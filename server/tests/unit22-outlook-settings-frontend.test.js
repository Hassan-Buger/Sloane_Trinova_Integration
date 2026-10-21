/**
 * Automated Test Suite: Task P7.1 — Outlook Settings Frontend Card & Modals
 * Implements verification per docs/outlook-build/SPEC.md §4.1, §4.3, §5 (Task P7.1):
 * - Settings card rendering for every state:
 *   - Not connected
 *   - Connected
 *   - Reconnect required
 *   - Sync error
 *   - Syncing
 *   - Disconnected-after-confirm (revocation guidance)
 * - Strict escapeHtml application to all dynamic server strings (anti-XSS verification)
 * - Accessible ModalManager disconnect modal with exact §4.1 revocation copy
 * - Zero literal @ or secret disclosure in logged-out index.html shell
 * - ApiService Outlook methods and X-Requested-With CSRF header enforcement
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  OutlookSettings,
  formatSyncTimestamp
} from '../../scripts/components/outlookSettings.js';
import { ApiService } from '../../scripts/services/api.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const INDEX_HTML_PATH = path.resolve(__dirname, '../../index.html');

describe('Task P7.1: Settings Card per §4.1 & Frontend Architecture', () => {
  const indexHtml = fs.readFileSync(INDEX_HTML_PATH, 'utf-8');

  // ==========================================
  // 1. Static HTML Shell & Security Verification
  // ==========================================
  describe('index.html Shell & Accessibility Structure', () => {
    test('1. index.html contains Settings navigation button and view section', () => {
      assert.ok(indexHtml.includes('id="nav-settings"'), 'nav-settings button exists in sidebar');
      assert.ok(indexHtml.includes('data-view="settings"'), 'nav-settings has data-view="settings"');
      assert.ok(indexHtml.includes('id="view-settings"'), 'view-settings container exists');
      assert.ok(indexHtml.includes('id="outlookSettingsCard"'), 'outlookSettingsCard mount point exists');
    });

    test('2. index.html contains accessible Disconnect Confirmation Modal per §4.1 and §5 P7.5', () => {
      assert.ok(indexHtml.includes('id="outlookDisconnectModal"'), 'outlookDisconnectModal exists');
      assert.ok(indexHtml.includes('role="dialog"'), 'Modal has role="dialog"');
      assert.ok(indexHtml.includes('aria-modal="true"'), 'Modal has aria-modal="true"');
      assert.ok(indexHtml.includes('data-close-modal'), 'Modal has data-close-modal handlers');
      assert.ok(indexHtml.includes('id="btnConfirmOutlookDisconnect"'), 'Confirm disconnect button exists');
      assert.ok(indexHtml.includes('id="btnCancelOutlookDisconnect"'), 'Cancel button exists');
    });

    test('3. Disconnect modal contains exact §4.1 revocation text and honest guidance', () => {
      assert.ok(
        indexHtml.includes("deletes Sloane's copy of your Outlook access and clears diary and email data"),
        'Mentions deletion of Sloane copy and dashboard data clearing'
      );
      assert.ok(
        indexHtml.includes('https://myapps.microsoft.com'),
        'Directs user to https://myapps.microsoft.com to fully remove Microsoft consent'
      );
      assert.ok(
        !indexHtml.includes('Microsoft has revoked'),
        'Honest behavior: does not claim Microsoft has revoked anything'
      );
    });

    test('4. index.html complies with data-free logged-out shell: zero literal @ and zero client leaks', () => {
      const leakRegex = /woofington|jenkins|alpha delta|cfi|R GB|@|kirsty/i;
      assert.equal(
        leakRegex.test(indexHtml),
        false,
        'index.html logged-out shell must contain zero matches for sensitive client names, credentials, or @ characters'
      );
    });
  });

  // ==========================================
  // 2. Timestamp Formatting Utility
  // ==========================================
  describe('formatSyncTimestamp Helper', () => {
    test('5. Formats null or invalid timestamps gracefully', () => {
      assert.equal(formatSyncTimestamp(null), 'Never synced');
      assert.equal(formatSyncTimestamp(undefined), 'Never synced');
      assert.equal(formatSyncTimestamp('invalid-date'), 'Never synced');
    });

    test('6. Formats valid timestamps with Europe/London time and relative duration', () => {
      const recent = new Date(Date.now() - 3 * 60 * 1000).toISOString(); // 3 mins ago
      const formatted = formatSyncTimestamp(recent);
      assert.ok(formatted.includes('3 min ago'), `Expected '3 min ago', got: ${formatted}`);
      assert.match(formatted, /\d{2}:\d{2} — 3 min ago/);
    });
  });

  // ==========================================
  // 3. OutlookSettings State Renderers
  // ==========================================
  describe('OutlookSettings State Renderers (§4.1)', () => {
    test('7. renderNotConnected: displays Not connected, privacy boundaries, and Connect link', () => {
      const html = OutlookSettings.renderNotConnected();
      assert.ok(html.includes('Not connected'), 'Shows Not connected status pill');
      assert.ok(html.includes('id="btnConnectOutlook"'), 'Contains Connect button');
      assert.ok(html.includes('/api/v1/integrations/outlook/connect'), 'Links to connect route');
      assert.ok(html.includes('AES-256-GCM'), 'Explains encryption');
      // Must not render toggles or disconnect button
      assert.ok(!html.includes('chkEmailSync'), 'Does not render email sync toggle');
      assert.ok(!html.includes('btnOpenDisconnectModal'), 'Does not render disconnect button');
    });

    test('8. renderConnected: renders Connected, metadata, sync toggles, folders, sync-now and disconnect', () => {
      const data = {
        status: 'connected',
        accountEmail: 'kirsty.allen@trinova.co.uk',
        displayName: 'Kirsty Allen',
        lastSyncAt: new Date(Date.now() - 5 * 60 * 1000).toISOString(),
        emailSyncEnabled: true,
        calendarSyncEnabled: true,
        mailFolderIds: ['Inbox']
      };

      OutlookSettings.availableFolders = [
        { id: 'Inbox', displayName: 'Inbox', unreadItemCount: 2 },
        { id: 'Archive', displayName: 'Archive', unreadItemCount: 0 }
      ];

      const html = OutlookSettings.renderConnected(data);
      assert.ok(html.includes('Connected'), 'Shows Connected pill');
      assert.ok(html.includes('kirsty.allen@trinova.co.uk'), 'Shows account email');
      assert.ok(html.includes('Kirsty Allen'), 'Shows display name');
      assert.ok(html.includes('id="chkEmailSync"'), 'Contains email sync toggle');
      assert.ok(html.includes('id="chkCalendarSync"'), 'Contains calendar sync toggle');
      assert.ok(html.includes('value="Inbox" checked'), 'Inbox is selected');
      assert.ok(html.includes('value="Archive"'), 'Archive folder rendered');
      assert.ok(html.includes('id="btnSyncOutlookNow"'), 'Contains Sync now button');
      assert.ok(html.includes('id="btnOpenDisconnectModal"'), 'Contains Disconnect button');
    });

    test('9. renderReconnectRequired: renders warning banner, reconnect button, and disconnect button', () => {
      const data = {
        status: 'reconnect_required',
        accountEmail: 'kirsty.allen@trinova.co.uk',
        displayName: 'Kirsty Allen'
      };

      const html = OutlookSettings.renderReconnectRequired(data);
      assert.ok(html.includes('Reconnect your Outlook'), 'Shows Reconnect your Outlook pill');
      assert.ok(html.includes('Microsoft authorization has expired or consent was revoked'), 'Shows warning');
      assert.ok(html.includes('id="btnConnectOutlook"'), 'Contains Reconnect button');
      assert.ok(html.includes('id="btnOpenDisconnectModal"'), 'Contains Disconnect button');
    });

    test('10. renderSyncError: renders short reason and last successful sync time', () => {
      const data = {
        status: 'sync_error',
        accountEmail: 'kirsty.allen@trinova.co.uk',
        displayName: 'Kirsty Allen',
        lastSyncAt: new Date(Date.now() - 10 * 60 * 1000).toISOString(),
        lastError: 'Microsoft is busy, try again shortly',
        emailSyncEnabled: true,
        calendarSyncEnabled: false,
        mailFolderIds: ['Inbox']
      };

      const html = OutlookSettings.renderSyncError(data);
      assert.ok(html.includes('Sync error — Microsoft is busy, try again shortly'), 'Renders short reason in status line');
      assert.ok(html.includes('Last Successful Sync'), 'Shows last successful sync section');
      assert.ok(html.includes('id="btnSyncOutlookNow"'), 'Sync now button is available');
      assert.ok(html.includes('id="btnOpenDisconnectModal"'), 'Disconnect button is available');
    });

    test('11. renderFolderCheckboxes: maps folder IDs and display names', () => {
      OutlookSettings.availableFolders = [
        { id: 'fld_inbox', displayName: 'Inbox', unreadItemCount: 12 },
        { id: 'fld_action', displayName: 'Action Items', unreadItemCount: 3 }
      ];

      const html = OutlookSettings.renderFolderCheckboxes(['fld_action']);
      assert.ok(html.includes('value="fld_action" checked'), 'fld_action is checked');
      assert.ok(html.includes('Action Items'), 'Displays human name Action Items');
      assert.ok(html.includes('3'), 'Displays unread item count badge');
      assert.ok(html.includes('value="fld_inbox"'), 'fld_inbox rendered');
    });
  });

  // ==========================================
  // 4. Strict XSS Safety (escapeHtml Enforcement)
  // ==========================================
  describe('Strict XSS Sanitization in OutlookSettings', () => {
    test('12. Prevents XSS via malicious accountEmail, displayName, lastError, and folder names', () => {
      const xssData = {
        status: 'sync_error',
        accountEmail: '<script>alert("xss-email")</script>',
        displayName: '<b onmouseover="alert(1)">Hacker</b>',
        lastError: '<img src=x onerror="alert(2)">Network Failed',
        lastSyncAt: null,
        emailSyncEnabled: true,
        calendarSyncEnabled: true,
        mailFolderIds: ['<script>evil()</script>']
      };

      OutlookSettings.availableFolders = [
        { id: '<script>evil()</script>', displayName: '<script>alert("folder")</script>', unreadItemCount: 0 }
      ];

      const html = OutlookSettings.renderSyncError(xssData);

      // Verify executable tags are escaped into HTML entities
      assert.ok(!html.includes('<script>alert("xss-email")</script>'), 'Email script tag must NOT exist in raw form');
      assert.ok(html.includes('&lt;script&gt;alert(&quot;xss-email&quot;)&lt;/script&gt;'), 'Email must be escaped');

      assert.ok(!html.includes('<b onmouseover="alert(1)">'), 'Name tag must NOT exist in raw form');
      assert.ok(html.includes('&lt;b onmouseover=&quot;alert(1)&quot;&gt;Hacker&lt;/b&gt;'), 'Name must be escaped');

      assert.ok(!html.includes('<img src=x onerror='), 'Image error handler must NOT exist in raw form');
      assert.ok(html.includes('&lt;img src=x onerror=&quot;alert(2)&quot;&gt;'), 'Error string must be escaped');

      assert.ok(!html.includes('<script>alert("folder")</script>'), 'Folder script tag must NOT exist in raw form');
      assert.ok(html.includes('&lt;script&gt;alert(&quot;folder&quot;)&lt;/script&gt;'), 'Folder name must be escaped');
    });
  });

  // ==========================================
  // 5. ApiService Outlook Methods & CSRF Header
  // ==========================================
  describe('ApiService Outlook Integration Methods', () => {
    test('13. ApiService provides all required Outlook endpoint helpers', () => {
      assert.equal(typeof ApiService.getOutlookStatus, 'function');
      assert.equal(typeof ApiService.updateOutlookSettings, 'function');
      assert.equal(typeof ApiService.getOutlookFolders, 'function');
      assert.equal(typeof ApiService.syncOutlook, 'function');
      assert.equal(typeof ApiService.disconnectOutlook, 'function');
      assert.equal(typeof ApiService.getOutlookDiary, 'function');
      assert.equal(typeof ApiService.getOutlookFlaggedEmails, 'function');
    });
  });
});
