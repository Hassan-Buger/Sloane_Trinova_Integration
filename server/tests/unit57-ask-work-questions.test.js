/**
 * Unit 57 Test Suite: Ask Sloane about people, clients that are behind, and chasing
 *
 * Verifies, with work spread over the four businesses (dates relative to today, UK date):
 * - "What's Mark working on?" lists that person's open tasks, stuck and late first, with counts
 * - A name Sloane does not know gets an honest "no one called ..." answer, not a guess
 * - "Which TriNova clients are behind?" groups late filings, VAT and tasks by client, worst first,
 *   and only for the business named
 * - "What needs chasing at Emerald?" lists stuck, late and waiting work with who to chase,
 *   says so honestly when nothing is saved, and never claims to have read emails or Teams
 * - "How is MTDflow doing?" gives one business at a glance
 * - "Who has too much on?" ranks the team
 * - Other questions are left to the existing answers (null)
 * - The route answers these over HTTP, and the real AI model is given the same facts
 */

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';

import { createApp } from '../src/app.js';
import { mockDb, DEFAULT_BUSINESSES } from '../src/data/db.js';
import { answerWorkQuestion, buildWorkContext } from '../src/services/ai/workAnswers.js';
import { ContextBuilder } from '../src/services/ai/contextBuilder.js';
import { ukToday } from '../src/services/weeklyReport.js';
import { TEST_API_KEY } from './fixtures.js';

const PORT = 5057;
const today = ukToday();
const plus = n => new Date(Date.parse(`${today}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10);
const KEYS = ['businesses', 'clients', 'companies', 'statutoryTracker', 'vatReturns', 'tasks', 'clientBusiness', 'teamMembers'];

const task = (id, title, extra = {}) => ({ id, title, status: 'Pending', priority: 'Normal', dueDate: null, isBlocked: false, assigneeName: null, ...extra });
const deadline = (num, name, accounts, business) => ({ id: `dl_${num}`, origin: 'manual', companyNumber: num, name, accountsDueDate: accounts, confirmationDueDate: null, status: 'Active', businessArea: business });

describe('Unit 57: Ask Sloane about people, clients behind and chasing', () => {
  let saved;
  before(() => {
    saved = {};
    for (const k of KEYS) { mockDb[k] = mockDb[k] || []; saved[k] = [...mockDb[k]]; mockDb[k].length = 0; }
    mockDb.businesses.push(...DEFAULT_BUSINESSES.map(b => ({ ...b })));
    mockDb.teamMembers.push({ id: 'tm1', name: 'Mark Jones' }, { id: 'tm2', name: 'Priya Shah' }, { id: 'tm3', name: 'Lena Idle' });
    mockDb.statutoryTracker.push(
      deadline('57000001', 'Very Late Ltd', plus(-40), 'TriNova Accounting'),
      deadline('57000002', 'Also Late Ltd', plus(-3), 'TriNova Accounting'),
      deadline('57000003', 'Emerald Soon Ltd', plus(2), 'Emerald Education')
    );
    mockDb.vatReturns.push({ id: 'v1', clientName: 'Very Late Ltd', period: 'Q3', dueDate: plus(-9), status: 'Not started', businessArea: 'TriNova Accounting' });
    mockDb.tasks.push(
      task('t1', 'Chase the bank statements', { assigneeName: 'Mark Jones', dueDate: plus(-2), businessArea: 'TriNova Accounting', companyName: 'Also Late Ltd', isBlocked: true, blocker: 'Waiting for the client' }),
      task('t2', 'Prepare the accounts', { assigneeName: 'Mark Jones', dueDate: plus(6), businessArea: 'TriNova Accounting', companyName: 'Also Late Ltd', dependsOn: ['t1'] }),
      task('t3', 'Plan the term', { assigneeName: 'Priya Shah', dueDate: plus(-1), businessArea: 'Emerald Education' }),
      task('t4', 'Book the venue', { dueDate: plus(2), businessArea: 'Emerald Education', dependsOn: ['t3'] }),
      task('t5', 'Done already', { status: 'Completed', assigneeName: 'Mark Jones', completedAt: new Date().toISOString(), businessArea: 'TriNova Accounting' })
    );
  });
  after(() => {
    for (const k of KEYS) { mockDb[k].length = 0; mockDb[k].push(...saved[k]); }
  });

  describe('1. One person', () => {
    test('1.1 "What\'s Mark working on?" lists open tasks, stuck first, with counts', () => {
      const r = answerWorkQuestion("What's Mark working on?");
      assert.equal(r.response_type, 'practice_assessment');
      assert.match(r.answer, /^Mark Jones has 2 open tasks, 1 late, 1 stuck\.$/);
      assert.match(r.key_reasons[0], /^Chase the bank statements \(Also Late Ltd\) - stuck: Waiting for the client; late since /);
      assert.equal(r.key_reasons.length, 2, 'the finished task is not listed');
      assert.equal(r.risk_level, 'red');
      assert.match(r.recommended_actions[0].action, /unblock "Chase the bank statements"/);
    });

    test('1.2 a first name or a full name both work, and a person with nothing says so', () => {
      assert.match(answerWorkQuestion('what is Priya Shah doing').answer, /^Priya Shah has 1 open task, 1 late\.$/);
      assert.equal(answerWorkQuestion('What is Lena working on?').answer, 'Lena Idle has no open tasks in Sloane.');
    });

    test('1.3 a name Sloane does not know is not guessed at', () => {
      const r = answerWorkQuestion("What's Zoltan working on?");
      assert.match(r.answer, /no one called Zoltan/);
      assert.equal(answerWorkQuestion("What's everyone working on?"), null, 'everyone is a team question, not a name');
    });

    test('1.4 "who has too much on" ranks the team and points at tasks nobody has', () => {
      const r = answerWorkQuestion('Who has the most on right now?');
      assert.match(r.answer, /^Mark Jones has the most on: 2 open tasks, 1 late\. 1 task has nobody working on it\.$/);
      assert.ok(r.key_reasons.some(x => /^Priya Shah: 1 open task, 1 late$/.test(x)));
      assert.match(r.recommended_actions[0].action, /nobody to someone/);
    });
  });

  describe('2. Clients behind', () => {
    test('2.1 "Which TriNova clients are behind?" groups by client, worst first, for that business only', () => {
      const r = answerWorkQuestion('Which TriNova clients are behind?');
      assert.match(r.answer, /^2 clients are behind in TriNova Accounting\. The furthest behind: Very Late Ltd, Also Late Ltd/);
      assert.equal(r.risk_level, 'red');
      assert.match(r.key_reasons[0], /^Very Late Ltd: Accounts 40 days late; VAT return \(Q3\) 9 days late$/);
      assert.ok(!r.key_reasons.join('\n').includes('Emerald Soon'));
      assert.match(r.recommended_actions[0].action, /Ask for Very Late Ltd to be dealt with first/);
    });

    test('2.2 across all businesses when none is named; none behind says so honestly', () => {
      assert.match(answerWorkQuestion('Which clients are behind?').answer, /behind across your businesses/);
      const none = answerWorkQuestion('Which CFI clients are overdue?');
      assert.match(none.answer, /^No client is behind in CFI Awarding/);
    });
  });

  describe('3. What needs chasing', () => {
    test('3.1 "What needs chasing at Emerald?" lists late, waiting and stuck work with who to chase', () => {
      const r = answerWorkQuestion('What needs chasing at Emerald?');
      assert.match(r.answer, /^\d+ things? needs? chasing at Emerald Education\.$/);
      const text = r.key_reasons.join('\n');
      assert.match(text, /Plan the term: 1 day late - chase Priya Shah/);
      assert.match(text, /Book the venue: due in 2 days but waiting for Plan the term/);
      assert.ok(!text.includes('bank statements'), 'TriNova work is not listed');
      assert.match(r.recommended_actions[0].action, /^Start with /);
    });

    test('3.2 stuck work is listed with the reason and who to chase', () => {
      const r = answerWorkQuestion('what do I need to chase at TriNova');
      assert.match(r.key_reasons[0], /^Chase the bank statements \(Also Late Ltd\): stuck: Waiting for the client - chase Mark Jones$/);
    });

    test('3.3 nothing to chase, and nothing saved, are said honestly', () => {
      const quiet = answerWorkQuestion('What needs chasing at CFI?');
      assert.equal(quiet.answer, 'Nothing is saved for CFI Awarding yet, so there is nothing to chase.');
      assert.equal(quiet.risk_level, 'neutral');
      mockDb.clients.push({ id: 'cfi1', name: 'CFI Client Ltd', businessArea: 'CFI Awarding', status: 'Active' });
      const calm = answerWorkQuestion('What needs chasing at CFI?');
      assert.match(calm.answer, /^Nothing needs chasing at CFI Awarding from what is saved in Sloane/);
      assert.match(calm.key_reasons[0], /cannot see emails or Teams replies/);
      mockDb.clients.length = 0;
    });
  });

  describe('4. One business, and other questions', () => {
    test('4.1 "How is MTDflow doing?" says what is saved, or that nothing is', () => {
      assert.equal(answerWorkQuestion('How is MTDflow doing?').answer, 'Nothing is saved for MTDflow yet: no clients, deadlines, VAT returns or tasks.');
      const e = answerWorkQuestion('How is Emerald doing?');
      assert.match(e.answer, /^Emerald Education: 1 item is late, 2 fall due in the next 7 days\.$/);
    });

    test('4.2 other questions are left to the existing answers', () => {
      assert.equal(answerWorkQuestion('hello'), null);
      assert.equal(answerWorkQuestion('How many filings are red?'), null);
      assert.equal(answerWorkQuestion(''), null);
    });
  });

  describe('5. Over HTTP, and for the real AI model', () => {
    let server;
    let baseUrl;
    before(async () => {
      const app = createApp();
      await new Promise(resolve => { server = app.listen(PORT, () => { baseUrl = `http://localhost:${PORT}`; resolve(); }); });
    });
    after(async () => { if (server) await new Promise(resolve => server.close(resolve)); });

    test('5.1 the Ask Sloane route answers in the same plain way', async () => {
      const res = await fetch(`${baseUrl}/api/v1/ai/ask`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${TEST_API_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: "What's Mark working on?" })
      });
      assert.equal(res.status, 200);
      const body = await res.json();
      assert.match(body.data.answer, /^Mark Jones has 2 open tasks/);
    });

    test('5.2 the AI model is handed who is doing what and what is late or stuck', () => {
      const w = buildWorkContext();
      assert.equal(w.today, today);
      const mark = w.team.find(p => p.person === 'Mark Jones');
      assert.equal(mark.openTasks, 2);
      assert.equal(mark.nextUp[0].stuck, 'Waiting for the client');
      assert.ok(w.businesses.some(b => b.name === 'Emerald Education'));
      assert.ok(w.lateItems.some(i => i.client === 'Very Late Ltd' && i.daysLate === 40));
      const { allowedContext, privacyAudit } = ContextBuilder.buildContext({ clientId: null, query: 'Which clients are behind?', actor: {} });
      assert.ok(allowedContext.work && allowedContext.work.team.length > 0);
      assert.ok(privacyAudit.sanitizedFieldsIncluded.includes('team_and_business_work'));
    });
  });
});
