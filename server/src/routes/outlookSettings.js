/**
 * Outlook Settings & Connection Lifecycle Routes
 * Implements Task P5.1 per docs/outlook-build/SPEC.md §4.1 and §5:
 * - GET /api/v1/integrations/outlook/status
 *
 * Future routes (P5.2 - P5.6):
 * - PATCH /api/v1/integrations/outlook/settings (P5.2)
 * - GET /api/v1/integrations/outlook/folders (P5.3)
 * - POST /api/v1/integrations/outlook/sync (P5.4)
 * - POST /api/v1/integrations/outlook/disconnect (P5.5)
 * - CSRF verification middleware for state-changing routes (P5.6)
 */

import { outlookConnectionStore } from '../services/outlookConnectionStore.js';
import { outlookVault } from '../services/outlookVault.js';
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

  return app;
}

export default registerOutlookSettingsRoutes;
