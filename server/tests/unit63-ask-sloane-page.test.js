/**
 * Unit 63 Test Suite: Ask Sloane has its own page
 *
 * The question box and its example buttons used to sit in the header of every page. They now live on
 * their own "Ask Sloane" page in the menu. Verifies:
 * - the header holds only the greeting (no question box, no example buttons)
 * - the menu has an "Ask Sloane" item that opens a page which holds the box, the provider choice and the examples
 * - the examples include the new kinds of question, and every one still carries its prompt
 * - the page focuses the box when it opens
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const app = fs.readFileSync(path.join(root, 'scripts/app.js'), 'utf8');

/** The text between a start marker and the first matching end after it. */
const between = (start, end) => { const a = html.indexOf(start); return html.slice(a, html.indexOf(end, a)); };

describe('Unit 63: the Ask Sloane page', () => {
  const header = between('<div class="top">', '<div class="sourcebanner scope-banner"');
  const page = between('<section class="view hidden" id="view-ask">', '</section>');

  test('63.1 the header holds only the greeting', () => {
    assert.match(header, /id="greetingHeading"/);
    assert.equal(/id="askForm"|id="askInput"|ask-pill-suggestion|topAiProviderSelect/.test(header), false);
  });

  test('63.2 the menu has Ask Sloane, and its page holds the box, the choice of AI and the examples', () => {
    assert.match(html, /<button class="nav-btn" data-view="ask" id="nav-ask"/);
    assert.equal((html.match(/id="askForm"/g) || []).length, 1, 'one question box in the whole page');
    for (const id of ['askForm', 'askInput', 'askSubmitBtn', 'topAiProviderSelect', 'askSuggestions']) {
      assert.ok(page.includes(`id="${id}"`), `${id} is on the Ask Sloane page`);
    }
  });

  test('63.3 every example button carries its question, including the newer kinds', () => {
    const prompts = [...page.matchAll(/class="ask-pill-suggestion" data-prompt="([^"]+)"/g)].map(m => m[1]);
    assert.ok(prompts.length >= 8);
    assert.ok(prompts.includes('What needs chasing?'));
    assert.ok(prompts.includes('Which clients are behind?'));
    assert.ok(prompts.some(p => /across my businesses/i.test(p)));
    assert.ok(prompts.every(p => p.trim().length > 5));
    assert.match(page, /Where are we with the MTDflow launch\?/);
  });

  test('63.4 opening the page puts the cursor in the question box', () => {
    assert.match(app, /if \(viewId === 'ask'\) \{\s*setTimeout\(\(\) => \{ const box = document\.getElementById\('askInput'\)/);
  });
});
