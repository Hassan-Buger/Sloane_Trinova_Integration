/**
 * Unit 40 Test Suite: Front-end controls are wired up
 *
 * Verifies, by reading the front-end source:
 * - Every button or drop-down drawn by a page (data-action / data-change) points at a handler that exists
 * - Every create / change / delete the pages offer has a matching ApiService method and server route
 * - Deletes ask first using the shared confirm dialog (no native confirm() pop-ups are left)
 * - The shared dialogs exist in index.html, and the confirm dialog starts on "Cancel"
 * - All scripts are valid JavaScript, and the page loads each module only once
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { frontendSource } from './support.js';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = rel => fs.readFileSync(path.join(rootDir, rel), 'utf8');
const html = read('index.html');
const source = frontendSource();
const api = read('scripts/services/api.js');

function listScripts(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) listScripts(full, out);
    else if (e.name.endsWith('.js')) out.push(full);
  }
  return out;
}

describe('Unit 40: Front-end controls', () => {
  describe('1. Buttons point at real handlers', () => {
    const mixins = {};
    let actionNames = new Set();

    test('1.0 Load the feature modules', async () => {
      const t = await import('../../scripts/features/teamTasks.js');
      const d = await import('../../scripts/features/deadlines.js');
      const c = await import('../../scripts/features/clientDetail.js');
      const p = await import('../../scripts/features/privateNotes.js');
      const b = await import('../../scripts/features/bin.js');
      Object.assign(mixins, t.teamTaskMethods, d.deadlineMethods, c.clientDetailMethods, p.privateNoteMethods, b.binMethods);
      actionNames = new Set([...t.TEAM_TASK_ACTIONS, ...d.DEADLINE_ACTIONS, ...c.CLIENT_DETAIL_ACTIONS, ...p.PRIVATE_NOTE_ACTIONS, ...b.BIN_ACTIONS]);
      assert.ok(Object.keys(mixins).length > 40);
    });

    test('1.1 Every action named in the module lists exists as a method', () => {
      for (const name of actionNames) assert.equal(typeof mixins[name], 'function', `${name} must exist`);
    });

    test('1.2 Every data-action in the pages is a handler the app allows', () => {
      const appOnly = ['markTaskDone', 'openEditClient', 'openEditBiz', 'deleteBiz', 'deleteClient', 'selectClient360'];
      const allowedInApp = new Set([...actionNames, ...appOnly]);
      const used = new Set();
      for (const text of [source, html]) {
        for (const m of text.matchAll(/data-action="([A-Za-z0-9_]+)"/g)) used.add(m[1]);
      }
      assert.ok(used.size > 20, 'the pages use many actions');
      for (const name of used) assert.ok(allowedInApp.has(name), `data-action="${name}" has no allowed handler`);
      for (const name of appOnly) assert.match(read('scripts/app.js'), new RegExp(`\\b(async )?${name}\\(`), `${name} is defined in app.js`);
    });

    test('1.3 Every data-change in the pages is a handler the app allows and that exists', () => {
      const allowedChanges = read('scripts/app.js').match(/this\.changeNames = new Set\(\[([\s\S]*?)\]\)/)[1];
      const used = new Set();
      for (const m of source.matchAll(/data-change="([A-Za-z0-9_]+)"/g)) used.add(m[1]);
      assert.ok(used.size >= 4);
      for (const name of used) {
        assert.ok(allowedChanges.includes(`'${name}'`), `data-change="${name}" is not in changeNames`);
        assert.ok(typeof mixins[name] === 'function' || new RegExp(`\\b${name}\\(`).test(read('scripts/app.js')), `${name} exists`);
      }
    });

    test('1.4 The click handler runs first, so a button inside a clickable table row only does its own job', () => {
      const app = read('scripts/app.js');
      assert.match(app, /e\.stopPropagation\(\);[\s\S]*?\}, true\);/);
    });
  });

  describe('2. Every create / change / delete has an API method', () => {
    const wanted = [
      'createTask', 'updateTask', 'deleteTask', 'completeTask',
      'getTeam', 'createTeamMember', 'updateTeamMember', 'deleteTeamMember',
      'createDeadline', 'updateDeadline', 'deleteDeadline',
      'getVatReturns', 'createVatReturn', 'updateVatReturn', 'deleteVatReturn',
      'createClient', 'updateClient', 'deleteClient', 'setClientBusiness',
      'createBusiness', 'updateBusiness', 'deleteBusiness',
      'sendNoteToTrinova', 'updateCompanyNote', 'deleteCompanyNote',
      'createTimelineEvent', 'updateTimelineEvent', 'deleteTimelineEvent',
      'uploadDocument', 'updateDocument', 'deleteDocument', 'getDocumentAccessToken',
      'createSigningRequest', 'cancelSigningRequest',
      'getPrivateNotes', 'createPrivateNote', 'updatePrivateNote', 'deletePrivateNote', 'importPrivateNotes',
      'getSystemStatus'
    ];
    for (const name of wanted) {
      test(`2.x ApiService.${name} exists`, () => {
        assert.match(api, new RegExp(`async\\s+${name}\\s*\\(`));
      });
    }

    test('2.y Nothing pretends to save when the server refused (no local fake records)', () => {
      assert.doesNotMatch(api, /falling back to local storage cache/i);
      assert.doesNotMatch(api, /Annual_Accounts_Draft_2026\.pdf/, 'no made-up document on error');
      assert.doesNotMatch(api, /will sync when online/);
    });

    test('2.z The download link uses the real server route', () => {
      assert.match(api, /\/documents\/\$\{encodeURIComponent\(documentId\)\}\/download-token/);
    });
  });

  describe('3. Deletes ask first', () => {
    test('3.1 No native confirm() or alert() pop-ups remain', () => {
      for (const file of listScripts(path.join(rootDir, 'scripts'))) {
        // ignore comments
        const text = fs.readFileSync(file, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1');
        assert.doesNotMatch(text, /(^|[^.\w])confirm\(/m, `${path.relative(rootDir, file)} uses a native confirm()`);
        assert.doesNotMatch(text, /(^|[^.\w])alert\(/m, `${path.relative(rootDir, file)} uses a native alert()`);
      }
    });

    test('3.2 Each delete handler asks with the shared confirm dialog', () => {
      for (const name of ['deleteTask', 'deleteTeamMember', 'deleteDeadline', 'deleteVatReturn', 'deleteDocument', 'deleteNote', 'deleteHistoryEntry', 'deleteBrainEntry', 'deleteClient', 'deleteBiz', 'cancelSigningRequest']) {
        const m = source.match(new RegExp(`async ${name}\\([^)]*\\) \\{([\\s\\S]*?)\\n  \\}`));
        assert.ok(m, `${name} found`);
        assert.match(m[1], /ConfirmDialog\.ask\(/, `${name} must ask first`);
        assert.match(m[1], /Toast\.success\(/, `${name} must show a success toast`);
      }
    });

    test('3.3 The confirm dialog starts on Cancel, so Enter never deletes anything', () => {
      assert.match(read('scripts/components/formModal.js'), /confirmModalCancel'\)\.focus\(\)/);
    });
  });

  describe('4. Shared dialogs and page structure', () => {
    test('4.1 index.html has the shared form and confirm dialogs', () => {
      for (const id of ['formModal', 'formModalForm', 'formModalFields', 'formModalError', 'formModalSubmit', 'confirmModal', 'confirmModalOk', 'confirmModalCancel']) {
        assert.match(html, new RegExp(`id="${id}"`), `${id} missing`);
      }
    });

    test('4.2 The pages have their add buttons', () => {
      for (const id of ['openAddTaskBtn', 'openAddMemberBtn', 'openAddDeadlineBtn', 'openAddVatBtn', 'openAddClientBtn', 'openAddBizBtn']) {
        assert.match(html, new RegExp(`id="${id}"`), `${id} missing`);
      }
    });

    test('4.3 The client page has a Tasks tab and a TriNova status banner', () => {
      assert.match(html, /data-client-tab="tasks"/);
      assert.match(html, /id="clientTabContent-tasks"/);
      assert.match(html, /id="clientTrinovaBanner"/);
      assert.match(read('styles/layout.css'), /\.client-tab-content\.hidden\s*\{\s*display:\s*none/);
    });

    test('4.4 Settings shows plain facts about how Sloane is set up', () => {
      assert.match(html, /id="systemStatusCard"/);
      assert.match(source, /Your information is saved/);
      assert.match(source, /Your information is NOT being saved/);
    });

    test('4.5 Signing says honestly that nothing is sent', () => {
      assert.match(source, /does not send anything to the signers yet/);
    });

    test('4.6 The page loads the app module only once (no second copy under another address)', () => {
      for (const file of listScripts(path.join(rootDir, 'scripts'))) {
        if (file.endsWith(`${path.sep}scripts${path.sep}app.js`)) continue;
        assert.doesNotMatch(fs.readFileSync(file, 'utf8'), /from\s+['"](\.\.?\/)+app\.js['"]/, `${path.relative(rootDir, file)} imports app.js`);
      }
    });

    test('4.7 Scripts and styles are re-checked on every load, so an update reaches everyone', () => {
      const appServer = read('server/src/app.js');
      assert.match(appServer, /revalidate/);
      assert.match(appServer, /'Cache-Control': revalidate \? 'no-cache'/);
    });
  });

  describe('4b. Walkthrough fixes', () => {
    test('4b.1 The menu always opens the list of clients (Overview), not the last client tab', () => {
      assert.match(read('scripts/app.js'), /if \(viewId === 'clients'\) this\.switchClientTab\('overview'\);/);
    });

    test('4b.2 The page has an icon, so every load does not log a 404', () => {
      assert.match(html, /<link rel="icon" href="data:image\/svg\+xml/);
    });

    test('4b.3 "Refresh from TriNova" forces a fresh read and tells the truth about the result', () => {
      assert.match(api, /filters\.refresh/);
      const app = read('scripts/app.js');
      assert.match(app, /refresh: true/);
      assert.match(app, /Sloane could not reach TriNova just now\. Showing/);
      assert.match(app, /TriNova is not set up yet, so only the/);
    });

    test('4b.4 Counts read correctly: "1 entry" not "1 events", and the client count is live', () => {
      assert.match(read('scripts/app.js'), /events\.length === 1 \? 'entry' : 'entries'/);
      assert.doesNotMatch(html, /clientTimelineCountBadge[^>]*>Live</);
      assert.match(read('scripts/app.js'), /clientCountMeta/);
    });

    test('4b.5 Notes moved from the browser keep their original dates', async () => {
      const { parseBrowserDate } = await import('../../scripts/features/privateNotes.js');
      const iso = parseBrowserDate('24/10/2026, 12:42:10');
      assert.equal(new Date(iso).getDate(), 24);
      assert.equal(new Date(iso).getMonth(), 9);           // October: day comes first
      assert.equal(new Date(iso).getFullYear(), 2026);
      assert.equal(new Date(iso).getHours(), 12);
      assert.equal(parseBrowserDate('2026-03-04T10:00:00.000Z'), '2026-03-04T10:00:00.000Z');
      assert.equal(parseBrowserDate('not a date'), null);
      assert.equal(parseBrowserDate(undefined), null);
      assert.match(read('scripts/features/privateNotes.js'), /createdAt: e\.createdAt \|\| parseBrowserDate\(e\.at\)/);
    });

    test('4b.7 The sign-in form never flashes up while Sloane checks you are already signed in', () => {
      assert.match(html, /<body class="session-check">/);
      assert.match(read('styles/auth.css'), /\.session-check \.auth-shell[\s\S]*?visibility: hidden/);
      const app = read('scripts/app.js');
      assert.equal((app.match(/classList\.remove\('session-check'\)/g) || []).length, 2, 'cleared when showing the sign-in page or the dashboard');
      assert.match(html, /setTimeout\(function \(\) \{ document\.body\.classList\.remove\("session-check"\)/, 'never stays blank');
    });

    test('4b.8 The message from the Outlook button is kept until the dashboard is up, then shown on Settings', () => {
      const settings = read('scripts/components/outlookSettings.js');
      const start = settings.indexOf('  init() {');
      const init = settings.slice(start, settings.indexOf('\n  },', start));
      assert.ok(start > 0 && init.length > 20);
      assert.ok(!init.includes('this.checkUrlParams()'), 'init must not clear the URL message before the app is ready');
      const app = read('scripts/app.js');
      assert.ok(app.includes("window.location.search.includes('outlook_error=')"), 'read after the dashboard is up');
      assert.ok(app.includes('outlook(_error)?='), 'and also after signing in');
    });

    test('4b.6 On a phone the question box wraps and messages never block the button under them', () => {
      assert.match(read('styles/layout.css'), /@media \(max-width: 600px\)[\s\S]*?\.ask-form[\s\S]*?flex-wrap: wrap/);
      assert.match(read('styles/components.css'), /\.toast \{[\s\S]*?pointer-events: none/);
    });
  });

  describe('5. Every script is valid JavaScript', () => {
    for (const file of listScripts(path.join(rootDir, 'scripts'))) {
      test(`5.x ${path.relative(rootDir, file).replace(/\\/g, '/')}`, () => {
        execFileSync(process.execPath, ['--check', file], { stdio: 'pipe' });
      });
    }
  });
});
