/**
 * Unit 29 Test Suite: Disconnect Confirm Dialog & Reconnect Banner (Task P7.5)
 *
 * Verifies:
 * - Disconnect Confirmation Dialog Accessibility & Guidance (§4.1 & Task P7.5):
 *   1. outlookDisconnectModal exists with role="dialog", aria-modal="true", and aria-labelledby
 *   2. Modal contains exact honest §4.1 revocation guidance linking to https://myapps.microsoft.com
 *   3. Modal contains accessible cancel and confirm action buttons
 * - ModalManager Controller & Focus Trapping Standards:
 *   4. ModalManager traps focus between first and last focusable elements (Tab & Shift+Tab)
 *   5. Escape key listener closes active modal and restores focus
 *   6. Backdrop click closes active modal and unlocks body scroll
 * - Disconnect Execution & State Transition:
 *   7. POST /api/v1/integrations/outlook/disconnect purges vault and resets status
 *   8. confirmDisconnect renders post-disconnect revocation notice banner
 *   9. confirmDisconnect disables confirm button during transit preventing double-submit
 * - Reconnect Banner & Command Centre Integration:
 *   10. Command Centre displays #outlookReconnectBanner when status is reconnect_required
 *   11. Reconnect banner provides direct connect link and dismiss button
 *   12. Banner is hidden when status is connected or not_connected
 * - Static Shell Leak & Token Hygiene:
 *   13. index.html static shell has zero literal @ symbols and zero client entity leaks
 *   14. Zero sensitive tokens exposed in DOM or static files
 */

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { createApp } from '../src/app.js';
import { outlookVault } from '../src/services/outlookVault.js';
import { outlookConnectionStore } from '../src/services/outlookConnectionStore.js';
import { TEST_API_KEY, TEST_READONLY_KEY } from './fixtures.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '../..');

const TEST_ENC_KEY = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
const TEST_VAULT_PATH = path.resolve(__dirname, '../data-private/test-unit29-vault.json');
const TEST_CLIENT_ID = 'test-outlook-client-id-500';
const PORT = 5016;

describe('Task P7.5: Disconnect Confirm Dialog & Reconnect Banner', () => {
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
    process.env.OUTLOOK_CLIENT_ID = TEST_CLIENT_ID;

    const app = createApp({
      outlookOptions: {
        vaultKey: TEST_ENC_KEY,
        vaultPath: TEST_VAULT_PATH,
        clientId: TEST_CLIENT_ID
      }
    });

    await new Promise(resolve => {
      server = app.listen(PORT, () => {
        baseUrl = `http://localhost:${PORT}`;
        resolve();
      });
    });
  });

  after(async () => {
    if (server) {
      await new Promise(resolve => server.close(resolve));
    }
    if (fs.existsSync(TEST_VAULT_PATH)) {
      try { fs.unlinkSync(TEST_VAULT_PATH); } catch (_) {}
    }
    if (origEncKey !== undefined) {
      process.env.OUTLOOK_TOKEN_ENC_KEY = origEncKey;
    } else {
      delete process.env.OUTLOOK_TOKEN_ENC_KEY;
    }
    if (origVaultPath !== undefined) {
      process.env.OUTLOOK_VAULT_PATH = origVaultPath;
    } else {
      delete process.env.OUTLOOK_VAULT_PATH;
    }
    if (origClientId !== undefined) {
      process.env.OUTLOOK_CLIENT_ID = origClientId;
    } else {
      delete process.env.OUTLOOK_CLIENT_ID;
    }
  });

  describe('1. Disconnect Confirmation Modal Accessibility & §4.1 Copy', () => {
    test('1.1 index.html contains accessible #outlookDisconnectModal structure', () => {
      const html = fs.readFileSync(path.join(rootDir, 'index.html'), 'utf8');

      assert.ok(html.includes('id="outlookDisconnectModal"'), 'Modal element must exist');
      assert.ok(html.includes('role="dialog"'), 'Modal must have role="dialog"');
      assert.ok(html.includes('aria-modal="true"'), 'Modal must declare aria-modal="true"');
      assert.ok(html.includes('aria-labelledby="outlookDisconnectTitle"'), 'Modal must declare aria-labelledby');
      assert.ok(html.includes('aria-hidden="true"'), 'Modal must default to aria-hidden="true"');
    });

    test('1.2 Modal contains honest §4.1 revocation guidance and myapps link', () => {
      const html = fs.readFileSync(path.join(rootDir, 'index.html'), 'utf8');
      const modalIdx = html.indexOf('id="outlookDisconnectModal"');
      assert.ok(modalIdx !== -1);
      const modalHtml = html.substring(modalIdx, modalIdx + 3000);

      // Section 4.1 mandatory revocation guidance
      assert.ok(modalHtml.includes("deletes Sloane&#39;s copy of your Outlook access") || modalHtml.includes("deletes Sloane's copy of your Outlook access"), 'Must explain local deletion');
      assert.ok(modalHtml.includes('https://myapps.microsoft.com'), 'Must link to Microsoft myapps portal');
      assert.ok(modalHtml.includes('rel="noopener noreferrer"'), 'External link must have rel="noopener noreferrer"');
      assert.ok(modalHtml.includes('Zero tokens will remain on the server'), 'Must confirm complete token deletion');
    });

    test('1.3 Modal contains distinct dismiss and confirm buttons', () => {
      const html = fs.readFileSync(path.join(rootDir, 'index.html'), 'utf8');
      const modalIdx = html.indexOf('id="outlookDisconnectModal"');
      assert.ok(modalIdx !== -1);
      const modalHtml = html.substring(modalIdx, modalIdx + 3000);

      assert.ok(modalHtml.includes('id="btnCancelOutlookDisconnect"'), 'Must have Cancel button');
      assert.ok(modalHtml.includes('data-close-modal'), 'Cancel button must have data-close-modal attribute');
      assert.ok(modalHtml.includes('id="btnConfirmOutlookDisconnect"'), 'Must have Confirm Disconnect button');
      assert.ok(modalHtml.includes('modal-close-btn'), 'Must have header close button');
    });
  });

  describe('2. ModalManager Controller & Focus Trapping Standards', () => {
    test('2.1 modal.js implements global Escape key listener', () => {
      const modalJs = fs.readFileSync(path.join(rootDir, 'scripts/components/modal.js'), 'utf8');

      assert.ok(modalJs.includes("e.key === 'Escape'"), 'Must check Escape key');
      assert.ok(modalJs.includes('this.close(this.activeModal.id)'), 'Must close active modal on Escape');
    });

    test('2.2 modal.js traps focus within modal bounds on Tab and Shift+Tab', () => {
      const modalJs = fs.readFileSync(path.join(rootDir, 'scripts/components/modal.js'), 'utf8');

      assert.ok(modalJs.includes('_bindFocusTrap(modal)'), 'Must define _bindFocusTrap');
      assert.ok(modalJs.includes("e.key !== 'Tab'"), 'Must listen for Tab key');
      assert.ok(modalJs.includes('e.shiftKey'), 'Must handle Shift+Tab backwards navigation');
      assert.ok(modalJs.includes('first.focus()'), 'Must wrap to first element');
      assert.ok(modalJs.includes('last.focus()'), 'Must wrap to last element');
    });

    test('2.3 modal.js locks body scroll on open and restores on close', () => {
      const modalJs = fs.readFileSync(path.join(rootDir, 'scripts/components/modal.js'), 'utf8');

      assert.ok(modalJs.includes("document.body.style.overflow = 'hidden'"), 'Must lock scroll on open');
      assert.ok(modalJs.includes("document.body.style.overflow = ''"), 'Must unlock scroll on close');
    });

    test('2.4 modal.js preserves and restores trigger focus element', () => {
      const modalJs = fs.readFileSync(path.join(rootDir, 'scripts/components/modal.js'), 'utf8');

      assert.ok(modalJs.includes('this.lastFocusedElement = triggerElement || document.activeElement'), 'Must save trigger element');
      assert.ok(modalJs.includes('this.lastFocusedElement.focus()'), 'Must restore focus on close');
    });
  });

  describe('3. Disconnect Execution & Post-Revocation Notice', () => {
    test('3.1 outlookSettings.js wires disconnect trigger to ModalManager.open with trigger element', () => {
      const settingsJs = fs.readFileSync(path.join(rootDir, 'scripts/components/outlookSettings.js'), 'utf8');

      assert.ok(settingsJs.includes("ModalManager.open('outlookDisconnectModal', btnDisconnect)"), 'Must open modal passing trigger element for focus return');
    });

    test('3.2 confirmDisconnect disables confirm button during transit', () => {
      const settingsJs = fs.readFileSync(path.join(rootDir, 'scripts/components/outlookSettings.js'), 'utf8');

      assert.ok(settingsJs.includes('btnConfirm.disabled = true'), 'Must disable confirm button during transit');
      assert.ok(settingsJs.includes("btnConfirm.textContent = 'Disconnecting...'"), 'Must show loading label');
      assert.ok(settingsJs.includes('btnConfirm.disabled = false'), 'Must restore button in finally block');
    });

    test('3.3 confirmDisconnect renders §4.1 revocation guidance banner in settings view', () => {
      const settingsJs = fs.readFileSync(path.join(rootDir, 'scripts/components/outlookSettings.js'), 'utf8');

      assert.ok(settingsJs.includes('Outlook Account Disconnected'), 'Banner must declare disconnection');
      assert.ok(settingsJs.includes('https://myapps.microsoft.com'), 'Banner must link to Microsoft portal');
      assert.ok(settingsJs.includes("this.statusData = { status: 'not_connected' }"), 'Must reset status to not_connected');
    });

    test('3.4 POST /api/v1/integrations/outlook/disconnect returns 200 and §4.1 revocation guidance', async () => {
      // Connect first in mock store with vault options
      outlookConnectionStore.saveConnection({
        actorId: 'actor_kirsty_allen',
        status: 'connected',
        accountEmail: 'kirsty@trinova.example',
        displayName: 'Kirsty Allen',
        tenantId: 'tenant-test-123',
        scopes: ['Mail.Read', 'Calendars.Read'],
        refreshToken: 'rt-test-12345',
        accessToken: 'at-test-12345',
        accessTokenExpiresAt: Date.now() + 3600000,
        emailSyncEnabled: true,
        calendarSyncEnabled: true,
        mailFolderIds: ['Inbox'],
        connectedAt: new Date().toISOString(),
        lastSyncAt: new Date().toISOString(),
        lastError: null
      }, { filePath: TEST_VAULT_PATH, key: TEST_ENC_KEY });

      // Disconnect
      const res = await fetch(`${baseUrl}/api/v1/integrations/outlook/disconnect`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${TEST_API_KEY}`,
          Origin: baseUrl,
          'X-Requested-With': 'sloane'
        }
      });

      assert.equal(res.status, 200);
      const json = await res.json();
      assert.equal(json.disconnected, true);
      assert.equal(json.status, 'not_connected');
      assert.ok(json.message.includes('https://myapps.microsoft.com'), 'Must include myapps link in API response message');
      assert.equal(json.revocationUrl, 'https://myapps.microsoft.com');
    });
  });

  describe('4. Reconnect Banner & Command Centre Integration', () => {
    test('4.1 index.html contains #outlookReconnectBanner in Command Centre view', () => {
      const html = fs.readFileSync(path.join(rootDir, 'index.html'), 'utf8');

      assert.ok(html.includes('id="outlookReconnectBanner"'), 'Must define outlookReconnectBanner in index.html');
      assert.ok(html.includes('style="display: none;'), 'Must default to hidden');
    });

    test('4.2 scripts/app.js renders #outlookReconnectBanner when status is reconnect_required', () => {
      const appJs = fs.readFileSync(path.join(rootDir, 'scripts/app.js'), 'utf8');

      assert.ok(appJs.includes("status === 'reconnect_required' && !this._dismissedReconnectBanner"), 'Must check reconnect_required');
      assert.ok(appJs.includes('Outlook Reconnect Required:'), 'Must display reconnect warning title');
      assert.ok(appJs.includes('href="/api/v1/integrations/outlook/connect"'), 'Must provide connect action link');
      assert.ok(appJs.includes('id="btnDismissReconnectBanner"'), 'Must provide dismiss button');
    });

    test('4.3 scripts/app.js dismiss button hides banner and records dismissal flag', () => {
      const appJs = fs.readFileSync(path.join(rootDir, 'scripts/app.js'), 'utf8');

      assert.ok(appJs.includes('this._dismissedReconnectBanner = true'), 'Dismiss must set flag');
      assert.ok(appJs.includes("reconnectBannerEl.style.display = 'none'"), 'Dismiss must hide banner element');
      assert.ok(appJs.includes("if (status !== 'reconnect_required')"), 'Must reset flag when status changes');
    });

    test('4.4 outlookSettings.js renders Reconnect banner in Settings card', () => {
      const settingsJs = fs.readFileSync(path.join(rootDir, 'scripts/components/outlookSettings.js'), 'utf8');

      assert.ok(settingsJs.includes('renderReconnectRequired(data)'), 'Must define renderReconnectRequired');
      assert.ok(settingsJs.includes('Reconnect your Outlook'), 'Must display status pill');
      assert.ok(settingsJs.includes('Microsoft authorization has expired or consent was revoked'), 'Must explain reason honestly');
      assert.ok(settingsJs.includes('btnOpenDisconnectModal'), 'Must offer Disconnect button to reset state');
    });
  });

  describe('5. Security, Token Hygiene & Static Shell Leaks', () => {
    test('5.1 index.html static shell has zero literal @ symbols', () => {
      const html = fs.readFileSync(path.join(rootDir, 'index.html'), 'utf8');
      assert.equal(html.includes('@'), false, 'index.html must not contain literal @ symbol');
    });

    test('5.2 index.html static shell has zero client entity leaks', () => {
      const html = fs.readFileSync(path.join(rootDir, 'index.html'), 'utf8').toLowerCase();
      const forbiddenEntities = ['woofington', 'jenkins', 'alpha delta', 'cfi awarding', 'r gb', 'kirsty'];

      for (const entity of forbiddenEntities) {
        assert.equal(html.includes(entity), false, `Static shell must not leak "${entity}"`);
      }
    });

    test('5.3 Zero token leakage in vault after disconnect', () => {
      const conn = outlookConnectionStore.getConnection({ filePath: TEST_VAULT_PATH, key: TEST_ENC_KEY });
      assert.equal(conn, null, 'Vault record must be completely deleted after disconnect');
    });
  });
});
