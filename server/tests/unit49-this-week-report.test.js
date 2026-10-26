/**
 * Unit 49 Test Suite: the "This week" report
 *
 * Verifies, with deadlines, VAT returns and tasks dated relative to today (UK date):
 * - Late items (filings, VAT returns, tasks) are listed under "Late", oldest first
 * - Items due today to 6 days ahead are "Due in the next 7 days"; day 7 onward is not
 * - Filed VAT returns, finished and cancelled tasks are left out of what is open
 * - Stuck tasks are listed with their reason; tasks finished in the last 7 days are listed
 * - The counts, "coming next" (8 to 30 days) and who-is-doing-what add up
 * - The route answers for a signed-in owner and for an API key, and refuses no sign-in
 * - The page has a print button and print rules that print only the report
 */

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { createApp } from '../src/app.js';
import { mockDb } from '../src/data/db.js';
import { buildWeeklyReport, ukToday, daysBetween } from '../src/services/weeklyReport.js';
import { TEST_API_KEY } from './fixtures.js';
import { loginCookie } from './support.js';

const PORT = 5049;
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const DAY = 24 * 60 * 60 * 1000;
const today = ukToday();
const plus = n => new Date(Date.parse(`${today}T00:00:00Z`) + n * DAY).toISOString().slice(0, 10);

describe('Unit 49: the This week report', () => {
  const added = { statutoryTracker: [], vatReturns: [], tasks: [] };
  let saved;

  before(() => {
    // Start from a known set: keep the originals aside and put them back afterwards
    saved = { statutoryTracker: [...mockDb.statutoryTracker], vatReturns: [...mockDb.vatReturns], tasks: [...mockDb.tasks], companies: [...mockDb.companies] };
    mockDb.statutoryTracker.length = 0;
    mockDb.vatReturns.length = 0;
    mockDb.tasks.length = 0;
    mockDb.companies.length = 0;

    const dl = (id, name, accounts, confirm) => ({ id, origin: 'manual', companyNumber: id.toUpperCase(), name, accountsDueDate: accounts, confirmationDueDate: confirm, status: 'Active', notes: '' });
    added.statutoryTracker.push(
      dl('wk01', 'Late Accounts Ltd', plus(-10), plus(40)),
      dl('wk02', 'Due Friday Ltd', plus(3), plus(200)),
      dl('wk03', 'Next Month Ltd', plus(20), null),
      dl('wk04', 'Day Seven Ltd', plus(7), null)
    );
    added.vatReturns.push(
      { id: 'vat_wk1', clientName: 'Late VAT Ltd', period: 'Q2', dueDate: plus(-2), status: 'Not started', notes: '' },
      { id: 'vat_wk2', clientName: 'Week VAT Ltd', period: 'Q3', dueDate: plus(5), status: 'In progress', notes: '' },
      { id: 'vat_wk3', clientName: 'Filed VAT Ltd', period: 'Q1', dueDate: plus(-30), status: 'Filed', notes: '' }
    );
    const task = (id, title, extra) => ({ id, title, status: 'Pending', priority: 'Normal', dueDate: null, isBlocked: false, blocker: null, assigneeName: null, companyName: null, ...extra });
    added.tasks.push(
      task('t1', 'Chase bank statements', { dueDate: plus(-1), assigneeName: 'Priya' }),
      task('t2', 'Prepare accounts', { dueDate: plus(0), assigneeName: 'Priya', isBlocked: true, blocker: 'Waiting for the client' }),
      task('t3', 'Later task', { dueDate: plus(15), assigneeName: 'Sam' }),
      task('t4', 'Finished task', { status: 'Completed', completedAt: new Date().toISOString(), assigneeName: 'Sam', dueDate: plus(-3) }),
      task('t5', 'Cancelled task', { status: 'Cancelled', dueDate: plus(-5) }),
      task('t6', 'Old finished task', { status: 'Completed', completedAt: new Date(Date.now() - 20 * DAY).toISOString() })
    );
    mockDb.statutoryTracker.push(...added.statutoryTracker);
    mockDb.vatReturns.push(...added.vatReturns);
    mockDb.tasks.push(...added.tasks);
  });

  after(() => {
    for (const k of Object.keys(saved)) {
      mockDb[k].length = 0;
      mockDb[k].push(...saved[k]);
    }
  });

  test('49.1 the week runs from today (UK date) for 7 days', () => {
    const r = buildWeeklyReport();
    assert.equal(r.period.from, today);
    assert.equal(r.period.to, plus(6));
    assert.equal(daysBetween(today, plus(-3)), -3);
  });

  test('49.2 late: filings, VAT returns and tasks whose date has passed, oldest first', () => {
    const r = buildWeeklyReport();
    const late = r.late.map(i => `${i.kind}:${i.name || i.what}`);
    assert.deepEqual(late, ['filing:Late Accounts Ltd', 'vat:Late VAT Ltd', 'task:General task']);
    assert.equal(r.late[0].what, 'Accounts');
    assert.equal(r.late[0].days, -10);
    assert.equal(r.late[2].what, 'Chase bank statements');
    assert.equal(r.late.some(i => i.name === 'Filed VAT Ltd'), false, 'a filed VAT return is never late');
    assert.equal(r.late.some(i => i.what === 'Cancelled task' || i.what === 'Finished task'), false, 'closed tasks are not late');
  });

  test('49.3 due in the next 7 days: today to 6 days ahead; day 7 and later are not', () => {
    const r = buildWeeklyReport();
    const due = r.dueThisWeek.map(i => i.what === 'Accounts' || i.what === 'Yearly update' ? `${i.what}:${i.name}` : i.what);
    assert.deepEqual(due, ['Prepare accounts', 'Accounts:Due Friday Ltd', 'VAT return (Q3)']);
    assert.equal(r.dueThisWeek.some(i => i.name === 'Day Seven Ltd'), false);
    assert.equal(r.dueThisWeek.some(i => i.name === 'Next Month Ltd'), false);
  });

  test('49.4 stuck tasks with the reason; finished in the last 7 days only', () => {
    const r = buildWeeklyReport();
    assert.deepEqual(r.stuck.map(s => [s.what, s.stuck, s.who]), [['Prepare accounts', 'Waiting for the client', 'Priya']]);
    assert.deepEqual(r.done.map(d => d.what), ['Finished task']);
  });

  test('49.5 counts, coming next and who is doing what add up', () => {
    const r = buildWeeklyReport();
    assert.deepEqual(r.counts, { late: 3, lateFilings: 1, dueThisWeek: 3, vatThisWeek: 1, openTasks: 3, stuckTasks: 1, doneThisWeek: 1 });
    // 8 to 30 days: Day Seven Ltd (day 7) and Next Month Ltd (day 20); Late Accounts' yearly update is day 40
    assert.deepEqual(r.comingNext, { filings: 2, vat: 0, tasks: 1 });
    assert.deepEqual(r.workload, [
      { who: 'Priya', open: 2, late: 1, stuck: 1 },
      { who: 'Sam', open: 1, late: 0, stuck: 0 }
    ]);
  });

  describe('49.6 the route', () => {
    let server;
    let baseUrl;
    before(async () => {
      const app = createApp();
      await new Promise(resolve => { server = app.listen(PORT, () => { baseUrl = `http://localhost:${PORT}`; resolve(); }); });
    });
    after(async () => { if (server) await new Promise(resolve => server.close(resolve)); });

    test('answers for the signed-in owner and an API key, refuses no sign-in', async () => {
      const cookie = await loginCookie(baseUrl);
      const owner = await fetch(`${baseUrl}/api/v1/reports/this-week`, { headers: { Cookie: cookie } });
      assert.equal(owner.status, 200);
      const body = await owner.json();
      assert.equal(body.data.period.from, today);
      assert.equal(body.data.counts.late, 3);
      const key = await fetch(`${baseUrl}/api/v1/reports/this-week`, { headers: { Authorization: `Bearer ${TEST_API_KEY}` } });
      assert.equal(key.status, 200);
      const anon = await fetch(`${baseUrl}/api/v1/reports/this-week`);
      assert.equal(anon.status, 401);
    });
  });

  test('49.7 the page has the menu item, the print button, and print rules that print only the report', () => {
    const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
    const css = fs.readFileSync(path.join(root, 'styles/views.css'), 'utf8');
    assert.match(html, /data-view="reports"/);
    assert.match(html, /data-action="printWeeklyReport"/);
    assert.match(html, /id="weeklyReport"/);
    assert.match(css, /@media print \{[\s\S]*@page \{\s*size: A4;/);
    assert.match(css, /body\.printing-report \.view:not\(\.print-this\)/);
    assert.match(css, /body\.printing-report \.side,/);
  });
});
