/**
 * Unit 14 Test Suite: Outlook OAuth Connect & Callback Endpoints (Task P3.2)
 *
 * Verifies:
 * - GET /api/v1/integrations/outlook/connect (Session required, PKCE, 302 redirect)
 * - GET /api/v1/integrations/outlook/callback (Cookie-free, state-bound, single-use)
 * - Covers: success, user-denied error, missing refresh_token, bad id_token signature,
 *   expired state, replayed callback, token endpoint 500, unconfigured server.
 */

import { test, describe, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import path from 'node:path';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

import { createApp } from '../src/app.js';
import { sessionStore } from '../src/services/sessionStore.js';
import { createStateEntry, consumeState } from '../src/services/outlookOAuthStateStore.js';
import { outlookConnectionStore } from '../src/services/outlookConnectionStore.js';
import { outlookIdentityService } from '../src/services/outlookIdentityService.js';
import { outlookVault } from '../src/services/outlookVault.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const TEST_ENC_KEY = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
const TEST_VAULT_PATH = path.resolve(__dirname, '../data-private/test-unit14-vault.json');
const TEST_CLIENT_ID = 'test-client-id-123';
const TEST_CLIENT_SECRET = 'test-client-secret-xyz';
const TEST_TENANT_ID = 'test-tenant-guid-456';
const TEST_REDIRECT_URI = 'http://localhost:5005/api/v1/integrations/outlook/callback';

describe('Task P3.2: Outlook OAuth 2.0 Connect & Callback Routes', () => {
  let server;
  let baseUrl;
  let rsaPrivateKey;
  let testJwk;
  let sessionCookie;
  let mockFetchHandler = null;

  const TEST_PORT = 5005;

  // Generate real RSA key pair for cryptographic token signing in tests
  before(() => {
    const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
    rsaPrivateKey = privateKey;
    testJwk = publicKey.export({ format: 'jwk' });
    testJwk.kid = 'unit14-test-key-id';
    testJwk.use = 'sig';

    process.env.OUTLOOK_TOKEN_ENC_KEY = TEST_ENC_KEY;
    process.env.OUTLOOK_VAULT_PATH = TEST_VAULT_PATH;
    process.env.OUTLOOK_CLIENT_ID = TEST_CLIENT_ID;
    process.env.OUTLOOK_CLIENT_SECRET = TEST_CLIENT_SECRET;
    process.env.OUTLOOK_TENANT_ID = TEST_TENANT_ID;
    process.env.OUTLOOK_REDIRECT_URI = TEST_REDIRECT_URI;

    // Create CEO session for Kirsty
    const session = sessionStore.createSession({
      id: 'actor_kirsty_allen',
      name: 'Kirsty Allen',
      email: 'kirsty.allen@trinova.co.uk',
      role: 'owner'
    });
    sessionCookie = `slon_session=${session.sessionId}`;

    // Prime identity service with our test JWK
    outlookIdentityService.setJwksCache(TEST_TENANT_ID, [testJwk]);

    // Custom fetch proxy allowing per-test endpoint mocking
    const customFetch = async (url, fetchOptions) => {
      if (typeof mockFetchHandler === 'function') {
        return mockFetchHandler(url, fetchOptions);
      }
      throw new Error(`Unhandled fetch call to ${url}`);
    };

    const app = createApp({
      outlookOptions: {
        fetch: customFetch,
        keyset: [testJwk],
        vaultPath: TEST_VAULT_PATH,
        vaultKey: TEST_ENC_KEY
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
    outlookIdentityService.clearJwksCache();
    if (fs.existsSync(TEST_VAULT_PATH)) {
      try { fs.unlinkSync(TEST_VAULT_PATH); } catch {}
    }
    return new Promise(resolve => server.close(resolve));
  });

  beforeEach(() => {
    mockFetchHandler = null;
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
          let body;
          try {
            body = JSON.parse(raw);
          } catch {
            body = raw;
          }
          resolve({
            status: res.statusCode,
            headers: res.headers,
            body
          });
        });
      });
      req.on('error', reject);
      if (options.body) {
        req.write(typeof options.body === 'string' ? options.body : JSON.stringify(options.body));
      }
      req.end();
    });
  }

  // Helper to generate a valid or tampered signed id_token
  function createSignedIdToken({
    name = 'Kirsty Allen',
    email = 'kirsty@trinova.co.uk',
    nonce,
    aud = TEST_CLIENT_ID,
    tid = TEST_TENANT_ID,
    exp = Math.floor(Date.now() / 1000) + 3600
  } = {}, tamper = false) {
    const header = { alg: 'RS256', kid: testJwk.kid, typ: 'JWT' };
    const payload = {
      name,
      preferred_username: email,
      aud,
      nonce,
      exp,
      tid,
      iss: `https://login.microsoftonline.com/${tid}/v2.0`
    };

    const h = Buffer.from(JSON.stringify(header)).toString('base64url');
    const p = Buffer.from(JSON.stringify(payload)).toString('base64url');
    const dataToSign = Buffer.from(`${h}.${p}`);
    const sig = crypto.sign('SHA256', dataToSign, rsaPrivateKey);

    if (tamper) {
      sig[0] ^= 0xff; // Invert first byte of signature
    }

    return `${h}.${p}.${sig.toString('base64url')}`;
  }

  describe('GET /api/v1/integrations/outlook/connect', () => {
    test('1. Rejects unauthenticated request without session cookie with 401', async () => {
      const res = await makeRequest('/api/v1/integrations/outlook/connect');
      assert.equal(res.status, 401);
      assert.equal(res.body.error?.code, 'UNAUTHORIZED');
    });

    test('2. Authenticated request redirects 302 to Microsoft authorize endpoint with correct parameters', async () => {
      const res = await makeRequest('/api/v1/integrations/outlook/connect', {
        headers: {
          Cookie: sessionCookie
        }
      });

      assert.equal(res.status, 302);
      const location = res.headers.location;
      assert.ok(location, 'Expected Location header on 302 redirect');

      const redirectUrl = new URL(location);
      assert.equal(redirectUrl.origin, 'https://login.microsoftonline.com');
      assert.equal(redirectUrl.pathname, `/${TEST_TENANT_ID}/oauth2/v2.0/authorize`);

      const params = redirectUrl.searchParams;
      assert.equal(params.get('client_id'), TEST_CLIENT_ID);
      assert.equal(params.get('response_type'), 'code');
      assert.equal(params.get('response_mode'), 'query');
      assert.equal(params.get('redirect_uri'), TEST_REDIRECT_URI);
      assert.equal(params.get('code_challenge_method'), 'S256');
      assert.equal(params.get('prompt'), 'select_account');

      // Verify scope contains required permissions
      const scopes = params.get('scope');
      assert.ok(scopes.includes('offline_access'));
      assert.ok(scopes.includes('Mail.Read'));
      assert.ok(scopes.includes('Calendars.Read'));
      assert.ok(scopes.includes('openid'));
      assert.ok(scopes.includes('profile'));
      assert.ok(scopes.includes('email'));

      // Verify state was created and is consumable in state store
      const stateParam = params.get('state');
      assert.ok(stateParam, 'Expected state parameter in redirect URL');
      const stateResult = consumeState(stateParam);
      assert.equal(stateResult.valid, true);
      assert.equal(stateResult.data.actorId, 'actor_kirsty_allen');
      assert.equal(params.get('code_challenge'), stateResult.data.codeChallenge);
      assert.equal(params.get('nonce'), stateResult.data.nonce);
    });

    test('3. Returns 503 when OUTLOOK_CLIENT_ID is unconfigured', async () => {
      const oldClientId = process.env.OUTLOOK_CLIENT_ID;
      delete process.env.OUTLOOK_CLIENT_ID;

      try {
        const res = await makeRequest('/api/v1/integrations/outlook/connect', {
          headers: { Cookie: sessionCookie }
        });
        assert.equal(res.status, 503);
        assert.equal(res.body.error?.code, 'OUTLOOK_NOT_CONFIGURED');
      } finally {
        process.env.OUTLOOK_CLIENT_ID = oldClientId;
      }
    });
  });

  describe('Connect link clicked in a browser when Outlook is not configured', () => {
    test('3b. Redirects back to Sloane with a plain-English message instead of raw JSON', async () => {
      const oldClientId = process.env.OUTLOOK_CLIENT_ID;
      delete process.env.OUTLOOK_CLIENT_ID;

      try {
        const res = await makeRequest('/api/v1/integrations/outlook/connect', {
          headers: { Cookie: sessionCookie, Accept: 'text/html,application/xhtml+xml' }
        });
        assert.equal(res.status, 302);
        const loc = res.headers.location || '';
        assert.ok(loc.startsWith('/?outlook_error='), 'Redirects to the app with outlook_error');
        assert.ok(decodeURIComponent(loc).includes('not switched on'), 'Message is plain English');
        assert.ok(!decodeURIComponent(loc).includes('OUTLOOK_CLIENT_ID'), 'Message does not expose config names');
      } finally {
        process.env.OUTLOOK_CLIENT_ID = oldClientId;
      }
    });
  });

  describe('GET /api/v1/integrations/outlook/callback', () => {
    test('4. Does not require session cookie to handle callback', async () => {
      // Create state entry directly
      const stateEntry = createStateEntry({ actorId: 'actor_kirsty_allen' });

      // Missing code returns 400, proving no 401 was returned even without session cookie
      const res = await makeRequest(`/api/v1/integrations/outlook/callback?state=${stateEntry.state}`);
      assert.notEqual(res.status, 401);
      assert.equal(res.status, 400);
      assert.equal(res.body.error?.code, 'MISSING_CODE');
    });

    test('5. Handles user-denied error by redirecting to dashboard with error and stores nothing', async () => {
      const res = await makeRequest('/api/v1/integrations/outlook/callback?error=access_denied&error_description=The+user+has+denied+consent');
      assert.equal(res.status, 302);
      const location = res.headers.location;
      assert.ok(location.includes('/index.html?outlook_error='));
      assert.ok(location.includes('denied'));

      // Verify no vault record was created
      const conn = outlookConnectionStore.getConnection({ filePath: TEST_VAULT_PATH, key: TEST_ENC_KEY });
      assert.equal(conn, null);
    });

    test('6. Rejects missing or malformed state parameter with 400', async () => {
      const res = await makeRequest('/api/v1/integrations/outlook/callback?code=mock_code');
      assert.equal(res.status, 400);
      assert.equal(res.body.error?.code, 'INVALID_STATE');
    });

    test('7. Rejects expired state parameter with 400', async () => {
      const stateEntry = createStateEntry({ actorId: 'actor_kirsty_allen', ttlMs: -1000 });
      const res = await makeRequest(`/api/v1/integrations/outlook/callback?state=${stateEntry.state}&code=mock_code`);
      assert.equal(res.status, 400);
      assert.equal(res.body.error?.code, 'EXPIRED_STATE');
    });

    test('8. Replayed callback / double-click: second invocation fails with UNKNOWN_STATE message', async () => {
      const stateEntry = createStateEntry({ actorId: 'actor_kirsty_allen' });

      // First consumption
      consumeState(stateEntry.state);

      // Attempt callback with already-consumed state
      const res = await makeRequest(`/api/v1/integrations/outlook/callback?state=${stateEntry.state}&code=mock_code`);
      assert.equal(res.status, 400);
      assert.equal(res.body.error?.code, 'UNKNOWN_STATE');
      assert.ok(res.body.error?.message.includes('already been used') || res.body.error?.message.includes('invalid'));
    });

    test('9. Handles Microsoft token endpoint 500 error gracefully with 502', async () => {
      const stateEntry = createStateEntry({ actorId: 'actor_kirsty_allen' });

      mockFetchHandler = async () => {
        return {
          ok: false,
          status: 500,
          text: async () => 'Internal Microsoft Server Error'
        };
      };

      const res = await makeRequest(`/api/v1/integrations/outlook/callback?state=${stateEntry.state}&code=mock_code_500`);
      assert.equal(res.status, 502);
      assert.equal(res.body.error?.code, 'TOKEN_ENDPOINT_ERROR');
    });

    test('10. Rejects token response missing refresh_token with 400 MISSING_REFRESH_TOKEN', async () => {
      const stateEntry = createStateEntry({ actorId: 'actor_kirsty_allen' });

      mockFetchHandler = async () => {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            token_type: 'Bearer',
            scope: 'Mail.Read Calendars.Read',
            expires_in: 3600,
            access_token: 'mock_access_token_no_refresh',
            id_token: 'any.jwt.string'
            // refresh_token omitted!
          })
        };
      };

      const res = await makeRequest(`/api/v1/integrations/outlook/callback?state=${stateEntry.state}&code=mock_code`);
      assert.equal(res.status, 400);
      assert.equal(res.body.error?.code, 'MISSING_REFRESH_TOKEN');
    });

    test('11. Rejects bad id_token signature with 401 INVALID_ID_TOKEN', async () => {
      const stateEntry = createStateEntry({ actorId: 'actor_kirsty_allen' });
      const tamperedIdToken = createSignedIdToken({ nonce: stateEntry.nonce }, true);

      mockFetchHandler = async () => {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            token_type: 'Bearer',
            scope: 'offline_access Mail.Read Calendars.Read',
            expires_in: 3600,
            access_token: 'mock_access_token',
            refresh_token: 'mock_refresh_token',
            id_token: tamperedIdToken
          })
        };
      };

      const res = await makeRequest(`/api/v1/integrations/outlook/callback?state=${stateEntry.state}&code=mock_code`);
      assert.equal(res.status, 401);
      assert.equal(res.body.error?.code, 'INVALID_ID_TOKEN');
      assert.ok(res.body.error?.message.includes('signature') || res.body.error?.message.includes('verification'));
    });

    test('12. Success flow: exchanges code, validates tokens, persists encrypted vault record, redirects 302 to /index.html?outlook=connected', async () => {
      const stateEntry = createStateEntry({ actorId: 'actor_kirsty_allen' });
      const validIdToken = createSignedIdToken({
        name: 'Kirsty Allen (CEO)',
        email: 'kirsty.allen@trinova.co.uk',
        nonce: stateEntry.nonce
      });

      let tokenEndpointCalled = false;
      mockFetchHandler = async (url, options) => {
        assert.ok(url.includes(`/${TEST_TENANT_ID}/oauth2/v2.0/token`));
        assert.equal(options.method, 'POST');
        assert.ok(options.body.includes(`code_verifier=${stateEntry.codeVerifier}`));
        assert.ok(options.body.includes(`client_id=${TEST_CLIENT_ID}`));
        assert.ok(options.body.includes('code=valid_auth_code'));
        tokenEndpointCalled = true;

        return {
          ok: true,
          status: 200,
          json: async () => ({
            token_type: 'Bearer',
            scope: 'offline_access Mail.Read Calendars.Read openid profile email',
            expires_in: 3600,
            access_token: 'live_test_access_token_777',
            refresh_token: 'live_test_refresh_token_888',
            id_token: validIdToken
          })
        };
      };

      const res = await makeRequest(`/api/v1/integrations/outlook/callback?state=${stateEntry.state}&code=valid_auth_code`);
      assert.equal(tokenEndpointCalled, true);
      assert.equal(res.status, 302);
      assert.equal(res.headers.location, '/index.html?outlook=connected');

      // Verify connection record was securely stored in encrypted vault
      const stored = outlookConnectionStore.getConnection({
        filePath: TEST_VAULT_PATH,
        key: TEST_ENC_KEY
      });

      assert.ok(stored, 'Expected connection record in encrypted vault');
      assert.equal(stored.status, 'connected');
      assert.equal(stored.actorId, 'actor_kirsty_allen');
      assert.equal(stored.accountEmail, 'kirsty.allen@trinova.co.uk');
      assert.equal(stored.displayName, 'Kirsty Allen (CEO)');
      assert.equal(stored.tenantId, TEST_TENANT_ID);
      assert.equal(stored.refreshToken, 'live_test_refresh_token_888');
      assert.equal(stored.accessToken, 'live_test_access_token_777');
      assert.equal(stored.emailSyncEnabled, true);
      assert.equal(stored.calendarSyncEnabled, true);
      assert.deepEqual(stored.mailFolderIds, ['Inbox']);
      assert.ok(stored.accessTokenExpiresAt > Date.now());

      // Verify file on disk is encrypted AES-256-GCM ciphertext without plaintext tokens
      const rawDisk = fs.readFileSync(TEST_VAULT_PATH, 'utf8');
      assert.ok(!rawDisk.includes('live_test_refresh_token_888'));
      assert.ok(!rawDisk.includes('live_test_access_token_777'));
      assert.ok(!rawDisk.includes('kirsty.allen@trinova.co.uk'));
    });
  });
});
