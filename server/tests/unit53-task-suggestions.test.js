/**
 * Unit 53 Test Suite: "Sloane suggests" tasks
 *
 * Verifies, with deadlines dated relative to today (UK date):
 * - Accounts / yearly update due within 30 days (or late) and VAT returns due within 21 days are
 *   suggested, with a sensible due date, priority, reason and (when known) the person to give it to
 * - Nothing is suggested when it is further away, when a task already carries the key (even a
 *   finished one), when an open task for that client already covers it, or when it was dismissed
 * - A new year's deadline is a new suggestion (recurring work)
 * - Accepting makes a real task (with the key, a history entry and an audit entry) only for a
 *   suggestion Sloane is making right now; accepting twice is refused politely
 * - Accept all, dismiss and bring-back work; the page has the card
 */

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { createApp } from '../src/app.js';
import { mockDb } from '../src/data/db.js';
import { auditStore } from '../src/middleware/audit.js';
import { clientDirectory } from '../src/services/clientDirectory.js';
import { buildSuggestions, dismissSuggestion, resetDismissals } from '../src/services/taskSuggestions.js';
import { ukToday } from '../src/services/weeklyReport.js';
import { TEST_API_KEY } from './fixtures.js';

const PORT = 5053;
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const today = ukToday();
const plus = n => new Date(Date.parse(`${today}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10);
const auth = { Authorization: `Bearer ${TEST_API_KEY}`, 'Content-Type': 'application/json' };

describe('Unit 53: Sloane suggests tasks', () => {
  let saved;

  before(() => {
    saved = {};
    for (const k of ['statutoryTracker', 'vatReturns', 'tasks', 'companies', 'clients', 'teamMembers', 'suggestionDismissals', 'timeline_events']) {
      saved[k] = [...(mockDb[k] || [])];
      mockDb[k] = mockDb[k] || [];
      mockDb[k].length = 0;
    }
    clientDirectory.setTrinovaClients([{ id: 'tn-5301', name: 'Managed Live Ltd', company_number: '53010001', account_manager: 'Priya Shah' }]);
    mockDb.teamMembers.push({ id: 'usr_priya', name: 'Priya Shah', role: 'Bookkeeper', createdAt: new Date().toISOString() });
    const dl = (num, name, accounts, confirm, clientId = null) => ({ id: `dl_${num}`, origin: 'manual', companyNumber: num, clientId, name, accountsDueDate: accounts, confirmationDueDate: confirm, status: 'Active', notes: '' });
    mockDb.statutoryTracker.push(
      dl('53010001', 'Managed Live Ltd', plus(20), plus(200), 'tn-5301'),
      dl('53020002', 'Late Accounts Ltd', plus(-12), null),
      dl('53030003', 'Far Away Ltd', plus(90), plus(120)),
      dl('53040004', 'Yearly Soon Ltd', plus(300), plus(10))
    );
    mockDb.vatReturns.push(
      { id: 'vat_a', clientName: 'VAT Soon Ltd', period: 'Q3 2026', dueDate: plus(14), status: 'Not started', notes: '' },
      { id: 'vat_b', clientName: 'VAT Far Ltd', period: 'Q4 2026', dueDate: plus(60), status: 'Not started', notes: '' },
      { id: 'vat_c', clientName: 'VAT Filed Ltd', period: 'Q2 2026', dueDate: plus(5), status: 'Filed', notes: '' }
    );
  });

  after(() => {
    for (const k of Object.keys(saved)) {
      mockDb[k].length = 0;
      mockDb[k].push(...saved[k]);
    }
    clientDirectory.clearTrinova();
  });

  const find = (list, text) => list.suggestions.find(s => s.title.includes(text));

  test('53.1 what gets suggested, and what does not', () => {
    const { suggestions } = buildSuggestions();
    const titles = suggestions.map(s => s.title);
    assert.deepEqual(titles, [
      'Prepare and file accounts: Late Accounts Ltd',
      'File the yearly update (confirmation statement): Yearly Soon Ltd',
      'Prepare the VAT return (Q3 2026): VAT Soon Ltd',
      'Prepare and file accounts: Managed Live Ltd'
    ]);
  });

  test('53.2 due date, priority and the reason are sensible', () => {
    const list = buildSuggestions();
    const late = find(list, 'Late Accounts');
    assert.equal(late.priority, 'Urgent');
    assert.equal(late.dueDate, today, 'late work is due today');
    assert.match(late.reason, /12 days late/);
    assert.match(late.reason, /nobody has a task for it yet/);

    const soon = find(list, 'Yearly Soon');
    assert.equal(soon.priority, 'High');
    assert.equal(soon.dueDate, plus(7), 'three days before the yearly update is due');

    const accounts = find(list, 'Managed Live');
    assert.equal(accounts.priority, 'Normal');
    assert.equal(accounts.dueDate, plus(13), 'a week before the accounts are due');
    assert.match(accounts.description, /Suggested by Sloane/);
  });

  test('53.3 the person looking after the client is the assignee when they are on the team', () => {
    const s = find(buildSuggestions(), 'Managed Live');
    assert.equal(s.assigneeId, 'usr_priya');
    assert.equal(s.assigneeName, 'Priya Shah');
    assert.equal(s.managerName, 'Priya Shah');
    const other = find(buildSuggestions(), 'Late Accounts');
    assert.equal(other.assigneeId, null);
    assert.equal(other.managerName, null);

    // A manager who is not on the team: not assigned, but named
    clientDirectory.setTrinovaClients([{ id: 'tn-5301', name: 'Managed Live Ltd', company_number: '53010001', account_manager: 'Someone New' }]);
    const named = find(buildSuggestions(), 'Managed Live');
    assert.equal(named.assigneeId, null);
    assert.equal(named.managerName, 'Someone New');
    clientDirectory.setTrinovaClients([{ id: 'tn-5301', name: 'Managed Live Ltd', company_number: '53010001', account_manager: 'Priya Shah' }]);
  });

  test('53.4 a task already covering the work, or carrying the key, stops the suggestion', () => {
    // An open "accounts" task for that client covers it
    mockDb.tasks.push({ id: 't_cover', title: 'Sort the accounts', status: 'Pending', clientId: 'tn-5301', companyId: 'tn-5301' });
    assert.equal(find(buildSuggestions(), 'Managed Live'), undefined);
    mockDb.tasks.length = 0;

    // A finished task with the same key means it was done: not suggested again
    const key = find(buildSuggestions(), 'Late Accounts').key;
    mockDb.tasks.push({ id: 't_done', title: 'Whatever', status: 'Completed', sourceKey: key });
    assert.equal(find(buildSuggestions(), 'Late Accounts'), undefined);
    mockDb.tasks.length = 0;
    assert.ok(find(buildSuggestions(), 'Late Accounts'), 'back once the task is gone');

    // A closed task that only looks similar does not cover it
    mockDb.tasks.push({ id: 't_closed', title: 'Sort the accounts', status: 'Cancelled', clientId: 'tn-5301' });
    assert.ok(find(buildSuggestions(), 'Managed Live'));
    mockDb.tasks.length = 0;
  });

  test('53.5 "Not needed" is remembered, and can be undone', () => {
    const s = find(buildSuggestions(), 'VAT Soon');
    dismissSuggestion(s.key);
    const after = buildSuggestions();
    assert.equal(find(after, 'VAT Soon'), undefined);
    assert.equal(after.dismissedCount, 1);
    assert.equal(resetDismissals(), 1);
    assert.ok(find(buildSuggestions(), 'VAT Soon'));
  });

  test('53.6 next year\'s deadline is a new suggestion (recurring work)', () => {
    const first = find(buildSuggestions(), 'Late Accounts');
    mockDb.tasks.push({ id: 't_year1', title: 'Done', status: 'Completed', sourceKey: first.key });
    assert.equal(find(buildSuggestions(), 'Late Accounts'), undefined, 'this year is done');
    // The company's accounts date moves on a year, to a date that is now close again
    mockDb.statutoryTracker.find(r => r.companyNumber === '53020002').accountsDueDate = plus(25);
    const next = find(buildSuggestions(), 'Late Accounts');
    assert.ok(next, 'the new date is suggested');
    assert.notEqual(next.key, first.key);
    mockDb.statutoryTracker.find(r => r.companyNumber === '53020002').accountsDueDate = plus(-12);
    mockDb.tasks.length = 0;
  });

  describe('53.7 over HTTP', () => {
    let server;
    let baseUrl;
    const call = (method, p, body) => fetch(`${baseUrl}/api/v1${p}`, { method, headers: auth, body: body ? JSON.stringify(body) : undefined });

    before(async () => {
      const app = createApp();
      await new Promise(resolve => { server = app.listen(PORT, () => { baseUrl = `http://localhost:${PORT}`; resolve(); }); });
    });
    after(async () => { if (server) await new Promise(resolve => server.close(resolve)); });

    test('listing needs a sign-in; accepting makes a real task with a history entry and an audit entry', async () => {
      assert.equal((await fetch(`${baseUrl}/api/v1/suggestions`)).status, 401);
      const list = await (await call('GET', '/suggestions')).json();
      assert.equal(list.data.length, 4);
      assert.equal(list.meta.total, 4);

      const s = list.data.find(x => x.title.includes('Managed Live'));
      const res = await call('POST', '/suggestions/accept', { key: s.key });
      assert.equal(res.status, 201);
      const task = (await res.json()).data;
      assert.equal(task.title, s.title);
      assert.equal(task.sourceKey, s.key);
      assert.equal(task.assigneeName, 'Priya Shah');
      assert.equal(task.clientId, 'tn-5301');
      assert.equal(task.status, 'Pending');
      assert.equal(task.dueDate, s.dueDate);
      assert.match(task.creatorName, /^Sloane \(approved by /);
      assert.ok(mockDb.tasks.some(t => t.id === task.id));
      assert.ok(mockDb.timeline_events.some(e => e.clientId === 'tn-5301' && /Task Created/.test(e.title)), 'history entry');
      assert.equal(auditStore.logs[0].action, 'suggestion_accepted');

      const again = await call('POST', '/suggestions/accept', { key: s.key });
      assert.equal(again.status, 409);
      assert.match((await again.json()).error.message, /no longer suggesting/);
    });

    test('nothing can be made from a key Sloane is not suggesting', async () => {
      const before = mockDb.tasks.length;
      const res = await call('POST', '/suggestions/accept', { key: 'deadline:accounts:EVIL:2026-01-01' });
      assert.equal(res.status, 409);
      assert.equal((await call('POST', '/suggestions/accept', {})).status, 409);
      assert.equal(mockDb.tasks.length, before);
    });

    test('dismiss, bring back, and accept all', async () => {
      const list = (await (await call('GET', '/suggestions')).json()).data;
      assert.equal(list.length, 3);
      const vat = list.find(x => x.title.includes('VAT Soon'));
      assert.equal((await call('POST', '/suggestions/dismiss', { key: vat.key })).status, 200);
      assert.equal((await call('POST', '/suggestions/dismiss', { key: vat.key })).status, 409, 'already gone');
      const meta = (await (await call('GET', '/suggestions')).json()).meta;
      assert.deepEqual([meta.total, meta.dismissedCount], [2, 1]);

      const reset = await (await call('POST', '/suggestions/reset')).json();
      assert.equal(reset.data.restored, 1);

      const all = await call('POST', '/suggestions/accept-all', {});
      assert.equal(all.status, 201);
      const body = await all.json();
      assert.equal(body.data.created, 3);
      assert.equal(body.message, '3 tasks made.');
      const after = await (await call('GET', '/suggestions')).json();
      assert.equal(after.data.length, 0, 'every suggestion now has its task');
      assert.equal((await (await call('POST', '/suggestions/accept-all', {})).json()).message, 'There was nothing to make.');
    });
  });

  test('53.8 the Today page has the card, and it is wired up', () => {
    const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
    const app = fs.readFileSync(path.join(root, 'scripts/app.js'), 'utf8');
    assert.match(html, /id="suggestionsCard"/);
    assert.match(app, /this\.renderSuggestions\(\)/);
    const feature = fs.readFileSync(path.join(root, 'scripts/features/suggestions.js'), 'utf8');
    for (const a of ['acceptSuggestion', 'dismissSuggestion', 'acceptAllSuggestions', 'resetSuggestionDismissals']) assert.match(feature, new RegExp(a));
  });
});
