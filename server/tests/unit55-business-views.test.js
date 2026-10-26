/**
 * Unit 55 Test Suite: seeing one business at a time, or all together
 *
 * Verifies, with work spread over the owner's businesses (dates relative to today, UK date):
 * - Deadlines, VAT returns, tasks, suggestions and the "This week" report all follow ?business=
 * - A deadline typed in by hand can be put under a business; others follow their client
 * - "All businesses at a glance" counts add up to what the other pages show, and give each
 *   business a health colour; work with no business is shown on its own
 * - Renaming a business renames it on tasks, deadlines and VAT returns as well
 */

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

import { createApp } from '../src/app.js';
import { mockDb, DEFAULT_BUSINESSES } from '../src/data/db.js';
import { buildBusinessOverview, NO_BUSINESS } from '../src/services/businessOverview.js';
import { ukToday } from '../src/services/weeklyReport.js';
import { clientDirectory } from '../src/services/clientDirectory.js';
import { businessOfClient, businessOfTask } from '../src/services/businessOf.js';
import { TEST_API_KEY } from './fixtures.js';

const PORT = 5055;
const auth = { Authorization: `Bearer ${TEST_API_KEY}`, 'Content-Type': 'application/json' };
const today = ukToday();
const plus = n => new Date(Date.parse(`${today}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10);

describe('Unit 55: business views', () => {
  let server;
  let baseUrl;
  let saved;
  const call = async (method, p, body) => {
    const res = await fetch(`${baseUrl}/api/v1${p}`, {
      method,
      headers: method === 'POST' && p === '/tasks' ? { ...auth, 'Idempotency-Key': randomUUID() } : auth,
      body: body ? JSON.stringify(body) : undefined
    });
    return { status: res.status, body: await res.json() };
  };

  before(async () => {
    saved = {};
    for (const k of ['businesses', 'clients', 'companies', 'statutoryTracker', 'vatReturns', 'tasks', 'clientBusiness', 'suggestionDismissals']) {
      saved[k] = [...(mockDb[k] || [])];
      mockDb[k] = mockDb[k] || [];
      mockDb[k].length = 0;
    }
    mockDb.businesses.push(...DEFAULT_BUSINESSES.map(b => ({ ...b })));
    mockDb.clients.push(
      { id: 'cli_a', name: 'Accounts Client Ltd', businessArea: 'TriNova Accounting', addedInSloane: true, companyIds: ['comp_a'] },
      { id: 'cli_e', name: 'Emerald Centre', businessArea: 'Emerald Education', addedInSloane: true, companyIds: ['comp_e'] }
    );
    mockDb.companies.push(
      { id: 'comp_a', clientId: 'cli_a', companyName: 'Accounts Client Ltd', companyNumber: '55000001', accountsDueDate: plus(-5), confirmationDueDate: plus(200) },
      { id: 'comp_e', clientId: 'cli_e', companyName: 'Emerald Centre', companyNumber: '55000002', accountsDueDate: plus(3), confirmationDueDate: plus(200) }
    );
    mockDb.statutoryTracker.push(
      { id: 'dl_m', origin: 'manual', companyNumber: '55000003', name: 'MTDflow Ltd', accountsDueDate: plus(20), confirmationDueDate: null, status: 'Active', businessArea: 'MTDflow' },
      { id: 'dl_n', origin: 'manual', companyNumber: '55000004', name: 'Nobody Ltd', accountsDueDate: plus(-2), confirmationDueDate: null, status: 'Active' }
    );
    mockDb.vatReturns.push(
      { id: 'vat_a', clientId: 'cli_a', clientName: 'Accounts Client Ltd', period: 'Q3', dueDate: plus(-1), status: 'Not started' },
      { id: 'vat_m', clientName: 'MTDflow Ltd', period: 'Q3', dueDate: plus(4), status: 'Not started', businessArea: 'MTDflow' }
    );
    mockDb.tasks.push(
      { id: 't_a1', title: 'Chase statements', status: 'Pending', dueDate: plus(-3), businessArea: 'TriNova Accounting', isBlocked: true, blocker: 'Waiting for the client' },
      { id: 't_a2', title: 'Review the file', status: 'Pending', dueDate: plus(5), clientId: 'cli_a', dependsOn: ['t_a1'] },
      { id: 't_e1', title: 'Plan the term', status: 'In_Progress', dueDate: plus(10), businessArea: 'Emerald Education' },
      { id: 't_m1', title: 'Launch checklist', status: 'Completed', completedAt: new Date().toISOString(), businessArea: 'MTDflow' },
      { id: 't_x1', title: 'Unfiled work', status: 'Pending', dueDate: plus(-1) }
    );
    const app = createApp();
    await new Promise(resolve => { server = app.listen(PORT, () => { baseUrl = `http://localhost:${PORT}`; resolve(); }); });
  });

  after(async () => {
    for (const k of Object.keys(saved)) { mockDb[k].length = 0; mockDb[k].push(...saved[k]); }
    if (server) await new Promise(resolve => server.close(resolve));
  });

  test('55.1 tasks follow ?business=, by the business chosen or the client\'s business', async () => {
    const titles = async b => (await call('GET', `/tasks?business=${encodeURIComponent(b)}`)).body.data.map(t => t.title).sort();
    assert.deepEqual(await titles('TriNova Accounting'), ['Chase statements', 'Review the file']);
    assert.deepEqual(await titles('Emerald Education'), ['Plan the term']);
    assert.deepEqual(await titles('MTDflow'), ['Launch checklist']);
    assert.equal((await call('GET', '/tasks')).body.data.length, 5);
  });

  test('55.2 deadlines follow ?business=, and each row says its business', async () => {
    const rows = async b => (await call('GET', `/statutory${b ? `?business=${encodeURIComponent(b)}` : ''}`)).body;
    const all = await rows('');
    assert.equal(all.data.length, 4);
    const by = Object.fromEntries(all.data.map(r => [r.companyNumber, r.businessArea]));
    assert.deepEqual(by, { 55000001: 'TriNova Accounting', 55000002: 'Emerald Education', 55000003: 'MTDflow', 55000004: null });
    const emerald = await rows('Emerald Education');
    assert.deepEqual(emerald.data.map(r => r.companyNumber), ['55000002']);
    assert.equal(emerald.meta.total, 1);
    assert.equal(emerald.meta.unfilteredTotal, 1, 'the counts are for that business');
  });

  test('55.3 VAT returns follow ?business=', async () => {
    const list = async b => (await call('GET', `/vat-returns?business=${encodeURIComponent(b)}`)).body.data.map(v => v.id);
    assert.deepEqual(await list('TriNova Accounting'), ['vat_a']);
    assert.deepEqual(await list('MTDflow'), ['vat_m']);
    assert.deepEqual(await list('Emerald Education'), []);
  });

  test('55.4 a hand-typed deadline or VAT return can be put under a business; a made-up one is refused', async () => {
    const dl = await call('POST', '/statutory/deadlines', { name: 'New Co Ltd', companyNumber: '55000009', accountsDueDate: plus(9), businessArea: 'cfi awarding' });
    assert.equal(dl.status, 201);
    assert.equal(dl.body.data.businessArea, 'CFI Awarding');
    assert.equal((await call('POST', '/statutory/deadlines', { name: 'Bad Co', businessArea: 'Nonsense' })).status, 400);
    const vat = await call('POST', '/vat-returns', { clientName: 'New Co Ltd', period: 'Q1', dueDate: plus(9), businessArea: 'CFI Awarding' });
    assert.equal(vat.status, 201);
    assert.equal(vat.body.data.businessArea, 'CFI Awarding');
    await call('DELETE', `/statutory/deadlines/${dl.body.data.id}`);
    await call('DELETE', `/vat-returns/${vat.body.data.id}`);
  });

  test('55.5 suggestions and the report follow the business', async () => {
    const all = (await call('GET', '/suggestions')).body.data;
    const trinova = (await call('GET', '/suggestions?business=TriNova%20Accounting')).body.data;
    assert.ok(all.length > trinova.length);
    assert.ok(trinova.length > 0 && trinova.every(s => s.businessArea === 'TriNova Accounting'));
    const report = (await call('GET', '/reports/this-week?business=Emerald%20Education')).body.data;
    assert.equal(report.business, 'Emerald Education');
    assert.deepEqual(report.late, []);
    assert.deepEqual(report.dueThisWeek.map(i => i.name), ['Emerald Centre']);
    assert.equal(report.counts.openTasks, 1);
    const whole = (await call('GET', '/reports/this-week')).body.data;
    assert.equal(whole.business, null);
    assert.ok(whole.counts.late > report.counts.late);
  });

  test('55.6 all businesses at a glance: each business, work with none, and a total that adds up', async () => {
    const res = await call('GET', '/businesses/overview');
    assert.equal(res.status, 200);
    const by = Object.fromEntries(res.body.data.map(b => [b.name, b]));
    assert.deepEqual(Object.keys(by), ['TriNova Accounting', 'CFI Awarding', 'Emerald Education', 'MTDflow', NO_BUSINESS]);

    const t = by['TriNova Accounting'];
    assert.equal(t.clients, 1);
    assert.equal(t.filingsLate, 1, 'accounts 5 days late');
    assert.equal(t.vatLate, 1);
    assert.equal(t.lateTasks, 1);
    assert.equal(t.stuckTasks, 1);
    assert.equal(t.waitingTasks, 1, 'the review waits for the chase');
    assert.equal(t.late, 3);
    assert.equal(t.health, 'red');

    const e = by['Emerald Education'];
    assert.equal(e.filingsDueThisWeek, 1);
    assert.equal(e.late, 0);
    assert.equal(e.dueThisWeek, 1);
    assert.equal(e.health, 'amber');

    const m = by.MTDflow;
    assert.equal(m.vatDueThisWeek, 1);
    assert.equal(m.doneThisWeek, 1);
    assert.equal(by['CFI Awarding'].health, 'green');

    const n = by[NO_BUSINESS];
    assert.equal(n.filingsLate, 1, 'the deadline with no business');
    assert.equal(n.lateTasks, 1, 'the unfiled task');

    const total = res.body.meta.total;
    assert.equal(total.late, res.body.data.reduce((sum, b) => sum + b.late, 0));
    assert.equal(total.openTasks, 4);
    assert.equal(total.health, 'red');
    assert.deepEqual(buildBusinessOverview().total, total);
  });

  test('55.8 clients read from TriNova belong to TriNova Accounting unless the owner puts them elsewhere', async () => {
    clientDirectory.setTrinovaClients([{ id: 'tn-55a', name: 'Live One Ltd', company_number: '55100001' }, { id: 'tn-55b', name: 'Live Two Ltd', company_number: '55100002' }]);
    try {
      assert.equal(businessOfClient('tn-55a'), 'TriNova Accounting');
      assert.equal(businessOfClient('unknown-id'), null);
      mockDb.clientBusiness.push({ id: 'tn-55b', businessArea: 'CFI Awarding' });
      assert.equal(businessOfClient('tn-55b'), 'CFI Awarding', 'the owner chose this one, so it wins');
      assert.equal(businessOfTask({ clientId: 'tn-55a' }), 'TriNova Accounting');
      assert.equal(businessOfTask({ companyId: 'comp_e' }), 'Emerald Education', 'a task linked only to a company');
      const before = buildBusinessOverview().businesses.find(b => b.name === 'TriNova Accounting').clients;
      assert.equal(before, 2, 'the Sloane client plus the live client still on the default');
      const cfi = buildBusinessOverview().businesses.find(b => b.name === 'CFI Awarding').clients;
      assert.equal(cfi, 1, 'the live client the owner put under CFI Awarding');
    } finally {
      mockDb.clientBusiness.length = 0;
      clientDirectory.clearTrinova();
    }
  });

  test('55.7 renaming a business renames it on tasks, deadlines and VAT returns too', async () => {
    const id = mockDb.businesses.find(b => b.name === 'MTDflow').id;
    const res = await call('PATCH', `/businesses/${id}`, { name: 'MTDflow Ltd Group' });
    assert.equal(res.status, 200);
    assert.equal(mockDb.tasks.find(t => t.id === 't_m1').businessArea, 'MTDflow Ltd Group');
    assert.equal(mockDb.statutoryTracker.find(r => r.id === 'dl_m').businessArea, 'MTDflow Ltd Group');
    assert.equal(mockDb.vatReturns.find(v => v.id === 'vat_m').businessArea, 'MTDflow Ltd Group');
    assert.deepEqual((await call('GET', '/tasks?business=MTDflow%20Ltd%20Group')).body.data.map(t => t.id), ['t_m1']);
  });
});
