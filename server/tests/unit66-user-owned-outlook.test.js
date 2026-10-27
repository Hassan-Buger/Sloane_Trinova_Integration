/**
 * Unit 66 Test Suite: User-Owned Microsoft Outlook Connection (Feature B)
 *
 * Verifies:
 * - Direct official Microsoft OAuth 2.0 Authorization Code flow with PKCE and state/nonce binding.
 * - Proper tenant routing (defaults to common/user-owned accounts) and prompt=select_account.
 * - Browser redirect handling: non-destructive return to Sloane on errors (no raw JSON in browser).
 * - Direct token exchange between backend and Microsoft token endpoint (zero third-party intermediaries).
 * - User identity verification from id_token claims and Graph connection check.
 * - AES-256-GCM encrypted vault persistence with zero secret leaks.
 * - Full disconnect lifecycle purging stored credentials.
 * - Interactive UI loading feedback on Connect button.
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
const rootDir = path.resolve(__dirname, '../..');

const TEST_ENC_KEY = 'fedcba9876543210fedcba9876543210fedcba9876543210fedcba9876543210';
const TEST_VAULT_PATH = path.resolve(__dirname, '../data-private/test-unit66-vault.json');
const TEST_CLIENT_ID = 'sloane-client-id-007';
const TEST_CLIENT_SECRET = 'sloane-client-secret-999';
const TEST_TENANT_ID = 'common';
const TEST_REDIRECT_URI = 'http://localhost:5006/api/v1/integrations/outlook/callback';

describe('Unit 66: User-Owned Microsoft Outlook Connection (Feature B)', () => {
  let server;
  let baseUrl;
  let rsaPrivateKey;
  let testJwk;
  let sessionCookie;
  let mockFetchHandler = null;

  const TEST_PORT = 5006;

  before(() => {
    // Generate RSA key pair for testing id_token signature verification
    const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
    rsaPrivateKey = privateKey;
    testJwk = publicKey.export({ format: 'jwk' });
    testJwk.kid = 'unit66-test-key-id';
    testJwk.use = 'sig';

    process.env.OUTLOOK_TOKEN_ENC_KEY = TEST_ENC_KEY;
    process.env.OUTLOOK_VAULT_PATH = TEST_VAULT_PATH;
    process.env.OUTLOOK_CLIENT_ID = TEST_CLIENT_ID;
    process.env.OUTLOOK_CLIENT_SECRET = TEST_CLIENT_SECRET;
    process.env.OUTLOOK_TENANT_ID = TEST_TENANT_ID;
    process.env.OUTLOOK_REDIRECT_URI = TEST_REDIRECT_URI;

    const session = sessionStore.createSession({
      id: 'actor_kirsty_allen',
      name: 'Kirsty Allen',
      email: 'kirsty.allen@trinova.co.uk',
      role: 'owner'
    });
    sessionCookie = `slon_session=${session.sessionId}`;

    outlookIdentityService.setJwksCache(TEST_TENANT_ID, [testJwk]);

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

  function createSignedIdToken(claims = {}) {
    const header = { alg: 'RS256', typ: 'JWT', kid: 'unit66-test-key-id' };
    const nowSec = Math.floor(Date.now() / 1000);
    const payload = {
      aud: TEST_CLIENT_ID,
      iss: `https://login.microsoftonline.com/${TEST_TENANT_ID}/v2.0`,
      iat: nowSec,
      nbf: nowSec - 5,
      exp: nowSec + 3600,
      sub: 'user_sub_unique_123',
      name: 'Kirsty Allen',
      preferred_username: 'kirsty.allen@trinova.co.uk',
      tid: TEST_TENANT_ID,
      ...claims
    };

    const b64Header = Buffer.from(JSON.stringify(header)).toString('base64url');
    const b64Payload = Buffer.from(JSON.stringify(payload)).toString('base64url');
    const message = `${b64Header}.${b64Payload}`;

    const signer = crypto.createSign('RSA-SHA256');
    signer.update(message);
    const sig = signer.sign(rsaPrivateKey, 'base64url');
    return `${message}.${sig}`;
  }

  describe('1. Direct Official Microsoft Authorization Initiation', () => {
    test('1.1 /connect redirects 302 to official Microsoft authorize endpoint with PKCE & select_account', async () => {
      const res = await makeRequest('/api/v1/integrations/outlook/connect', {
        headers: { Cookie: sessionCookie }
      });

      assert.equal(res.status, 302);
      const loc = res.headers.location;
      assert.ok(loc.startsWith('https://login.microsoftonline.com/common/oauth2/v2.0/authorize'));

      const targetUrl = new URL(loc);
      assert.equal(targetUrl.searchParams.get('client_id'), TEST_CLIENT_ID);
      assert.equal(targetUrl.searchParams.get('response_type'), 'code');
      assert.equal(targetUrl.searchParams.get('redirect_uri'), TEST_REDIRECT_URI);
      assert.equal(targetUrl.searchParams.get('prompt'), 'select_account');
      assert.equal(targetUrl.searchParams.get('code_challenge_method'), 'S256');
      assert.ok(targetUrl.searchParams.get('code_challenge'));
      assert.ok(targetUrl.searchParams.get('state'));
      assert.ok(targetUrl.searchParams.get('nonce'));
      assert.ok(targetUrl.searchParams.get('scope').includes('offline_access'));
      assert.ok(targetUrl.searchParams.get('scope').includes('Mail.Read'));
      assert.ok(targetUrl.searchParams.get('scope').includes('Calendars.Read'));
    });

    test('1.2 /connect requires active authentication session', async () => {
      const res = await makeRequest('/api/v1/integrations/outlook/connect');
      assert.equal(res.status, 401);
    });
  });

  describe('2. Browser Redirect Error Handling (No Raw JSON for Browsers)', () => {
    test('2.1 User cancellation redirects 302 to /index.html?outlook_error=...', async () => {
      const res = await makeRequest('/api/v1/integrations/outlook/callback?error=access_denied&error_description=User+cancelled');
      assert.equal(res.status, 302);
      assert.ok(res.headers.location.startsWith('/index.html?outlook_error='));
      assert.ok(decodeURIComponent(res.headers.location).includes('User cancelled'));
    });

    test('2.2 Invalid state with Accept: text/html redirects 302 to /index.html?outlook_error=...', async () => {
      const res = await makeRequest('/api/v1/integrations/outlook/callback?state=invalid_or_expired_state', {
        headers: { Accept: 'text/html,application/xhtml+xml' }
      });
      assert.equal(res.status, 302);
      assert.ok(res.headers.location.startsWith('/index.html?outlook_error='));
    });

    test('2.3 Missing code with Accept: text/html redirects 302 to /index.html?outlook_error=...', async () => {
      const stateEntry = createStateEntry({ actorId: 'actor_kirsty_allen' });
      const res = await makeRequest(`/api/v1/integrations/outlook/callback?state=${stateEntry.state}`, {
        headers: { Accept: 'text/html,application/xhtml+xml' }
      });
      assert.equal(res.status, 302);
      assert.ok(res.headers.location.startsWith('/index.html?outlook_error='));
    });
  });

  describe('3. Token Exchange, Identity Extraction & Vault Encryption', () => {
    test('3.1 Successful OAuth flow extracts user identity and securely persists encrypted tokens', async () => {
      const stateEntry = createStateEntry({ actorId: 'actor_kirsty_allen' });
      const validIdToken = createSignedIdToken({
        name: 'Kirsty Allen (CEO)',
        preferred_username: 'kirsty.allen@trinova.co.uk',
        nonce: stateEntry.nonce
      });

      mockFetchHandler = async (url, options) => {
        assert.ok(url.includes('/oauth2/v2.0/token'));
        assert.equal(options.method, 'POST');
        return {
          ok: true,
          status: 200,
          json: async () => ({
            token_type: 'Bearer',
            scope: 'offline_access Mail.Read Calendars.Read openid profile email',
            expires_in: 3600,
            access_token: 'live_access_token_secret_12345',
            refresh_token: 'live_refresh_token_secret_67890',
            id_token: validIdToken
          })
        };
      };

      const res = await makeRequest(`/api/v1/integrations/outlook/callback?state=${stateEntry.state}&code=valid_user_auth_code`);
      assert.equal(res.status, 302);
      assert.equal(res.headers.location, '/index.html?outlook=connected');

      // Verify vault persistence
      const connection = outlookConnectionStore.getConnection({
        filePath: TEST_VAULT_PATH,
        key: TEST_ENC_KEY
      });

      assert.ok(connection);
      assert.equal(connection.status, 'connected');
      assert.equal(connection.accountEmail, 'kirsty.allen@trinova.co.uk');
      assert.equal(connection.displayName, 'Kirsty Allen (CEO)');
      assert.equal(connection.refreshToken, 'live_refresh_token_secret_67890');

      // Verify file on disk is encrypted and does not contain plain secrets
      const rawFile = fs.readFileSync(TEST_VAULT_PATH, 'utf8');
      assert.ok(!rawFile.includes('live_access_token_secret_12345'), 'Raw file must not leak access token');
      assert.ok(!rawFile.includes('live_refresh_token_secret_67890'), 'Raw file must not leak refresh token');
    });

    test('3.2 Disconnect purges tokens and marks integration disconnected', async () => {
      // Seed connected state in vault
      outlookConnectionStore.saveConnection({
        actorId: 'actor_kirsty_allen',
        status: 'connected',
        accountEmail: 'kirsty.allen@trinova.co.uk',
        displayName: 'Kirsty Allen',
        tenantId: 'common',
        refreshToken: 'token_to_purge',
        accessToken: 'access_to_purge',
        accessTokenExpiresAt: Date.now() + 3600000
      }, { filePath: TEST_VAULT_PATH, key: TEST_ENC_KEY });

      // Call disconnect
      const res = await makeRequest('/api/v1/integrations/outlook/disconnect', {
        method: 'POST',
        headers: {
          Cookie: sessionCookie,
          Origin: 'http://localhost:5006',
          'X-Requested-With': 'sloane',
          'Content-Type': 'application/json'
        }
      });

      assert.equal(res.status, 200);
      assert.equal(res.body.status, 'not_connected');

      // Verify tokens purged from vault
      const afterConn = outlookConnectionStore.getConnection({
        filePath: TEST_VAULT_PATH,
        key: TEST_ENC_KEY
      });
      assert.equal(afterConn, null, 'Vault connection record should be cleared on disconnect');
    });
  });

  describe('4. Frontend Settings Loading State Feedback', () => {
    test('4.1 outlookSettings.js wires Connect button to loading state on click', () => {
      const settingsJs = fs.readFileSync(path.resolve(rootDir, 'scripts/components/outlookSettings.js'), 'utf8');
      assert.ok(
        settingsJs.includes("btnConnect.innerHTML = '⏳︎ Connecting to Microsoft...';"),
        'Connect button must transition to loading text on click'
      );
      assert.ok(
        settingsJs.includes("btnConnect.style.pointerEvents = 'none';"),
        'Connect button must prevent double clicks'
      );
    });
  });
});
