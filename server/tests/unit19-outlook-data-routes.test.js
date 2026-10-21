/**
 * Automated Test Suite: Task P6.1 — Outlook Data Endpoints
 * Implements verification per docs/outlook-build/SPEC.md §4.3 and §5 (Task P6.1):
 * - GET /api/v1/outlook/diary (session required, clean empty states, live Graph mapping)
 * - GET /api/v1/outlook/flagged-emails (session required, clean empty states, live Graph mapping)
 * - Empty states:
 *   - Not connected: "Connect your Outlook to see this here"
 *   - Reconnect required: "Reconnect your Outlook"
 *   - Toggle off: "Calendar sync is off" / "Email sync is off"
 * - Error propagation: 401 reconnect required, 503 Microsoft busy, 502 unavailable
 * - Zero token leakage verification
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
import { clearOutlookDataCache } from '../src/services/outlookDataService.js';
import { GraphClientError } from '../src/services/graphClient.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const TEST_ENC_KEY = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
const TEST_VAULT_PATH = path.resolve(__dirname, '../data-private/test-unit19-vault.json');
const TEST_CLIENT_ID = 'test-outlook-client-id-601';
const TEST_PORT = 5007;

const SENSITIVE_TOKENS = {
  refreshToken: 'RT_DATA_SECRET_REFRESH_TOKEN_UNIT19',
  accessToken: 'AT_DATA_SECRET_ACCESS_TOKEN_UNIT19'
};

const SAMPLE_GRAPH_CALENDAR_EVENTS = [
  {
    id: 'evt_board_review_1',
    subject: 'CFI Awarding Board Governance Call',
    start: { dateTime: '2026-10-21T10:00:00.0000000', timeZone: 'GMT Standard Time' },
    end: { dateTime: '2026-10-21T11:00:00.0000000', timeZone: 'GMT Standard Time' },
    location: { displayName: 'Boardroom A / Teams' },
    isAllDay: false,
    showAs: 'busy',
    importance: 'normal'
  },
  {
    id: 'evt_trinova_review_2',
    subject: 'Hamza Malik — Trinova Compliance & Staff Review',
    start: { dateTime: '2026-10-21T13:30:00.0000000', timeZone: 'GMT Standard Time' },
    end: { dateTime: '2026-10-21T14:15:00.0000000', timeZone: 'GMT Standard Time' },
    location: { displayName: 'Office Suite 3' },
    isAllDay: false,
    showAs: 'busy',
    importance: 'normal'
  },
  {
    id: 'evt_clashing_call_3',
    subject: 'Emergency Audit Sync (Clash)',
    start: { dateTime: '2026-10-21T13:45:00.0000000', timeZone: 'GMT Standard Time' },
    end: { dateTime: '2026-10-21T14:30:00.0000000', timeZone: 'GMT Standard Time' },
    location: { displayName: 'Phone Call' },
    isAllDay: false,
    showAs: 'busy',
    importance: 'high'
  }
];

const SAMPLE_GRAPH_MESSAGES = [
  {
    id: 'msg_hmrc_compliance_001',
    subject: 'HMRC Compliance: Woofington Park Strike-Off Objection',
    from: { emailAddress: { name: 'HMRC Solicitor Office', address: 'compliance@hmrc.gov.uk' } },
    receivedDateTime: '2026-10-21T09:15:00Z',
    importance: 'high',
    webLink: 'https://outlook.office.com/mail/id/msg_hmrc_compliance_001'
  },
  {
    id: 'msg_bank_statements_002',
    subject: 'Robert Brown (R GB Elevations): Bank Statements Attached',
    from: { emailAddress: { name: 'Robert Brown', address: 'rbrown@rgbelevations.co.uk' } },
    receivedDateTime: '2026-10-21T08:30:00Z',
    importance: 'normal',
    webLink: 'https://outlook.office.com/mail/id/msg_bank_statements_002'
  }
];

describe('Task P6.1: Outlook Data Endpoints (Diary & Flagged Emails)', () => {
  let server;
  let baseUrl;
  let sessionCookie;
  let mockGraphCalendarResponse = null;
  let mockGraphMessagesResponse = null;
  let mockGraphError = null;

  const mockGraphClient = {
    async get(endpoint, opts) {
      if (mockGraphError) throw mockGraphError;
      if (endpoint.includes('calendarView')) {
        return mockGraphCalendarResponse || { value: SAMPLE_GRAPH_CALENDAR_EVENTS };
      }
      if (endpoint.includes('messages')) {
        return mockGraphMessagesResponse || { value: SAMPLE_GRAPH_MESSAGES };
      }
      return { value: [] };
    }
  };

  before(() => {
    process.env.OUTLOOK_TOKEN_ENC_KEY = TEST_ENC_KEY;
    process.env.OUTLOOK_VAULT_PATH = TEST_VAULT_PATH;
    process.env.OUTLOOK_CLIENT_ID = TEST_CLIENT_ID;

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
    mockGraphCalendarResponse = null;
    mockGraphMessagesResponse = null;
    clearOutlookDataCache();

    if (fs.existsSync(TEST_VAULT_PATH)) {
      try { fs.unlinkSync(TEST_VAULT_PATH); } catch {}
    }
  });

  function makeRequest(reqPath, options = {}) {
    return new Promise((resolve, reject) => {
      const url = new URL(reqPath, baseUrl);
      const reqHeaders = { ...(options.headers || {}) };

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
  // GET /api/v1/outlook/diary
  // ==========================================
  describe('GET /api/v1/outlook/diary', () => {
    test('1. Unauthenticated request to /api/v1/outlook/diary returns 401 UNAUTHORIZED', async () => {
      const res = await makeRequest('/api/v1/outlook/diary', {
        method: 'GET'
      });

      assert.equal(res.status, 401);
      assert.equal(res.body?.error?.code, 'UNAUTHORIZED');
    });

    test('2. GET diary returns empty state when no connection exists in vault', async () => {
      const res = await makeRequest('/api/v1/outlook/diary', {
        method: 'GET',
        headers: { Cookie: sessionCookie }
      });

      assert.equal(res.status, 200);
      assert.equal(res.body.connected, false);
      assert.equal(res.body.enabled, false);
      assert.equal(res.body.code, 'OUTLOOK_NOT_CONNECTED');
      assert.equal(res.body.message, 'Connect your Outlook to see this here');
      assert.deepEqual(res.body.items, []);
    });

    test('3. GET diary returns reconnect_required empty state when connection status is reconnect_required', async () => {
      outlookConnectionStore.saveConnection({
        actorId: 'actor_kirsty_allen',
        status: 'reconnect_required',
        accountEmail: 'kirsty.allen@trinova.co.uk',
        refreshToken: SENSITIVE_TOKENS.refreshToken,
        calendarSyncEnabled: true
      }, { filePath: TEST_VAULT_PATH, key: TEST_ENC_KEY });

      const res = await makeRequest('/api/v1/outlook/diary', {
        method: 'GET',
        headers: { Cookie: sessionCookie }
      });

      assert.equal(res.status, 200);
      assert.equal(res.body.connected, false);
      assert.equal(res.body.enabled, true);
      assert.equal(res.body.code, 'OUTLOOK_RECONNECT_REQUIRED');
      assert.equal(res.body.message, 'Reconnect your Outlook');
      assert.deepEqual(res.body.items, []);
    });

    test('4. GET diary returns calendar_sync_disabled empty state when calendarSyncEnabled is false', async () => {
      outlookConnectionStore.saveConnection({
        actorId: 'actor_kirsty_allen',
        status: 'connected',
        accountEmail: 'kirsty.allen@trinova.co.uk',
        refreshToken: SENSITIVE_TOKENS.refreshToken,
        calendarSyncEnabled: false
      }, { filePath: TEST_VAULT_PATH, key: TEST_ENC_KEY });

      const res = await makeRequest('/api/v1/outlook/diary', {
        method: 'GET',
        headers: { Cookie: sessionCookie }
      });

      assert.equal(res.status, 200);
      assert.equal(res.body.connected, true);
      assert.equal(res.body.enabled, false);
      assert.equal(res.body.code, 'CALENDAR_SYNC_DISABLED');
      assert.equal(res.body.message, 'Calendar sync is off');
      assert.deepEqual(res.body.items, []);
    });

    test('5. GET diary succeeds: maps Graph calendarView items to DIARY_ITEMS shape with clash detection', async () => {
      outlookConnectionStore.saveConnection({
        actorId: 'actor_kirsty_allen',
        status: 'connected',
        accountEmail: 'kirsty.allen@trinova.co.uk',
        refreshToken: SENSITIVE_TOKENS.refreshToken,
        calendarSyncEnabled: true,
        lastSyncAt: '2026-10-21T09:00:00Z'
      }, { filePath: TEST_VAULT_PATH, key: TEST_ENC_KEY });

      const res = await makeRequest('/api/v1/outlook/diary', {
        method: 'GET',
        headers: { Cookie: sessionCookie }
      });

      assert.equal(res.status, 200);
      assert.equal(res.body.connected, true);
      assert.equal(res.body.enabled, true);
      assert.equal(res.body.count, 3);
      assert.equal(res.body.fromCache, false);

      const items = res.body.items;
      assert.equal(items.length, 3);

      // Event 1: 10:00 - 11:00 (no clash)
      assert.equal(items[0].title, 'CFI Awarding Board Governance Call');
      assert.equal(items[0].time, '10:00 - 11:00');
      assert.equal(items[0].isClash, false);
      assert.equal(items[0].chip, 'TODAY');

      // Event 2 & Event 3: Clash detected (13:30 - 14:15 overlaps with 13:45 - 14:30)
      assert.equal(items[1].isClash, true);
      assert.equal(items[1].chip, 'URGENT');
      assert.equal(items[2].isClash, true);
      assert.equal(items[2].chip, 'URGENT');

      // Verify zero token leakage
      assert.ok(!res.raw.includes(SENSITIVE_TOKENS.refreshToken));
      assert.ok(!res.raw.includes(TEST_ENC_KEY));
    });
  });

  // ==========================================
  // GET /api/v1/outlook/flagged-emails
  // ==========================================
  describe('GET /api/v1/outlook/flagged-emails', () => {
    test('6. Unauthenticated request to /api/v1/outlook/flagged-emails returns 401 UNAUTHORIZED', async () => {
      const res = await makeRequest('/api/v1/outlook/flagged-emails', {
        method: 'GET'
      });

      assert.equal(res.status, 401);
      assert.equal(res.body?.error?.code, 'UNAUTHORIZED');
    });

    test('7. GET flagged-emails returns empty state when no connection exists in vault', async () => {
      const res = await makeRequest('/api/v1/outlook/flagged-emails', {
        method: 'GET',
        headers: { Cookie: sessionCookie }
      });

      assert.equal(res.status, 200);
      assert.equal(res.body.connected, false);
      assert.equal(res.body.enabled, false);
      assert.equal(res.body.code, 'OUTLOOK_NOT_CONNECTED');
      assert.equal(res.body.message, 'Connect your Outlook to see this here');
      assert.deepEqual(res.body.items, []);
    });

    test('8. GET flagged-emails returns reconnect_required empty state when connection status is reconnect_required', async () => {
      outlookConnectionStore.saveConnection({
        actorId: 'actor_kirsty_allen',
        status: 'reconnect_required',
        accountEmail: 'kirsty.allen@trinova.co.uk',
        refreshToken: SENSITIVE_TOKENS.refreshToken,
        emailSyncEnabled: true
      }, { filePath: TEST_VAULT_PATH, key: TEST_ENC_KEY });

      const res = await makeRequest('/api/v1/outlook/flagged-emails', {
        method: 'GET',
        headers: { Cookie: sessionCookie }
      });

      assert.equal(res.status, 200);
      assert.equal(res.body.connected, false);
      assert.equal(res.body.enabled, true);
      assert.equal(res.body.code, 'OUTLOOK_RECONNECT_REQUIRED');
      assert.equal(res.body.message, 'Reconnect your Outlook');
      assert.deepEqual(res.body.items, []);
    });

    test('9. GET flagged-emails returns email_sync_disabled empty state when emailSyncEnabled is false', async () => {
      outlookConnectionStore.saveConnection({
        actorId: 'actor_kirsty_allen',
        status: 'connected',
        accountEmail: 'kirsty.allen@trinova.co.uk',
        refreshToken: SENSITIVE_TOKENS.refreshToken,
        emailSyncEnabled: false
      }, { filePath: TEST_VAULT_PATH, key: TEST_ENC_KEY });

      const res = await makeRequest('/api/v1/outlook/flagged-emails', {
        method: 'GET',
        headers: { Cookie: sessionCookie }
      });

      assert.equal(res.status, 200);
      assert.equal(res.body.connected, true);
      assert.equal(res.body.enabled, false);
      assert.equal(res.body.code, 'EMAIL_SYNC_DISABLED');
      assert.equal(res.body.message, 'Email sync is off');
      assert.deepEqual(res.body.items, []);
    });

    test('10. GET flagged-emails succeeds: maps Graph messages to ATTENTION_EMAILS shape with priority rules', async () => {
      outlookConnectionStore.saveConnection({
        actorId: 'actor_kirsty_allen',
        status: 'connected',
        accountEmail: 'kirsty.allen@trinova.co.uk',
        refreshToken: SENSITIVE_TOKENS.refreshToken,
        emailSyncEnabled: true,
        mailFolderIds: ['Inbox']
      }, { filePath: TEST_VAULT_PATH, key: TEST_ENC_KEY });

      const res = await makeRequest('/api/v1/outlook/flagged-emails', {
        method: 'GET',
        headers: { Cookie: sessionCookie }
      });

      assert.equal(res.status, 200);
      assert.equal(res.body.connected, true);
      assert.equal(res.body.enabled, true);
      assert.equal(res.body.count, 2);

      const items = res.body.items;
      assert.equal(items.length, 2);

      // Message 1: High priority
      assert.equal(items[0].title, 'HMRC Compliance: Woofington Park Strike-Off Objection');
      assert.equal(items[0].priority, 'High');
      assert.ok(items[0].sub.includes('HMRC Solicitor Office'));

      // Message 2: Normal priority
      assert.equal(items[1].title, 'Robert Brown (R GB Elevations): Bank Statements Attached');
      assert.equal(items[1].priority, 'Normal');
      assert.ok(items[1].sub.includes('Robert Brown'));

      // Verify zero token leakage
      assert.ok(!res.raw.includes(SENSITIVE_TOKENS.refreshToken));
      assert.ok(!res.raw.includes(TEST_ENC_KEY));
    });

    test('11. GET endpoints return 401 when Graph throws OUTLOOK_RECONNECT_REQUIRED', async () => {
      outlookConnectionStore.saveConnection({
        actorId: 'actor_kirsty_allen',
        status: 'connected',
        accountEmail: 'kirsty.allen@trinova.co.uk',
        refreshToken: SENSITIVE_TOKENS.refreshToken,
        calendarSyncEnabled: true
      }, { filePath: TEST_VAULT_PATH, key: TEST_ENC_KEY });

      mockGraphError = new GraphClientError('OUTLOOK_RECONNECT_REQUIRED', 'Token revoked', { status: 401 });

      const res = await makeRequest('/api/v1/outlook/diary', {
        method: 'GET',
        headers: { Cookie: sessionCookie }
      });

      assert.equal(res.status, 401);
      assert.equal(res.body?.error?.code, 'OUTLOOK_RECONNECT_REQUIRED');
    });

    test('12. GET endpoints return 503 when Graph throws MICROSOFT_BUSY', async () => {
      outlookConnectionStore.saveConnection({
        actorId: 'actor_kirsty_allen',
        status: 'connected',
        accountEmail: 'kirsty.allen@trinova.co.uk',
        refreshToken: SENSITIVE_TOKENS.refreshToken,
        emailSyncEnabled: true
      }, { filePath: TEST_VAULT_PATH, key: TEST_ENC_KEY });

      mockGraphError = new GraphClientError('MICROSOFT_BUSY', 'Rate limited', { status: 429 });

      const res = await makeRequest('/api/v1/outlook/flagged-emails', {
        method: 'GET',
        headers: { Cookie: sessionCookie }
      });

      assert.equal(res.status, 503);
      assert.equal(res.body?.error?.code, 'MICROSOFT_BUSY');
    });

    test('13. GET endpoints return 502 when Graph throws transient network error', async () => {
      outlookConnectionStore.saveConnection({
        actorId: 'actor_kirsty_allen',
        status: 'connected',
        accountEmail: 'kirsty.allen@trinova.co.uk',
        refreshToken: SENSITIVE_TOKENS.refreshToken,
        emailSyncEnabled: true
      }, { filePath: TEST_VAULT_PATH, key: TEST_ENC_KEY });

      mockGraphError = new Error('ECONNRESET: Connection reset');

      const res = await makeRequest('/api/v1/outlook/flagged-emails', {
        method: 'GET',
        headers: { Cookie: sessionCookie }
      });

      assert.equal(res.status, 502);
      assert.equal(res.body?.error?.code, 'GRAPH_UNAVAILABLE');
    });
  });
});
