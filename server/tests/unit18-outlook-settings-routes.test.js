/**
 * Unit 18 Test Suite: Outlook Settings & Status Routes (Task P5.1)
 *
 * Verifies:
 * - GET /api/v1/integrations/outlook/status
 *   1. Unauthenticated request returns 401 UNAUTHORIZED
 *   2. Unconfigured environment returns status: 'not_configured'
 *   3. Configured but empty vault returns status: 'not_connected'
 *   4. Connected vault record returns status: 'connected' with all required metadata fields
 *   5. Reconnect required status returns status: 'reconnect_required'
 *   6. Error status returns status: 'error' with lastError message
 *   7. Vault read failure handled gracefully with status: 'error'
 *   8. Strict token safety: tokens (access/refresh/id/secrets) NEVER appear in response body or raw JSON
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
import { formatStatusResponse, isOutlookConfigured } from '../src/routes/outlookSettings.js';

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

describe('Task P5.1: Outlook Settings & Status Endpoints', () => {
  let server;
  let baseUrl;
  let sessionCookie;

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
        clientId: TEST_CLIENT_ID
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
    if (fs.existsSync(TEST_VAULT_PATH)) {
      try { fs.unlinkSync(TEST_VAULT_PATH); } catch {}
    }
  });

  // Helper for HTTP requests
  function makeRequest(reqPath, options = {}) {
    return new Promise((resolve, reject) => {
      const url = new URL(reqPath, baseUrl);
      const req = http.request(url, options, res => {
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
      req.end();
    });
  }

  // 1. Authentication
  test('1. Unauthenticated request to /api/v1/integrations/outlook/status returns 401 UNAUTHORIZED', async () => {
    const res = await makeRequest('/api/v1/integrations/outlook/status', {
      method: 'GET'
    });

    assert.equal(res.status, 401);
    assert.equal(res.body?.error?.code, 'UNAUTHORIZED');
  });

  // 2. Pure Helper Validation
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

  // 3. Not Configured State
  test('4. GET /api/v1/integrations/outlook/status returns not_configured when configuration is missing', async () => {
    const origClientId = process.env.OUTLOOK_CLIENT_ID;
    delete process.env.OUTLOOK_CLIENT_ID;

    // Create a temporary unconfigured app
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

  // 4. Not Connected State
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

  // 5. Connected State
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

    // Strict assertions: tokens MUST NOT be present
    assert.equal(res.body.refreshToken, undefined);
    assert.equal(res.body.accessToken, undefined);
    assert.equal(res.body.accessTokenExpiresAt, undefined);
    assert.ok(!res.raw.includes(SENSITIVE_TOKENS.refreshToken));
    assert.ok(!res.raw.includes(SENSITIVE_TOKENS.accessToken));
  });

  // 6. Reconnect Required State
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

  // 7. Error State
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

  // 8. Graceful Exception Handling
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

  // 9. Zero Token Leakage Comprehensive Audit
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
