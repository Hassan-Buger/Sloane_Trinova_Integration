/**
 * Unit 56 Test Suite: the morning briefing
 *
 * Verifies, with work spread over the businesses (dates relative to today, UK date):
 * - "Do these first" puts the most overdue filing first, then stuck work, then what is due soonest
 * - Each business gets its own block, with a health colour and a plain summary
 * - One business can be chosen; the briefing is then only about it
 * - Who is doing what lists open, late and stuck tasks and what is next up (late first)
 * - Risks and recommendations are specific: a late filing, stuck work, someone with too much on,
 *   tasks due this week that nobody has, deadlines that have no task yet
 * - A quiet day says so, and never claims anything is on track
 * - The route answers for the signed-in owner; the page has its menu item, print and refresh
 */

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { createApp } from '../src/app.js';
import { mockDb, DEFAULT_BUSINESSES } from '../src/data/db.js';
import { buildMorningBriefing } from '../src/services/morningBriefing.js';
import { ukToday } from '../src/services/weeklyReport.js';
import { TEST_API_KEY } from './fixtures.js';

const PORT = 5056;
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const today = ukToday();
const plus = n => new Date(Date.parse(`${today}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10);
const KEYS = ['businesses', 'clients', 'companies', 'statutoryTracker', 'vatReturns', 'tasks', 'clientBusiness', 'suggestionDismissals'];

function reset() {
  for (const k of KEYS) { mockDb[k] = mockDb[k] || []; mockDb[k].length = 0; }
  mockDb.businesses.push(...DEFAULT_BUSINESSES.map(b => ({ ...b })));
}

const task = (id, title, extra = {}) => ({ id, title, status: 'Pending', priority: 'Normal', dueDate: null, isBlocked: false, assigneeName: null, ...extra });
const deadline = (num, name, accounts, business, extra = {}) => ({ id: `dl_${num}`, origin: 'manual', companyNumber: num, name, accountsDueDate: accounts, confirmationDueDate: null, status: 'Active', businessArea: business, ...extra });

describe('Unit 56: the morning briefing', () => {
  let saved;
  before(() => {
    saved = {};
    for (const k of KEYS) saved[k] = [...(mockDb[k] || [])];
  });
  after(() => {
    for (const k of KEYS) { mockDb[k].length = 0; mockDb[k].push(...saved[k]); }
  });

  describe('1. A busy morning', () => {
    before(() => {
      reset();
      mockDb.statutoryTracker.push(
        deadline('56000001', 'Very Late Ltd', plus(-40), 'TriNova Accounting'),
        deadline('56000002', 'A Bit Late Ltd', plus(-3), 'TriNova Accounting'),
        deadline('56000003', 'Emerald Soon Ltd', plus(2), 'Emerald Education'),
        deadline('56000004', 'Far Away Ltd', plus(100), 'CFI Awarding')
      );
      mockDb.vatReturns.push({ id: 'v1', clientName: 'MTD Client Ltd', period: 'Q3', dueDate: plus(5), status: 'Not started', businessArea: 'MTDflow' });
      mockDb.tasks.push(
        task('t1', 'Chase the bank statements', { assigneeName: 'Priya', dueDate: plus(-2), businessArea: 'TriNova Accounting', isBlocked: true, blocker: 'Waiting for the client' }),
        task('t2', 'Review the file', { assigneeName: 'Priya', dueDate: plus(4), businessArea: 'TriNova Accounting', dependsOn: ['t1'] }),
        task('t3', 'Plan the term', { assigneeName: 'Sam', dueDate: plus(3), businessArea: 'Emerald Education' }),
        task('t4', 'Nobody has this', { dueDate: plus(2), businessArea: 'MTDflow' }),
        task('t5', 'Done last night', { status: 'Completed', completedAt: new Date().toISOString(), assigneeName: 'Sam', businessArea: 'CFI Awarding' })
      );
      for (let i = 0; i < 8; i++) mockDb.tasks.push(task(`p${i}`, `Priya extra ${i}`, { assigneeName: 'Priya', dueDate: i < 3 ? plus(-5) : plus(20), businessArea: 'TriNova Accounting' }));
    });

    test('1.1 "Do these first": the most overdue filing, then what is stuck, then what is due soon', () => {
      const b = buildMorningBriefing();
      assert.equal(b.priorities.length, 5);
      assert.equal(b.priorities[0].title, 'Accounts for Very Late Ltd');
      assert.match(b.priorities[0].why, /40 days late/);
      assert.equal(b.priorities[0].business, 'TriNova Accounting');
      const titles = b.priorities.map(p => p.title);
      assert.ok(titles.indexOf('Accounts for A Bit Late Ltd') < titles.indexOf('Accounts for Emerald Soon Ltd') || !titles.includes('Accounts for Emerald Soon Ltd'));
      assert.ok(titles.some(t => t.startsWith('Chase the bank statements')), 'the stuck task is up there');
      assert.match(b.headline, /^5 things need you first\. Across your businesses, /);
    });

    test('1.2 each business has its own block, health colour and plain summary', () => {
      const b = buildMorningBriefing();
      const by = Object.fromEntries(b.businesses.map(x => [x.name, x]));
      assert.deepEqual(Object.keys(by), ['TriNova Accounting', 'CFI Awarding', 'Emerald Education', 'MTDflow', 'No business chosen yet'].filter(n => by[n]));
      assert.equal(by['TriNova Accounting'].health, 'red');
      assert.match(by['TriNova Accounting'].summary, /items are late, the oldest 40 days late\./);
      assert.match(by['TriNova Accounting'].summary, /1 task is stuck\./);
      assert.match(by['TriNova Accounting'].summary, /1 task is waiting for another task\./);
      assert.equal(by['Emerald Education'].health, 'amber');
      assert.match(by['Emerald Education'].summary, /2 items are due in the next 7 days\./);
      assert.equal(by['CFI Awarding'].health, 'green');
      assert.equal(by['CFI Awarding'].summary, 'Nothing urgent.');
      assert.equal(by['MTDflow'].counts.dueThisWeek, 2);
      assert.equal(by['TriNova Accounting'].late[0].title, 'Accounts for Very Late Ltd');
    });

    test('1.3 choosing one business makes the briefing about that business only', () => {
      const b = buildMorningBriefing(new Date(), { business: 'Emerald Education' });
      assert.equal(b.business, 'Emerald Education');
      assert.deepEqual(b.businesses.map(x => x.name), ['Emerald Education']);
      assert.ok(b.priorities.every(p => p.business === 'Emerald Education'));
      assert.match(b.headline, /Across Emerald Education,/);
      assert.equal(b.counts.late, 0);
    });

    test('1.4 who is doing what: counts, and next up with the late ones first', () => {
      const b = buildMorningBriefing();
      const priya = b.staff.find(p => p.who === 'Priya');
      assert.equal(priya.open, 10);
      assert.equal(priya.late, 4);
      assert.equal(priya.stuck, 1);
      assert.equal(priya.items.length, 3);
      assert.ok(priya.items.every(i => i.late), 'the three next up are all late');
      assert.ok(b.staff.some(p => p.who === 'Nobody yet'));
    });

    test('1.5 risks and recommendations are specific and plain', () => {
      const b = buildMorningBriefing();
      const text = b.risks.map(r => r.text).join('\n');
      assert.match(text, /TriNova Accounting: \d+ items are late\./);
      assert.match(text, /"Chase the bank statements" is stuck: Waiting for the client\./);
      assert.match(text, /Priya has 10 open tasks, 4 late\./);
      assert.match(text, /1 task due this week has nobody working on it\./);
      const recs = b.recommendations.join('\n');
      assert.match(b.recommendations[0], /Accounts for Very Late Ltd 40 days late/);
      assert.match(recs, /Unblock "Chase the bank statements" with Priya: Waiting for the client\./);
      assert.match(recs, /Priya has a lot on/);
      assert.match(recs, /Give the task due this week to someone: "Nobody has this"\./);
      assert.ok(b.recommendations.length <= 6 && b.risks.length <= 8);
    });

    test('1.6 what Sloane has not been given a task for is called out', () => {
      const b = buildMorningBriefing();
      assert.ok(b.suggestionsCount >= 2, 'the very late and a bit late accounts have no task');
      assert.match(b.recommendations.join('\n'), /Sloane found \d+ pieces of work with no task yet/);
      assert.match(b.risks.map(r => r.text).join('\n'), /deadlines have no task and nobody working on them\./);
    });
  });

  describe('2. A quiet morning', () => {
    before(() => {
      reset();
      mockDb.statutoryTracker.push(deadline('56000009', 'Calm Ltd', plus(25), 'CFI Awarding'));
    });

    test('2.1 says so plainly, and never claims everything is on track', () => {
      const b = buildMorningBriefing();
      assert.equal(b.priorities.length, 0);
      assert.equal(b.headline, 'Nothing needs you urgently today.');
      assert.equal(b.businesses.find(x => x.name === 'CFI Awarding').health, 'green');
      assert.equal(b.risks.length >= 0, true);
      const text = JSON.stringify(b).toLowerCase();
      assert.equal(/on track|all good|everything is fine/.test(text), false);
    });

    test('2.2 a completely empty install says there is nothing saved yet', () => {
      reset();
      const b = buildMorningBriefing();
      assert.equal(b.headline, 'Nothing needs you urgently today.');
      assert.ok(b.businesses.every(x => x.summary === 'Nothing is saved for this business yet.'));
      assert.deepEqual(b.recommendations, ['Nothing needs you urgently today.']);
      assert.deepEqual(b.staff, []);
    });
  });

  describe('3. Over HTTP and on the page', () => {
    let server;
    let baseUrl;
    before(async () => {
      reset();
      mockDb.statutoryTracker.push(deadline('56000010', 'Route Ltd', plus(-4), 'MTDflow'));
      const app = createApp();
      await new Promise(resolve => { server = app.listen(PORT, () => { baseUrl = `http://localhost:${PORT}`; resolve(); }); });
    });
    after(async () => { if (server) await new Promise(resolve => server.close(resolve)); });

    test('3.1 the route needs a sign-in and answers with the briefing, also for one business', async () => {
      assert.equal((await fetch(`${baseUrl}/api/v1/reports/morning`)).status, 401);
      const res = await fetch(`${baseUrl}/api/v1/reports/morning`, { headers: { Authorization: `Bearer ${TEST_API_KEY}` } });
      assert.equal(res.status, 200);
      const body = (await res.json()).data;
      assert.match(body.greeting, /^Good (morning|afternoon|evening), Kirsty$/);
      assert.equal(body.date, today);
      assert.equal(body.priorities[0].title, 'Accounts for Route Ltd');
      const one = await (await fetch(`${baseUrl}/api/v1/reports/morning?business=CFI%20Awarding`, { headers: { Authorization: `Bearer ${TEST_API_KEY}` } })).json();
      assert.equal(one.data.business, 'CFI Awarding');
      assert.equal(one.data.priorities.length, 0);
    });

    test('3.2 the page has its menu item, print and refresh buttons, and prints only itself', () => {
      const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
      const css = fs.readFileSync(path.join(root, 'styles/views.css'), 'utf8');
      assert.match(html, /data-view="briefing"/);
      assert.match(html, /id="morningBriefing"/);
      assert.match(html, /data-action="printMorningBriefing"/);
      assert.match(html, /data-action="refreshMorningBriefing"/);
      assert.match(css, /body\.printing-report \.view:not\(\.print-this\)/);
      const feature = fs.readFileSync(path.join(root, 'scripts/features/briefing.js'), 'utf8');
      assert.match(feature, /view\.classList\.add\('print-this'\)/);
      assert.match(feature, /Teams is not connected yet/, 'the page is honest about Teams');
    });
  });
});
