/**
 * Microsoft Graph API Client & Token Lifecycle Service
 * Implements Task P4.1 per docs/outlook-build/SPEC.md §4.4:
 * - Bearer token resolution from encrypted vault
 * - Single-flight refresh (concurrent requests share one refresh promise)
 * - 401 Unauthorized handling: refresh once and retry once
 * - Refresh invalid_grant handling: sets status to reconnect_required and halts Graph calls
 * - 429/503 rate limiting: parses and caps Retry-After at 60s, surfaces "Sync error — Microsoft is busy, try again shortly"
 * - Network timeout (8s per Graph call): surfaces "Sync error — could not reach Microsoft"
 * - Rotated refresh token persistence: atomically updates encrypted vault
 */

import { outlookConnectionStore } from './outlookConnectionStore.js';
import { logger } from '../middleware/sanitizer.js';

export const GRAPH_BASE_URL = 'https://graph.microsoft.com/v1.0';
export const DEFAULT_GRAPH_TIMEOUT_MS = 8000; // 8 seconds per §4.4

/**
 * Custom Error class for Microsoft Graph operations with structured error codes.
 */
export class GraphClientError extends Error {
  constructor(code, message, options = {}) {
    super(message);
    this.name = 'GraphClientError';
    this.code = code;
    this.status = options.status || null;
    this.retryAfter = options.retryAfter !== undefined ? options.retryAfter : null;
    this.details = options.details || null;
  }
}

// Single-flight refresh state (ensures only one refresh runs concurrently across callers)
let activeRefreshPromise = null;

/**
 * Executes a token refresh against the Microsoft OAuth 2.0 token endpoint.
 *
 * @param {object} [options]
 * @returns {Promise<{ accessToken: string, refreshToken: string, accessTokenExpiresAt: number }>}
 */
async function executeTokenRefresh(options = {}) {
  const fetchFn = options.fetchFn || globalThis.fetch;
  const connectionStore = options.connectionStore || outlookConnectionStore;

  const conn = connectionStore.getConnection({
    filePath: options.vaultPath,
    key: options.vaultKey
  });

  if (!conn) {
    throw new GraphClientError('OUTLOOK_NOT_CONNECTED', 'No active Outlook connection found');
  }

  const tenant = options.tenantId || process.env.OUTLOOK_TENANT_ID || conn.tenantId || 'common';
  const tokenEndpoint = options.tokenEndpoint || `https://login.microsoftonline.com/${tenant}/oauth2/v2.0/token`;
  const clientId = (options.clientId || process.env.OUTLOOK_CLIENT_ID || '').trim();
  const clientSecret = (options.clientSecret || process.env.OUTLOOK_CLIENT_SECRET || '').trim();

  const params = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    grant_type: 'refresh_token',
    refresh_token: conn.refreshToken
  });

  if (conn.scopes && conn.scopes.length > 0) {
    params.set('scope', conn.scopes.join(' '));
  }

  logger.info(`Refreshing Microsoft Graph access token for actor [${conn.actorId}]`);

  let res;
  try {
    res = await fetchFn(tokenEndpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: params.toString(),
      signal: AbortSignal.timeout(options.refreshTimeoutMs || 10000)
    });
  } catch (netErr) {
    logger.error(`Network failure during token refresh: ${netErr.message}`);
    throw new GraphClientError('TOKEN_REFRESH_NETWORK_ERROR', `Failed to reach Microsoft token endpoint: ${netErr.message}`);
  }

  if (!res.ok) {
    let errBody = '';
    let parsedErr = {};
    try {
      errBody = await res.text();
      parsedErr = JSON.parse(errBody);
    } catch {}

    const isInvalidGrant =
      parsedErr.error === 'invalid_grant' ||
      errBody.includes('invalid_grant') ||
      (parsedErr.error_description && parsedErr.error_description.includes('invalid_grant'));

    if (isInvalidGrant) {
      logger.warn(`Refresh token rejected (invalid_grant) for actor [${conn.actorId}]. Transitioning to reconnect_required.`);

      // Update connection status in encrypted vault to reconnect_required
      connectionStore.saveConnection({
        status: 'reconnect_required',
        lastError: 'Refresh token expired, invalid, or revoked (invalid_grant)'
      }, {
        filePath: options.vaultPath,
        key: options.vaultKey
      });

      throw new GraphClientError(
        'OUTLOOK_RECONNECT_REQUIRED',
        'Outlook connection requires re-authentication (invalid_grant)',
        { status: 400, details: errBody }
      );
    }

    logger.error(`Token refresh failed with HTTP ${res.status}: ${errBody}`);
    throw new GraphClientError(
      'TOKEN_REFRESH_FAILED',
      `Token refresh failed with HTTP ${res.status}`,
      { status: res.status, details: errBody }
    );
  }

  const data = await res.json();
  const newAccessToken = String(data.access_token || '').trim();
  const newRefreshToken = String(data.refresh_token || conn.refreshToken).trim();
  const expiresIn = typeof data.expires_in === 'number' ? data.expires_in : 3600;
  const accessTokenExpiresAt = Date.now() + (expiresIn * 1000);

  if (!newAccessToken) {
    throw new GraphClientError('INVALID_TOKEN_RESPONSE', 'Token refresh response missing access_token');
  }

  // Atomically persist rotated refresh token and new access token into encrypted vault
  connectionStore.saveConnection({
    accessToken: newAccessToken,
    refreshToken: newRefreshToken,
    accessTokenExpiresAt,
    status: 'connected',
    lastError: null
  }, {
    filePath: options.vaultPath,
    key: options.vaultKey
  });

  logger.info(`Access token refreshed successfully for actor [${conn.actorId}]. Valid until ${new Date(accessTokenExpiresAt).toISOString()}`);

  return {
    accessToken: newAccessToken,
    refreshToken: newRefreshToken,
    accessTokenExpiresAt
  };
}

/**
 * Single-flight token refresh wrapper.
 * Ensures concurrent callers share the exact same refresh promise, preventing race conditions
 * and Microsoft token rotation collisions.
 *
 * @param {object} [options]
 * @returns {Promise<{ accessToken: string, refreshToken: string, accessTokenExpiresAt: number }>}
 */
export function refreshAccessToken(options = {}) {
  if (activeRefreshPromise) {
    return activeRefreshPromise;
  }

  activeRefreshPromise = (async () => {
    try {
      return await executeTokenRefresh(options);
    } finally {
      activeRefreshPromise = null;
    }
  })();

  return activeRefreshPromise;
}

/**
 * Returns whether a single-flight token refresh is currently active.
 *
 * @returns {boolean}
 */
export function isRefreshActive() {
  return activeRefreshPromise !== null;
}

/**
 * Executes an authenticated GET request against Microsoft Graph API.
 * Handles bearer injection from vault, token expiration, 401 retry, 429/503 backoff, and 8s timeouts.
 *
 * @param {string} endpointPath - Graph path (e.g., '/me/calendarView') or full Graph URL
 * @param {object} [options]
 * @param {object} [options.headers] - Additional HTTP headers
 * @param {number} [options.timeoutMs=8000] - Request timeout in ms (default 8s)
 * @param {Function} [options.fetchFn=globalThis.fetch]
 * @param {string} [options.vaultPath]
 * @param {string|Buffer} [options.vaultKey]
 * @param {boolean} [options._isRetry=false] - Internal flag preventing infinite 401 retry loops
 * @returns {Promise<any>} Parsed response data from Graph
 */
export async function get(endpointPath, options = {}) {
  const fetchFn = options.fetchFn || globalThis.fetch;
  const connectionStore = options.connectionStore || outlookConnectionStore;
  const timeoutMs = typeof options.timeoutMs === 'number' ? options.timeoutMs : DEFAULT_GRAPH_TIMEOUT_MS;

  // 1. Resolve current connection from vault
  let conn = connectionStore.getConnection({
    filePath: options.vaultPath,
    key: options.vaultKey
  });

  if (!conn) {
    throw new GraphClientError('OUTLOOK_NOT_CONNECTED', 'No active Outlook connection found');
  }

  if (conn.status === 'reconnect_required') {
    throw new GraphClientError('OUTLOOK_RECONNECT_REQUIRED', 'Outlook connection requires re-authentication');
  }

  // 2. Check access token freshness (refresh if expired or within 60-second window)
  const now = Date.now();
  if (!conn.accessToken || conn.accessTokenExpiresAt <= (now + 60000)) {
    await refreshAccessToken(options);
    conn = connectionStore.getConnection({
      filePath: options.vaultPath,
      key: options.vaultKey
    });
  }

  // 3. Assemble target URL
  const baseUrl = options.baseUrl || GRAPH_BASE_URL;
  const fullUrl = endpointPath.startsWith('http://') || endpointPath.startsWith('https://')
    ? endpointPath
    : `${baseUrl.replace(/\/+$/, '')}/${endpointPath.replace(/^\/+/, '')}`;

  // 4. Assemble headers
  const headers = {
    'Accept': 'application/json',
    ...(options.headers || {}),
    'Authorization': `Bearer ${conn.accessToken}`
  };

  // 5. Execute HTTP request with 8s timeout
  let res;
  try {
    res = await fetchFn(fullUrl, {
      method: 'GET',
      headers,
      signal: AbortSignal.timeout(timeoutMs)
    });
  } catch (netErr) {
    const isTimeout =
      netErr.name === 'TimeoutError' ||
      netErr.name === 'AbortError' ||
      (netErr.message && netErr.message.toLowerCase().includes('timeout'));

    if (isTimeout) {
      logger.warn(`Microsoft Graph request timed out after ${timeoutMs}ms on [${fullUrl}]`);
      try {
        connectionStore.saveConnection({
          lastError: 'Sync error — could not reach Microsoft'
        }, {
          filePath: options.vaultPath,
          key: options.vaultKey
        });
      } catch {}

      throw new GraphClientError(
        'MICROSOFT_UNREACHABLE',
        'Sync error — could not reach Microsoft',
        { details: netErr.message }
      );
    }

    logger.error(`Network error calling Microsoft Graph: ${netErr.message}`);
    throw new GraphClientError(
      'NETWORK_ERROR',
      `Failed to contact Microsoft Graph: ${netErr.message}`,
      { details: netErr.message }
    );
  }

  // 6. Handle 401 Unauthorized (refresh once, retry once)
  if (res.status === 401) {
    if (options._isRetry) {
      logger.error('Microsoft Graph returned 401 on retried request. Setting status to reconnect_required.');
      connectionStore.saveConnection({
        status: 'reconnect_required',
        lastError: 'Unauthorized on retried Graph request'
      }, {
        filePath: options.vaultPath,
        key: options.vaultKey
      });

      throw new GraphClientError(
        'OUTLOOK_RECONNECT_REQUIRED',
        'Outlook connection requires re-authentication',
        { status: 401 }
      );
    }

    logger.info('Microsoft Graph returned 401. Refreshing access token and retrying once.');
    await refreshAccessToken(options);

    return get(endpointPath, {
      ...options,
      _isRetry: true
    });
  }

  // 7. Handle 429 or 503 (Microsoft is busy / Rate Limit)
  if (res.status === 429 || res.status === 503) {
    const rawRetry = res.headers?.get ? res.headers.get('retry-after') : (res.headers && res.headers['retry-after']);
    let retryAfterSec = 60;
    if (rawRetry) {
      const parsed = parseInt(rawRetry, 10);
      if (!isNaN(parsed) && parsed > 0) {
        retryAfterSec = Math.min(parsed, 60); // Cap at 60s per §4.4
      }
    }

    logger.warn(`Microsoft Graph rate limit / busy (HTTP ${res.status}). Retry-After: ${retryAfterSec}s`);
    try {
      connectionStore.saveConnection({
        lastError: 'Sync error — Microsoft is busy, try again shortly'
      }, {
        filePath: options.vaultPath,
        key: options.vaultKey
      });
    } catch {}

    throw new GraphClientError(
      'MICROSOFT_BUSY',
      'Sync error — Microsoft is busy, try again shortly',
      { status: res.status, retryAfter: retryAfterSec }
    );
  }

  // 8. Handle other HTTP errors
  if (!res.ok) {
    let errText = '';
    try {
      errText = await res.text();
    } catch {}

    logger.warn(`Microsoft Graph returned HTTP ${res.status}: ${errText}`);
    throw new GraphClientError(
      'GRAPH_API_ERROR',
      `Microsoft Graph returned HTTP ${res.status}`,
      { status: res.status, details: errText }
    );
  }

  // 9. Parse and return success data
  try {
    const data = await res.json();
    return data;
  } catch (parseErr) {
    return null;
  }
}

export const graphClient = {
  GRAPH_BASE_URL,
  DEFAULT_GRAPH_TIMEOUT_MS,
  GraphClientError,
  refreshAccessToken,
  isRefreshActive,
  get
};

export default graphClient;
