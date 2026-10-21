/**
 * Unit 18 Test Suite: Outlook Settings Routes (Tasks P5.1 and P5.2)
 *
 * Verifies:
 * - GET /api/v1/integrations/outlook/status (Task P5.1)
 *   1. Unauthenticated request returns 401 UNAUTHORIZED
 *   2. Unconfigured environment returns status: 'not_configured'
 *   3. Configured but empty vault returns status: 'not_connected'
 *   4. Connected vault record returns status: 'connected' with all required metadata fields
 *   5. Reconnect required status returns status: 'reconnect_required'
 *   6. Error status returns status: 'error' with lastError message
 *   7. Vault read failure handled gracefully with status: 'error'
 *   8. Strict token safety: tokens (access/refresh/id/secrets) NEVER appear in response body or raw JSON
 * - PATCH /api/v1/integrations/outlook/settings (Task P5.2)
 *   9. Unauthenticated request returns 401 UNAUTHORIZED
 *   10. Unconfigured environment returns 503 OUTLOOK_NOT_CONFIGURED
 *   11. Not connected state returns 404 OUTLOOK_NOT_CONNECTED
 *   12. Empty body returns 422 VALIDATION_ERROR
 *   13. Non-boolean emailSyncEnabled or calendarSyncEnabled returns 422 VALIDATION_ERROR
 *   14. Empty mailFolderIds array returns 422 VALIDATION_ERROR
 *   15. Non-string or whitespace mailFolderIds returns 422 VALIDATION_ERROR
 *   16. Invalid folder IDs not found in Graph returns 422 INVALID_MAIL_FOLDER
 *   17. Graph reconnect_required returns 401 OUTLOOK_RECONNECT_REQUIRED
 *   18. Graph busy (429/503) returns 503 MICROSOFT_BUSY
 *   19. Graph network error returns 502 GRAPH_FOLDER_LOOKUP_FAILED
 *   20. Successful update persists booleans and valid mailFolderIds to encrypted vault
 *   21. Zero token leakage assertion on PATCH responses
 */

import { test, describe, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

import { createApp } from '../src/app.js';
import { sessionStore } from '../src/services/sessionStore.js';
import { outlookConnectionStore } from '../src/services/outlookConnectionStore.js';
import { formatStatusResponse, isOutlookConfigured, setSyncActiveForTest, clearOutlookDataCache, outlookDataCache } from '../src/routes/outlookSettings.js';
import { GraphClientError } from '../src/services/graphClient.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const TEST_ENC_KEY = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
const TEST_VAULT_PATH = path.resolve(__dirname, '../data-private/test-unit18-vault.json');
const TEST_CLIENT_ID = 'test-outlook-client-id-500';
const TEST_PORT = 5006;

const SENSITIVE_TOKENS = {
  refreshToken: 'RT_SUPER_SECRET_REFRESH_TOKEN_UNIT18',
  accessToken: 'AT_SUPER_SECRET_ACCESS_TOKEN_UNIT18'
};

const VALID_GRAPH_FOLDERS = [
  { id: 'folder_inbox_id_123', displayName: 'Inbox' },
  { id: 'folder_archive_id_456', displayName: 'Archive' },
  { id: 'folder_finance_id_789', displayName: 'Finance' }
];

describe('Tasks P5.1 & P5.2: Outlook Settings Endpoints', () => {
  let server;
  let baseUrl;
  let sessionCookie;
  let mockGraphResponse = null;
  let mockGraphError = null;

  const mockGraphClient = {
    async get(endpoint, opts) {
      if (mockGraphError) throw mockGraphError;
      return mockGraphResponse;
    }
  };

  before(() => {
    process.env.OUTLOOK_TOKEN_ENC_KEY = TEST_ENC_KEY;
    process.env.OUTLOOK_VAULT_PATH = TEST_VAULT_PATH;
    process.env.OUTLOOK_CLIENT_ID = TEST_CLIENT_ID;

    // Create authenticated CEO session
    const session = sessionStore.createSession({
      email: 'kirsty@trinova.com',
      name: 'Kirsty Allen'
    });
    sessionCookie = `slon_session=${session.sessionId}`;

    const app = createApp({
      outlookOptions: {
        vaultPath: TEST_VAULT_PATH,
        vaultKey: TEST_ENC_KEY,
        clientId: TEST_CLIENT_ID,
        graphClient: mockGraphClient
      }
    });

    return new Promise(resolve => {
      server = app.listen(TEST_PORT, () => {
        baseUrl = `http://localhost:${TEST_PORT}`;
        resolve();
      });
    });
  });

  after(() => {
    if (fs.existsSync(TEST_VAULT_PATH)) {
      try { fs.unlinkSync(TEST_VAULT_PATH); } catch {}
    }
    return new Promise(resolve => server.close(resolve));
  });

  beforeEach(() => {
    mockGraphError = null;
    mockGraphResponse = { value: VALID_GRAPH_FOLDERS };
    if (fs.existsSync(TEST_VAULT_PATH)) {
      try { fs.unlinkSync(TEST_VAULT_PATH); } catch {}
    }
  });

  // Helper for HTTP requests
  function makeRequest(reqPath, options = {}) {
    return new Promise((resolve, reject) => {
      const url = new URL(reqPath, baseUrl);
      const reqHeaders = { ...(options.headers || {}) };
      if (options.body && !reqHeaders['Content-Type']) {
        reqHeaders['Content-Type'] = 'application/json';
      }

      const req = http.request(url, { ...options, headers: reqHeaders }, res => {
        let raw = '';
        res.on('data', chunk => raw += chunk);
        res.on('end', () => {
          let body = null;
          try {
            body = JSON.parse(raw);
          } catch (_) {
            body = raw;
          }
          resolve({ status: res.statusCode, headers: res.headers, raw, body });
        });
      });
      req.on('error', reject);
      if (options.body) {
        req.write(typeof options.body === 'string' ? options.body : JSON.stringify(options.body));
      }
      req.end();
    });
  }

  // ==========================================
  // P5.1: GET /api/v1/integrations/outlook/status
  // ==========================================
  describe('Task P5.1: GET status', () => {
    test('1. Unauthenticated request to /api/v1/integrations/outlook/status returns 401 UNAUTHORIZED', async () => {
      const res = await makeRequest('/api/v1/integrations/outlook/status', {
        method: 'GET'
      });

      assert.equal(res.status, 401);
      assert.equal(res.body?.error?.code, 'UNAUTHORIZED');
    });

    test('2. isOutlookConfigured correctly determines readiness from key and client ID', () => {
      assert.equal(isOutlookConfigured({ isConfigured: true }), true);
      assert.equal(isOutlookConfigured({ isConfigured: false }), false);

      assert.equal(isOutlookConfigured({ vaultKey: TEST_ENC_KEY, clientId: 'client_id' }), true);
      assert.equal(isOutlookConfigured({ vaultKey: '', clientId: 'client_id' }), false);
      assert.equal(isOutlookConfigured({ vaultKey: TEST_ENC_KEY, clientId: '' }), false);
    });

    test('3. formatStatusResponse sanitizes records and guarantees schema conformity', () => {
      const unconfigured = formatStatusResponse('not_configured');
      assert.equal(unconfigured.status, 'not_configured');
      assert.equal(unconfigured.connected, false);
      assert.equal(unconfigured.accountEmail, null);
      assert.deepEqual(unconfigured.scopes, []);
      assert.deepEqual(unconfigured.mailFolderIds, []);

      const fullRecord = {
        status: 'connected',
        accountEmail: 'kirsty.allen@trinova.co.uk',
        displayName: 'Kirsty Allen',
        lastSyncAt: '2026-10-21T12:00:00Z',
        lastError: null,
        emailSyncEnabled: true,
        calendarSyncEnabled: true,
        mailFolderIds: ['Inbox', 'Drafts'],
        scopes: ['Mail.Read', 'Calendars.Read'],
        refreshToken: SENSITIVE_TOKENS.refreshToken,
        accessToken: SENSITIVE_TOKENS.accessToken
      };

      const formatted = formatStatusResponse('connected', fullRecord);
      assert.equal(formatted.status, 'connected');
      assert.equal(formatted.connected, true);
      assert.equal(formatted.accountEmail, 'kirsty.allen@trinova.co.uk');
      assert.equal(formatted.displayName, 'Kirsty Allen');
      assert.equal(formatted.lastSyncAt, '2026-10-21T12:00:00Z');
      assert.equal(formatted.lastError, null);
      assert.equal(formatted.emailSyncEnabled, true);
      assert.equal(formatted.calendarSyncEnabled, true);
      assert.deepEqual(formatted.mailFolderIds, ['Inbox', 'Drafts']);
      assert.deepEqual(formatted.scopes, ['Mail.Read', 'Calendars.Read']);

      // Ensure tokens are absent
      assert.equal(formatted.refreshToken, undefined);
      assert.equal(formatted.accessToken, undefined);
    });

    test('4. GET /api/v1/integrations/outlook/status returns not_configured when configuration is missing', async () => {
      const origClientId = process.env.OUTLOOK_CLIENT_ID;
      delete process.env.OUTLOOK_CLIENT_ID;

      const unconfiguredApp = createApp({
        outlookOptions: {
          vaultPath: TEST_VAULT_PATH,
          vaultKey: TEST_ENC_KEY,
          clientId: ''
        }
      });

      const unconfPort = 5007;
      const unconfServer = unconfiguredApp.listen(unconfPort);

      try {
        const res = await new Promise((resolve, reject) => {
          const req = http.request(`http://localhost:${unconfPort}/api/v1/integrations/outlook/status`, {
            headers: { Cookie: sessionCookie }
          }, res => {
            let raw = '';
            res.on('data', chunk => raw += chunk);
            res.on('end', () => resolve({ status: res.statusCode, body: JSON.parse(raw) }));
          });
          req.on('error', reject);
          req.end();
        });

        assert.equal(res.status, 200);
        assert.equal(res.body.status, 'not_configured');
        assert.equal(res.body.connected, false);
        assert.equal(res.body.accountEmail, null);
        assert.deepEqual(res.body.mailFolderIds, []);
      } finally {
        process.env.OUTLOOK_CLIENT_ID = origClientId;
        await new Promise(resolve => unconfServer.close(resolve));
      }
    });

    test('5. GET /api/v1/integrations/outlook/status returns not_connected when no connection exists in vault', async () => {
      const res = await makeRequest('/api/v1/integrations/outlook/status', {
        headers: { Cookie: sessionCookie }
      });

      assert.equal(res.status, 200);
      assert.equal(res.body.status, 'not_connected');
      assert.equal(res.body.connected, false);
      assert.equal(res.body.accountEmail, null);
      assert.equal(res.body.displayName, null);
      assert.equal(res.body.lastSyncAt, null);
      assert.equal(res.body.lastError, null);
      assert.equal(res.body.emailSyncEnabled, false);
      assert.equal(res.body.calendarSyncEnabled, false);
      assert.deepEqual(res.body.mailFolderIds, []);
      assert.deepEqual(res.body.scopes, []);
    });

    test('6. GET /api/v1/integrations/outlook/status returns connected state with populated fields and no tokens', async () => {
      outlookConnectionStore.saveConnection({
        actorId: 'actor_kirsty_allen',
        status: 'connected',
        accountEmail: 'kirsty.allen@trinova.co.uk',
        displayName: 'Kirsty Allen',
        tenantId: 'tenant-guid-789',
        scopes: ['offline_access', 'Mail.Read', 'Calendars.Read'],
        refreshToken: SENSITIVE_TOKENS.refreshToken,
        accessToken: SENSITIVE_TOKENS.accessToken,
        accessTokenExpiresAt: Date.now() + 3600000,
        emailSyncEnabled: true,
        calendarSyncEnabled: true,
        mailFolderIds: ['Inbox', 'archive-folder-id'],
        connectedAt: '2026-10-21T10:00:00.000Z',
        lastSyncAt: '2026-10-21T12:00:00.000Z',
        lastError: null
      }, { filePath: TEST_VAULT_PATH, key: TEST_ENC_KEY });

      const res = await makeRequest('/api/v1/integrations/outlook/status', {
        headers: { Cookie: sessionCookie }
      });

      assert.equal(res.status, 200);
      assert.equal(res.body.status, 'connected');
      assert.equal(res.body.connected, true);
      assert.equal(res.body.accountEmail, 'kirsty.allen@trinova.co.uk');
      assert.equal(res.body.displayName, 'Kirsty Allen');
      assert.equal(res.body.lastSyncAt, '2026-10-21T12:00:00.000Z');
      assert.equal(res.body.lastError, null);
      assert.equal(res.body.emailSyncEnabled, true);
      assert.equal(res.body.calendarSyncEnabled, true);
      assert.deepEqual(res.body.mailFolderIds, ['Inbox', 'archive-folder-id']);
      assert.deepEqual(res.body.scopes, ['offline_access', 'Mail.Read', 'Calendars.Read']);
      assert.equal(res.body.connectedAt, '2026-10-21T10:00:00.000Z');
      assert.equal(res.body.tenantId, 'tenant-guid-789');

      assert.equal(res.body.refreshToken, undefined);
      assert.equal(res.body.accessToken, undefined);
      assert.equal(res.body.accessTokenExpiresAt, undefined);
      assert.ok(!res.raw.includes(SENSITIVE_TOKENS.refreshToken));
      assert.ok(!res.raw.includes(SENSITIVE_TOKENS.accessToken));
    });

    test('7. GET /api/v1/integrations/outlook/status returns reconnect_required when token is invalidated', async () => {
      outlookConnectionStore.saveConnection({
        actorId: 'actor_kirsty_allen',
        status: 'reconnect_required',
        accountEmail: 'kirsty.allen@trinova.co.uk',
        displayName: 'Kirsty Allen',
        refreshToken: SENSITIVE_TOKENS.refreshToken,
        lastError: 'Refresh token expired or consent revoked'
      }, { filePath: TEST_VAULT_PATH, key: TEST_ENC_KEY });

      const res = await makeRequest('/api/v1/integrations/outlook/status', {
        headers: { Cookie: sessionCookie }
      });

      assert.equal(res.status, 200);
      assert.equal(res.body.status, 'reconnect_required');
      assert.equal(res.body.connected, false);
      assert.equal(res.body.accountEmail, 'kirsty.allen@trinova.co.uk');
      assert.equal(res.body.lastError, 'Refresh token expired or consent revoked');
      assert.ok(!res.raw.includes(SENSITIVE_TOKENS.refreshToken));
    });

    test('8. GET /api/v1/integrations/outlook/status returns error when connection has error status', async () => {
      outlookConnectionStore.saveConnection({
        actorId: 'actor_kirsty_allen',
        status: 'error',
        accountEmail: 'kirsty.allen@trinova.co.uk',
        displayName: 'Kirsty Allen',
        refreshToken: SENSITIVE_TOKENS.refreshToken,
        lastError: 'Microsoft Graph rate limit exceeded (HTTP 429)'
      }, { filePath: TEST_VAULT_PATH, key: TEST_ENC_KEY });

      const res = await makeRequest('/api/v1/integrations/outlook/status', {
        headers: { Cookie: sessionCookie }
      });

      assert.equal(res.status, 200);
      assert.equal(res.body.status, 'error');
      assert.equal(res.body.connected, false);
      assert.equal(res.body.lastError, 'Microsoft Graph rate limit exceeded (HTTP 429)');
    });

    test('9. GET /api/v1/integrations/outlook/status handles vault read failure without crashing', async () => {
      const errorStoreApp = createApp({
        outlookOptions: {
          connectionStore: {
            getConnection() {
              throw new Error('Simulated disk I/O failure on encrypted vault');
            }
          },
          vaultKey: TEST_ENC_KEY,
          clientId: TEST_CLIENT_ID
        }
      });

      const errPort = 5008;
      const errServer = errorStoreApp.listen(errPort);

      try {
        const res = await new Promise((resolve, reject) => {
          const req = http.request(`http://localhost:${errPort}/api/v1/integrations/outlook/status`, {
            headers: { Cookie: sessionCookie }
          }, res => {
            let raw = '';
            res.on('data', chunk => raw += chunk);
            res.on('end', () => resolve({ status: res.statusCode, body: JSON.parse(raw) }));
          });
          req.on('error', reject);
          req.end();
        });

        assert.equal(res.status, 200);
        assert.equal(res.body.status, 'error');
        assert.equal(res.body.connected, false);
        assert.equal(res.body.lastError, 'Failed to read Outlook connection store');
      } finally {
        await new Promise(resolve => errServer.close(resolve));
      }
    });

    test('10. Raw response NEVER contains tokens, encryption keys, or client secrets', async () => {
      outlookConnectionStore.saveConnection({
        actorId: 'actor_kirsty_allen',
        status: 'connected',
        accountEmail: 'kirsty.allen@trinova.co.uk',
        displayName: 'Kirsty Allen',
        refreshToken: SENSITIVE_TOKENS.refreshToken,
        accessToken: SENSITIVE_TOKENS.accessToken
      }, { filePath: TEST_VAULT_PATH, key: TEST_ENC_KEY });

      const res = await makeRequest('/api/v1/integrations/outlook/status', {
        headers: { Cookie: sessionCookie }
      });

      const forbiddenStrings = [
        'refresh_token',
        'refreshToken',
        'access_token',
        'accessToken',
        'id_token',
        'idToken',
        'client_secret',
        'clientSecret',
        'code_verifier',
        'codeVerifier',
        SENSITIVE_TOKENS.refreshToken,
        SENSITIVE_TOKENS.accessToken,
        TEST_ENC_KEY
      ];

      for (const forbidden of forbiddenStrings) {
        assert.ok(
          !res.raw.includes(forbidden),
          `Response must not contain sensitive token or key string "${forbidden}"`
        );
      }
    });
  });

  // ==========================================
  // P5.2: PATCH /api/v1/integrations/outlook/settings
  // ==========================================
  describe('Task P5.2: PATCH settings', () => {
    test('11. PATCH /api/v1/integrations/outlook/settings without session returns 401 UNAUTHORIZED', async () => {
      const res = await makeRequest('/api/v1/integrations/outlook/settings', {
        method: 'PATCH',
        body: { emailSyncEnabled: true }
      });

      assert.equal(res.status, 401);
      assert.equal(res.body?.error?.code, 'UNAUTHORIZED');
    });

    test('12. PATCH returns 404 OUTLOOK_NOT_CONNECTED when no connection exists in vault', async () => {
      const res = await makeRequest('/api/v1/integrations/outlook/settings', {
        method: 'PATCH',
        headers: { Cookie: sessionCookie },
        body: { emailSyncEnabled: true }
      });

      assert.equal(res.status, 404);
      assert.equal(res.body?.error?.code, 'OUTLOOK_NOT_CONNECTED');
    });

    test('13. PATCH returns 422 VALIDATION_ERROR when body is empty', async () => {
      outlookConnectionStore.saveConnection({
        actorId: 'actor_kirsty_allen',
        status: 'connected',
        accountEmail: 'kirsty.allen@trinova.co.uk',
        refreshToken: SENSITIVE_TOKENS.refreshToken
      }, { filePath: TEST_VAULT_PATH, key: TEST_ENC_KEY });

      const res = await makeRequest('/api/v1/integrations/outlook/settings', {
        method: 'PATCH',
        headers: { Cookie: sessionCookie },
        body: {}
      });

      assert.equal(res.status, 422);
      assert.equal(res.body?.error?.code, 'VALIDATION_ERROR');
    });

    test('14. PATCH rejects non-boolean emailSyncEnabled or calendarSyncEnabled with 422', async () => {
      outlookConnectionStore.saveConnection({
        actorId: 'actor_kirsty_allen',
        status: 'connected',
        accountEmail: 'kirsty.allen@trinova.co.uk',
        refreshToken: SENSITIVE_TOKENS.refreshToken
      }, { filePath: TEST_VAULT_PATH, key: TEST_ENC_KEY });

      // Non-boolean emailSyncEnabled
      const res1 = await makeRequest('/api/v1/integrations/outlook/settings', {
        method: 'PATCH',
        headers: { Cookie: sessionCookie },
        body: { emailSyncEnabled: 'true' }
      });
      assert.equal(res1.status, 422);
      assert.match(res1.body?.error?.message, /emailSyncEnabled must be a boolean/i);

      // Non-boolean calendarSyncEnabled
      const res2 = await makeRequest('/api/v1/integrations/outlook/settings', {
        method: 'PATCH',
        headers: { Cookie: sessionCookie },
        body: { calendarSyncEnabled: 1 }
      });
      assert.equal(res2.status, 422);
      assert.match(res2.body?.error?.message, /calendarSyncEnabled must be a boolean/i);
    });

    test('15. PATCH rejects empty mailFolderIds list with 422', async () => {
      outlookConnectionStore.saveConnection({
        actorId: 'actor_kirsty_allen',
        status: 'connected',
        accountEmail: 'kirsty.allen@trinova.co.uk',
        refreshToken: SENSITIVE_TOKENS.refreshToken
      }, { filePath: TEST_VAULT_PATH, key: TEST_ENC_KEY });

      const res = await makeRequest('/api/v1/integrations/outlook/settings', {
        method: 'PATCH',
        headers: { Cookie: sessionCookie },
        body: { mailFolderIds: [] }
      });

      assert.equal(res.status, 422);
      assert.equal(res.body?.error?.code, 'VALIDATION_ERROR');
      assert.match(res.body?.error?.message, /mailFolderIds cannot be empty/i);
    });

    test('16. PATCH rejects non-string or whitespace mailFolderIds elements with 422', async () => {
      outlookConnectionStore.saveConnection({
        actorId: 'actor_kirsty_allen',
        status: 'connected',
        accountEmail: 'kirsty.allen@trinova.co.uk',
        refreshToken: SENSITIVE_TOKENS.refreshToken
      }, { filePath: TEST_VAULT_PATH, key: TEST_ENC_KEY });

      const res = await makeRequest('/api/v1/integrations/outlook/settings', {
        method: 'PATCH',
        headers: { Cookie: sessionCookie },
        body: { mailFolderIds: ['folder_inbox_id_123', '  '] }
      });

      assert.equal(res.status, 422);
      assert.equal(res.body?.error?.code, 'VALIDATION_ERROR');
      assert.match(res.body?.error?.message, /non-empty string/i);
    });

    test('17. PATCH rejects folder IDs that do not exist in Microsoft Graph with 422 INVALID_MAIL_FOLDER', async () => {
      outlookConnectionStore.saveConnection({
        actorId: 'actor_kirsty_allen',
        status: 'connected',
        accountEmail: 'kirsty.allen@trinova.co.uk',
        refreshToken: SENSITIVE_TOKENS.refreshToken
      }, { filePath: TEST_VAULT_PATH, key: TEST_ENC_KEY });

      const res = await makeRequest('/api/v1/integrations/outlook/settings', {
        method: 'PATCH',
        headers: { Cookie: sessionCookie },
        body: { mailFolderIds: ['folder_inbox_id_123', 'nonexistent_folder_xyz'] }
      });

      assert.equal(res.status, 422);
      assert.equal(res.body?.error?.code, 'INVALID_MAIL_FOLDER');
      assert.match(res.body?.error?.message, /nonexistent_folder_xyz/);
    });

    test('18. PATCH returns 401 when Graph throws OUTLOOK_RECONNECT_REQUIRED', async () => {
      outlookConnectionStore.saveConnection({
        actorId: 'actor_kirsty_allen',
        status: 'connected',
        accountEmail: 'kirsty.allen@trinova.co.uk',
        refreshToken: SENSITIVE_TOKENS.refreshToken
      }, { filePath: TEST_VAULT_PATH, key: TEST_ENC_KEY });

      mockGraphError = new GraphClientError('OUTLOOK_RECONNECT_REQUIRED', 'Consent revoked', { status: 401 });

      const res = await makeRequest('/api/v1/integrations/outlook/settings', {
        method: 'PATCH',
        headers: { Cookie: sessionCookie },
        body: { mailFolderIds: ['folder_inbox_id_123'] }
      });

      assert.equal(res.status, 401);
      assert.equal(res.body?.error?.code, 'OUTLOOK_RECONNECT_REQUIRED');
    });

    test('19. PATCH returns 503 when Graph is busy (MICROSOFT_BUSY)', async () => {
      outlookConnectionStore.saveConnection({
        actorId: 'actor_kirsty_allen',
        status: 'connected',
        accountEmail: 'kirsty.allen@trinova.co.uk',
        refreshToken: SENSITIVE_TOKENS.refreshToken
      }, { filePath: TEST_VAULT_PATH, key: TEST_ENC_KEY });

      mockGraphError = new GraphClientError('MICROSOFT_BUSY', 'Microsoft is busy', { status: 429 });

      const res = await makeRequest('/api/v1/integrations/outlook/settings', {
        method: 'PATCH',
        headers: { Cookie: sessionCookie },
        body: { mailFolderIds: ['folder_inbox_id_123'] }
      });

      assert.equal(res.status, 503);
      assert.equal(res.body?.error?.code, 'MICROSOFT_BUSY');
    });

    test('20. PATCH returns 502 when Graph call fails with general network error', async () => {
      outlookConnectionStore.saveConnection({
        actorId: 'actor_kirsty_allen',
        status: 'connected',
        accountEmail: 'kirsty.allen@trinova.co.uk',
        refreshToken: SENSITIVE_TOKENS.refreshToken
      }, { filePath: TEST_VAULT_PATH, key: TEST_ENC_KEY });

      mockGraphError = new Error('ECONNRESET: Socket hang up');

      const res = await makeRequest('/api/v1/integrations/outlook/settings', {
        method: 'PATCH',
        headers: { Cookie: sessionCookie },
        body: { mailFolderIds: ['folder_inbox_id_123'] }
      });

      assert.equal(res.status, 502);
      assert.equal(res.body?.error?.code, 'GRAPH_FOLDER_LOOKUP_FAILED');
    });

    test('21. PATCH successfully updates sync toggles and valid mailFolderIds into vault', async () => {
      outlookConnectionStore.saveConnection({
        actorId: 'actor_kirsty_allen',
        status: 'connected',
        accountEmail: 'kirsty.allen@trinova.co.uk',
        displayName: 'Kirsty Allen',
        refreshToken: SENSITIVE_TOKENS.refreshToken,
        accessToken: SENSITIVE_TOKENS.accessToken,
        emailSyncEnabled: false,
        calendarSyncEnabled: false,
        mailFolderIds: ['Inbox']
      }, { filePath: TEST_VAULT_PATH, key: TEST_ENC_KEY });

      const res = await makeRequest('/api/v1/integrations/outlook/settings', {
        method: 'PATCH',
        headers: { Cookie: sessionCookie },
        body: {
          emailSyncEnabled: true,
          calendarSyncEnabled: true,
          mailFolderIds: ['folder_inbox_id_123', 'folder_finance_id_789']
        }
      });

      assert.equal(res.status, 200);
      assert.equal(res.body.emailSyncEnabled, true);
      assert.equal(res.body.calendarSyncEnabled, true);
      assert.deepEqual(res.body.mailFolderIds, ['folder_inbox_id_123', 'folder_finance_id_789']);

      // Verify vault persistence directly
      const reloaded = outlookConnectionStore.getConnection({
        filePath: TEST_VAULT_PATH,
        key: TEST_ENC_KEY
      });
      assert.equal(reloaded.emailSyncEnabled, true);
      assert.equal(reloaded.calendarSyncEnabled, true);
      assert.deepEqual(reloaded.mailFolderIds, ['folder_inbox_id_123', 'folder_finance_id_789']);
      assert.equal(reloaded.refreshToken, SENSITIVE_TOKENS.refreshToken);

      // Verify tokens never exposed in response
      assert.equal(res.body.refreshToken, undefined);
      assert.equal(res.body.accessToken, undefined);
      assert.ok(!res.raw.includes(SENSITIVE_TOKENS.refreshToken));
      assert.ok(!res.raw.includes(SENSITIVE_TOKENS.accessToken));
    });
  });

  // ==========================================
  // P5.3: GET /api/v1/integrations/outlook/folders
  // ==========================================
  describe('Task P5.3: GET folders', () => {
    test('22. GET /api/v1/integrations/outlook/folders without session returns 401 UNAUTHORIZED', async () => {
      const res = await makeRequest('/api/v1/integrations/outlook/folders', {
        method: 'GET'
      });

      assert.equal(res.status, 401);
      assert.equal(res.body?.error?.code, 'UNAUTHORIZED');
    });

    test('23. GET folders returns 404 OUTLOOK_NOT_CONNECTED when no connection in vault', async () => {
      const res = await makeRequest('/api/v1/integrations/outlook/folders', {
        headers: { Cookie: sessionCookie }
      });

      assert.equal(res.status, 404);
      assert.equal(res.body?.error?.code, 'OUTLOOK_NOT_CONNECTED');
    });

    test('24. GET folders returns 401 when connection status is reconnect_required', async () => {
      outlookConnectionStore.saveConnection({
        actorId: 'actor_kirsty_allen',
        status: 'reconnect_required',
        accountEmail: 'kirsty.allen@trinova.co.uk',
        refreshToken: SENSITIVE_TOKENS.refreshToken
      }, { filePath: TEST_VAULT_PATH, key: TEST_ENC_KEY });

      const res = await makeRequest('/api/v1/integrations/outlook/folders', {
        headers: { Cookie: sessionCookie }
      });

      assert.equal(res.status, 401);
      assert.equal(res.body?.error?.code, 'OUTLOOK_RECONNECT_REQUIRED');
    });

    test('25. GET folders returns 401 when Graph throws OUTLOOK_RECONNECT_REQUIRED', async () => {
      outlookConnectionStore.saveConnection({
        actorId: 'actor_kirsty_allen',
        status: 'connected',
        accountEmail: 'kirsty.allen@trinova.co.uk',
        refreshToken: SENSITIVE_TOKENS.refreshToken
      }, { filePath: TEST_VAULT_PATH, key: TEST_ENC_KEY });

      mockGraphError = new GraphClientError('OUTLOOK_RECONNECT_REQUIRED', 'Token revoked', { status: 401 });

      const res = await makeRequest('/api/v1/integrations/outlook/folders', {
        headers: { Cookie: sessionCookie }
      });

      assert.equal(res.status, 401);
      assert.equal(res.body?.error?.code, 'OUTLOOK_RECONNECT_REQUIRED');
    });

    test('26. GET folders returns 503 when Graph is busy (MICROSOFT_BUSY)', async () => {
      outlookConnectionStore.saveConnection({
        actorId: 'actor_kirsty_allen',
        status: 'connected',
        accountEmail: 'kirsty.allen@trinova.co.uk',
        refreshToken: SENSITIVE_TOKENS.refreshToken
      }, { filePath: TEST_VAULT_PATH, key: TEST_ENC_KEY });

      mockGraphError = new GraphClientError('MICROSOFT_BUSY', 'Microsoft is busy', { status: 429 });

      const res = await makeRequest('/api/v1/integrations/outlook/folders', {
        headers: { Cookie: sessionCookie }
      });

      assert.equal(res.status, 503);
      assert.equal(res.body?.error?.code, 'MICROSOFT_BUSY');
    });

    test('27. GET folders returns 502 when Graph call fails with general network error', async () => {
      outlookConnectionStore.saveConnection({
        actorId: 'actor_kirsty_allen',
        status: 'connected',
        accountEmail: 'kirsty.allen@trinova.co.uk',
        refreshToken: SENSITIVE_TOKENS.refreshToken
      }, { filePath: TEST_VAULT_PATH, key: TEST_ENC_KEY });

      mockGraphError = new Error('ETIMEDOUT: Connection timed out');

      const res = await makeRequest('/api/v1/integrations/outlook/folders', {
        headers: { Cookie: sessionCookie }
      });

      assert.equal(res.status, 502);
      assert.equal(res.body?.error?.code, 'GRAPH_FOLDERS_FETCH_FAILED');
    });

    test('28. GET folders returns mapped list of [{ id, displayName, unreadItemCount }]', async () => {
      outlookConnectionStore.saveConnection({
        actorId: 'actor_kirsty_allen',
        status: 'connected',
        accountEmail: 'kirsty.allen@trinova.co.uk',
        refreshToken: SENSITIVE_TOKENS.refreshToken,
        accessToken: SENSITIVE_TOKENS.accessToken
      }, { filePath: TEST_VAULT_PATH, key: TEST_ENC_KEY });

      mockGraphResponse = {
        value: [
          { id: 'f_inbox_01', displayName: 'Inbox', unreadItemCount: 4, extraInternalGraphField: 'leak_check' },
          { id: 'f_archive_02', displayName: 'Archive', unreadItemCount: 0 },
          { id: 'f_sent_03', displayName: 'Sent Items', unreadItemCount: 0 }
        ]
      };

      const res = await makeRequest('/api/v1/integrations/outlook/folders', {
        headers: { Cookie: sessionCookie }
      });

      assert.equal(res.status, 200);
      assert.ok(Array.isArray(res.body));
      assert.equal(res.body.length, 3);
      assert.deepEqual(res.body, [
        { id: 'f_inbox_01', displayName: 'Inbox', unreadItemCount: 4 },
        { id: 'f_archive_02', displayName: 'Archive', unreadItemCount: 0 },
        { id: 'f_sent_03', displayName: 'Sent Items', unreadItemCount: 0 }
      ]);

      // Strict token and credential leakage checks
      assert.ok(!res.raw.includes(SENSITIVE_TOKENS.refreshToken));
      assert.ok(!res.raw.includes(SENSITIVE_TOKENS.accessToken));
      assert.ok(!res.raw.includes('leak_check'));
    });
  });

  // ==========================================
  // P5.4: POST /api/v1/integrations/outlook/sync
  // ==========================================
  describe('Task P5.4: POST sync', () => {
    test('29. POST /api/v1/integrations/outlook/sync without session returns 401 UNAUTHORIZED', async () => {
      const res = await makeRequest('/api/v1/integrations/outlook/sync', {
        method: 'POST'
      });

      assert.equal(res.status, 401);
      assert.equal(res.body?.error?.code, 'UNAUTHORIZED');
    });

    test('30. POST sync returns 404 OUTLOOK_NOT_CONNECTED when no connection in vault', async () => {
      const res = await makeRequest('/api/v1/integrations/outlook/sync', {
        method: 'POST',
        headers: { Cookie: sessionCookie }
      });

      assert.equal(res.status, 404);
      assert.equal(res.body?.error?.code, 'OUTLOOK_NOT_CONNECTED');
    });

    test('31. POST sync returns 401 when connection status is reconnect_required', async () => {
      outlookConnectionStore.saveConnection({
        actorId: 'actor_kirsty_allen',
        status: 'reconnect_required',
        accountEmail: 'kirsty.allen@trinova.co.uk',
        refreshToken: SENSITIVE_TOKENS.refreshToken
      }, { filePath: TEST_VAULT_PATH, key: TEST_ENC_KEY });

      const res = await makeRequest('/api/v1/integrations/outlook/sync', {
        method: 'POST',
        headers: { Cookie: sessionCookie }
      });

      assert.equal(res.status, 401);
      assert.equal(res.body?.error?.code, 'OUTLOOK_RECONNECT_REQUIRED');
    });

    test('32. POST sync returns 409 SYNC_IN_PROGRESS when a sync is already running', async () => {
      outlookConnectionStore.saveConnection({
        actorId: 'actor_kirsty_allen',
        status: 'connected',
        accountEmail: 'kirsty.allen@trinova.co.uk',
        refreshToken: SENSITIVE_TOKENS.refreshToken
      }, { filePath: TEST_VAULT_PATH, key: TEST_ENC_KEY });

      setSyncActiveForTest(true);
      try {
        const res = await makeRequest('/api/v1/integrations/outlook/sync', {
          method: 'POST',
          headers: { Cookie: sessionCookie }
        });

        assert.equal(res.status, 409);
        assert.equal(res.body?.error?.code, 'SYNC_IN_PROGRESS');
      } finally {
        setSyncActiveForTest(false);
      }
    });

    test('33. POST sync returns 401 and transitions status to reconnect_required on Graph 401', async () => {
      outlookConnectionStore.saveConnection({
        actorId: 'actor_kirsty_allen',
        status: 'connected',
        accountEmail: 'kirsty.allen@trinova.co.uk',
        refreshToken: SENSITIVE_TOKENS.refreshToken,
        calendarSyncEnabled: true
      }, { filePath: TEST_VAULT_PATH, key: TEST_ENC_KEY });

      mockGraphError = new GraphClientError('OUTLOOK_RECONNECT_REQUIRED', 'Token revoked', { status: 401 });

      const res = await makeRequest('/api/v1/integrations/outlook/sync', {
        method: 'POST',
        headers: { Cookie: sessionCookie }
      });

      assert.equal(res.status, 401);
      assert.equal(res.body?.error?.code, 'OUTLOOK_RECONNECT_REQUIRED');

      const reloaded = outlookConnectionStore.getConnection({
        filePath: TEST_VAULT_PATH,
        key: TEST_ENC_KEY
      });
      assert.equal(reloaded.status, 'reconnect_required');
    });

    test('34. POST sync returns 503 when Graph is busy (MICROSOFT_BUSY)', async () => {
      outlookConnectionStore.saveConnection({
        actorId: 'actor_kirsty_allen',
        status: 'connected',
        accountEmail: 'kirsty.allen@trinova.co.uk',
        refreshToken: SENSITIVE_TOKENS.refreshToken,
        calendarSyncEnabled: true
      }, { filePath: TEST_VAULT_PATH, key: TEST_ENC_KEY });

      mockGraphError = new GraphClientError('MICROSOFT_BUSY', 'Microsoft is busy', { status: 429 });

      const res = await makeRequest('/api/v1/integrations/outlook/sync', {
        method: 'POST',
        headers: { Cookie: sessionCookie }
      });

      assert.equal(res.status, 503);
      assert.equal(res.body?.error?.code, 'MICROSOFT_BUSY');
    });

    test('35. POST sync returns 502 when Graph call fails with general network error', async () => {
      outlookConnectionStore.saveConnection({
        actorId: 'actor_kirsty_allen',
        status: 'connected',
        accountEmail: 'kirsty.allen@trinova.co.uk',
        refreshToken: SENSITIVE_TOKENS.refreshToken,
        calendarSyncEnabled: true
      }, { filePath: TEST_VAULT_PATH, key: TEST_ENC_KEY });

      mockGraphError = new Error('ECONNRESET: Connection reset');

      const res = await makeRequest('/api/v1/integrations/outlook/sync', {
        method: 'POST',
        headers: { Cookie: sessionCookie }
      });

      assert.equal(res.status, 502);
      assert.equal(res.body?.error?.code, 'SYNC_FAILED');
    });

    test('36. POST sync succeeds: queries enabled sources, updates lastSyncAt in vault, and never exposes tokens', async () => {
      outlookConnectionStore.saveConnection({
        actorId: 'actor_kirsty_allen',
        status: 'connected',
        accountEmail: 'kirsty.allen@trinova.co.uk',
        refreshToken: SENSITIVE_TOKENS.refreshToken,
        accessToken: SENSITIVE_TOKENS.accessToken,
        calendarSyncEnabled: true,
        emailSyncEnabled: true,
        mailFolderIds: ['folder_inbox_id_123']
      }, { filePath: TEST_VAULT_PATH, key: TEST_ENC_KEY });

      // Custom mock responses for calendar and emails
      mockGraphResponse = {
        value: [
          { subject: 'Board Review', start: { dateTime: '2026-10-21T10:00:00Z' } },
          { subject: 'Client Signing', start: { dateTime: '2026-10-21T14:00:00Z' } }
        ]
      };

      const res = await makeRequest('/api/v1/integrations/outlook/sync', {
        method: 'POST',
        headers: { Cookie: sessionCookie }
      });

      assert.equal(res.status, 200);
      assert.equal(res.body.synced, true);
      assert.ok(res.body.lastSyncAt);
      assert.equal(res.body.status, 'connected');
      assert.ok(typeof res.body.counts?.events === 'number');
      assert.ok(typeof res.body.counts?.emails === 'number');

      // Verify vault persistence
      const reloaded = outlookConnectionStore.getConnection({
        filePath: TEST_VAULT_PATH,
        key: TEST_ENC_KEY
      });
      assert.equal(reloaded.lastSyncAt, res.body.lastSyncAt);
      assert.equal(reloaded.lastError, null);

      // Verify tokens never exposed in response
      assert.equal(res.body.refreshToken, undefined);
      assert.equal(res.body.accessToken, undefined);
      assert.ok(!res.raw.includes(SENSITIVE_TOKENS.refreshToken));
      assert.ok(!res.raw.includes(SENSITIVE_TOKENS.accessToken));
    });
  });

  // ==========================================
  // P5.5: POST /api/v1/integrations/outlook/disconnect
  // ==========================================
  describe('Task P5.5: POST disconnect', () => {
    test('37. POST /api/v1/integrations/outlook/disconnect without session returns 401 UNAUTHORIZED', async () => {
      const res = await makeRequest('/api/v1/integrations/outlook/disconnect', {
        method: 'POST'
      });

      assert.equal(res.status, 401);
      assert.equal(res.body?.error?.code, 'UNAUTHORIZED');
    });

    test('38. POST disconnect when active connection exists purges vault and data cache, returning §4.1 revocation guidance', async () => {
      // 1. Establish connected vault record with sensitive tokens
      outlookConnectionStore.saveConnection({
        actorId: 'actor_kirsty_allen',
        status: 'connected',
        accountEmail: 'kirsty.allen@trinova.co.uk',
        displayName: 'Kirsty Allen',
        refreshToken: SENSITIVE_TOKENS.refreshToken,
        accessToken: SENSITIVE_TOKENS.accessToken,
        calendarSyncEnabled: true,
        emailSyncEnabled: true,
        mailFolderIds: ['inbox']
      }, { filePath: TEST_VAULT_PATH, key: TEST_ENC_KEY });

      assert.ok(fs.existsSync(TEST_VAULT_PATH));

      // 2. Set test item in memory cache
      outlookDataCache.set('test_diary_cache', { events: ['meeting1'] });
      assert.equal(outlookDataCache.size, 1);

      // 3. Send disconnect request
      const res = await makeRequest('/api/v1/integrations/outlook/disconnect', {
        method: 'POST',
        headers: { Cookie: sessionCookie }
      });

      assert.equal(res.status, 200);
      assert.equal(res.body.disconnected, true);
      assert.equal(res.body.status, 'not_connected');
      assert.equal(res.body.connected, false);
      assert.ok(res.body.message.includes('https://myapps.microsoft.com'));
      assert.ok(res.body.message.includes("deletes Sloane's copy of your Outlook access"));
      assert.equal(res.body.revocationUrl, 'https://myapps.microsoft.com');

      // 4. Verify vault file is completely removed / 0 tokens remain
      assert.equal(fs.existsSync(TEST_VAULT_PATH), false);
      const reloaded = outlookConnectionStore.getConnection({
        filePath: TEST_VAULT_PATH,
        key: TEST_ENC_KEY
      });
      assert.equal(reloaded, null);

      // 5. Verify cache is flushed
      assert.equal(outlookDataCache.size, 0);

      // 6. Verify zero token leakage in raw response
      assert.ok(!res.raw.includes(SENSITIVE_TOKENS.refreshToken));
      assert.ok(!res.raw.includes(SENSITIVE_TOKENS.accessToken));
      assert.ok(!res.raw.includes(TEST_ENC_KEY));
    });

    test('39. Subsequent status and sync calls immediately reflect disconnected state', async () => {
      // Status should return not_connected
      const statusRes = await makeRequest('/api/v1/integrations/outlook/status', {
        method: 'GET',
        headers: { Cookie: sessionCookie }
      });
      assert.equal(statusRes.status, 200);
      assert.equal(statusRes.body.status, 'not_connected');
      assert.equal(statusRes.body.connected, false);

      // Sync should return 404 OUTLOOK_NOT_CONNECTED
      const syncRes = await makeRequest('/api/v1/integrations/outlook/sync', {
        method: 'POST',
        headers: { Cookie: sessionCookie }
      });
      assert.equal(syncRes.status, 404);
      assert.equal(syncRes.body?.error?.code, 'OUTLOOK_NOT_CONNECTED');
    });

    test('40. POST disconnect is idempotent and succeeds safely when vault is already empty', async () => {
      assert.equal(fs.existsSync(TEST_VAULT_PATH), false);

      const res = await makeRequest('/api/v1/integrations/outlook/disconnect', {
        method: 'POST',
        headers: { Cookie: sessionCookie }
      });

      assert.equal(res.status, 200);
      assert.equal(res.body.disconnected, true);
      assert.equal(res.body.status, 'not_connected');
      assert.equal(res.body.connected, false);
      assert.ok(res.body.message.includes('https://myapps.microsoft.com'));
    });
  });
});

