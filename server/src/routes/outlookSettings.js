/**
 * Outlook Settings & Connection Lifecycle Routes
 * Implements Tasks P5.1 and P5.2 per docs/outlook-build/SPEC.md §4.1 and §5:
 * - GET /api/v1/integrations/outlook/status (Task P5.1)
 * - PATCH /api/v1/integrations/outlook/settings (Task P5.2)
 *
 * Future routes (P5.3 - P5.6):
 * - GET /api/v1/integrations/outlook/folders (P5.3)
 * - POST /api/v1/integrations/outlook/sync (P5.4)
 * - POST /api/v1/integrations/outlook/disconnect (P5.5)
 * - CSRF verification middleware for state-changing routes (P5.6)
 */

import { outlookConnectionStore } from '../services/outlookConnectionStore.js';
import { outlookVault } from '../services/outlookVault.js';
import { graphClient } from '../services/graphClient.js';
import { logger } from '../middleware/sanitizer.js';

/**
 * Checks whether the server environment and configuration support the Outlook integration.
 * Requires:
 * 1. Valid 32-byte OUTLOOK_TOKEN_ENC_KEY
 * 2. Non-empty OUTLOOK_CLIENT_ID
 *
 * @param {object} [options]
 * @returns {boolean}
 */
export function isOutlookConfigured(options = {}) {
  if (typeof options.isConfigured === 'boolean') {
    return options.isConfigured;
  }

  const keyValidation = outlookVault.validateKey(options.vaultKey);
  if (!keyValidation.valid) {
    return false;
  }

  const clientId = options.clientId !== undefined ? options.clientId : process.env.OUTLOOK_CLIENT_ID;
  if (!clientId || !String(clientId).trim()) {
    return false;
  }

  return true;
}

/**
 * Formats a connection record or status state into a sanitized status response.
 * Strictly guarantees zero token leakage.
 *
 * @param {'not_configured' | 'not_connected' | 'connected' | 'reconnect_required' | 'error'} status
 * @param {object|null} connection
 * @returns {object} Public status descriptor
 */
export function formatStatusResponse(status, connection = null) {
  if (status === 'not_configured' || status === 'not_connected' || !connection) {
    return {
      status,
      accountEmail: null,
      displayName: null,
      lastSyncAt: null,
      lastError: null,
      emailSyncEnabled: false,
      calendarSyncEnabled: false,
      mailFolderIds: [],
      scopes: [],
      connected: false
    };
  }

  return {
    status: connection.status || status,
    accountEmail: connection.accountEmail || null,
    displayName: connection.displayName || null,
    lastSyncAt: connection.lastSyncAt || null,
    lastError: connection.lastError || null,
    emailSyncEnabled: Boolean(connection.emailSyncEnabled),
    calendarSyncEnabled: Boolean(connection.calendarSyncEnabled),
    mailFolderIds: Array.isArray(connection.mailFolderIds) ? connection.mailFolderIds : [],
    scopes: Array.isArray(connection.scopes) ? connection.scopes : [],
    connected: connection.status === 'connected',
    connectedAt: connection.connectedAt || null,
    tenantId: connection.tenantId || null
  };
}

/**
 * Registers Outlook settings endpoints on the application router.
 *
 * @param {object} app - Application router instance
 * @param {object} security - Middleware handlers
 * @param {Function} security.authenticate - Session authentication middleware
 * @param {object} [options] - Injectable overrides for testing
 */
export function registerOutlookSettingsRoutes(app, { authenticate }, options = {}) {
  const connectionStore = options.connectionStore || outlookConnectionStore;
  const graph = options.graphClient || graphClient;

  /**
   * GET /api/v1/integrations/outlook/status
   * Returns sanitized connection metadata for the CEO Command Centre settings card.
   * Session required (401 if unauthenticated).
   */
  app.get('/api/v1/integrations/outlook/status', authenticate, (req, res) => {
    try {
      // 1. Verify feature configuration
      if (!isOutlookConfigured(options)) {
        return res.json(formatStatusResponse('not_configured'));
      }

      // 2. Read active connection from vault
      const vaultOptions = {
        filePath: options.vaultPath,
        key: options.vaultKey
      };

      const connection = connectionStore.getConnection(vaultOptions);

      if (!connection) {
        return res.json(formatStatusResponse('not_connected'));
      }

      return res.json(formatStatusResponse(connection.status, connection));
    } catch (err) {
      logger.error('Failed to retrieve Outlook connection status:', err);
      return res.json({
        status: 'error',
        accountEmail: null,
        displayName: null,
        lastSyncAt: null,
        lastError: 'Failed to read Outlook connection store',
        emailSyncEnabled: false,
        calendarSyncEnabled: false,
        mailFolderIds: [],
        scopes: [],
        connected: false
      });
    }
  });

  /**
   * PATCH /api/v1/integrations/outlook/settings
   * Updates sync toggles and folder selection.
   * Validates booleans and confirms mailFolderIds exist via Microsoft Graph.
   * Empty folder list is rejected with 422.
   * Session required (401 if unauthenticated).
   */
  app.patch('/api/v1/integrations/outlook/settings', authenticate, async (req, res) => {
    // 1. Verify feature configuration
    if (!isOutlookConfigured(options)) {
      return res.status(503).json({
        error: {
          code: 'OUTLOOK_NOT_CONFIGURED',
          message: 'Outlook integration is not configured on this server.'
        }
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
      logger.error('Failed to read Outlook connection store during settings update:', err);
      return res.status(500).json({
        error: {
          code: 'VAULT_READ_ERROR',
          message: 'Failed to access encrypted Outlook connection vault'
        }
      });
    }

    if (!connection) {
      return res.status(404).json({
        error: {
          code: 'OUTLOOK_NOT_CONNECTED',
          message: 'No active Outlook connection found. Connect an Outlook account before modifying settings.'
        }
      });
    }

    // 3. Validate body fields
    const body = req.body || {};
    const { emailSyncEnabled, calendarSyncEnabled, mailFolderIds } = body;

    if (emailSyncEnabled === undefined && calendarSyncEnabled === undefined && mailFolderIds === undefined) {
      return res.status(422).json({
        error: {
          code: 'VALIDATION_ERROR',
          message: 'At least one setting (emailSyncEnabled, calendarSyncEnabled, mailFolderIds) must be provided.'
        }
      });
    }

    // Boolean validation
    if (emailSyncEnabled !== undefined && typeof emailSyncEnabled !== 'boolean') {
      return res.status(422).json({
        error: {
          code: 'VALIDATION_ERROR',
          message: 'emailSyncEnabled must be a boolean.'
        }
      });
    }

    if (calendarSyncEnabled !== undefined && typeof calendarSyncEnabled !== 'boolean') {
      return res.status(422).json({
        error: {
          code: 'VALIDATION_ERROR',
          message: 'calendarSyncEnabled must be a boolean.'
        }
      });
    }

    // mailFolderIds validation
    if (mailFolderIds !== undefined) {
      if (!Array.isArray(mailFolderIds) || mailFolderIds.length === 0) {
        return res.status(422).json({
          error: {
            code: 'VALIDATION_ERROR',
            message: 'mailFolderIds cannot be empty. At least one folder ID must be selected.'
          }
        });
      }

      for (const id of mailFolderIds) {
        if (typeof id !== 'string' || !id.trim()) {
          return res.status(422).json({
            error: {
              code: 'VALIDATION_ERROR',
              message: 'Each item in mailFolderIds must be a non-empty string.'
            }
          });
        }
      }

      // 4. Verify folder IDs against Microsoft Graph
      try {
        const graphRes = await graph.get('/me/mailFolders?$top=100&$select=id,displayName', {
          ...options,
          vaultPath: options.vaultPath,
          vaultKey: options.vaultKey
        });

        const graphFolders = (graphRes && Array.isArray(graphRes.value)) ? graphRes.value : [];
        const validFolderIds = new Set();
        for (const f of graphFolders) {
          if (f.id) validFolderIds.add(f.id);
          if (f.displayName) validFolderIds.add(f.displayName.toLowerCase());
        }
        validFolderIds.add('inbox');

        const invalidIds = mailFolderIds.filter(id => !validFolderIds.has(id) && !validFolderIds.has(id.toLowerCase()));
        if (invalidIds.length > 0) {
          return res.status(422).json({
            error: {
              code: 'INVALID_MAIL_FOLDER',
              message: `Invalid folder ID(s): [${invalidIds.join(', ')}]. Folder does not exist in Microsoft Outlook account.`
            }
          });
        }
      } catch (graphErr) {
        if (graphErr.code === 'OUTLOOK_RECONNECT_REQUIRED') {
          return res.status(401).json({
            error: {
              code: 'OUTLOOK_RECONNECT_REQUIRED',
              message: 'Outlook connection requires re-authentication before folder settings can be verified.'
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
        logger.warn('Failed to verify mail folders via Graph:', graphErr.message);
        return res.status(502).json({
          error: {
            code: 'GRAPH_FOLDER_LOOKUP_FAILED',
            message: 'Could not reach Microsoft to verify mail folder IDs.'
          }
        });
      }
    }

    // 5. Atomically persist validated settings updates to vault
    const updates = {};
    if (emailSyncEnabled !== undefined) updates.emailSyncEnabled = emailSyncEnabled;
    if (calendarSyncEnabled !== undefined) updates.calendarSyncEnabled = calendarSyncEnabled;
    if (mailFolderIds !== undefined) updates.mailFolderIds = mailFolderIds;

    try {
      const updated = connectionStore.saveConnection(updates, vaultOptions);
      return res.json(formatStatusResponse(updated.status, updated));
    } catch (saveErr) {
      logger.error('Failed to save updated Outlook settings to vault:', saveErr);
      return res.status(500).json({
        error: {
          code: 'VAULT_SAVE_ERROR',
          message: 'Failed to write updated settings to encrypted vault.'
        }
      });
    }
  });

  return app;
}

export default registerOutlookSettingsRoutes;
