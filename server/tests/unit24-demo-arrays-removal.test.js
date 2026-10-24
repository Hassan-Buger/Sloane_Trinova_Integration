import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { frontendSource } from './support.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '../..');

describe('Task P7.3: Demo Arrays Removal from UI Path', () => {
  const appJsPath = path.join(rootDir, 'scripts/app.js');
  const apiJsPath = path.join(rootDir, 'scripts/services/api.js');
  const indexHtmlPath = path.join(rootDir, 'index.html');

  const appJsContent = frontendSource();
  const apiJsContent = fs.readFileSync(apiJsPath, 'utf8');
  const indexHtmlContent = fs.readFileSync(indexHtmlPath, 'utf8');

  describe('Elimination of Seed Imports & Demo Arrays from scripts/app.js', () => {
    test('1. scripts/app.js does NOT import ./data/seed.js or define getSeedData()', () => {
      assert.doesNotMatch(
        appJsContent,
        /import\s*\(\s*['"]\.\/data\/seed\.js['"]\s*\)/,
        'scripts/app.js must not dynamically import ./data/seed.js'
      );
      assert.doesNotMatch(
        appJsContent,
        /function\s+getSeedData\s*\(/,
        'scripts/app.js must not define getSeedData()'
      );
      assert.doesNotMatch(
        appJsContent,
        /\b_seedData\b/,
        'scripts/app.js must not declare or use _seedData'
      );
    });

    test('2. scripts/app.js does NOT extract or use demo arrays from seed', () => {
      assert.doesNotMatch(
        appJsContent,
        /seed\.TOP3_ITEMS/,
        'scripts/app.js must not access seed.TOP3_ITEMS'
      );
      assert.doesNotMatch(
        appJsContent,
        /seed\.WAITING_SIGNOFF/,
        'scripts/app.js must not access seed.WAITING_SIGNOFF'
      );
      assert.doesNotMatch(
        appJsContent,
        /seed\.PEOPLE_WORK/,
        'scripts/app.js must not access seed.PEOPLE_WORK'
      );
      assert.doesNotMatch(
        appJsContent,
        /seed\.ACCOUNTS_TRACKER/,
        'scripts/app.js must not access seed.ACCOUNTS_TRACKER'
      );
      assert.doesNotMatch(
        appJsContent,
        /seed\.ACTION_TRACKER/,
        'scripts/app.js must not access seed.ACTION_TRACKER'
      );
      assert.doesNotMatch(
        appJsContent,
        /seed\.VAT_TRACKER/,
        'scripts/app.js must not access seed.VAT_TRACKER'
      );
    });
  });

  describe('ApiService.getTasks Implementation', () => {
    test('3. ApiService provides getTasks method querying /tasks', () => {
      assert.match(
        apiJsContent,
        /async\s+getTasks\s*\(\s*params\s*=\s*\{\}\s*\)/,
        'ApiService must define async getTasks(params = {})'
      );
      assert.match(
        apiJsContent,
        /this\.request\(`\/tasks\$\{query \? '\?' \+ query : ''\}`\)/,
        'getTasks must query /tasks with optional URLSearchParams'
      );
    });
  });

  describe('Command Centre Dynamic Data & Empty States', () => {
    test('4. renderCommandCentre queries live ApiService.getTasks and ApiService.getStatutory', () => {
      assert.match(
        appJsContent,
        /ApiService\.getTasks\(\)/,
        'renderCommandCentre must query ApiService.getTasks()'
      );
      assert.match(
        appJsContent,
        /ApiService\.getStatutory\(\)/,
        'renderCommandCentre must query ApiService.getStatutory()'
      );
    });

    test('5. Waiting for sign-off renders honest empty state when no sign-off tasks exist', () => {
      assert.match(
        appJsContent,
        /Nothing is waiting for your OK/,
        'renderCommandCentre must define "Nothing is waiting for your OK" empty state'
      );
    });

    test('6. Top 3 ranked items renders honest empty state when no statutory items exist', () => {
      assert.match(
        appJsContent,
        /Nothing urgent right now/,
        'renderCommandCentre must define "Nothing urgent right now" empty state'
      );
    });

    test('7. Pulse metrics are dynamically computed from live API data and meta', () => {
      // pulseSignoffs must be signoffItems.length
      assert.match(
        appJsContent,
        /pulseSignoffs\.textContent\s*=\s*signoffCount/,
        'pulseSignoffs must be updated from signoffCount'
      );
      // pulseOverdue must be computed from the real filing records (late filings)
      assert.match(
        appJsContent,
        /pulseOverdue\.textContent\s*=\s*lateCount/,
        'pulseOverdue must be dynamically set from lateCount'
      );
      // pulseBlocked must be updated from blockedCount
      assert.match(
        appJsContent,
        /pulseBlocked\.textContent\s*=\s*blockedCount/,
        'pulseBlocked must be dynamically set from blockedCount'
      );
    });
  });

  describe('People & Work Dynamic Grouping & Empty States', () => {
    test('8. renderPeopleWork groups tasks from ApiService.getTasks and provides empty state', () => {
      assert.match(
        appJsContent,
        /await\s+ApiService\.getTasks\(\)/,
        'renderPeopleWork must await ApiService.getTasks()'
      );
      assert.match(
        appJsContent,
        /No tasks yet\. Click/,
        'renderPeopleWork must display an empty state when tasks array is empty'
      );
      assert.match(
        appJsContent,
        /div class="card person-card"/,
        'renderPeopleWork must wrap each person in .card.person-card'
      );
    });
  });

  describe('Statutory Monitor Dynamic Data & Empty States', () => {
    test('9. renderStatutory queries ApiService.getStatutory and handles empty states cleanly', () => {
      assert.match(
        appJsContent,
        /await\s+ApiService\.getStatutory\(\)/,
        'renderStatutory must await ApiService.getStatutory()'
      );
      assert.match(
        appJsContent,
        /No deadlines yet/,
        'renderStatutory must provide empty state for empty records'
      );
      assert.match(
        appJsContent,
        /Nothing needs doing right now/,
        'renderStatutory action tracker must provide empty state when no RED/AMBER items exist'
      );
      assert.match(
        appJsContent,
        /No VAT returns saved yet/,
        'renderVatReturns must provide clean empty state (VAT returns are now kept in Sloane)'
      );
    });
  });

  describe('Logged-Out Shell Security & Leak Hygiene', () => {
    test('10. index.html static shell has zero literal @ symbols and zero demo array data', () => {
      // Zero unescaped literal @ in index.html
      const atHits = (indexHtmlContent.match(/@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g) || []).length;
      assert.equal(atHits, 0, 'index.html must contain zero email addresses');

      // Zero sensitive client entities in index.html
      const leakPattern = /woofington|jenkins|alpha delta creative|cfi awarding|rgb elevations|kirsty/i;
      assert.doesNotMatch(
        indexHtmlContent,
        leakPattern,
        'index.html logged-out shell must contain zero hardcoded client entity names'
      );
    });
  });
});
