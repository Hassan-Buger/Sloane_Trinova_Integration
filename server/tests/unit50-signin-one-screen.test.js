/**
 * Unit 50 Test Suite: the sign-in page fits on one screen
 *
 * Guards the layout rules that keep everything (logo, form, Sign in button, footer) above the
 * fold on shorter screens: laptops, a zoomed-in browser and phones. Measured in a real browser
 * when the rules were written: 1280x650, 375x667 and 360x640 all fit, even with the
 * wrong-password message showing.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const css = fs.readFileSync(path.join(root, 'styles/auth.css'), 'utf8');

describe('Unit 50: sign-in page on one screen', () => {
  test('50.1 the spacing tightens on shorter screens (820px, 700px and 580px tall)', () => {
    for (const h of [820, 700, 580]) {
      assert.match(css, new RegExp(`@media \\(max-height: ${h}px\\) \\{`), `a rule for screens up to ${h}px tall`);
    }
  });

  test('50.2 the version sits on the footer line, not on a line of its own', () => {
    assert.match(css, /\.auth-version \{\s*display: inline;/);
    assert.match(css, /\.auth-version:not\(:empty\)::before \{\s*content: " · ";/);
  });

  test('50.3 on very short screens only the extras are dropped, never the form', () => {
    const block = css.slice(css.indexOf('@media (max-height: 580px)'));
    const hidden = block.slice(0, block.indexOf('}')).match(/\.[\w-]+/g);
    assert.deepEqual(hidden.sort(), ['.auth-brand-badge', '.auth-card-header', '.auth-trust'].sort());
    assert.match(block, /\.auth-card-header p,/, 'only the welcome sentence of the header, not the heading');
  });
});
