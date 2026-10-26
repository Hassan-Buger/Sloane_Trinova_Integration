/**
 * Unit 54 Test Suite: the owner's four businesses, and the richer task
 *
 * Verifies:
 * - The one-time fix-up of the business list: original six unused -> the four; changed or in use
 *   -> only Emerald Education is added; it runs once
 * - A task can carry a business, department, next action, what it waits for, related links
 *   (email / document / Teams) and how often it repeats; bad input is refused in plain words
 * - The business follows the client unless one is chosen, and tasks can be filtered by business
 * - Waiting for another task cannot loop; links must be web addresses
 * - Progress notes are only ever added, with who and when
 * - A repeating task makes the next one when it is finished (by "Done" or by changing the status),
 *   once only, with the date one step on and never in the past
 */

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

import { createApp } from '../src/app.js';
import { mockDb, DEFAULT_BUSINESSES } from '../src/data/db.js';
import { migrateBusinesses } from '../src/services/businessMigration.js';
import { nextRepeatDate, addMonthsIso, guessLinkKind } from '../src/routes/tasks.js';
import { ukToday } from '../src/services/weeklyReport.js';
import { TEST_API_KEY } from './fixtures.js';

const PORT = 5054;
const auth = { Authorization: `Bearer ${TEST_API_KEY}`, 'Content-Type': 'application/json' };
const today = ukToday();
const plus = n => new Date(Date.parse(`${today}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10);

const OLD_SIX = () => [
  { id: 'biz-1', name: 'Trinova Accounting', type: 'Accountancy & Tax', status: 'Active' },
  { id: 'biz-2', name: 'CFI Awarding', type: 'Awarding Organisation', status: 'Active' },
  { id: 'biz-3', name: 'The Thinking Tent / Yellow Brick', type: 'Consultancy & Design', status: 'Active' },
  { id: 'biz-4', name: 'MTDflow', type: 'Fintech / SaaS', status: 'Active' },
  { id: 'biz-5', name: 'Meta Digital Accounting', type: 'Digital Accounting', status: 'Active' },
  { id: 'biz-6', name: 'Other ventures & property', type: 'Holdings & Investments', status: 'Active' }
];

describe('Unit 54: four businesses and richer tasks', () => {
  describe('1. The one-time fix-up of the business list', () => {
    let saved;
    before(() => {
      saved = { businesses: [...mockDb.businesses], appMeta: [...(mockDb.appMeta || [])], clients: [...mockDb.clients], clientBusiness: [...(mockDb.clientBusiness || [])], tasks: [...mockDb.tasks] };
    });
    after(() => {
      for (const k of Object.keys(saved)) { mockDb[k] = mockDb[k] || []; mockDb[k].length = 0; mockDb[k].push(...saved[k]); }
    });
    const reset = () => {
      mockDb.appMeta = [];
      mockDb.clients.length = 0;
      mockDb.tasks.length = 0;
      mockDb.clientBusiness = [];
    };

    test('1.1 new installs start with the four businesses', () => {
      assert.deepEqual(DEFAULT_BUSINESSES.map(b => b.name), ['TriNova Accounting', 'CFI Awarding', 'Emerald Education', 'MTDflow']);
    });

    test('1.2 the original six, with nothing using the extras, become the four (and TriNova is renamed everywhere)', () => {
      reset();
      mockDb.businesses.length = 0;
      mockDb.businesses.push(...OLD_SIX());
      mockDb.clients.push({ id: 'c1', name: 'Uses TriNova', businessArea: 'Trinova Accounting' });
      mockDb.clientBusiness.push({ id: 'live-1', businessArea: 'Trinova Accounting' });
      assert.equal(migrateBusinesses(), 'replaced');
      assert.deepEqual(mockDb.businesses.map(b => b.name), ['TriNova Accounting', 'CFI Awarding', 'Emerald Education', 'MTDflow']);
      assert.equal(mockDb.clients[0].businessArea, 'TriNova Accounting');
      assert.equal(mockDb.clientBusiness[0].businessArea, 'TriNova Accounting');
    });

    test('1.3 it only ever runs once', () => {
      assert.equal(migrateBusinesses(), 'already-done');
      assert.equal(mockDb.businesses.length, 4);
    });

    test('1.4 if one of the extra businesses is in use, nothing is removed: only Emerald Education is added', () => {
      reset();
      mockDb.businesses.length = 0;
      mockDb.businesses.push(...OLD_SIX());
      mockDb.clients.push({ id: 'c2', name: 'Uses Meta', businessArea: 'Meta Digital Accounting' });
      assert.equal(migrateBusinesses(), 'added');
      assert.equal(mockDb.businesses.length, 7);
      assert.ok(mockDb.businesses.some(b => b.name === 'Emerald Education'));
      assert.ok(mockDb.businesses.some(b => b.name === 'Meta Digital Accounting'));
    });

    test('1.5 a list the owner has already changed gets only the missing Emerald Education; one that has it is left alone', () => {
      reset();
      mockDb.businesses.length = 0;
      mockDb.businesses.push({ id: 'b-a', name: 'My Own Thing', type: 'x', status: 'Active' });
      assert.equal(migrateBusinesses(), 'added');
      assert.deepEqual(mockDb.businesses.map(b => b.name), ['My Own Thing', 'Emerald Education']);
      reset();
      mockDb.businesses.length = 0;
      mockDb.businesses.push({ id: 'b-e', name: 'emerald education', type: 'x', status: 'Active' });
      assert.equal(migrateBusinesses(), 'unchanged');
      assert.equal(mockDb.businesses.length, 1);
    });
  });

  describe('2. Dates for repeating work', () => {
    test('2.1 one step on, never in the past', () => {
      assert.equal(addMonthsIso('2026-01-31', 1), '2026-02-28', 'end of a shorter month');
      assert.equal(addMonthsIso('2028-01-31', 1), '2028-02-29', 'leap year');
      assert.equal(addMonthsIso('2026-11-15', 3), '2027-02-15', 'across the new year');
      assert.equal(addMonthsIso('2028-02-29', 12), '2029-02-28');
      assert.equal(nextRepeatDate('2026-10-01', 'weekly', '2026-10-01'), '2026-10-08');
      assert.equal(nextRepeatDate('2026-10-01', 'monthly', '2026-10-01'), '2026-11-01');
      assert.equal(nextRepeatDate('2026-10-01', 'quarterly', '2026-10-01'), '2027-01-01');
      assert.equal(nextRepeatDate('2026-10-01', 'yearly', '2026-10-01'), '2027-10-01');
      // Finished very late: the next one is the first date on the pattern that is not already past
      assert.equal(nextRepeatDate('2026-08-01', 'monthly', '2026-10-20'), '2026-11-01');
      assert.equal(nextRepeatDate(null, 'weekly', '2026-10-20'), '2026-10-27', 'no old date: from today');
    });

    test('2.2 links are told apart by where they point', () => {
      const kind = u => guessLinkKind(new URL(u));
      assert.equal(kind('https://teams.microsoft.com/l/message/123'), 'teams');
      assert.equal(kind('https://outlook.office.com/mail/id/abc'), 'email');
      assert.equal(kind('https://trinova.sharepoint.com/sites/x/doc.docx'), 'document');
      assert.equal(kind('https://example.com/page'), 'other');
    });
  });

  describe('3. Over HTTP', () => {
    let server;
    let baseUrl;
    let savedTasks;
    const call = async (method, p, body) => {
      const res = await fetch(`${baseUrl}/api/v1${p}`, {
        method,
        headers: method === 'POST' && p === '/tasks' ? { ...auth, 'Idempotency-Key': randomUUID() } : auth,
        body: body ? JSON.stringify(body) : undefined
      });
      return { status: res.status, body: await res.json() };
    };
    const make = async (extra = {}) => (await call('POST', '/tasks', { title: 'T', general: true, ...extra })).body.data;

    before(async () => {
      savedTasks = [...mockDb.tasks];
      mockDb.tasks.length = 0;
      mockDb.businesses.length = 0;
      mockDb.businesses.push(...DEFAULT_BUSINESSES.map(b => ({ ...b })));
      mockDb.clients.push({ id: 'cli_54', name: 'Business Client Ltd', businessArea: 'CFI Awarding', addedInSloane: true, companyIds: ['comp_54'] });
      mockDb.companies.push({ id: 'comp_54', clientId: 'cli_54', companyName: 'Business Client Ltd', companyNumber: '54000001' });
      const app = createApp();
      await new Promise(resolve => { server = app.listen(PORT, () => { baseUrl = `http://localhost:${PORT}`; resolve(); }); });
    });
    after(async () => {
      mockDb.tasks.length = 0;
      mockDb.tasks.push(...savedTasks);
      mockDb.clients.splice(mockDb.clients.findIndex(c => c.id === 'cli_54'), 1);
      mockDb.companies.splice(mockDb.companies.findIndex(c => c.id === 'comp_54'), 1);
      if (server) await new Promise(resolve => server.close(resolve));
    });

    test('3.1 a task carries business, department, next action, repeat, waiting-for and links', async () => {
      const blocker = await make({ title: 'Get the bank statements' });
      const res = await call('POST', '/tasks', {
        title: 'Prepare the accounts', general: true,
        businessArea: 'emerald education', department: 'Accounts', nextAction: 'Ask Priya for the statements',
        repeat: 'monthly', dependsOn: [blocker.id],
        links: [
          { label: 'Their email', url: 'https://outlook.office.com/mail/id/abc' },
          { url: 'https://teams.microsoft.com/l/message/42' },
          { label: 'Engagement letter', url: 'https://trinova.sharepoint.com/sites/x/letter.docx', kind: 'document' }
        ]
      });
      assert.equal(res.status, 201);
      const t = res.body.data;
      assert.equal(t.businessArea, 'Emerald Education', 'matched to the business, whatever the capitals');
      assert.equal(t.department, 'Accounts');
      assert.equal(t.nextAction, 'Ask Priya for the statements');
      assert.equal(t.repeat, 'monthly');
      assert.deepEqual(t.dependsOn, [blocker.id]);
      assert.deepEqual(t.links.map(l => [l.kind, l.label]), [['email', 'Their email'], ['teams', 'teams.microsoft.com'], ['document', 'Engagement letter']]);
      assert.deepEqual(t.progressNotes, []);
    });

    test('3.2 the business follows the client unless one is chosen; tasks can be filtered by business', async () => {
      const follows = await make({ title: 'For the CFI client', general: undefined, clientId: 'cli_54' });
      assert.equal(follows.businessArea, 'CFI Awarding');
      const chosen = await make({ title: 'Chosen business', clientId: 'cli_54', businessArea: 'MTDflow' });
      assert.equal(chosen.businessArea, 'MTDflow');
      const cfi = (await call('GET', '/tasks?business=CFI%20Awarding')).body.data;
      assert.deepEqual(cfi.map(t => t.title), ['For the CFI client']);
      const all = (await call('GET', '/tasks')).body.data;
      assert.ok(all.length >= 4);
      assert.equal((await call('GET', '/tasks?business=All')).body.data.length, all.length);
      // An old task made before businesses existed still shows its client's business
      mockDb.tasks.push({ id: 'old_1', title: 'Old task', status: 'Pending', clientId: 'cli_54', companyId: 'comp_54' });
      assert.equal((await call('GET', '/tasks/old_1')).body.data.businessArea, 'CFI Awarding');
      mockDb.tasks.splice(mockDb.tasks.findIndex(t => t.id === 'old_1'), 1);
    });

    test('3.3 bad input is refused in plain words and nothing is made', async () => {
      const count = mockDb.tasks.length;
      const cases = [
        [{ businessArea: 'Nonexistent Co' }, /not on your list/],
        [{ repeat: 'daily' }, /must be one of/],
        [{ links: [{ url: 'javascript:alert(1)' }] }, /web address that starts with http/],
        [{ links: [{ url: 'not a url' }] }, /web address/],
        [{ dependsOn: ['nope'] }, /no longer exists/],
        [{ department: 'x'.repeat(81) }, /up to 80/],
        [{ nextAction: 'x'.repeat(301) }, /up to 300/]
      ];
      for (const [extra, message] of cases) {
        const res = await call('POST', '/tasks', { title: 'Bad', general: true, ...extra });
        assert.equal(res.status, 422, JSON.stringify(extra));
        assert.match(res.body.error.message, message);
      }
      assert.equal(mockDb.tasks.length, count);
    });

    test('3.4 waiting for another task cannot loop', async () => {
      const a = await make({ title: 'A' });
      const b = await make({ title: 'B', dependsOn: [a.id] });
      const self = await call('PATCH', `/tasks/${a.id}`, { dependsOn: [a.id] });
      assert.equal(self.status, 422);
      assert.match(self.body.error.message, /cannot wait for itself/);
      const loop = await call('PATCH', `/tasks/${a.id}`, { dependsOn: [b.id] });
      assert.equal(loop.status, 422);
      assert.match(loop.body.error.message, /wait for each other/);
      const fine = await call('PATCH', `/tasks/${b.id}`, { dependsOn: [] });
      assert.equal(fine.status, 200);
      assert.deepEqual(fine.body.data.dependsOn, []);
    });

    test('3.5 progress notes are added with who and when, never edited away', async () => {
      const t = await make({ title: 'Needs notes' });
      const res = await call('POST', `/tasks/${t.id}/notes`, { text: 'Rang the client; records arrive Friday.' });
      assert.equal(res.status, 201);
      const note = res.body.data.progressNotes[0];
      assert.equal(note.text, 'Rang the client; records arrive Friday.');
      assert.ok(note.by && note.at && note.id);
      await call('POST', `/tasks/${t.id}/notes`, { text: 'Records arrived.' });
      const after = (await call('GET', `/tasks/${t.id}`)).body.data;
      assert.deepEqual(after.progressNotes.map(n => n.text), ['Rang the client; records arrive Friday.', 'Records arrived.']);
      assert.equal((await call('POST', `/tasks/${t.id}/notes`, { text: '  ' })).status, 422);
      assert.equal((await call('POST', '/tasks/nope/notes', { text: 'x' })).status, 404);
      assert.equal((await call('POST', `/tasks/${t.id}/notes`, { text: 'x'.repeat(2001) })).status, 422);
    });

    test('3.6 finishing a repeating task makes the next one, once, whichever way it is finished', async () => {
      const weekly = await make({ title: 'Weekly management meeting prep', dueDate: plus(1), repeat: 'weekly', department: 'Management', links: [{ url: 'https://example.com/agenda' }] });
      const done = await call('POST', `/tasks/${weekly.id}/complete`, { completionNotes: 'Done' });
      assert.equal(done.status, 200);
      assert.match(done.body.message, /The next one is set for/);
      const nextId = done.body.meta.nextTask.id;
      const next = (await call('GET', `/tasks/${nextId}`)).body.data;
      assert.equal(next.title, 'Weekly management meeting prep');
      assert.equal(next.dueDate, plus(8), 'one week on');
      assert.equal(next.status, 'Pending');
      assert.equal(next.repeat, 'weekly');
      assert.equal(next.department, 'Management');
      assert.equal(next.links.length, 1);
      assert.equal(next.repeatOf, weekly.id);
      assert.deepEqual(next.progressNotes, []);

      // Finishing it again is refused, so no second copy appears
      assert.equal((await call('POST', `/tasks/${weekly.id}/complete`, {})).status, 422);
      assert.equal(mockDb.tasks.filter(t => t.repeatOf === weekly.id).length, 1);

      // Finished by changing the status instead: the next one is made too
      const monthly = await make({ title: 'Monthly review', dueDate: plus(2), repeat: 'monthly' });
      const patched = await call('PATCH', `/tasks/${monthly.id}`, { status: 'Completed' });
      assert.equal(patched.status, 200);
      assert.ok(patched.body.meta.nextTask);
      assert.equal(patched.body.meta.nextTask.dueDate, nextRepeatDate(plus(2), 'monthly'));

      // A task that does not repeat makes nothing
      const once = await make({ title: 'One off', dueDate: plus(2) });
      const finished = await call('POST', `/tasks/${once.id}/complete`, {});
      assert.equal(finished.body.meta, undefined);
    });
  });
});
