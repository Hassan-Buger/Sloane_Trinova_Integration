/**
 * Unit 16 Test Suite: Microsoft Graph Client & Token Lifecycle (Task P4.1)
 *
 * Verifies:
 * - Bearer token resolution from encrypted vault
 * - Single-flight refresh (N concurrent requests share exactly 1 refresh call)
 * - 401 Unauthorized retry handling (refresh once, retry once)
 * - Double 401 failure transition to reconnect_required
 * - Refresh invalid_grant handling (transition to reconnect_required)
 * - 429/503 rate limiting with Retry-After cap at 60s and "Microsoft is busy" error
 * - 8s network timeout handling with "could not reach Microsoft" error
 * - Rotated refresh token persistence in encrypted vault
 * - OUTLOOK_NOT_CONNECTED when no vault record exists
 */

import { test, describe, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

import {
  graphClient,
  GraphClientError,
  GRAPH_BASE_URL
} from '../src/services/graphClient.js';
import { outlookConnectionStore } from '../src/services/outlookConnectionStore.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const TEST_ENC_KEY = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
const TEST_VAULT_PATH = path.resolve(__dirname, '../data-private/test-unit16-vault.json');
const TEST_CLIENT_ID = 'test-client-id-graph';
const TEST_CLIENT_SECRET = 'test-client-secret-graph';
const TEST_TENANT_ID = 'test-tenant-graph-789';

describe('Task P4.1: Microsoft Graph Client & Token Lifecycle', () => {
  const defaultVaultOptions = {
    vaultPath: TEST_VAULT_PATH,
    vaultKey: TEST_ENC_KEY,
    clientId: TEST_CLIENT_ID,
    clientSecret: TEST_CLIENT_SECRET,
    tenantId: TEST_TENANT_ID
  };

  before(() => {
    process.env.OUTLOOK_TOKEN_ENC_KEY = TEST_ENC_KEY;
    process.env.OUTLOOK_VAULT_PATH = TEST_VAULT_PATH;
    process.env.OUTLOOK_CLIENT_ID = TEST_CLIENT_ID;
    process.env.OUTLOOK_CLIENT_SECRET = TEST_CLIENT_SECRET;
    process.env.OUTLOOK_TENANT_ID = TEST_TENANT_ID;
  });

  after(() => {
    if (fs.existsSync(TEST_VAULT_PATH)) {
      try { fs.unlinkSync(TEST_VAULT_PATH); } catch {}
    }
  });

  beforeEach(() => {
    if (fs.existsSync(TEST_VAULT_PATH)) {
      try { fs.unlinkSync(TEST_VAULT_PATH); } catch {}
    }
  });

  // Helper to create a valid connection record in the vault
  function seedConnection({
    status = 'connected',
    refreshToken = 'initial_refresh_token_001',
    accessToken = 'initial_access_token_001',
    expiresInSec = 3600
  } = {}) {
    return outlookConnectionStore.saveConnection({
      actorId: 'actor_kirsty_allen',
      status,
      accountEmail: 'kirsty.allen@trinova.co.uk',
      displayName: 'Kirsty Allen',
      tenantId: TEST_TENANT_ID,
      scopes: ['offline_access', 'Mail.Read', 'Calendars.Read'],
      refreshToken,
      accessToken,
      accessTokenExpiresAt: Date.now() + (expiresInSec * 1000),
      emailSyncEnabled: true,
      calendarSyncEnabled: true,
      mailFolderIds: ['Inbox'],
      connectedAt: new Date().toISOString()
    }, {
      filePath: TEST_VAULT_PATH,
      key: TEST_ENC_KEY
    });
  }

  test('1. Throws OUTLOOK_NOT_CONNECTED when no vault record exists', async () => {
    await assert.rejects(
      () => graphClient.get('/me', defaultVaultOptions),
      (err) => {
        assert.ok(err instanceof GraphClientError);
        assert.equal(err.code, 'OUTLOOK_NOT_CONNECTED');
        return true;
      }
    );
  });

  test('2. Throws OUTLOOK_RECONNECT_REQUIRED when connection status is reconnect_required', async () => {
    seedConnection({ status: 'reconnect_required' });

    await assert.rejects(
      () => graphClient.get('/me', defaultVaultOptions),
      (err) => {
        assert.ok(err instanceof GraphClientError);
        assert.equal(err.code, 'OUTLOOK_RECONNECT_REQUIRED');
        return true;
      }
    );
  });

  test('3. Executes successful GET request with Bearer token against Graph base URL', async () => {
    seedConnection({ accessToken: 'valid_live_token_123' });

    let fetchCalled = false;
    const mockFetch = async (url, options) => {
      fetchCalled = true;
      assert.equal(url, `${GRAPH_BASE_URL}/me/calendarView?start=today`);
      assert.equal(options.headers['Authorization'], 'Bearer valid_live_token_123');
      assert.equal(options.headers['Accept'], 'application/json');

      return {
        ok: true,
        status: 200,
        json: async () => ({ value: [{ id: 'evt_1', subject: 'Board Meeting' }] })
      };
    };

    const data = await graphClient.get('/me/calendarView?start=today', {
      ...defaultVaultOptions,
      fetchFn: mockFetch
    });

    assert.equal(fetchCalled, true);
    assert.deepEqual(data, { value: [{ id: 'evt_1', subject: 'Board Meeting' }] });
  });

  test('4. Auto-refreshes token when access token is expired or within 60s window before calling Graph', async () => {
    // Seed expired token (expired 10 seconds ago)
    seedConnection({
      accessToken: 'expired_access_token',
      expiresInSec: -10,
      refreshToken: 'valid_refresh_token_abc'
    });

    let refreshCalled = false;
    let graphCalled = false;

    const mockFetch = async (url, options) => {
      if (url.includes('/oauth2/v2.0/token')) {
        refreshCalled = true;
        assert.ok(options.body.includes('refresh_token=valid_refresh_token_abc'));
        return {
          ok: true,
          status: 200,
          json: async () => ({
            access_token: 'fresh_refreshed_access_token_999',
            refresh_token: 'valid_refresh_token_abc',
            expires_in: 3600
          })
        };
      }

      if (url.includes('graph.microsoft.com')) {
        graphCalled = true;
        assert.equal(options.headers['Authorization'], 'Bearer fresh_refreshed_access_token_999');
        return {
          ok: true,
          status: 200,
          json: async () => ({ displayName: 'Kirsty Allen' })
        };
      }

      throw new Error(`Unexpected url: ${url}`);
    };

    const data = await graphClient.get('/me', {
      ...defaultVaultOptions,
      fetchFn: mockFetch
    });

    assert.equal(refreshCalled, true);
    assert.equal(graphCalled, true);
    assert.equal(data.displayName, 'Kirsty Allen');

    // Verify vault now contains fresh access token
    const conn = outlookConnectionStore.getConnection({ filePath: TEST_VAULT_PATH, key: TEST_ENC_KEY });
    assert.equal(conn.accessToken, 'fresh_refreshed_access_token_999');
  });

  test('5. Atomically persists rotated refresh token in encrypted vault', async () => {
    seedConnection({
      accessToken: 'expired_token',
      expiresInSec: -10,
      refreshToken: 'old_refresh_token_001'
    });

    const mockFetch = async (url) => {
      if (url.includes('/oauth2/v2.0/token')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            access_token: 'new_token_777',
            refresh_token: 'brand_new_rotated_refresh_token_888', // Microsoft rotated it!
            expires_in: 3600
          })
        };
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({ success: true })
      };
    };

    await graphClient.get('/me', {
      ...defaultVaultOptions,
      fetchFn: mockFetch
    });

    const conn = outlookConnectionStore.getConnection({ filePath: TEST_VAULT_PATH, key: TEST_ENC_KEY });
    assert.equal(conn.refreshToken, 'brand_new_rotated_refresh_token_888');
    assert.equal(conn.accessToken, 'new_token_777');

    // Verify disk contents contain no plaintext tokens
    const rawDisk = fs.readFileSync(TEST_VAULT_PATH, 'utf8');
    assert.ok(!rawDisk.includes('brand_new_rotated_refresh_token_888'));
    assert.ok(!rawDisk.includes('new_token_777'));
  });

  test('6. Graph 401 Unauthorized: refreshes once and retries once successfully', async () => {
    seedConnection({
      accessToken: 'stale_token_that_graph_rejects',
      expiresInSec: 3600 // Looks fresh locally, but revoked on Microsoft side
    });

    let graphAttempts = 0;
    let refreshCount = 0;

    const mockFetch = async (url, options) => {
      if (url.includes('/oauth2/v2.0/token')) {
        refreshCount++;
        return {
          ok: true,
          status: 200,
          json: async () => ({
            access_token: 'recovered_token_after_401',
            refresh_token: 'refreshed_rt',
            expires_in: 3600
          })
        };
      }

      if (url.includes('graph.microsoft.com')) {
        graphAttempts++;
        if (graphAttempts === 1) {
          assert.equal(options.headers['Authorization'], 'Bearer stale_token_that_graph_rejects');
          return {
            ok: false,
            status: 401,
            text: async () => 'Unauthorized'
          };
        }
        // Second attempt with retried recovered token
        assert.equal(options.headers['Authorization'], 'Bearer recovered_token_after_401');
        return {
          ok: true,
          status: 200,
          json: async () => ({ mail: 'kirsty@trinova.co.uk' })
        };
      }

      throw new Error(`Unknown url: ${url}`);
    };

    const data = await graphClient.get('/me', {
      ...defaultVaultOptions,
      fetchFn: mockFetch
    });

    assert.equal(graphAttempts, 2, 'Expected exactly 1 retry after 401');
    assert.equal(refreshCount, 1, 'Expected exactly 1 refresh call');
    assert.equal(data.mail, 'kirsty@trinova.co.uk');
  });

  test('7. Double 401: transitions connection to reconnect_required and halts', async () => {
    seedConnection({ accessToken: 'initial_token' });

    let graphAttempts = 0;
    const mockFetch = async (url) => {
      if (url.includes('/oauth2/v2.0/token')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            access_token: 'second_token',
            expires_in: 3600
          })
        };
      }

      // Graph returns 401 both times
      graphAttempts++;
      return {
        ok: false,
        status: 401,
        text: async () => 'Unauthorized'
      };
    };

    await assert.rejects(
      () => graphClient.get('/me', { ...defaultVaultOptions, fetchFn: mockFetch }),
      (err) => {
        assert.ok(err instanceof GraphClientError);
        assert.equal(err.code, 'OUTLOOK_RECONNECT_REQUIRED');
        return true;
      }
    );

    assert.equal(graphAttempts, 2);

    const conn = outlookConnectionStore.getConnection({ filePath: TEST_VAULT_PATH, key: TEST_ENC_KEY });
    assert.equal(conn.status, 'reconnect_required');
  });

  test('8. Refresh invalid_grant: sets status to reconnect_required and throws OUTLOOK_RECONNECT_REQUIRED', async () => {
    seedConnection({
      accessToken: 'expired_token',
      expiresInSec: -10,
      refreshToken: 'revoked_refresh_token'
    });

    const mockFetch = async (url) => {
      if (url.includes('/oauth2/v2.0/token')) {
        return {
          ok: false,
          status: 400,
          text: async () => JSON.stringify({
            error: 'invalid_grant',
            error_description: 'AADSTS700082: The refresh token has expired due to inactivity.'
          })
        };
      }
      throw new Error('Graph should not be called if refresh failed with invalid_grant');
    };

    await assert.rejects(
      () => graphClient.get('/me', { ...defaultVaultOptions, fetchFn: mockFetch }),
      (err) => {
        assert.ok(err instanceof GraphClientError);
        assert.equal(err.code, 'OUTLOOK_RECONNECT_REQUIRED');
        return true;
      }
    );

    const conn = outlookConnectionStore.getConnection({ filePath: TEST_VAULT_PATH, key: TEST_ENC_KEY });
    assert.equal(conn.status, 'reconnect_required');
    assert.ok(conn.lastError.includes('invalid_grant'));
  });

  test('9. Rate limit 429/503: honours Retry-After, caps at 60s, and surfaces "Microsoft is busy"', async () => {
    seedConnection({ accessToken: 'valid_token' });

    // Test with 30s Retry-After
    const mockFetch30 = async () => ({
      ok: false,
      status: 429,
      headers: { 'retry-after': '30' }
    });

    await assert.rejects(
      () => graphClient.get('/me', { ...defaultVaultOptions, fetchFn: mockFetch30 }),
      (err) => {
        assert.ok(err instanceof GraphClientError);
        assert.equal(err.code, 'MICROSOFT_BUSY');
        assert.equal(err.message, 'Sync error — Microsoft is busy, try again shortly');
        assert.equal(err.retryAfter, 30);
        return true;
      }
    );

    // Test with 180s Retry-After (must be capped at 60s per §4.4)
    const mockFetch180 = async () => ({
      ok: false,
      status: 503,
      headers: { 'retry-after': '180' }
    });

    await assert.rejects(
      () => graphClient.get('/me', { ...defaultVaultOptions, fetchFn: mockFetch180 }),
      (err) => {
        assert.equal(err.code, 'MICROSOFT_BUSY');
        assert.equal(err.retryAfter, 60);
        return true;
      }
    );

    const conn = outlookConnectionStore.getConnection({ filePath: TEST_VAULT_PATH, key: TEST_ENC_KEY });
    assert.equal(conn.lastError, 'Sync error — Microsoft is busy, try again shortly');
  });

  test('10. Network timeout: surfaces "Sync error — could not reach Microsoft"', async () => {
    seedConnection({ accessToken: 'valid_token' });

    const mockFetchTimeout = async () => {
      const err = new Error('The operation was aborted due to timeout');
      err.name = 'TimeoutError';
      throw err;
    };

    await assert.rejects(
      () => graphClient.get('/me', { ...defaultVaultOptions, fetchFn: mockFetchTimeout }),
      (err) => {
        assert.ok(err instanceof GraphClientError);
        assert.equal(err.code, 'MICROSOFT_UNREACHABLE');
        assert.equal(err.message, 'Sync error — could not reach Microsoft');
        return true;
      }
    );

    const conn = outlookConnectionStore.getConnection({ filePath: TEST_VAULT_PATH, key: TEST_ENC_KEY });
    assert.equal(conn.lastError, 'Sync error — could not reach Microsoft');
  });

  test('11. Single-Flight Refresh: 5 concurrent requests trigger exactly ONE token refresh call', async () => {
    seedConnection({
      accessToken: 'expired_token',
      expiresInSec: -50,
      refreshToken: 'concurrent_rt_001'
    });

    let refreshCallCount = 0;
    let graphCallCount = 0;

    const mockFetch = async (url) => {
      if (url.includes('/oauth2/v2.0/token')) {
        refreshCallCount++;
        // Introduce small async delay to simulate real network latency
        await new Promise(r => setTimeout(r, 20));
        return {
          ok: true,
          status: 200,
          json: async () => ({
            access_token: 'shared_refreshed_access_token_888',
            refresh_token: 'concurrent_rt_001',
            expires_in: 3600
          })
        };
      }

      if (url.includes('graph.microsoft.com')) {
        graphCallCount++;
        return {
          ok: true,
          status: 200,
          json: async () => ({ count: graphCallCount })
        };
      }

      throw new Error(`Unexpected url: ${url}`);
    };

    // Fire 5 concurrent requests simultaneously
    const promises = [
      graphClient.get('/me/messages', { ...defaultVaultOptions, fetchFn: mockFetch }),
      graphClient.get('/me/calendarView', { ...defaultVaultOptions, fetchFn: mockFetch }),
      graphClient.get('/me/mailFolders', { ...defaultVaultOptions, fetchFn: mockFetch }),
      graphClient.get('/me/events', { ...defaultVaultOptions, fetchFn: mockFetch }),
      graphClient.get('/me/contacts', { ...defaultVaultOptions, fetchFn: mockFetch })
    ];

    const results = await Promise.all(promises);

    assert.equal(results.length, 5);
    // CRITICAL: Refresh endpoint must have been called exactly ONCE!
    assert.equal(refreshCallCount, 1, 'Single-flight violation: expected exactly 1 refresh call for 5 concurrent requests');
    assert.equal(graphCallCount, 5, 'All 5 Graph calls should have executed');

    // Single-flight promise must be cleanly reset after completion
    assert.equal(graphClient.isRefreshActive(), false);
  });
});
