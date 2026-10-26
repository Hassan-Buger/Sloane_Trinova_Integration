/**
 * Unit 60 Test Suite: Ask Sloane investigates live records, and the morning note
 *
 * Verifies, with work spread over the businesses (dates relative to today, UK date):
 * - "Where are we with the MTDflow launch?" is answered from the saved tasks and notes (counts, who, last note),
 *   and honestly says when nothing is saved about it
 * - "What's happening across my businesses?" gives the briefing in short
 * - With an AI key set: exact questions about people and chasing still come from the records (the model is not called),
 *   and an open question sends the model the briefing, the business asked about, and what matches the question
 * - The morning note: written by the model from the figures only; dropped when it invents a number,
 *   says "on track", is too short/long, or the model is down; kept for a while so the page does not call it every time
 * - The note route needs a sign-in and answers { note: null } with no AI key
 */

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';

import { createApp } from '../src/app.js';
import { mockDb, DEFAULT_BUSINESSES } from '../src/data/db.js';
import { claudeService } from '../src/services/ai/claudeService.js';
import { answerWorkQuestion, searchWork, keywordsOf, buildWorkContext } from '../src/services/ai/workAnswers.js';
import { writeBriefingNote, checkNote, clearBriefingNoteCache, compactBriefing } from '../src/services/briefingNote.js';
import { buildMorningBriefing } from '../src/services/morningBriefing.js';
import { ukToday } from '../src/services/weeklyReport.js';
import { loginCookie } from './support.js';

const PORT = 5160;
const today = ukToday();
const plus = n => new Date(Date.parse(`${today}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10);
const KEYS = ['businesses', 'clients', 'companies', 'statutoryTracker', 'vatReturns', 'tasks', 'clientBusiness', 'teamMembers', 'suggestionDismissals'];
const task = (id, title, extra = {}) => ({ id, title, status: 'Pending', priority: 'Normal', dueDate: null, isBlocked: false, assigneeName: null, ...extra });

describe('Unit 60: Ask Sloane investigates live records', () => {
  let saved;
  const realFetch = globalThis.fetch;
  let geminiCalls;
  let geminiReply;
  const savedAi = {};

  before(() => {
    saved = {};
    for (const k of KEYS) { mockDb[k] = mockDb[k] || []; saved[k] = [...mockDb[k]]; mockDb[k].length = 0; }
    mockDb.businesses.push(...DEFAULT_BUSINESSES.map(b => ({ ...b })));
    mockDb.teamMembers.push({ id: 'tm1', name: 'Mark Jones' }, { id: 'tm2', name: 'Priya Shah' });
    mockDb.statutoryTracker.push({ id: 'dl1', origin: 'manual', companyNumber: '60000001', name: 'Late Ltd', accountsDueDate: plus(-12), confirmationDueDate: null, status: 'Active', businessArea: 'TriNova Accounting' });
    mockDb.tasks.push(
      task('l1', 'Launch: finish the sign-up page', { businessArea: 'MTDflow', assigneeName: 'Mark Jones', status: 'Completed', completedAt: new Date().toISOString() }),
      task('l2', 'Launch: test the VAT bridge', { businessArea: 'MTDflow', assigneeName: 'Mark Jones', dueDate: plus(-2), isBlocked: true, blocker: 'Waiting for HMRC sandbox keys', progressNotes: [{ text: 'HMRC have not replied to the sandbox request yet', by: 'Kirsty', at: new Date().toISOString() }] }),
      task('l3', 'Launch: write the help articles', { businessArea: 'MTDflow', assigneeName: 'Priya Shah', dueDate: plus(6) }),
      task('t1', 'Chase the bank statements', { businessArea: 'TriNova Accounting', assigneeName: 'Priya Shah', dueDate: plus(-3) }),
      task('e1', 'Plan the term', { businessArea: 'Emerald Education' })
    );
    // an AI key is "set", and the model's network call is faked
    for (const k of ['geminiApiKey', 'aiProvider', 'apiKey', 'client']) savedAi[k] = claudeService[k];
    claudeService.geminiApiKey = 'test-key';
    claudeService.aiProvider = 'gemini';
    claudeService.apiKey = '';
    claudeService.client = null;
    geminiCalls = [];
    geminiReply = () => ({ response_type: 'practice_assessment', answer: 'MTDflow has 3 launch tasks.', risk_level: 'amber', key_reasons: [], recommended_actions: [], evidence: [] });
    globalThis.fetch = async (url, init) => {
      if (String(url).includes('generativelanguage.googleapis.com')) {
        geminiCalls.push({ url: String(url), body: JSON.parse(init.body) });
        return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify(geminiReply()) }] } }] }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      return realFetch(url, init);
    };
  });

  after(() => {
    globalThis.fetch = realFetch;
    for (const k of Object.keys(savedAi)) claudeService[k] = savedAi[k];
    for (const k of KEYS) { mockDb[k].length = 0; mockDb[k].push(...saved[k]); }
  });

  describe('1. From the saved records', () => {
    test('1.1 the words worth searching for leave out filler, business names and people', () => {
      assert.deepEqual(keywordsOf('Where are we with the MTDflow launch?'), ['launch']);
      assert.deepEqual(keywordsOf("What's Mark working on?"), []);
    });

    test('1.2 "Where are we with the MTDflow launch?" counts done, open, late and stuck, and names who has what', () => {
      const r = answerWorkQuestion('Where are we with the MTDflow launch?');
      assert.equal(r.answer, '3 tasks about "launch" in MTDflow: 1 done, 2 open, 1 late, 1 stuck.');
      assert.equal(r.risk_level, 'red');
      const text = r.key_reasons.join('\n');
      assert.match(text, /Launch: test the VAT bridge - pending \(Mark Jones\), due .*stuck: Waiting for HMRC sandbox keys\. Last note: HMRC have not replied/);
      assert.match(text, /Launch: finish the sign-up page - completed \(Mark Jones\)/);
      assert.match(r.recommended_actions[0].action, /Unblock "Launch: test the VAT bridge"/);
    });

    test('1.3 something that is not saved is said plainly, with what IS saved for the business', () => {
      const r = answerWorkQuestion('Where are we with the MTDflow rebrand?');
      assert.match(r.answer, /^Sloane has no task, note or client about "rebrand" in MTDflow\./);
      assert.match(r.answer, /MTDflow:/);
      assert.equal(r.risk_level, 'neutral');
    });

    test('1.4 "What\'s happening across my businesses?" is the briefing in short', () => {
      const r = answerWorkQuestion("What's happening across my businesses?");
      assert.match(r.answer, /^\d+ things? needs? you first\. Across your businesses, /);
      assert.ok(r.key_reasons.some(x => /^MTDflow: /.test(x)));
      assert.ok(r.key_reasons.some(x => /Accounts for Late Ltd/.test(x)));
      assert.ok(r.recommended_actions.length >= 1);
    });

    test('1.5 searching finds tasks by words in their notes too', () => {
      const m = searchWork('what did HMRC say about the sandbox');
      assert.deepEqual(m.tasks.map(t => t.title), ['Launch: test the VAT bridge']);
      assert.equal(m.tasks[0].late, true);
      assert.equal(m.tasks[0].lastNote, 'HMRC have not replied to the sandbox request yet');
    });
  });

  describe('2. With an AI key set', () => {
    test('2.1 exact questions still come from the records, and the model is not asked', async () => {
      geminiCalls.length = 0;
      const people = await claudeService.ask({ query: "What's Mark working on?", context: { executiveOverview: {} } });
      assert.equal(people.source, 'sloane_work_answers');
      assert.match(people.data.answer, /^Mark Jones has 1 open task, 1 late, 1 stuck/);
      const chase = await claudeService.ask({ query: 'What needs chasing at MTDflow?', context: { executiveOverview: {} } });
      assert.equal(chase.source, 'sloane_work_answers');
      assert.equal(geminiCalls.length, 0);
    });

    test('2.2 an open question goes to the model with the briefing, the business and what matches', async () => {
      geminiCalls.length = 0;
      const { allowedContext } = (await import('../src/services/ai/contextBuilder.js')).ContextBuilder.buildContext({ clientId: null, query: 'Is the MTDflow launch going to be ready for the HMRC sandbox?', actor: {} });
      const res = await claudeService.ask({ query: 'Is the MTDflow launch going to be ready for the HMRC sandbox?', context: allowedContext });
      assert.equal(res.source, 'google_gemini');
      assert.equal(res.data.answer, 'MTDflow has 3 launch tasks.');
      assert.equal(geminiCalls.length, 1);
      const sent = geminiCalls[0].body.contents.at(-1).parts[0].text;
      assert.match(sent, /"focusBusiness"/);
      assert.match(sent, /"business": "MTDflow"/);
      assert.match(sent, /Launch: test the VAT bridge/);
      assert.match(sent, /"matches"/);
      assert.match(sent, /HMRC have not replied to the sandbox request yet/);
      assert.match(sent, /"briefing"/);
      assert.match(sent, /"doFirst"/);
    });

    test('2.3 the context carries no private notes and stays a sensible size', () => {
      const ctx = buildWorkContext(new Date(), { query: 'Where are we with the MTDflow launch?' });
      const text = JSON.stringify(ctx);
      assert.ok(text.length < 20000, `context is ${text.length} characters`);
      assert.equal(/ceoNotes|privateNote|password/i.test(text), false);
      assert.ok(ctx.focusBusiness && ctx.focusBusiness.business === 'MTDflow');
    });

    test('2.4 the model is told how to investigate and never to invent', async () => {
      const prompts = await import('../src/services/ai/prompts.js');
      assert.match(prompts.SLOANE_SYSTEM_PROMPT, /INVESTIGATING WITH LIVE RECORDS/);
      assert.match(prompts.SLOANE_SYSTEM_PROMPT, /never invent progress, dates or people/);
      assert.match(prompts.BRIEFING_NOTE_PROMPT, /ONLY the figures/);
    });
  });

  describe('3. The morning note', () => {
    const goodNote = b => `${b.counts.late} items are late and ${b.counts.stuckTasks} task is stuck. Start with Accounts for Late Ltd, then unblock the stuck launch work.`;

    test('3.1 a note written from the figures is shown, and kept for a while', async () => {
      clearBriefingNoteCache();
      const b = buildMorningBriefing();
      geminiCalls.length = 0;
      geminiReply = () => ({ response_type: 'conversational', answer: goodNote(b), risk_level: null, key_reasons: [], recommended_actions: [], evidence: [] });
      const first = await writeBriefingNote(b);
      assert.equal(first.source, 'google_gemini');
      assert.match(first.note, /^\d+ items are late and 1 task is stuck\./);
      assert.match(geminiCalls[0].body.contents.at(-1).parts[0].text, /THE BRIEFING FIGURES/);
      assert.equal(JSON.stringify(compactBriefing(b)).includes('privateNote'), false);
      await writeBriefingNote(b);
      assert.equal(geminiCalls.length, 1, 'the second page load did not call the model again');
    });

    test('3.2 a note that invents a number, says "on track", or is the wrong length is dropped', async () => {
      const b = buildMorningBriefing();
      const figures = JSON.stringify(compactBriefing(b));
      assert.equal(checkNote('Forty-seven things are late and 9999 clients are waiting on you today.', figures), null, 'a number that is not in the figures');
      assert.equal(checkNote('Everything is on track across the four businesses, so you can relax today.', figures), null);
      assert.equal(checkNote('Fine.', figures), null);
      assert.equal(checkNote('x'.repeat(901), figures), null);
      assert.ok(checkNote(goodNote(b), figures));
      clearBriefingNoteCache();
      geminiReply = () => ({ response_type: 'conversational', answer: 'There are 4821 late items and nothing is on track at all, so panic now.', risk_level: null, key_reasons: [], recommended_actions: [], evidence: [] });
      const out = await writeBriefingNote(b);
      assert.deepEqual(out, { note: null, reason: 'rejected' });
    });

    test('3.3 no AI key, or the model down, means no note and no error', async () => {
      clearBriefingNoteCache();
      const b = buildMorningBriefing();
      assert.deepEqual(await writeBriefingNote(b, { ai: { isConfigured: () => false } }), { note: null, reason: 'no_ai' });
      assert.deepEqual(await writeBriefingNote(b, { ai: { isConfigured: () => true, ask: async () => { throw new Error('down'); } } }), { note: null, reason: 'ai_unavailable' });
      assert.deepEqual(await writeBriefingNote(b, { ai: { isConfigured: () => true, ask: async () => ({ source: 'sloane_rules_engine', data: { answer: 'The wrong kind of answer for a note, produced by rules.' } }) } }), { note: null, reason: 'ai_unavailable' });
    });
  });

  describe('4. The route', () => {
    let server;
    let baseUrl;
    before(async () => {
      clearBriefingNoteCache();
      const app = createApp();
      await new Promise(resolve => { server = app.listen(PORT, () => { baseUrl = `http://localhost:${PORT}`; resolve(); }); });
    });
    after(async () => { if (server) await new Promise(resolve => server.close(resolve)); });

    test('4.1 needs a sign-in; gives the note when there is one and { note: null } when there is not', async () => {
      assert.equal((await fetch(`${baseUrl}/api/v1/reports/morning/note`)).status, 401);
      const cookie = await loginCookie(baseUrl);
      const b = buildMorningBriefing();
      geminiReply = () => ({ response_type: 'conversational', answer: goodNoteFor(b), risk_level: null, key_reasons: [], recommended_actions: [], evidence: [] });
      const withAi = await (await fetch(`${baseUrl}/api/v1/reports/morning/note`, { headers: { Cookie: cookie } })).json();
      assert.match(withAi.data.note, /items are late/);
      claudeService.geminiApiKey = '';
      clearBriefingNoteCache();
      const without = await (await fetch(`${baseUrl}/api/v1/reports/morning/note`, { headers: { Cookie: cookie } })).json();
      assert.deepEqual(without.data, { note: null, reason: 'no_ai' });
      claudeService.geminiApiKey = 'test-key';
    });
  });
});

function goodNoteFor(b) {
  return `${b.counts.late} items are late and ${b.counts.stuckTasks} task is stuck. Start with Accounts for Late Ltd, then unblock the stuck launch work.`;
}
