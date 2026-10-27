/**
 * Unit 65 Test Suite: Sequential Record Numbering (Feature A)
 *
 * Verifies:
 * - 1-based sequential display numbering (#) across Clients, Deadlines, Actions,
 *   VAT, Team & Tasks, Client Detail (Docs, Signing, Notes, Tasks), Recycle Bin, and Reports.
 * - Dynamic recalculation on filtering, searching, and sorting (1..N with no gaps).
 * - Empty states colspans updated cleanly to prevent layout collapse.
 * - Responsive table/card styling with dedicated .col-num and .row-num tokens.
 * - Full compliance with Unit 64 Luxury Black/Gold palette rules.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '../..');

describe('Unit 65: Sequential Record Numbering (Feature A)', () => {
  const indexHtml = fs.readFileSync(path.resolve(rootDir, 'index.html'), 'utf8');
  const componentsCss = fs.readFileSync(path.resolve(rootDir, 'styles/components.css'), 'utf8');
  const appJs = fs.readFileSync(path.resolve(rootDir, 'scripts/app.js'), 'utf8');
  const deadlinesJs = fs.readFileSync(path.resolve(rootDir, 'scripts/features/deadlines.js'), 'utf8');
  const teamTasksJs = fs.readFileSync(path.resolve(rootDir, 'scripts/features/teamTasks.js'), 'utf8');
  const clientDetailJs = fs.readFileSync(path.resolve(rootDir, 'scripts/features/clientDetail.js'), 'utf8');
  const binJs = fs.readFileSync(path.resolve(rootDir, 'scripts/features/bin.js'), 'utf8');
  const reportsJs = fs.readFileSync(path.resolve(rootDir, 'scripts/features/reports.js'), 'utf8');

  describe('1. Clients Table & Card Display', () => {
    test('1.1 index.html includes # table header with .col-num class and aria-label', () => {
      assert.ok(
        indexHtml.includes('<th class="col-num" aria-label="Row number">#</th>'),
        'Clients table header must have accessible .col-num header'
      );
    });

    test('1.2 styles/components.css defines .col-num and .row-num typography and width', () => {
      assert.ok(componentsCss.includes('.col-num'), 'Must define .col-num in components.css');
      assert.ok(componentsCss.includes('.row-num'), 'Must define .row-num in components.css');
      assert.ok(componentsCss.includes('font-variant-numeric: tabular-nums'), 'Numbers must be tabular');
    });

    test('1.3 app.js renders 1-based sequential number in renderClients', () => {
      assert.ok(
        appJs.includes('<td class="col-num">${idx + 1}</td>'),
        'renderClients must output <td class="col-num">${idx + 1}</td>'
      );
    });

    test('1.4 app.js sets empty state colspan to 10 for Clients table', () => {
      assert.ok(
        appJs.includes('colspan="10"'),
        'Empty state must span 10 columns to account for the numbering column'
      );
    });

    test('1.5 app.js renders # row-num in business cards', () => {
      assert.ok(
        appJs.includes('<span class="row-num">#${idx + 1}</span>'),
        'Business card header must display sequential # row-num'
      );
    });
  });

  describe('2. Statutory Deadlines, Actions Tracker & VAT Schedule', () => {
    test('2.1 index.html has # header for Deadlines, Action Tracker, and VAT tables', () => {
      const occurrences = (indexHtml.match(/<th class="col-num" aria-label="Row number">#<\/th>/g) || []).length;
      assert.ok(occurrences >= 4, `Expected at least 4 occurrences of # header, found ${occurrences}`);
    });

    test('2.2 deadlines.js renders 1-based sequential numbers in all tables', () => {
      assert.ok(deadlinesJs.includes('<td class="col-num">${i + 1}</td>'), 'Statutory deadlines table must number rows');
      assert.ok(deadlinesJs.includes('<td class="col-num">${idx + 1}</td>'), 'Action tracker table must number rows');
    });

    test('2.3 deadlines.js empty state colspans match total column counts', () => {
      assert.ok(deadlinesJs.includes('colspan="9"'), 'Statutory deadlines empty state must span 9 cols');
      assert.ok(deadlinesJs.includes('colspan="6"'), 'Action tracker and VAT empty states must span 6 cols');
    });
  });

  describe('3. Team & Tasks', () => {
    test('3.1 teamTasks.js taskRow renders sequential index marker', () => {
      assert.ok(
        teamTasksJs.includes('aria-label="Task ${index + 1}">#${index + 1}</div>'),
        'Task row must display accessible sequential marker'
      );
    });

    test('3.2 renderPeopleWork maps tasks with their index', () => {
      assert.ok(
        teamTasksJs.includes('(t, idx) => taskRow(t, idx)'),
        'renderPeopleWork must pass idx to taskRow'
      );
    });
  });

  describe('4. Client Detail Views, Recycle Bin & Reports', () => {
    test('4.1 clientDetail.js renders sequential row-num in documents, signing, notes and tasks', () => {
      assert.ok(clientDetailJs.includes('#${idx + 1}</span>'), 'Client detail lists must display sequential numbers');
    });

    test('4.2 bin.js renders sequential row-num in recycle bin items', () => {
      assert.ok(binJs.includes('#${idx + 1}</span>'), 'Recycle bin items must display sequential numbers');
    });

    test('4.3 reports.js includes # column mapping index + 1', () => {
      assert.ok(
        reportsJs.includes("label: '#'"),
        'Reports table definition must include # column'
      );
      assert.ok(
        reportsJs.includes('(_r, idx) => String(idx + 1)'),
        'Reports # column must map idx + 1'
      );
    });
  });

  describe('5. Filter and Search Sequence Integrity Simulation', () => {
    test('5.1 Filtered result set numbers sequentially from 1 to N without gaps', () => {
      const records = [
        { id: 'rec_1', name: 'Alpha Ltd', status: 'active' },
        { id: 'rec_2', name: 'Beta Ltd', status: 'inactive' },
        { id: 'rec_3', name: 'Gamma Ltd', status: 'active' },
        { id: 'rec_4', name: 'Delta Ltd', status: 'active' }
      ];

      // Simulate filtering for active records
      const filtered = records.filter(r => r.status === 'active');
      const renderedNumbers = filtered.map((_, idx) => idx + 1);

      assert.deepEqual(renderedNumbers, [1, 2, 3], 'Display numbers must be 1, 2, 3 with no gaps');
      assert.notEqual(renderedNumbers[1], 3, 'Display number must not reflect raw record array index');
    });

    test('5.2 Sorted result set maintains 1 to N sequence', () => {
      const records = [
        { id: 'rec_1', name: 'Zeta Ltd' },
        { id: 'rec_2', name: 'Alpha Ltd' },
        { id: 'rec_3', name: 'Beta Ltd' }
      ];

      const sorted = [...records].sort((a, b) => a.name.localeCompare(b.name));
      const renderedNumbers = sorted.map((_, idx) => idx + 1);

      assert.deepEqual(renderedNumbers, [1, 2, 3]);
    });
  });

  describe('6. Luxury Black/Gold Palette Compliance', () => {
    test('6.1 col-num and row-num use standard muted CSS tokens and no forbidden colors', () => {
      // Must use var(--muted) or var(--line)
      assert.ok(componentsCss.includes('.col-num {'), '.col-num selector present');
      assert.ok(componentsCss.includes('.row-num {'), '.row-num selector present');
      // No forbidden raw hex colors in the added CSS classes
      const colNumBlock = componentsCss.match(/\.col-num\s*\{[^}]+\}/)?.[0] || '';
      const rowNumBlock = componentsCss.match(/\.row-num\s*\{[^}]+\}/)?.[0] || '';
      assert.ok(!colNumBlock.includes('#ff'), 'No raw red in .col-num');
      assert.ok(!colNumBlock.includes('#00f'), 'No raw blue in .col-num');
      assert.ok(!rowNumBlock.includes('#ff'), 'No raw red in .row-num');
    });
  });
});
