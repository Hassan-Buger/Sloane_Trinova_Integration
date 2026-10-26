/**
 * Unit 58 Test Suite: delegating by conversation, what Sloane may do alone, and alerts
 *
 * Verifies, with dates relative to today (UK date):
 * - "Ask Priya to ... by Friday" becomes ONE proposed task for Priya, due Friday; nothing is created
 * - A name that is not in the team is reported, never guessed; "Remind me to ..." has no assignee
 * - Pasted text with promises and requests becomes proposals marked "check before you create"
 * - Questions and ordinary text do not become proposals; tasks that already exist are not proposed again
 * - Dates: today, tomorrow, weekdays, "5 November", "05/11", "in 3 weeks", end of the month
 * - What Sloane may do on her own: starts on "Ask me first"; locked things cannot be switched;
 *   on "Do it automatically" she makes the deadline tasks (once, for the chosen business only) and logs them
 * - Only the signed-in owner can change the rules (not an API key)
 * - Alerts: late, stuck, due today, nobody-has-it, deadlines with no task; stable ids; one business at a time
 * - The page is installable (manifest, icons) and has a notification helper
 */

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { createApp } from '../src/app.js';
import { mockDb, DEFAULT_BUSINESSES } from '../src/data/db.js';
import { proposeTasks, findDate } from '../src/services/ai/taskProposals.js';
import { getRules, updateRules, runAutomation, recentLog } from '../src/services/automation.js';
import { buildAlerts } from '../src/services/alerts.js';
import { ukToday } from '../src/services/weeklyReport.js';
import { TEST_API_KEY } from './fixtures.js';
import { loginCookie } from './support.js';

const PORT = 5058;
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const today = ukToday();
const plus = n => new Date(Date.parse(`${today}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10);
const KEYS = ['businesses', 'clients', 'companies', 'statutoryTracker', 'vatReturns', 'tasks', 'clientBusiness', 'teamMembers', 'suggestionDismissals', 'automationRules', 'automationLog'];

const task = (id, title, extra = {}) => ({ id, title, status: 'Pending', priority: 'Normal', dueDate: null, isBlocked: false, assigneeName: null, ...extra });
const deadline = (num, name, accounts, business) => ({ id: `dl_${num}`, origin: 'manual', companyNumber: num, name, accountsDueDate: accounts, confirmationDueDate: null, status: 'Active', businessArea: business });
const nextWeekday = (from, weekday) => { for (let i = 1; i <= 7; i++) { const d = plus(i); if (new Date(`${d}T12:00:00Z`).getUTCDay() === weekday) return d; } return null; };

describe('Unit 58: delegating, automation rules and alerts', () => {
  let saved;
  before(() => {
    saved = {};
    for (const k of KEYS) { mockDb[k] = mockDb[k] || []; saved[k] = [...mockDb[k]]; mockDb[k].length = 0; }
    mockDb.businesses.push(...DEFAULT_BUSINESSES.map(b => ({ ...b })));
    mockDb.teamMembers.push({ id: 'tm1', name: 'Priya Shah' }, { id: 'tm2', name: 'Mark Jones' });
    mockDb.clients.push({ id: 'cl_acme', name: 'Acme Holdings Limited', businessArea: 'TriNova Accounting', status: 'Active' });
  });
  after(() => {
    for (const k of KEYS) { mockDb[k].length = 0; mockDb[k].push(...saved[k]); }
  });

  describe('1. Delegating by conversation', () => {
    test('1.1 "Ask Priya to ..." is one proposed task for Priya with the date and client found', () => {
      const r = proposeTasks('Ask Priya to chase the bank statements for Acme by Friday');
      assert.equal(r.kind, 'instruction');
      assert.equal(r.proposals.length, 1);
      const p = r.proposals[0];
      assert.equal(p.title, 'Chase the bank statements for Acme');
      assert.equal(p.assigneeName, 'Priya Shah');
      assert.equal(p.assigneeId, 'tm1');
      assert.equal(p.dueDate, nextWeekday(today, 5));
      assert.equal(p.clientName, 'Acme Holdings Limited');
      assert.equal(p.businessArea, 'TriNova Accounting');
      assert.equal(mockDb.tasks.length, 0, 'nothing is created by proposing');
    });

    test('1.2 other ways of saying it', () => {
      assert.equal(proposeTasks('Assign the VAT return for Acme to Mark Jones by tomorrow').proposals[0].assigneeName, 'Mark Jones');
      assert.equal(proposeTasks('Assign the VAT return for Acme to Mark Jones by tomorrow').proposals[0].dueDate, plus(1));
      assert.equal(proposeTasks('please ask priya to ring Sam today').proposals[0].dueDate, today);
      const r = proposeTasks('Remind me to call the accountant tomorrow').proposals[0];
      assert.equal(r.title, 'Call the accountant');
      assert.equal(r.assigneeName, null);
      assert.equal(r.dueDate, plus(1));
    });

    test('1.3 a name that is not in the team is reported, never guessed', () => {
      const p = proposeTasks('Tell Zoltan to file the VAT return by 5 November').proposals[0];
      assert.equal(p.assigneeName, null);
      assert.match(p.note, /no one called Zoltan in the team/);
    });

    test('1.4 questions and ordinary text are not turned into tasks', () => {
      assert.deepEqual(proposeTasks('What is due this week?').proposals, []);
      assert.deepEqual(proposeTasks('Ask me nothing').proposals, []);
      assert.deepEqual(proposeTasks('hello').proposals, []);
      assert.deepEqual(proposeTasks('').proposals, []);
    });

    test('1.5 pasted text: promises and requests become proposals to check', () => {
      const text = 'Hi Kirsty, thanks for the call. I will send the signed engagement letter by Monday. Could you review the draft accounts for Acme Ltd? Action: book the venue for the training day. We need to chase the client for bank statements by 5 November. Kind regards, Sam';
      const r = proposeTasks(text);
      assert.equal(r.kind, 'text');
      assert.deepEqual(r.proposals.map(p => p.title), [
        'Send the signed engagement letter',
        'Review the draft accounts for Acme Ltd',
        'Book the venue for the training day',
        'Chase the client for bank statements'
      ]);
      assert.equal(r.proposals[0].dueDate, nextWeekday(today, 1));
      assert.ok(r.proposals.every(p => p.confidence === 'check' && /Check who should do this/.test(p.note)));
      assert.ok(r.proposals.every(p => p.assigneeName === null), 'who does it is never guessed from pasted text');
    });

    test('1.6 a task that already exists is not proposed again', () => {
      mockDb.tasks.push(task('t_existing', 'Book the venue for the training day'));
      try {
        const r = proposeTasks('Notes from the meeting. Action: book the venue for the training day. Action: order the lunch for Friday.');
        assert.deepEqual(r.proposals.map(p => [p.title, p.dueDate]), [['Order the lunch', nextWeekday(today, 5)]]);
      } finally {
        mockDb.tasks.length = 0;
      }
    });

    test('1.7 dates in sentences', () => {
      assert.equal(findDate('by tomorrow').date, plus(1));
      assert.equal(findDate('on 5 November 2031').date, '2031-11-05');
      assert.equal(findDate('see 05/11/2031').date, '2031-11-05');
      assert.equal(findDate('in 3 weeks').date, plus(21));
      assert.equal(findDate('by 31 February 2031'), null, 'a date that does not exist is not guessed');
      assert.match(findDate('end of the month').date, /^\d{4}-\d{2}-(28|29|30|31)$/);
      assert.equal(findDate('nothing here'), null);
    });
  });

  describe('2. What Sloane may do on her own', () => {
    before(() => {
      mockDb.statutoryTracker.push(
        deadline('58000001', 'Acorn Ltd', plus(10), 'TriNova Accounting'),
        deadline('58000002', 'Emerald Soon Ltd', plus(12), 'Emerald Education')
      );
      mockDb.clients.push({ id: 'cl_em', name: 'Emerald Soon Ltd', businessArea: 'Emerald Education', status: 'Active' });
    });

    test('2.1 it starts on "Ask me first", and the always-ask things are locked', () => {
      const r = getRules();
      assert.deepEqual(r.deadlineTasks, { mode: 'ask', business: '' });
      assert.equal(r.locked.length, 3);
      assert.ok(r.locked.every(l => l.mode === 'ask'));
      assert.match(r.locked.map(l => l.label).join(' | '), /outside.*Spend money.*Sensitive/);
    });

    test('2.2 on "Ask me first" nothing is made, even when told to run', () => {
      const out = runAutomation();
      assert.equal(out.ran, false);
      assert.equal(mockDb.tasks.length, 0);
    });

    test('2.3 bad choices are refused; a business must exist', () => {
      assert.match(updateRules({ mode: 'always' }).error, /Ask me first/);
      assert.match(updateRules({ business: 'Nonexistent' }).error, /no business called/);
      assert.equal(getRules().deadlineTasks.mode, 'ask');
    });

    test('2.4 on "Do it automatically" she makes the tasks for the chosen business only, once, and logs them', () => {
      assert.equal(updateRules({ mode: 'auto', business: 'emerald education' }, { actorName: 'Kirsty Allen' }).rules.deadlineTasks.business, 'Emerald Education');
      const first = runAutomation();
      assert.equal(first.ran, true);
      assert.equal(first.created, 1);
      const made = mockDb.tasks.find(t => t.id === first.taskIds[0]);
      assert.match(made.title, /accounts/i);
      assert.equal(made.title, 'Prepare and file accounts: Emerald Soon Ltd');
      assert.equal(made.businessArea, 'Emerald Education');
      assert.equal(made.origin, 'automation');
      assert.equal(made.creatorName, 'Sloane (automatic, from your rule)');
      assert.equal(mockDb.tasks.some(t => /Acorn/.test(t.title)), false, 'TriNova work is left alone');
      assert.equal(runAutomation().created, 0, 'nothing is made twice');
      const log = recentLog();
      assert.equal(log.length, 1);
      assert.equal(log[0].title, made.title);
      assert.equal(getRules().updatedBy, 'Kirsty Allen');
    });

    test('2.5 for all businesses, and the rest of the deadlines are then made', () => {
      updateRules({ business: 'all' });
      assert.equal(getRules().deadlineTasks.business, '');
      const out = runAutomation();
      assert.equal(out.created, 1);
      assert.equal(mockDb.tasks.some(t => t.title === 'Prepare and file accounts: Acorn Ltd'), true);
      updateRules({ mode: 'ask' });
    });
  });

  describe('3. Alerts', () => {
    before(() => {
      mockDb.tasks.length = 0;
      mockDb.statutoryTracker.length = 0;
      mockDb.vatReturns.length = 0;
      mockDb.automationRules.length = 0;
      mockDb.statutoryTracker.push(
        deadline('58000010', 'Very Late Ltd', plus(-40), 'TriNova Accounting'),
        deadline('58000011', 'Today Ltd', plus(0), 'Emerald Education')
      );
      mockDb.tasks.push(
        task('a1', 'Chase statements', { assigneeName: 'Priya Shah', dueDate: plus(5), isBlocked: true, blocker: 'Waiting for the client', businessArea: 'TriNova Accounting' }),
        task('a2', 'Nobody has this', { dueDate: plus(2), businessArea: 'Emerald Education' })
      );
    });

    test('3.1 late, stuck, due today, nobody-has-it, and deadlines with no task', () => {
      const a = buildAlerts();
      const byKind = k => a.alerts.filter(x => x.kind === k);
      assert.match(byKind('late')[0].title, /^Accounts for Very Late Ltd is 40 days late$/);
      assert.equal(byKind('late')[0].level, 'red');
      assert.match(byKind('stuck')[0].detail, /^Waiting for the client \(Priya Shah\)\.$/);
      assert.match(byKind('today')[0].title, /Accounts for Today Ltd is due today/);
      assert.equal(byKind('today')[0].level, 'amber');
      assert.equal(byKind('nobody')[0].title, 'Nobody is working on "Nobody has this"');
      assert.equal(byKind('suggestions')[0].level, 'info');
      assert.equal(a.counts.total, a.alerts.length);
      assert.ok(a.counts.red >= 2 && a.counts.amber >= 2 && a.counts.info === 1);
    });

    test('3.2 ids stay the same from one check to the next, so a device can tell what is new', () => {
      const first = buildAlerts().alerts.map(x => x.id);
      const second = buildAlerts().alerts.map(x => x.id);
      assert.deepEqual(first, second);
      assert.equal(new Set(first).size, first.length, 'no two alerts share an id');
      mockDb.tasks.push(task('a3', 'Fresh problem', { isBlocked: true, blocker: 'Held up', businessArea: 'MTDflow' }));
      const third = buildAlerts().alerts.map(x => x.id);
      assert.equal(third.filter(id => !first.includes(id)).length, 1, 'only the new problem has a new id');
    });

    test('3.3 one business at a time', () => {
      const e = buildAlerts(new Date(), { business: 'Emerald Education' });
      assert.ok(e.alerts.every(x => x.business === 'Emerald Education' || x.kind === 'suggestions'));
      assert.ok(!e.alerts.some(x => /Very Late/.test(x.title)));
    });

    test('3.4 a quiet install has no alerts', () => {
      const saveT = [...mockDb.tasks]; const saveS = [...mockDb.statutoryTracker];
      mockDb.tasks.length = 0; mockDb.statutoryTracker.length = 0;
      const a = buildAlerts();
      assert.deepEqual(a.counts, { red: 0, amber: 0, info: 0, total: 0 });
      mockDb.tasks.push(...saveT); mockDb.statutoryTracker.push(...saveS);
    });
  });

  describe('4. Over HTTP, and the page', () => {
    let server;
    let baseUrl;
    before(async () => {
      const app = createApp();
      await new Promise(resolve => { server = app.listen(PORT, () => { baseUrl = `http://localhost:${PORT}`; resolve(); }); });
    });
    after(async () => { if (server) await new Promise(resolve => server.close(resolve)); });

    test('4.1 Ask Sloane returns proposals (and creates nothing)', async () => {
      const before = mockDb.tasks.length;
      const res = await fetch(`${baseUrl}/api/v1/ai/ask`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${TEST_API_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: 'Ask Priya to chase the bank statements for Acme by Friday' })
      });
      assert.equal(res.status, 200);
      const body = await res.json();
      assert.equal(body.source, 'sloane_task_proposals');
      assert.equal(body.data.proposals.length, 1);
      assert.match(body.data.answer, /Nothing is made until you do/);
      assert.equal(mockDb.tasks.length, before);
    });

    test('4.2 only the signed-in owner can read or change the rules; an API key cannot', async () => {
      assert.equal((await fetch(`${baseUrl}/api/v1/automation`)).status, 401);
      const key = await fetch(`${baseUrl}/api/v1/automation/rules`, { method: 'PUT', headers: { Authorization: `Bearer ${TEST_API_KEY}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ mode: 'auto' }) });
      assert.ok([401, 403].includes(key.status), `an API key is refused (got ${key.status})`);
      const cookie = await loginCookie(baseUrl);
      const bad = await fetch(`${baseUrl}/api/v1/automation/rules`, { method: 'PUT', headers: { Cookie: cookie, 'Content-Type': 'application/json' }, body: JSON.stringify({ mode: 'sometimes' }) });
      assert.equal(bad.status, 422);
      const ok = await fetch(`${baseUrl}/api/v1/automation/rules`, { method: 'PUT', headers: { Cookie: cookie, 'Content-Type': 'application/json' }, body: JSON.stringify({ mode: 'auto', business: 'MTDflow' }) });
      assert.equal(ok.status, 200);
      assert.equal((await ok.json()).data.deadlineTasks.business, 'MTDflow');
      const run = await fetch(`${baseUrl}/api/v1/automation/run`, { method: 'POST', headers: { Cookie: cookie, 'Content-Type': 'application/json' }, body: '{}' });
      assert.equal(run.status, 200);
      const read = await (await fetch(`${baseUrl}/api/v1/automation`, { headers: { Cookie: cookie } })).json();
      assert.equal(read.data.locked.length, 3);
      await fetch(`${baseUrl}/api/v1/automation/rules`, { method: 'PUT', headers: { Cookie: cookie, 'Content-Type': 'application/json' }, body: JSON.stringify({ mode: 'ask', business: '' }) });
    });

    test('4.3 the alerts route needs a sign-in and answers with the alerts', async () => {
      assert.equal((await fetch(`${baseUrl}/api/v1/alerts`)).status, 401);
      const res = await fetch(`${baseUrl}/api/v1/alerts`, { headers: { Authorization: `Bearer ${TEST_API_KEY}` } });
      assert.equal(res.status, 200);
      const body = (await res.json()).data;
      assert.ok(Array.isArray(body.alerts));
      assert.equal(body.counts.total, body.alerts.length);
    });

    test('4.4 the page is installable and has its notification helper', async () => {
      const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
      assert.match(html, /rel="manifest" href="assets\/manifest\.webmanifest"/);
      assert.match(html, /id="alertsCard"/);
      assert.match(html, /id="automationCard"/);
      const manifest = await fetch(`${baseUrl}/assets/manifest.webmanifest`);
      assert.equal(manifest.status, 200);
      assert.match(manifest.headers.get('content-type'), /application\/manifest\+json/);
      const m = await manifest.json();
      assert.equal(m.short_name, 'Sloane');
      assert.equal(m.display, 'standalone');
      for (const icon of m.icons) assert.equal((await fetch(`${baseUrl}${icon.src}`)).status, 200, `${icon.src} is served`);
      const sw = await fetch(`${baseUrl}/scripts/sw.js`);
      assert.equal(sw.status, 200);
      assert.match(await sw.text(), /notificationclick/);
    });
  });
});
