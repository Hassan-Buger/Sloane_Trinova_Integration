/**
 * Automated Test Suite: Task P7.2 — Command Centre Integration & Dynamic Radar Pills
 * Implements verification per docs/outlook-build/SPEC.md §4.3 and §5 (Task P7.2):
 * - Removal of hard-coded "Outlook Connected" top-bar eyebrow label
 * - Removal of static "Connected" Diary card pill (dynamic #diaryStatusPill)
 * - Removal of static "Outlook Radar" attention emails pill (dynamic #emailsRadarPill, shown only when connected)
 * - Removal of DIARY_ITEMS and ATTENTION_EMAILS mock reads from renderCommandCentre
 * - Live endpoint integration with exact §4.3 empty states:
 *   - "Connect your Outlook to see this here" (disconnected)
 *   - "Reconnect your Outlook" (reconnect required)
 *   - "Calendar sync is off" / "Email sync is off" (disabled toggles)
 * - Pulse metrics #pulseEmails dynamically reflects live email count
 * - Context scan meetings clash card derived dynamically from real calendar events
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const INDEX_HTML_PATH = path.resolve(__dirname, '../../index.html');
const APP_JS_PATH = path.resolve(__dirname, '../../scripts/app.js');

describe('Task P7.2: Command Centre Integration & Dynamic Radar Pills', () => {
  const indexHtml = fs.readFileSync(INDEX_HTML_PATH, 'utf-8');
  const appJs = fs.readFileSync(APP_JS_PATH, 'utf-8');

  // ==========================================
  // 1. Static HTML Shell Verification
  // ==========================================
  describe('index.html Dynamic Shell Elements (No Hardcoded Statuses)', () => {
    test('1. index.html does NOT contain hardcoded "Outlook Connected" in top bar eyebrow', () => {
      // Must not contain static string in the top bar eyebrow
      assert.ok(!indexHtml.includes('Private CEO Command Centre · Outlook Connected'), 'Static Outlook Connected string removed from index.html');
      assert.ok(indexHtml.includes('id="outlookEyebrowDot"'), 'outlookEyebrowDot dynamic element present');
      assert.ok(indexHtml.includes('id="outlookEyebrowText"'), 'outlookEyebrowText dynamic element present');
    });

    test('2. index.html contains dynamic #diaryStatusPill initialized as hidden', () => {
      assert.ok(indexHtml.includes('id="diaryStatusPill"'), 'diaryStatusPill element present in diary header');
      assert.ok(indexHtml.includes('id="diaryStatusPill" style="display: none;"'), 'diaryStatusPill is hidden by default in static shell');
    });

    test('3. index.html contains dynamic #emailsRadarPill initialized as hidden', () => {
      assert.ok(indexHtml.includes('id="emailsRadarPill"'), 'emailsRadarPill element present in attention emails header');
      assert.ok(indexHtml.includes('id="emailsRadarPill" style="display: none;"'), 'emailsRadarPill is hidden by default in static shell');
    });

    test('4. index.html maintains zero client data leaks or literal @ symbols', () => {
      const leakRegex = /woofington|jenkins|alpha delta|cfi|R GB|@|kirsty/i;
      assert.equal(leakRegex.test(indexHtml), false, 'index.html contains zero data leaks');
    });
  });

  // ==========================================
  // 2. app.js Code Structure & Removal of Mock Reads
  // ==========================================
  describe('app.js Elimination of DIARY_ITEMS and ATTENTION_EMAILS Reads', () => {
    test('5. renderCommandCentre does NOT extract DIARY_ITEMS or ATTENTION_EMAILS from seed', () => {
      // Find the renderCommandCentre implementation block
      const rccMatch = appJs.match(/async\s+renderCommandCentre\s*\(\)\s*\{([\s\S]*?)async\s+renderBusinesses/);
      assert.ok(rccMatch, 'renderCommandCentre method found in app.js');

      const rccBody = rccMatch[1];
      assert.ok(!rccBody.includes('seed.DIARY_ITEMS'), 'Does not read seed.DIARY_ITEMS');
      assert.ok(!rccBody.includes('const DIARY_ITEMS ='), 'Does not assign const DIARY_ITEMS');
      assert.ok(!rccBody.includes('seed.ATTENTION_EMAILS'), 'Does not read seed.ATTENTION_EMAILS');
      assert.ok(!rccBody.includes('const ATTENTION_EMAILS ='), 'Does not assign const ATTENTION_EMAILS');
    });

    test('6. renderCommandCentre queries live ApiService endpoints', () => {
      const rccMatch = appJs.match(/async\s+renderCommandCentre\s*\(\)\s*\{([\s\S]*?)async\s+renderBusinesses/);
      const rccBody = rccMatch[1];

      assert.ok(rccBody.includes('ApiService.getOutlookDiary'), 'Calls ApiService.getOutlookDiary');
      assert.ok(rccBody.includes('ApiService.getOutlookFlaggedEmails'), 'Calls ApiService.getOutlookFlaggedEmails');
      assert.ok(rccBody.includes('ApiService.getOutlookStatus'), 'Calls ApiService.getOutlookStatus');
    });

    test('7. Implements refreshOutlookData helper on SloaneApp', () => {
      assert.ok(appJs.includes('async refreshOutlookData()'), 'refreshOutlookData method exists on SloaneApp');
      assert.ok(appJs.includes('this.renderCommandCentre()'), 'Refreshes command centre');
      assert.ok(appJs.includes('this.renderIntelligence()'), 'Refreshes intelligence radar');
    });
  });

  // ==========================================
  // 3. Dynamic Rendering & Empty State Logic
  // ==========================================
  describe('Command Centre UI Simulation & §4.3 Empty States', () => {
    test('8. Wording conforms exactly to §4.3 specifications', () => {
      const expectedPhrases = [
        'Connect your Outlook to see this here',
        'Reconnect your Outlook',
        'Calendar sync is off',
        'Email sync is off'
      ];

      for (const phrase of expectedPhrases) {
        assert.ok(appJs.includes(phrase), `app.js must include exact specification wording: "${phrase}"`);
      }
    });

    test('9. Context scan in renderIntelligence dynamically uses cachedDiaryEvents', () => {
      const intelMatch = appJs.match(/renderIntelligence\s*\(\)\s*\{([\s\S]*?)renderMissedScan/);
      assert.ok(intelMatch, 'renderIntelligence method found');
      const intelBody = intelMatch[1];

      assert.ok(intelBody.includes('this.cachedDiaryEvents'), 'Inspects cachedDiaryEvents for clashes');
      assert.ok(intelBody.includes('Two meetings at once:'), 'Renders a plain-English clash title when clashes exist');
      assert.ok(intelBody.includes('None of today'), 'Says plainly that no meetings overlap when there are no clashes');
    });

    test('10. Pulse metric pulseEmails is updated from attentionEmails.length', () => {
      const rccMatch = appJs.match(/async\s+renderCommandCentre\s*\(\)\s*\{([\s\S]*?)async\s+renderBusinesses/);
      const rccBody = rccMatch[1];

      assert.ok(rccBody.includes("pulseEmails.textContent = emailCount") || rccBody.includes("pulseEmails.textContent = attentionEmails.length"), 'Updates pulseEmails from live count');
    });
  });
});
