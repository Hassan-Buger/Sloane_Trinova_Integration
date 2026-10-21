/**
 * Automated Test Suite: Task P6.3 — Per-User 2-Minute In-Memory Cache
 * Implements verification per docs/outlook-build/SPEC.md §4.3 and §5 (Task P6.3):
 * - Per-user 2-minute cache keyed by actor and resource
 * - Subsequent calls within 2 minutes return fromCache: true without calling Microsoft Graph
 * - Cache expiry after 2 minutes causes fresh Graph fetch
 * - POST /api/v1/integrations/outlook/sync clears the cache immediately
 * - POST /api/v1/integrations/outlook/disconnect clears the cache immediately
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
import {
  outlookDataCache,
  clearOutlookDataCache,
  getCachedResource,
  setCachedResource,
  DATA_CACHE_TTL_MS
} from '../src/services/outlookDataService.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const TEST_ENC_KEY = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
const TEST_VAULT_PATH = path.resolve(__dirname, '../data-private/test-unit21-vault.json');
const TEST_CLIENT_ID = 'test-outlook-client-id-701';
const TEST_PORT = 5008;

const SENSITIVE_TOKENS = {
  refreshToken: 'RT_CACHE_SECRET_REFRESH_TOKEN_UNIT21',
  accessToken: 'AT_CACHE_SECRET_ACCESS_TOKEN_UNIT21'
};

describe('Task P6.3: Per-User 2-Minute In-Memory Cache', () => {
  let server;
  let baseUrl;
  let kirstySessionCookie;
  let hamzaSessionCookie;
  let graphCallCount = {
    calendar: 0,
    messages: 0
  };

  const mockGraphClient = {
    async get(endpoint, opts) {
      if (endpoint.includes('calendarView')) {
        graphCallCount.calendar++;
        return {
          value: [
            {
              id: `evt_${Date.now()}`,
              subject: 'Portfolio Briefing',
              start: { dateTime: '2026-10-21T10:00:00Z' },
              end: { dateTime: '2026-10-21T11:00:00Z' },
              isAllDay: false
            }
          ]
        };
      }
      if (endpoint.includes('messages')) {
        graphCallCount.messages++;
        return {
          value: [
            {
              id: `msg_${Date.now()}`,
              subject: 'Action Required: Filing Sign-Off',
              from: { emailAddress: { name: 'Client Manager' } },
              receivedDateTime: new Date().toISOString(),
              importance: 'high'
            }
          ]
        };
      }
      return { value: [] };
    }
  };

  before(() => {
    process.env.OUTLOOK_TOKEN_ENC_KEY = TEST_ENC_KEY;
    process.env.OUTLOOK_VAULT_PATH = TEST_VAULT_PATH;
    process.env.OUTLOOK_CLIENT_ID = TEST_CLIENT_ID;

    // Create session 1: Kirsty Allen
    const s1 = sessionStore.createSession({
      email: 'kirsty@trinova.com',
      name: 'Kirsty Allen'
    });
    kirstySessionCookie = `slon_session=${s1.sessionId}`;

    // Create session 2: Hamza Malik
    const s2 = sessionStore.createSession({
      email: 'hamza@trinova.com',
      name: 'Hamza Malik'
    });
    hamzaSessionCookie = `slon_session=${s2.sessionId}`;

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
    graphCallCount.calendar = 0;
    graphCallCount.messages = 0;
    clearOutlookDataCache();

    if (fs.existsSync(TEST_VAULT_PATH)) {
      try { fs.unlinkSync(TEST_VAULT_PATH); } catch {}
    }

    // Default active connection in vault
    outlookConnectionStore.saveConnection({
      actorId: 'actor_kirsty_allen',
      status: 'connected',
      accountEmail: 'kirsty.allen@trinova.co.uk',
      refreshToken: SENSITIVE_TOKENS.refreshToken,
      calendarSyncEnabled: true,
      emailSyncEnabled: true,
      mailFolderIds: ['Inbox']
    }, { filePath: TEST_VAULT_PATH, key: TEST_ENC_KEY });
  });

  function makeRequest(reqPath, options = {}) {
    return new Promise((resolve, reject) => {
      const url = new URL(reqPath, baseUrl);
      const isStateChanging = ['POST', 'PATCH', 'PUT', 'DELETE'].includes((options.method || 'GET').toUpperCase());
      const defaultHeaders = isStateChanging ? {
        Origin: baseUrl,
        'X-Requested-With': 'sloane'
      } : {};
      const reqHeaders = { ...defaultHeaders, ...(options.headers || {}) };

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
      req.end();
    });
  }

  // ==========================================
  // In-Memory Cache Unit Helpers
  // ==========================================
  describe('Cache Helper Functions', () => {
    test('1. DATA_CACHE_TTL_MS is exactly 2 minutes (120,000 ms)', () => {
      assert.equal(DATA_CACHE_TTL_MS, 120000);
    });

    test('2. getCachedResource returns null for non-existent or expired keys', () => {
      assert.equal(getCachedResource('user1', 'diary'), null);

      // Insert expired entry
      setCachedResource('user1', 'diary', { test: 123 }, -1000); // expired 1s ago
      assert.equal(getCachedResource('user1', 'diary'), null);
    });

    test('3. setCachedResource stores valid entries and isolates by actor and resource', () => {
      setCachedResource('actor_1', 'diary', { count: 5 });
      setCachedResource('actor_2', 'diary', { count: 8 });
      setCachedResource('actor_1', 'flagged-emails', { count: 2 });

      assert.deepEqual(getCachedResource('actor_1', 'diary'), { count: 5 });
      assert.deepEqual(getCachedResource('actor_2', 'diary'), { count: 8 });
      assert.deepEqual(getCachedResource('actor_1', 'flagged-emails'), { count: 2 });
    });
  });

  // ==========================================
  // HTTP Endpoints Cache Lifecycle
  // ==========================================
  describe('HTTP Endpoints Cache Integration', () => {
    test('4. GET /api/v1/outlook/diary caches first response; second request hits cache without Graph call', async () => {
      // First request: calls Graph
      const res1 = await makeRequest('/api/v1/outlook/diary', {
        method: 'GET',
        headers: { Cookie: kirstySessionCookie }
      });

      assert.equal(res1.status, 200);
      assert.equal(res1.body.fromCache, false);
      assert.equal(graphCallCount.calendar, 1);

      // Second request within 2 minutes: returns from cache
      const res2 = await makeRequest('/api/v1/outlook/diary', {
        method: 'GET',
        headers: { Cookie: kirstySessionCookie }
      });

      assert.equal(res2.status, 200);
      assert.equal(res2.body.fromCache, true);
      assert.equal(graphCallCount.calendar, 1); // Not incremented!
    });

    test('5. GET /api/v1/outlook/flagged-emails caches first response; second request hits cache without Graph call', async () => {
      // First request: calls Graph
      const res1 = await makeRequest('/api/v1/outlook/flagged-emails', {
        method: 'GET',
        headers: { Cookie: kirstySessionCookie }
      });

      assert.equal(res1.status, 200);
      assert.equal(res1.body.fromCache, false);
      assert.equal(graphCallCount.messages, 1);

      // Second request: returns from cache
      const res2 = await makeRequest('/api/v1/outlook/flagged-emails', {
        method: 'GET',
        headers: { Cookie: kirstySessionCookie }
      });

      assert.equal(res2.status, 200);
      assert.equal(res2.body.fromCache, true);
      assert.equal(graphCallCount.messages, 1); // Not incremented!
    });

    test('6. POST /api/v1/integrations/outlook/sync clears cache so subsequent reads call Graph again', async () => {
      // 1. Prime diary cache
      const initial = await makeRequest('/api/v1/outlook/diary', {
        method: 'GET',
        headers: { Cookie: kirstySessionCookie }
      });
      assert.equal(initial.body.fromCache, false);
      assert.equal(graphCallCount.calendar, 1);

      // 2. Call sync-now
      const syncRes = await makeRequest('/api/v1/integrations/outlook/sync', {
        method: 'POST',
        headers: { Cookie: kirstySessionCookie }
      });
      assert.equal(syncRes.status, 200);

      // 3. Subsequent diary request must fetch fresh data from Graph
      const freshRes = await makeRequest('/api/v1/outlook/diary', {
        method: 'GET',
        headers: { Cookie: kirstySessionCookie }
      });
      assert.equal(freshRes.status, 200);
      assert.equal(freshRes.body.fromCache, false);
      assert.ok(graphCallCount.calendar >= 2);
    });

    test('7. POST /api/v1/integrations/outlook/disconnect purges all caches', async () => {
      // 1. Prime cache
      await makeRequest('/api/v1/outlook/diary', {
        method: 'GET',
        headers: { Cookie: kirstySessionCookie }
      });
      assert.ok(outlookDataCache.size > 0);

      // 2. Call disconnect
      const discRes = await makeRequest('/api/v1/integrations/outlook/disconnect', {
        method: 'POST',
        headers: { Cookie: kirstySessionCookie }
      });
      assert.equal(discRes.status, 200);

      // 3. Cache must be completely empty
      assert.equal(outlookDataCache.size, 0);

      // 4. Subsequent diary request returns empty state
      const emptyRes = await makeRequest('/api/v1/outlook/diary', {
        method: 'GET',
        headers: { Cookie: kirstySessionCookie }
      });
      assert.equal(emptyRes.status, 200);
      assert.equal(emptyRes.body.connected, false);
      assert.equal(emptyRes.body.code, 'OUTLOOK_NOT_CONNECTED');
    });
  });
});
