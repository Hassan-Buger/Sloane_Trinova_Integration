/**
 * Unit 65 Test Suite: Settings is split into tabs
 *
 * Settings used to be one long page of cards. Verifies:
 * - there are five tabs (Overview, Connections, Alerts & automation, Security, Your data), each with its pane
 * - every settings card sits in exactly one pane, in the group where it belongs, and none is lost
 * - only the Overview pane is shown to start with; the Outlook message banner stays above the panes
 * - the tab buttons use an allowed action that exists, and opening Settings restores the last tab
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { SETTINGS_TABS, SETTINGS_TAB_ACTIONS, settingsTabMethods } from '../../scripts/features/settingsTabs.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const app = fs.readFileSync(path.join(root, 'scripts/app.js'), 'utf8');

const start = html.indexOf('<section class="view hidden" id="view-settings">');
const settings = html.slice(start, html.indexOf('</section>', start));

/** The text of one pane (they are not nested, so the next pane or the end of the page ends it). */
function pane(name) {
  const a = settings.indexOf(`data-pane="${name}"`);
  const rest = settings.slice(a + 1);
  const next = rest.search(/<div class="settings-pane/);
  return settings.slice(a, next === -1 ? undefined : a + 1 + next);
}

describe('Unit 65: Settings tabs', () => {
  test('65.1 five tabs, each with a pane', () => {
    assert.deepEqual(SETTINGS_TABS, ['overview', 'connections', 'alerts', 'security', 'data']);
    for (const t of SETTINGS_TABS) {
      assert.match(settings, new RegExp(`data-action="selectSettingsTab" data-id="${t}"`), `tab ${t}`);
      assert.match(settings, new RegExp(`data-pane="${t}"`), `pane ${t}`);
    }
    assert.equal((settings.match(/class="settings-tab[ "]/g) || []).length, 5);
  });

  test('65.2 every card is in the right pane, once', () => {
    const where = {
      overview: ['systemStatusCard'],
      connections: ['trinovaSyncCard', 'outlookSettingsCard'],
      alerts: ['alertsCard', 'automationCard'],
      security: ['securityCard'],
      data: ['yourDataCard']
    };
    for (const [name, ids] of Object.entries(where)) {
      const text = pane(name);
      for (const id of ids) assert.ok(text.includes(`id="${id}"`), `${id} is in the ${name} pane`);
    }
    for (const id of Object.values(where).flat()) {
      assert.equal((settings.match(new RegExp(`id="${id}"`, 'g')) || []).length, 1, `${id} appears once`);
    }
  });

  test('65.3 only Overview shows first, and the Outlook banner is above the panes', () => {
    assert.doesNotMatch(settings, /class="settings-pane hidden" data-pane="overview"/);
    for (const t of ['connections', 'alerts', 'security', 'data']) assert.match(settings, new RegExp(`class="settings-pane hidden" data-pane="${t}"`));
    assert.ok(settings.indexOf('id="outlookAlertBanner"') < settings.indexOf('data-pane="overview"'));
  });

  test('65.4 the tab action is allowed and exists; opening Settings restores the last tab', () => {
    assert.deepEqual(SETTINGS_TAB_ACTIONS, ['selectSettingsTab']);
    assert.equal(typeof settingsTabMethods.selectSettingsTab, 'function');
    assert.match(app, /SETTINGS_TAB_ACTIONS/);
    assert.match(app, /if \(viewId === 'settings'\) \{\s*this\.openSavedSettingsTab\(\);/);
  });
});
