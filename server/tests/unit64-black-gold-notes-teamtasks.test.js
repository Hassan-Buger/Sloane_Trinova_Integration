/**
 * Unit 64 Test Suite: black and gold, shorter notes lists, and Team & Tasks search
 *
 * Verifies:
 * - PALETTE: no colour written in the styles, the page or the scripts is red, green, blue, purple or
 *   any other hue: only black, white, greys, ivory and gold (hue 25 to 62 degrees)
 * - The menu uses one-colour icons (no emoji) and the status colours are gold, ivory and warm grey
 * - NOTES: a long list shows only the newest 5 with "Show all N notes"; a long note is cut with "Read more"
 * - TEAM & TASKS: the filter (open, late, stuck, finished, everything) and the search words pick the right tasks;
 *   the page has the search box and filter; removing a person with open tasks asks where the tasks go
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { visibleNotes, moreNotesButton, noteTextHtml, toggleExpanded, toggleList, NOTES_SHOWN, LONG_NOTE } from '../../scripts/utils/compactNotes.js';
import { passesFilter } from '../../scripts/features/teamTasks.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = f => fs.readFileSync(path.join(root, f), 'utf8');

function listFiles(dir, exts, out = []) {
  for (const e of fs.readdirSync(path.join(root, dir), { withFileTypes: true })) {
    const rel = `${dir}/${e.name}`;
    if (e.isDirectory()) { if (!['data', 'node_modules'].includes(e.name)) listFiles(rel, exts, out); }
    else if (exts.some(x => e.name.endsWith(x))) out.push(rel);
  }
  return out;
}

function hsv(r, g, b) {
  const rr = r / 255; const gg = g / 255; const bb = b / 255;
  const max = Math.max(rr, gg, bb); const min = Math.min(rr, gg, bb); const d = max - min;
  let h = 0;
  if (d) {
    if (max === rr) h = ((gg - bb) / d) % 6; else if (max === gg) h = (bb - rr) / d + 2; else h = (rr - gg) / d + 4;
    h *= 60; if (h < 0) h += 360;
  }
  return { h, s: max ? d / max : 0, v: max };
}

/** Is a colour black, white, grey, ivory or gold? */
function onPalette(r, g, b) {
  const { h, s, v } = hsv(r, g, b);
  if (s <= 0.12) return true; // greys, black, white
  if (h >= 25 && h <= 62) return true; // gold, bronze, ivory, warm browns
  return s <= 0.18 && v <= 0.12 && !(h >= 180 && h <= 280); // near-black with a hint of warmth
}

describe('Unit 64: black and gold, shorter notes, Team & Tasks', () => {
  describe('1. The palette', () => {
    const files = [...listFiles('styles', ['.css']), ...listFiles('scripts', ['.js']), 'index.html', 'assets/manifest.webmanifest'];

    test('64.1 no colour in the styles, page or scripts is outside black, white, grey, ivory and gold', () => {
      const offenders = [];
      for (const f of files) {
        const text = read(f);
        for (const m of text.matchAll(/#([0-9a-fA-F]{6})\b|rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/g)) {
          const [r, g, b] = m[1] ? [parseInt(m[1].slice(0, 2), 16), parseInt(m[1].slice(2, 4), 16), parseInt(m[1].slice(4, 6), 16)] : [+m[2], +m[3], +m[4]];
          if (!onPalette(r, g, b)) offenders.push(`${f}: ${m[0]}`);
        }
      }
      assert.deepEqual([...new Set(offenders)].slice(0, 12), [], 'colours outside the palette');
    });

    test('64.2 the status colours are gold, ivory and warm grey (no red, green or blue)', () => {
      const tokens = read('styles/tokens.css');
      for (const name of ['red', 'amber', 'green', 'blue']) {
        const m = tokens.match(new RegExp(`--${name}: #([0-9a-fA-F]{6});`));
        assert.ok(m, `--${name} is set`);
        assert.ok(onPalette(parseInt(m[1].slice(0, 2), 16), parseInt(m[1].slice(2, 4), 16), parseInt(m[1].slice(4, 6), 16)), `--${name} is on the palette`);
      }
      assert.match(tokens, /--accent: #d4af37;/);
      assert.match(tokens, /--bg: #050505;/);
    });

    test('64.3 the menu uses one-colour icons, not emoji', () => {
      const html = read('index.html');
      const start = html.indexOf('<ul class="nav-list">');
      const nav = html.slice(start, html.indexOf('</ul>', start));
      assert.equal((nav.match(/class="nav-ico"><svg/g) || []).length, 12);
      assert.equal(/[\u{1F300}-\u{1FAFF}☀-➿]/u.test(nav.replace(/<svg[\s\S]*?<\/svg>/g, '')), false, 'no emoji left in the menu');
    });
  });

  describe('2. Notes lists stay short', () => {
    const notes = n => Array.from({ length: n }, (_, i) => ({ id: `n${i}`, text: `note ${i}` }));

    test('64.4 only the newest 5 show, with a button for the rest', () => {
      const app = {};
      const info = visibleNotes(app, 'client', notes(12));
      assert.equal(NOTES_SHOWN, 5);
      assert.equal(info.shown.length, 5);
      assert.equal(info.shown[0].id, 'n0', 'the newest first');
      assert.equal(info.hidden, 7);
      assert.match(moreNotesButton('client', info, 12), /Show all 12 notes/);
      toggleList(app, 'client');
      const all = visibleNotes(app, 'client', notes(12));
      assert.equal(all.shown.length, 12);
      assert.match(moreNotesButton('client', all, 12), /Show fewer notes/);
      assert.equal(moreNotesButton('client', visibleNotes({}, 'client', notes(4)), 4), '', 'no button when there is nothing hidden');
    });

    test('64.5 two lists keep their own choice', () => {
      const app = {};
      toggleList(app, 'private');
      assert.equal(visibleNotes(app, 'private', notes(9)).shown.length, 9);
      assert.equal(visibleNotes(app, 'client', notes(9)).shown.length, 5);
    });

    test('64.6 a long note is cut with "Read more", and opens when asked; a short one is left alone', () => {
      const app = {};
      const long = 'word '.repeat(80);
      assert.ok(long.length > LONG_NOTE);
      const cut = noteTextHtml(app, 'a1', long, 'note-text');
      assert.match(cut, /class="note-text note-clamped"/);
      assert.match(cut, />Read more</);
      toggleExpanded(app, 'a1');
      const open = noteTextHtml(app, 'a1', long, 'note-text');
      assert.equal(/note-clamped/.test(open), false);
      assert.match(open, />Show less</);
      const short = noteTextHtml(app, 'a2', 'Call the client', 'note-text');
      assert.equal(/note-clamped|note-toggle/.test(short), false);
      assert.match(noteTextHtml(app, 'a3', '<script>alert(1)</script>', 'note-text'), /&lt;script&gt;/, 'text is escaped');
    });
  });

  describe('3. Team & Tasks', () => {
    const today = '2026-10-27';
    const t = extra => ({ title: 'Prepare accounts', description: '', companyName: 'Acme Ltd', status: 'Pending', dueDate: null, isBlocked: false, assigneeName: 'Priya', progressNotes: [], ...extra });

    test('64.7 the filter chooses open, late, stuck, finished or everything', () => {
      const open = t({});
      const late = t({ dueDate: '2026-10-01' });
      const stuck = t({ isBlocked: true });
      const done = t({ status: 'Completed' });
      const pick = mode => [open, late, stuck, done].filter(x => passesFilter(x, mode, [], today)).length;
      assert.equal(pick('open'), 3);
      assert.equal(pick('late'), 1);
      assert.equal(pick('stuck'), 1);
      assert.equal(pick('finished'), 1);
      assert.equal(pick('all'), 4);
      assert.equal(passesFilter(t({ status: 'Completed', dueDate: '2026-10-01' }), 'late', [], today), false, 'a finished task is never late');
    });

    test('64.8 search words must all appear: in the title, client, person, notes and more', () => {
      const task = t({ title: 'Chase statements', department: 'Accounts', progressNotes: [{ text: 'Client says Friday' }], businessArea: 'TriNova Accounting' });
      assert.equal(passesFilter(task, 'all', ['statements'], today), true);
      assert.equal(passesFilter(task, 'all', ['acme', 'friday'], today), true);
      assert.equal(passesFilter(task, 'all', ['priya', 'trinova'], today), true);
      assert.equal(passesFilter(task, 'all', ['statements', 'zzz'], today), false);
    });

    test('64.9 the page has the search box and filter, and removing a person asks where their tasks go', () => {
      const html = read('index.html');
      assert.match(html, /id="taskSearch"/);
      assert.match(html, /id="taskFilterSelect" data-change="changeTaskFilter"/);
      assert.match(read('scripts/app.js'), /'changeTaskFilter'/);
      const src = read('scripts/features/teamTasks.js');
      assert.match(src, /Who should \$\{open\.length === 1 \? 'it' : 'they'\} go to\?/);
      assert.match(src, /Nobody yet \(I will give them out later\)/);
      assert.match(src, /data-action="openTeamMemberForm" data-name=/, 'a name that is not on the team list can be added');
    });
  });
});
