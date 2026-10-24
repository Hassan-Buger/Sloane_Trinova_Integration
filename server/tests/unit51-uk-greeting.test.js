/**
 * Unit 51 Test Suite: greetings follow UK time
 *
 * Kirsty is in the UK. "Good morning / afternoon / evening" follows the UK clock (with British
 * Summer Time), not the clock of the computer or server showing Sloane:
 *   5:00-11:59 morning, 12:00-16:59 afternoon, 17:00-4:59 evening.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { ukPartOfDay as serverPart, ukHour } from '../src/services/ukTime.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

// [UTC instant, expected part of day in the UK]
const CASES = [
  // Winter (GMT = UTC)
  ['2026-01-15T04:59:00Z', 'evening'],
  ['2026-01-15T05:00:00Z', 'morning'],
  ['2026-01-15T11:59:00Z', 'morning'],
  ['2026-01-15T12:00:00Z', 'afternoon'],
  ['2026-01-15T16:59:00Z', 'afternoon'],
  ['2026-01-15T17:00:00Z', 'evening'],
  ['2026-01-15T23:30:00Z', 'evening'],
  // Summer (BST = UTC + 1)
  ['2026-07-15T04:30:00Z', 'morning'],   // 05:30 BST
  ['2026-07-15T11:30:00Z', 'afternoon'], // 12:30 BST
  ['2026-07-15T15:59:00Z', 'afternoon'], // 16:59 BST
  ['2026-07-15T16:00:00Z', 'evening']    // 17:00 BST
];

describe('Unit 51: greetings follow UK time', () => {
  test('51.1 the server picks morning / afternoon / evening by UK time, summer time included', () => {
    for (const [instant, expected] of CASES) {
      assert.equal(serverPart(new Date(instant)), expected, `${instant} is ${expected} in the UK`);
    }
    assert.equal(ukHour(new Date('2026-07-15T11:30:00Z')), 12);
  });

  test('51.2 the browser uses the same rule', async () => {
    const { ukPartOfDay } = await import('../../scripts/utils/html.js');
    for (const [instant, expected] of CASES) {
      assert.equal(ukPartOfDay(new Date(instant)), expected, `${instant} is ${expected} in the UK (browser)`);
    }
  });

  test('51.3 the dashboard greeting and the morning briefing use UK time, not the local clock', () => {
    const app = fs.readFileSync(path.join(root, 'scripts/app.js'), 'utf8');
    assert.match(app, /greetingEl\.textContent = `Good \$\{ukPartOfDay\(\)\}, \$\{firstName\}`/);
    assert.equal(/const hour = new Date\(\)\.getHours\(\)/.test(app), false, 'no greeting from the local clock');
    const ai = fs.readFileSync(path.join(root, 'server/src/routes/ai.js'), 'utf8');
    assert.equal(/Good morning, Kirsty/.test(ai), false, 'the briefing does not always say Good morning');
    assert.match(ai, /Good \$\{ukPartOfDay\(\)\}, Kirsty/);
  });
});
