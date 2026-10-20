/**
 * Outlook Connection Repository & Store
 * Manages the single encrypted connection record for the owner (Kirsty Allen),
 * persisting all credentials, sync toggles, and metadata inside the encrypted vault.
 *
 * Connection Schema:
 * {
 *   actorId: string,
 *   status: 'connected' | 'reconnect_required' | 'error',
 *   accountEmail: string,
 *   displayName: string,
 *   tenantId: string,
 *   scopes: string[],
 *   refreshToken: string,
 *   accessToken: string,
 *   accessTokenExpiresAt: number,
 *   emailSyncEnabled: boolean,
 *   calendarSyncEnabled: boolean,
 *   mailFolderIds: string[],
 *   connectedAt: string (ISO),
 *   lastSyncAt: string | null (ISO),
 *   lastError: string | null
 * }
 */

import { outlookVault } from './outlookVault.js';

export const VALID_STATUSES = ['connected', 'reconnect_required', 'error'];

/**
 * Validates and normalizes an Outlook connection record against the required schema.
 *
 * @param {object} record
 * @param {object} [existing] - Existing record to merge against for partial updates
 * @returns {object} Validated connection record
 */
export function validateConnectionSchema(record, existing = null) {
  if (!record || typeof record !== 'object') {
    throw new Error('Connection record must be a non-null object');
  }

  const merged = { ...(existing || {}), ...record };

  // Validate required identity fields
  if (!merged.actorId || typeof merged.actorId !== 'string') {
    throw new Error('Connection record requires a valid actorId string');
  }

  if (!merged.accountEmail || typeof merged.accountEmail !== 'string') {
    throw new Error('Connection record requires a valid accountEmail string');
  }

  // Validate status
  const status = merged.status || 'connected';
  if (!VALID_STATUSES.includes(status)) {
    throw new Error(`Invalid connection status "${status}". Expected one of: ${VALID_STATUSES.join(', ')}`);
  }

  // Validate tokens
  if (!merged.refreshToken || typeof merged.refreshToken !== 'string') {
    throw new Error('Connection record requires a valid refreshToken string');
  }

  // Normalize array fields
  const scopes = Array.isArray(merged.scopes)
    ? merged.scopes.map(s => String(s).trim()).filter(Boolean)
    : [];

  const mailFolderIds = Array.isArray(merged.mailFolderIds)
    ? merged.mailFolderIds.map(f => String(f).trim()).filter(Boolean)
    : ['Inbox'];

  return {
    actorId: String(merged.actorId).trim(),
    status,
    accountEmail: String(merged.accountEmail).trim(),
    displayName: String(merged.displayName || '').trim(),
    tenantId: String(merged.tenantId || '').trim(),
    scopes,
    refreshToken: String(merged.refreshToken).trim(),
    accessToken: String(merged.accessToken || '').trim(),
    accessTokenExpiresAt: typeof merged.accessTokenExpiresAt === 'number' ? merged.accessTokenExpiresAt : 0,
    emailSyncEnabled: merged.emailSyncEnabled !== undefined ? Boolean(merged.emailSyncEnabled) : true,
    calendarSyncEnabled: merged.calendarSyncEnabled !== undefined ? Boolean(merged.calendarSyncEnabled) : true,
    mailFolderIds,
    connectedAt: merged.connectedAt || new Date().toISOString(),
    lastSyncAt: merged.lastSyncAt ? String(merged.lastSyncAt) : null,
    lastError: merged.lastError ? String(merged.lastError) : null
  };
}

/**
 * Retrieves the active Outlook connection record from the encrypted vault.
 * Returns null if no connection exists or if the vault file is empty.
 *
 * @param {object} [options]
 * @param {string} [options.filePath] - Vault file path override
 * @param {string|Buffer} [options.key] - Encryption key override
 * @returns {object|null} The decrypted connection record or null
 */
export function getConnection(options = {}) {
  try {
    const raw = outlookVault.readVault(options);
    if (!raw) return null;
    return validateConnectionSchema(raw);
  } catch (err) {
    if (err.message && err.message.includes('authentication tag verification error')) {
      throw err;
    }
    return null;
  }
}

/**
 * Saves or updates the owner's Outlook connection record inside the encrypted vault.
 * Automatically performs schema validation and merges with existing records for partial updates.
 *
 * @param {object} record - Full or partial connection data
 * @param {object} [options]
 * @param {string} [options.filePath] - Vault file path override
 * @param {string|Buffer} [options.key] - Encryption key override
 * @returns {object} The validated and saved connection record
 */
export function saveConnection(record, options = {}) {
  const existing = getConnection(options);
  const validated = validateConnectionSchema(record, existing);

  outlookVault.writeVault(validated, options);
  return validated;
}

/**
 * Permanently deletes the Outlook connection record and purges the encrypted vault.
 *
 * @param {object} [options]
 * @param {string} [options.filePath] - Vault file path override
 * @returns {boolean} True if deleted, false if no record existed
 */
export function deleteConnection(options = {}) {
  return outlookVault.deleteVault(options);
}

/**
 * Returns a sanitized view of the connection suitable for client status responses.
 * Never exposes refresh tokens, access tokens, or internal encryption keys.
 *
 * @param {object|null} connection
 * @returns {object} Public status descriptor
 */
export function getSanitizedStatus(connection) {
  if (!connection) {
    return {
      status: 'disconnected',
      connected: false
    };
  }

  return {
    status: connection.status,
    connected: connection.status === 'connected',
    accountEmail: connection.accountEmail,
    displayName: connection.displayName,
    tenantId: connection.tenantId,
    scopes: connection.scopes,
    emailSyncEnabled: connection.emailSyncEnabled,
    calendarSyncEnabled: connection.calendarSyncEnabled,
    mailFolderIds: connection.mailFolderIds,
    connectedAt: connection.connectedAt,
    lastSyncAt: connection.lastSyncAt,
    lastError: connection.lastError
  };
}

export const outlookConnectionStore = {
  VALID_STATUSES,
  validateConnectionSchema,
  getConnection,
  saveConnection,
  deleteConnection,
  getSanitizedStatus
};

export default outlookConnectionStore;
