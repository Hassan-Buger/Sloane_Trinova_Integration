/**
 * Unit 46 Test Suite: one spacing system for every page
 *
 * Guards the layout rules that keep spacing even:
 * - spacing values come from tokens, not one-off numbers
 * - sections on a page are spaced by the page (one gap), and a wide table scrolls inside its own
 *   box instead of making the page wider than the screen (min-width: 0)
 * - cards share one padding; the phone-style top bar is hidden on desktop
 * - the sidebar Sign out button never squeezes the owner's name
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = rel => fs.readFileSync(path.join(root, rel), 'utf8');
const tokens = read('styles/tokens.css');
const views = read('styles/views.css');
const html = read('index.html');

describe('Unit 46: spacing system', () => {
  test('46.1 spacing tokens exist', () => {
    for (const t of ['--space-1', '--space-2', '--space-3', '--space-4', '--space-5', '--space-6', '--space-8', '--section-gap', '--grid-gap', '--card-pad', '--card-head-gap']) {
      assert.ok(tokens.includes(`${t}:`), `${t} is defined`);
    }
  });

  test('46.2 pages are spaced by one gap, and sections can shrink so wide tables scroll inside their box', () => {
    assert.match(views, /\.view:not\(\.hidden\),[\s\S]*?gap: var\(--section-gap\)/);
    assert.match(views, /\.view > \*,[\s\S]*?margin-bottom: 0 !important;[\s\S]*?min-width: 0;/);
    assert.match(views, /\.shell > main \{\s*min-width: 0;/);
  });

  test('46.3 cards share one padding, and no card sets its own padding inline in index.html', () => {
    assert.match(views, /\.card \{\s*padding: var\(--card-pad\);/);
    assert.equal(/class="card"[^>]*style="[^"]*padding: (20|22)px/.test(html), false);
  });

  test('46.4 the phone-style top bar is hidden on desktop, and Sign out never squeezes the name', () => {
    assert.match(views, /@media \(min-width: 1101px\) \{\s*\.mobile-nav-bar \{\s*display: none !important;/);
    assert.match(views, /\.profile \.btn-lock-session \{\s*flex: 1 0 100%;/);
    assert.match(read('styles/auth.css'), /\.btn-lock-session \{[\s\S]*?white-space: nowrap;/);
  });
});
