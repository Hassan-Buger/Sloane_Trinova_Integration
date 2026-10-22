/**
 * Automated Test Suite: Task P8.1 — Frontend Smoke Tests & Full Regression
 * Implements verification per docs/outlook-build/SPEC.md §5 (Task P8.1) & §6.1:
 * - Empty login field:
 *   - Login email input has no static value attribute or prefill
 *   - Generic placeholder with zero identity leaks
 *   - AuthService defaults to empty string when no remembered user
 * - Logged-out view contains no personal data:
 *   - index.html shell contains zero matches for sensitive client entities or unencoded @
 *   - Unauthenticated HTTP requests to / and static assets contain no personal data
 *   - Anonymous access to /scripts/data/seed.js returns 404
 *   - Unauthenticated API endpoints (/api/v1/clients, /tasks, /outlook/*) return 401
 * - Settings states render cleanly and securely:
 *   - not_connected (Connect button, AES-256-GCM copy, no toggles)
 *   - connected (account metadata, sync toggles, folder multi-select, Sync now, Disconnect)
 *   - reconnect_required (warning badge, direct Reconnect link, Disconnect option)
 *   - sync_error (error alert, XSS protection, Retry sync button)
 *   - syncing (Syncing indicator, disabled button)
 *   - disconnected-after-confirm (honest §4.1 revocation guidance linking to myapps.microsoft.com)
 *   - Strict escapeHtml sanitization across all dynamic data attributes
 */

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Polyfill localStorage / sessionStorage for Node environment
if (typeof globalThis.localStorage === 'undefined') {
  const store = new Map();
  globalThis.localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
    clear: () => store.clear()
  };
}
if (typeof globalThis.sessionStorage === 'undefined') {
  const store = new Map();
  globalThis.sessionStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
    clear: () => store.clear()
  };
}

import { createApp } from '../src/app.js';
import { AuthService } from '../../scripts/services/auth.js';
import {
  OutlookSettings,
  formatSyncTimestamp
} from '../../scripts/components/outlookSettings.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '../..');
const INDEX_HTML_PATH = path.resolve(rootDir, 'index.html');
const SLOANE_INDEX_PATH = path.resolve(rootDir, 'Sloane/index.html');

const PORT = 5017;
const TEST_ENC_KEY = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
const TEST_VAULT_PATH = path.resolve(__dirname, '../data-private/test-unit30-vault.json');

describe('Task P8.1: Frontend Smoke Tests & Logged-Out Boundary', () => {
  let server;
  let baseUrl;
  let origEncKey;
  let origVaultPath;
  let origClientId;

  before(async () => {
    origEncKey = process.env.OUTLOOK_TOKEN_ENC_KEY;
    origVaultPath = process.env.OUTLOOK_VAULT_PATH;
    origClientId = process.env.OUTLOOK_CLIENT_ID;

    process.env.OUTLOOK_TOKEN_ENC_KEY = TEST_ENC_KEY;
    process.env.OUTLOOK_VAULT_PATH = TEST_VAULT_PATH;
    process.env.OUTLOOK_CLIENT_ID = 'test-outlook-client-id-smoke';

    const app = createApp();
    await new Promise(resolve => {
      server = app.listen(PORT, () => {
        baseUrl = `http://127.0.0.1:${PORT}`;
        resolve();
      });
    });
  });

  after(async () => {
    if (server) {
      await new Promise(resolve => server.close(resolve));
    }
    try {
      if (fs.existsSync(TEST_VAULT_PATH)) {
        fs.unlinkSync(TEST_VAULT_PATH);
      }
    } catch (_) {}

    process.env.OUTLOOK_TOKEN_ENC_KEY = origEncKey;
    process.env.OUTLOOK_VAULT_PATH = origVaultPath;
    process.env.OUTLOOK_CLIENT_ID = origClientId;
  });

  // =========================================================================
  // 1. Empty Login Field Verification
  // =========================================================================
  describe('1. Empty Login Field Verification', () => {
    const indexHtml = fs.readFileSync(INDEX_HTML_PATH, 'utf-8');

    test('1.1 index.html #loginEmail has no static value attribute or hardcoded credentials', () => {
      const emailInputMatch = indexHtml.match(/<input[^>]*id=["']loginEmail["'][^>]*>/i);
      assert.ok(emailInputMatch, '#loginEmail input exists in index.html');
      const tag = emailInputMatch[0];
      assert.ok(!tag.includes('value='), '#loginEmail must NOT have a value attribute');
      assert.ok(!tag.toLowerCase().includes('kirsty'), '#loginEmail must NOT mention kirsty');
      assert.ok(!tag.toLowerCase().includes('trinova'), '#loginEmail placeholder must be generic');
    });

    test('1.2 index.html #loginPassword has no static value attribute', () => {
      const passInputMatch = indexHtml.match(/<input[^>]*id=["']loginPassword["'][^>]*>/i);
      assert.ok(passInputMatch, '#loginPassword input exists in index.html');
      const tag = passInputMatch[0];
      assert.ok(!tag.includes('value='), '#loginPassword must NOT have a value attribute');
      assert.ok(!tag.includes('password123'), '#loginPassword must NOT contain password123');
    });

    test('1.3 Sloane/index.html mirror also maintains empty login field', () => {
      if (fs.existsSync(SLOANE_INDEX_PATH)) {
        const sloaneHtml = fs.readFileSync(SLOANE_INDEX_PATH, 'utf-8');
        const emailInputMatch = sloaneHtml.match(/<input[^>]*id=["']loginEmail["'][^>]*>/i);
        assert.ok(emailInputMatch, '#loginEmail input exists in Sloane/index.html');
        assert.ok(!emailInputMatch[0].includes('value='), 'Sloane mirror #loginEmail has no value attribute');
      }
    });

    test('1.4 AuthService.getRememberedEmail() returns empty string when unremembered', () => {
      globalThis.localStorage.clear();
      const remembered = AuthService.getRememberedEmail();
      assert.equal(remembered, '', 'getRememberedEmail() strictly returns empty string by default');
    });

    test('1.5 AuthService.isAuthenticated() is false before explicit login', () => {
      assert.equal(AuthService.isAuthenticated(), false, 'AuthService is unauthenticated by default');
    });
  });

  // =========================================================================
  // 2. Logged-Out View Security & Leak Prevention (§6.1)
  // =========================================================================
  describe('2. Logged-Out View Security & Leak Prevention (§6.1)', () => {
    const leakPattern = /woofington|jenkins|alpha delta|cfi awarding|rgb elevations|password123|tn_sec_|documenso_webhook|kirsty/i;

    test('2.1 index.html static shell matches zero sensitive entities or unencoded @', () => {
      const indexHtml = fs.readFileSync(INDEX_HTML_PATH, 'utf-8');
      assert.equal(leakPattern.test(indexHtml), false, 'index.html contains no sensitive entities or passwords');
      assert.equal(/@/.test(indexHtml), false, 'index.html contains zero literal @ characters');
    });

    test('2.2 GET / and GET /index.html return 200 with zero sensitive hits', async () => {
      for (const route of ['/', '/index.html']) {
        const res = await fetch(`${baseUrl}${route}`);
        assert.equal(res.status, 200, `${route} returns 200 OK`);
        const text = await res.text();
        assert.equal(leakPattern.test(text), false, `${route} body has zero sensitive hits`);
        assert.equal(/@/.test(text), false, `${route} body has zero literal @ symbols`);
      }
    });

    test('2.3 GET /scripts/data/seed.js returns 404 for anonymous requests', async () => {
      const res = await fetch(`${baseUrl}/scripts/data/seed.js`);
      assert.equal(res.status, 404, 'seed.js must return 404 for unauthenticated requests');
    });

    test('2.4 Authenticated data API routes return 401 when accessed without session', async () => {
      const unauthRoutes = [
        '/api/v1/clients',
        '/api/v1/tasks',
        '/api/v1/outlook/diary',
        '/api/v1/outlook/flagged-emails',
        '/api/v1/integrations/outlook/status'
      ];

      for (const route of unauthRoutes) {
        const res = await fetch(`${baseUrl}${route}`);
        assert.equal(res.status, 401, `${route} must return 401 Unauthorized without session`);
        const body = await res.json();
        assert.ok(body.error, `${route} error envelope present`);
        // Verify no data leaked in response
        assert.equal(body.clients, undefined);
        assert.equal(body.tasks, undefined);
        assert.equal(body.events, undefined);
        assert.equal(body.messages, undefined);
      }
    });
  });

  // =========================================================================
  // 3. Settings States Render Smoke Tests
  // =========================================================================
  describe('3. Settings States Render Smoke Tests (§4.1 & §5)', () => {
    test('3.1 State "not_connected" renders clean unconfigured card with Connect link', () => {
      const html = OutlookSettings.renderNotConnected();
      assert.ok(html.includes('Not connected'), 'Displays "Not connected" badge');
      assert.ok(html.includes('id="btnConnectOutlook"'), 'Has connect button');
      assert.ok(html.includes('/api/v1/integrations/outlook/connect'), 'Connects to OAuth initiate route');
      assert.ok(html.includes('AES-256-GCM'), 'Mentions AES-256-GCM encrypted token storage');
      assert.ok(!html.includes('chkEmailSync'), 'Does not render email sync toggle when disconnected');
      assert.ok(!html.includes('btnOpenDisconnectModal'), 'Does not render disconnect button when disconnected');
    });

    test('3.2 State "connected" renders account details, sync controls, folders, and actions', () => {
      const data = {
        status: 'connected',
        accountEmail: 'kirsty.allen@trinova.co.uk',
        displayName: 'Kirsty Allen',
        lastSyncAt: new Date(Date.now() - 4 * 60 * 1000).toISOString(),
        emailSyncEnabled: true,
        calendarSyncEnabled: true,
        mailFolderIds: ['inbox', 'archive']
      };
      OutlookSettings.availableFolders = [
        { id: 'inbox', displayName: 'Inbox', unreadItemCount: 3 },
        { id: 'archive', displayName: 'Archive', unreadItemCount: 0 }
      ];

      const html = OutlookSettings.renderConnected(data);
      assert.ok(html.includes('Connected'), 'Displays "Connected" badge');
      assert.ok(html.includes('kirsty.allen@trinova.co.uk'), 'Displays account email');
      assert.ok(html.includes('Kirsty Allen'), 'Displays account display name');
      assert.ok(html.includes('4 min ago'), 'Displays formatted sync time');
      assert.ok(html.includes('id="chkEmailSync" checked'), 'Email sync toggle is checked');
      assert.ok(html.includes('id="chkCalendarSync" checked'), 'Calendar sync toggle is checked');
      assert.ok(html.includes('id="btnSyncOutlookNow"'), 'Sync now button present');
      assert.ok(html.includes('id="btnOpenDisconnectModal"'), 'Disconnect Outlook button present');
    });

    test('3.3 State "reconnect_required" renders warning badge and direct reconnect action', () => {
      const data = {
        status: 'reconnect_required',
        accountEmail: 'kirsty.allen@trinova.co.uk',
        displayName: 'Kirsty Allen',
        lastError: 'Consent revoked or refresh token expired'
      };

      const html = OutlookSettings.renderReconnectRequired(data);
      assert.ok(html.includes('Reconnect your Outlook'), 'Displays "Reconnect your Outlook" badge');
      assert.ok(html.includes('id="btnConnectOutlook"'), 'Displays Reconnect button');
      assert.ok(html.includes('/api/v1/integrations/outlook/connect'), 'Directs to connect route');
      assert.ok(html.includes('id="btnOpenDisconnectModal"'), 'Disconnect button available to reset');
      assert.ok(html.includes('Microsoft authorization has expired or consent was revoked'), 'Displays error reason');
    });

    test('3.4 State "sync_error" renders sync error badge, error description, and retry action', () => {
      const data = {
        status: 'sync_error',
        accountEmail: 'kirsty.allen@trinova.co.uk',
        displayName: 'Kirsty Allen',
        lastError: 'Microsoft is busy, try again shortly',
        emailSyncEnabled: true,
        calendarSyncEnabled: true,
        mailFolderIds: ['inbox']
      };
      OutlookSettings.availableFolders = [{ id: 'inbox', displayName: 'Inbox', unreadItemCount: 2 }];

      const html = OutlookSettings.renderSyncError(data);
      assert.ok(html.includes('Sync error — Microsoft is busy, try again shortly'), 'Displays "Sync error" badge');
      assert.ok(html.includes('Sync error — Microsoft is busy'), 'Displays specific error message');
      assert.ok(html.includes('id="btnSyncOutlookNow"'), 'Sync now button present');
      assert.ok(html.includes('Sync now'), 'Button labeled "Sync now"');
    });

    test('3.5 State "syncing" renders syncing state with disabled action button', () => {
      const data = {
        status: 'connected',
        accountEmail: 'kirsty.allen@trinova.co.uk',
        displayName: 'Kirsty Allen',
        emailSyncEnabled: true,
        calendarSyncEnabled: true,
        mailFolderIds: ['inbox']
      };
      OutlookSettings.isSyncing = true;
      const html = OutlookSettings.renderConnected(data);
      OutlookSettings.isSyncing = false; // reset

      assert.ok(html.includes('⏳ Syncing...'), 'Displays "⏳ Syncing..." status in button');
      assert.ok(html.includes('id="btnSyncOutlookNow" disabled'), 'Sync now button is disabled while syncing');
    });

    test('3.6 Disconnect modal and guidance render exact honest §4.1 revocation copy', () => {
      const indexHtml = fs.readFileSync(INDEX_HTML_PATH, 'utf-8');
      assert.ok(
        indexHtml.includes("deletes Sloane's copy of your Outlook access and clears diary and email data"),
        'Honest notice in index.html confirms deletion of local copy'
      );
      assert.ok(
        indexHtml.includes('https://myapps.microsoft.com'),
        'Directs user to https://myapps.microsoft.com for complete Microsoft cloud-side revocation'
      );
      assert.ok(
        !indexHtml.includes('Microsoft has revoked'),
        'Does not falsely claim Microsoft revoked access'
      );
    });

    test('3.7 Anti-XSS: dynamic server values are escaped across all Settings states', () => {
      const xssPayload = '<script>alert("xss")</script><img src=x onerror=alert(1)>';
      const maliciousData = {
        status: 'connected',
        accountEmail: `xss${xssPayload}@example.com`,
        displayName: `Attacker ${xssPayload}`,
        lastError: `Fatal ${xssPayload}`,
        emailSyncEnabled: true,
        calendarSyncEnabled: true,
        mailFolderIds: ['folder_xss']
      };
      OutlookSettings.availableFolders = [
        { id: 'folder_xss', displayName: `Inbox ${xssPayload}`, unreadItemCount: 0 }
      ];

      const connectedHtml = OutlookSettings.renderConnected(maliciousData);
      assert.ok(!connectedHtml.includes('<script>'), 'Unescaped <script> tag forbidden in connected view');
      assert.ok(connectedHtml.includes('&lt;script&gt;'), 'Script tag must be safely HTML escaped');
      assert.ok(!connectedHtml.includes('<img src=x onerror'), 'Unescaped <img> onerror forbidden');

      const errorHtml = OutlookSettings.renderSyncError(maliciousData);
      assert.ok(!errorHtml.includes('<script>'), 'Unescaped <script> tag forbidden in error view');
      assert.ok(errorHtml.includes('&lt;script&gt;'), 'Error message must be safely HTML escaped');
    });
  });

  // =========================================================================
  // 4. Time Formatting Smoke Tests
  // =========================================================================
  describe('4. formatSyncTimestamp Smoke Tests', () => {
    test('4.1 Gracefully handles null, undefined, or malformed timestamps', () => {
      assert.equal(formatSyncTimestamp(null), 'Never synced');
      assert.equal(formatSyncTimestamp(undefined), 'Never synced');
      assert.equal(formatSyncTimestamp('not-a-date'), 'Never synced');
    });

    test('4.2 Returns London time and relative minutes for recent syncs', () => {
      const recent = new Date(Date.now() - 2 * 60 * 1000).toISOString();
      const result = formatSyncTimestamp(recent);
      assert.ok(result.includes('2 min ago'), `Expected '2 min ago', got: ${result}`);
      assert.match(result, /\d{2}:\d{2} — 2 min ago/);
    });
  });
});
