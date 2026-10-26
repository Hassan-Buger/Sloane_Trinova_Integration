/**
 * Unit 31 Test Suite: Client Control (edit / remove / tick off) & Plain-English Wording
 *
 * Verifies:
 * - Business areas can be renamed, edited and removed (PATCH / DELETE /api/v1/businesses/:id)
 * - Clients added by hand can be edited and listed; TriNova clients are never silently "removed"
 * - New clients no longer get invented email addresses or invented deadlines
 * - The Today page reads Outlook's `items` list (the server's real response shape)
 * - The statutory counts are no longer lost between server and screen
 * - Menu counters are not hard-coded, and sample data is labelled as sample data
 * - Menu and page wording is plain English
 */

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { frontendSource } from './support.js';

import { createApp } from '../src/app.js';
import { mockDb } from '../src/data/db.js';
import { TEST_API_KEY, TEST_READONLY_KEY } from './fixtures.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '../..');
const read = rel => fs.readFileSync(path.join(rootDir, rel), 'utf8');

const PORT = 5031;
const auth = { Authorization: `Bearer ${TEST_API_KEY}`, 'Content-Type': 'application/json' };

describe('Unit 31: Client control & plain-English wording', () => {
  let server;
  let baseUrl;

  before(async () => {
    const app = createApp();
    await new Promise(resolve => {
      server = app.listen(PORT, () => {
        baseUrl = `http://localhost:${PORT}`;
        resolve();
      });
    });
  });

  after(async () => {
    if (server) await new Promise(resolve => server.close(resolve));
  });

  describe('1. Business areas: edit and remove', () => {
    let bizId;

    test('1.1 A new business can be renamed and its category changed', async () => {
      const created = await (await fetch(`${baseUrl}/api/v1/businesses`, {
        method: 'POST', headers: auth, body: JSON.stringify({ name: 'Unit31 Original', type: 'Testing' })
      })).json();
      bizId = created.data.id;

      const res = await fetch(`${baseUrl}/api/v1/businesses/${bizId}`, {
        method: 'PATCH', headers: auth, body: JSON.stringify({ name: 'Unit31 Renamed', type: 'Changed' })
      });
      assert.equal(res.status, 200);
      const body = await res.json();
      assert.equal(body.data.name, 'Unit31 Renamed');
      assert.equal(body.data.type, 'Changed');
    });

    test('1.2 Renaming to a name that already exists is refused (409)', async () => {
      const res = await fetch(`${baseUrl}/api/v1/businesses/${bizId}`, {
        method: 'PATCH', headers: auth, body: JSON.stringify({ name: 'TriNova Accounting' })
      });
      assert.equal(res.status, 409);
    });

    test('1.3 An empty name is refused (400)', async () => {
      const res = await fetch(`${baseUrl}/api/v1/businesses/${bizId}`, {
        method: 'PATCH', headers: auth, body: JSON.stringify({ name: '   ' })
      });
      assert.equal(res.status, 400);
    });

    test('1.4 A read-only key cannot edit or remove (403)', async () => {
      const ro = { Authorization: `Bearer ${TEST_READONLY_KEY}`, 'Content-Type': 'application/json' };
      const patch = await fetch(`${baseUrl}/api/v1/businesses/${bizId}`, { method: 'PATCH', headers: ro, body: '{"name":"x"}' });
      const del = await fetch(`${baseUrl}/api/v1/businesses/${bizId}`, { method: 'DELETE', headers: ro });
      assert.equal(patch.status, 403);
      assert.equal(del.status, 403);
    });

    test('1.5 A business that still has clients cannot be removed (409, plain message)', async () => {
      const used = mockDb.businesses.find(b => b.name === 'TriNova Accounting');
      const res = await fetch(`${baseUrl}/api/v1/businesses/${used.id}`, { method: 'DELETE', headers: auth });
      assert.equal(res.status, 409);
      const body = await res.json();
      assert.equal(body.error.code, 'BUSINESS_AREA_IN_USE');
      assert.match(body.error.message, /still has \d+ client/);
    });

    test('1.6 An empty business can be removed, and a second removal is a 404', async () => {
      const res = await fetch(`${baseUrl}/api/v1/businesses/${bizId}`, { method: 'DELETE', headers: auth });
      assert.equal(res.status, 200);
      assert.ok(!mockDb.businesses.some(b => b.id === bizId));
      const again = await fetch(`${baseUrl}/api/v1/businesses/${bizId}`, { method: 'DELETE', headers: auth });
      assert.equal(again.status, 404);
    });
  });

  describe('2. Clients: add, edit, and honest removal', () => {
    let clientId;

    test('2.1 A new client is flagged as added in Sloane and gets no invented data', async () => {
      const res = await fetch(`${baseUrl}/api/v1/clients`, {
        method: 'POST', headers: auth,
        body: JSON.stringify({ name: 'Unit31 Client Ltd', biz: 'TriNova Accounting', dirs: 'Jane Example' })
      });
      assert.equal(res.status, 201);
      const body = await res.json();
      clientId = body.data.id;
      assert.equal(body.data.addedInSloane, true);
      assert.equal(body.data.contacts[0].email, null, 'No made-up email address');
      const company = body.data.companies[0];
      assert.equal(company.accountsDueDate, null, 'No made-up accounts deadline');
      assert.equal(company.confirmationDueDate, null, 'No made-up confirmation deadline');
    });

    test('2.2 A client added in Sloane can be edited', async () => {
      const res = await fetch(`${baseUrl}/api/v1/clients/${clientId}`, {
        method: 'PATCH', headers: auth,
        body: JSON.stringify({ name: 'Unit31 Client Renamed Ltd', risk: 'High', notes: 'Call on Monday', accounts: '2027-01-31' })
      });
      assert.equal(res.status, 200);
      const body = await res.json();
      assert.equal(body.data.name, 'Unit31 Client Renamed Ltd');
      assert.equal(body.data.risk_tier, 'High');
      assert.equal(body.data.notes, 'Call on Monday');
      assert.equal(body.data.accounts_due, '2027-01-31');
    });

    test('2.3 A client that comes from TriNova (not added in Sloane) cannot be edited here (409)', async () => {
      const seeded = mockDb.clients.find(c => !c.addedInSloane);
      const res = await fetch(`${baseUrl}/api/v1/clients/${seeded.id}`, {
        method: 'PATCH', headers: auth, body: JSON.stringify({ name: 'Hijack' })
      });
      assert.equal(res.status, 409);
      const body = await res.json();
      assert.equal(body.error.code, 'MANAGED_IN_TRINOVA');
    });

    test('2.4 Removing a client that Sloane does not hold is refused instead of pretending (409)', async () => {
      const res = await fetch(`${baseUrl}/api/v1/clients/cli_not_in_sloane`, { method: 'DELETE', headers: auth });
      assert.equal(res.status, 409);
      assert.equal((await res.json()).error.code, 'MANAGED_IN_TRINOVA');
    });

    test('2.5 A client added in Sloane can be removed', async () => {
      const res = await fetch(`${baseUrl}/api/v1/clients/${clientId}`, { method: 'DELETE', headers: auth });
      assert.equal(res.status, 200);
      assert.ok(!mockDb.clients.some(c => c.id === clientId));
    });
  });

  describe('3. Sample data is labelled', () => {
    test('3.1 /tasks and /statutory say their data is sample data', async () => {
      const tasks = await (await fetch(`${baseUrl}/api/v1/tasks`, { headers: auth })).json();
      const statutory = await (await fetch(`${baseUrl}/api/v1/statutory`, { headers: auth })).json();
      assert.equal(tasks.meta.dataSource, 'sample');
      assert.equal(statutory.meta.dataSource, 'sample');
    });
  });

  describe('4. Frontend: Today page reads what the server really sends', () => {
    const appJs = frontendSource();
    const apiJs = read('scripts/services/api.js');

    test('4.1 Diary and flagged emails read the `items` list (the server response shape)', () => {
      assert.match(appJs, /diaryData\?\.items/, 'diary reads items');
      assert.match(appJs, /emailsData\?\.items/, 'emails read items');
    });

    test('4.2 A connected Outlook with nothing to show says so, instead of "Connect your Outlook"', () => {
      assert.match(appJs, /No meetings in your calendar today/);
      assert.match(appJs, /No flagged emails\. You are up to date/);
    });

    test('4.3 ApiService passes the response meta through for statutory and tasks', () => {
      const stat = apiJs.match(/async getStatutory[\s\S]*?\n  },/)[0];
      const tasks = apiJs.match(/async getTasks[\s\S]*?\n  },/)[0];
      assert.match(stat, /meta: res\.meta/);
      assert.match(tasks, /meta: res\.meta/);
    });

    test('4.4 ApiService no longer invents deadlines for clients that have none', () => {
      assert.doesNotMatch(apiJs, /'2026-08-31'|'2026-09-15'|'2026-03-31'/);
    });

    test('4.5 ApiService exposes edit / remove / tick-off calls', () => {
      for (const fn of ['updateClient', 'updateBusiness', 'deleteBusiness', 'updateTask', 'completeTask']) {
        assert.match(apiJs, new RegExp(`async ${fn}\\(`), `${fn} exists`);
      }
    });

    test('4.6 The app wires up edit / remove / tick-off handlers', () => {
      for (const fn of ['openEditClient', 'openEditBiz', 'deleteBiz', 'markTaskDone', 'changeTaskStatus', 'startBrainEdit', 'saveBrainEdit', 'deleteBrainEntry']) {
        assert.match(appJs, new RegExp(`\\b${fn}\\(`), `${fn} exists`);
      }
    });

    test('4.7 Finished tasks are hidden from the "waiting for your OK" list', () => {
      assert.match(appJs, /!\['Completed', 'Cancelled'\]\.includes\(t\.status\)/);
    });

    test('4.8 "Needs action now" uses the RED urgency the server actually sends', () => {
      assert.match(appJs, /s\.urgency === 'RED'/);
    });

    test('4.9 No made-up people, roles or CEO notes are hard-coded any more', () => {
      assert.doesNotMatch(appJs, /Senior Client Manager \/ Partner/);
      assert.doesNotMatch(appJs, /Agreed to follow up personally/);
      assert.doesNotMatch(appJs, /Relationship Silence Radar/);
      assert.doesNotMatch(appJs, /Awaiting live AI classification/);
    });

    test('4.10 CEO Brain no longer starts with invented private notes', () => {
      const storage = read('scripts/services/storage.js');
      assert.doesNotMatch(storage, /b-init-1|bonus structure|Sarah Jenkins promised/);
    });
  });

  describe('5. Plain-English wording', () => {
    const html = read('index.html');
    const navLabels = ['Today', 'My Businesses', 'Clients', 'Team &amp; Tasks|Team & Tasks', 'Deadlines', 'Warnings', 'My Private Notes', 'Settings'];

    test('5.1 The menu uses everyday words', () => {
      for (const label of navLabels) {
        assert.match(html, new RegExp(`<span>(${label})</span>`), `menu shows ${label}`);
      }
    });

    test('5.2 Menu counters are not hard-coded numbers', () => {
      assert.doesNotMatch(html, /<span class="nav-badge[^"]*">\d+<\/span>/);
    });

    test('5.3 The jargon the client could not follow is gone from screen text', () => {
      for (const jargon of ['Statutory Urgency Engine', 'Executive Intelligence Radar', 'Run Live Sync', 'Safety-Net Scan', 'Need PIN reset', 'Idempotency', 'Reconciliation']) {
        assert.ok(!html.includes(jargon), `"${jargon}" removed`);
      }
    });

    test('5.4 The sample-data notice exists on the pages that use sample data', () => {
      assert.ok((html.match(/data-sample-banner/g) || []).length >= 4);
      assert.match(html, /Example data/);
    });

    test('5.5 The Outlook panels tell the user plainly that Sloane only reads, with a link to the controls', () => {
      assert.match(html, /Sloane only reads\. It never sends, deletes or changes anything\./);
      assert.match(html, /data-goto-settings/);
    });
  });
});
