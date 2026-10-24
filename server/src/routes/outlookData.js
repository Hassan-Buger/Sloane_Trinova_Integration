/**
 * Outlook Data Routes: Diary & Flagged Emails
 * Implements Task P6.1 per docs/outlook-build/SPEC.md §4.3 and §5:
 * - GET /api/v1/outlook/diary (Calendar events covering today in Europe/London)
 * - GET /api/v1/outlook/flagged-emails (Flagged messages across selected folders)
 * - Both endpoints require an active session (401 if unauthenticated)
 * - Clean empty states with exact specification messages when not connected or sync toggled off
 * - Per-user 2-minute in-memory caching
 * - Strict zero token leakage
 */

import { outlookConnectionStore } from '../services/outlookConnectionStore.js';
import { isOutlookConfigured } from './outlookSettings.js';
import { graphClient } from '../services/graphClient.js';
import {
  mapGraphEventsToDiary,
  mapGraphMessagesToFlagged,
  getCachedResource,
  setCachedResource
} from '../services/outlookDataService.js';
import { logger } from '../middleware/sanitizer.js';

/**
 * Registers Outlook diary and flagged emails endpoints on the router.
 *
 * @param {object} app - Application router
 * @param {object} security - Security middlewares
 * @param {Function} security.authenticate - Session authentication middleware
 * @param {object} [options] - Injectable overrides for testing
 */
export function registerOutlookDataRoutes(app, { authenticate }, options = {}) {
  const connectionStore = options.connectionStore || outlookConnectionStore;
  const graph = options.graphClient || graphClient;

  /**
   * GET /api/v1/outlook/diary
   * Fetches today's calendar events from Microsoft Graph for the CEO Command Centre.
   * Query params: ?date=today (optional)
   * Session required (401 if unauthenticated).
   */
  app.get('/api/v1/outlook/diary', authenticate, async (req, res) => {
    const actorId = req.actor?.id || req.actor?.email || 'default';

    // 1. Verify feature configuration
    if (!isOutlookConfigured(options)) {
      return res.json({
        connected: false,
        enabled: false,
        code: 'OUTLOOK_NOT_CONFIGURED',
        message: 'Connect your Outlook to see this here',
        items: []
      });
    }

    // 2. Read active connection from vault
    const vaultOptions = {
      filePath: options.vaultPath,
      key: options.vaultKey
    };

    let connection;
    try {
      connection = connectionStore.getConnection(vaultOptions);
    } catch (err) {
      logger.error('Failed to read Outlook connection store for diary:', err);
      return res.status(500).json({
        error: {
          code: 'VAULT_READ_ERROR',
          message: 'Sloane could not open its saved Outlook connection. Please tell your Sloane administrator.'
        }
      });
    }

    // 3. Handle empty states: not connected or reconnect required
    if (!connection) {
      return res.json({
        connected: false,
        enabled: false,
        code: 'OUTLOOK_NOT_CONNECTED',
        message: 'Connect your Outlook to see this here',
        items: []
      });
    }

    if (connection.status === 'reconnect_required') {
      return res.json({
        connected: false,
        enabled: true,
        code: 'OUTLOOK_RECONNECT_REQUIRED',
        message: 'Reconnect your Outlook',
        items: []
      });
    }

    // 4. Handle switched-off calendar toggle
    if (!connection.calendarSyncEnabled) {
      return res.json({
        connected: true,
        enabled: false,
        code: 'CALENDAR_SYNC_DISABLED',
        message: 'Calendar sync is off',
        items: []
      });
    }

    // 5. Check in-memory 2-minute cache
    const cached = getCachedResource(actorId, 'diary');
    if (cached) {
      return res.json({
        ...cached,
        fromCache: true
      });
    }

    // 6. Fetch today's events from Microsoft Graph
    try {
      const now = new Date();
      const startOfDay = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 0, 0, 0)).toISOString();
      const endOfDay = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 23, 59, 59, 999)).toISOString();

      const calendarEndpoint = `/me/calendarView?startDateTime=${encodeURIComponent(startOfDay)}&endDateTime=${encodeURIComponent(endOfDay)}&$select=subject,start,end,location,isAllDay,showAs&$orderby=start/dateTime`;

      const graphRes = await graph.get(calendarEndpoint, {
        ...options,
        headers: { Prefer: 'outlook.timezone="GMT Standard Time"' },
        vaultPath: options.vaultPath,
        vaultKey: options.vaultKey
      });

      const rawEvents = (graphRes && Array.isArray(graphRes.value)) ? graphRes.value : [];
      const items = mapGraphEventsToDiary(rawEvents);

      const responsePayload = {
        connected: true,
        enabled: true,
        items,
        count: items.length,
        lastSyncAt: connection.lastSyncAt || null,
        fromCache: false
      };

      // 7. Store in 2-minute in-memory cache
      setCachedResource(actorId, 'diary', responsePayload);

      return res.json(responsePayload);
    } catch (graphErr) {
      if (graphErr.code === 'OUTLOOK_RECONNECT_REQUIRED') {
        try {
          connectionStore.saveConnection({
            status: 'reconnect_required',
            lastError: 'Your Outlook connection needs to be set up again. Please reconnect Outlook in Settings.'
          }, vaultOptions);
        } catch {}

        return res.status(401).json({
          error: {
            code: 'OUTLOOK_RECONNECT_REQUIRED',
            message: 'Your Outlook connection needs to be set up again. Please reconnect Outlook in Settings.'
          }
        });
      }

      if (graphErr.code === 'MICROSOFT_BUSY') {
        return res.status(503).json({
          error: {
            code: 'MICROSOFT_BUSY',
            message: 'Sync error — Microsoft is busy, try again shortly.'
          }
        });
      }

      logger.warn('Failed to fetch Outlook calendar view:', graphErr.message);
      return res.status(502).json({
        error: {
          code: 'GRAPH_UNAVAILABLE',
          message: 'Sync error — could not reach Microsoft'
        }
      });
    }
  });

  /**
   * GET /api/v1/outlook/flagged-emails
   * Fetches flagged messages across selected mail folders for the CEO Command Centre.
   * Session required (401 if unauthenticated).
   */
  app.get('/api/v1/outlook/flagged-emails', authenticate, async (req, res) => {
    const actorId = req.actor?.id || req.actor?.email || 'default';

    // 1. Verify feature configuration
    if (!isOutlookConfigured(options)) {
      return res.json({
        connected: false,
        enabled: false,
        code: 'OUTLOOK_NOT_CONFIGURED',
        message: 'Connect your Outlook to see this here',
        items: []
      });
    }

    // 2. Read active connection from vault
    const vaultOptions = {
      filePath: options.vaultPath,
      key: options.vaultKey
    };

    let connection;
    try {
      connection = connectionStore.getConnection(vaultOptions);
    } catch (err) {
      logger.error('Failed to read Outlook connection store for flagged emails:', err);
      return res.status(500).json({
        error: {
          code: 'VAULT_READ_ERROR',
          message: 'Sloane could not open its saved Outlook connection. Please tell your Sloane administrator.'
        }
      });
    }

    // 3. Handle empty states: not connected or reconnect required
    if (!connection) {
      return res.json({
        connected: false,
        enabled: false,
        code: 'OUTLOOK_NOT_CONNECTED',
        message: 'Connect your Outlook to see this here',
        items: []
      });
    }

    if (connection.status === 'reconnect_required') {
      return res.json({
        connected: false,
        enabled: true,
        code: 'OUTLOOK_RECONNECT_REQUIRED',
        message: 'Reconnect your Outlook',
        items: []
      });
    }

    // 4. Handle switched-off email toggle
    if (!connection.emailSyncEnabled) {
      return res.json({
        connected: true,
        enabled: false,
        code: 'EMAIL_SYNC_DISABLED',
        message: 'Email sync is off',
        items: []
      });
    }

    // 5. Check in-memory 2-minute cache
    const cached = getCachedResource(actorId, 'flagged-emails');
    if (cached) {
      return res.json({
        ...cached,
        fromCache: true
      });
    }

    // 6. Fetch flagged messages from Microsoft Graph across folders
    try {
      const folders = Array.isArray(connection.mailFolderIds) && connection.mailFolderIds.length > 0
        ? connection.mailFolderIds
        : ['Inbox'];

      const filterQuery = encodeURIComponent("flag/flagStatus eq 'flagged'");
      const combinedMessages = [];
      const seenIds = new Set();

      for (const folderId of folders) {
        const emailEndpoint = `/me/mailFolders/${encodeURIComponent(folderId)}/messages?$filter=${filterQuery}&$select=subject,from,receivedDateTime,importance,webLink&$orderby=receivedDateTime desc&$top=25`;

        const emailRes = await graph.get(emailEndpoint, {
          ...options,
          vaultPath: options.vaultPath,
          vaultKey: options.vaultKey
        });

        if (emailRes && Array.isArray(emailRes.value)) {
          for (const msg of emailRes.value) {
            const id = String(msg.id || '');
            if (!id || !seenIds.has(id)) {
              if (id) seenIds.add(id);
              combinedMessages.push(msg);
            }
          }
        }
      }

      // Sort newest first by receivedDateTime descending
      combinedMessages.sort((a, b) => {
        const timeA = a.receivedDateTime ? new Date(a.receivedDateTime).getTime() : 0;
        const timeB = b.receivedDateTime ? new Date(b.receivedDateTime).getTime() : 0;
        return timeB - timeA;
      });

      // Cap at 25 per §4.3
      const capped = combinedMessages.slice(0, 25);
      const items = mapGraphMessagesToFlagged(capped);

      const responsePayload = {
        connected: true,
        enabled: true,
        items,
        count: items.length,
        lastSyncAt: connection.lastSyncAt || null,
        fromCache: false
      };

      // 7. Store in 2-minute in-memory cache
      setCachedResource(actorId, 'flagged-emails', responsePayload);

      return res.json(responsePayload);
    } catch (graphErr) {
      if (graphErr.code === 'OUTLOOK_RECONNECT_REQUIRED') {
        try {
          connectionStore.saveConnection({
            status: 'reconnect_required',
            lastError: 'Your Outlook connection needs to be set up again. Please reconnect Outlook in Settings.'
          }, vaultOptions);
        } catch {}

        return res.status(401).json({
          error: {
            code: 'OUTLOOK_RECONNECT_REQUIRED',
            message: 'Your Outlook connection needs to be set up again. Please reconnect Outlook in Settings.'
          }
        });
      }

      if (graphErr.code === 'MICROSOFT_BUSY') {
        return res.status(503).json({
          error: {
            code: 'MICROSOFT_BUSY',
            message: 'Sync error — Microsoft is busy, try again shortly.'
          }
        });
      }

      logger.warn('Failed to fetch Outlook flagged emails:', graphErr.message);
      return res.status(502).json({
        error: {
          code: 'GRAPH_UNAVAILABLE',
          message: 'Sync error — could not reach Microsoft'
        }
      });
    }
  });

  return app;
}

export default registerOutlookDataRoutes;
