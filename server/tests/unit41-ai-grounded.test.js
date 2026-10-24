/**
 * Unit 41 Test Suite: "Ask Sloane" and the morning briefing only use real records
 *
 * Verifies, with no AI key set (so the built-in rules answer):
 * - An empty install never mentions the example companies or people
 * - Real records (a client added in Sloane, a live TriNova client, a stuck task) show up in answers
 * - A made-up client name is reported as not found, without claims about TriNova's portfolio
 * - A follow-up like "tell me more about the first company you mentioned" uses the earlier answer
 * - The morning briefing is built from real deadlines and tasks
 */

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

import { createApp } from '../src/app.js';
import { mockDb, resetData } from '../src/data/db.js';
import { clientDirectory } from '../src/services/clientDirectory.js';
import { TEST_API_KEY } from './fixtures.js';

const PORT = 5041;
const auth = { Authorization: `Bearer ${TEST_API_KEY}`, 'Content-Type': 'application/json' };
const EXAMPLES = /woofington|jenkins|r gb elevations|rgb|hamza|alpha delta|cfi awarding/i;

function isoInDays(n) {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

describe('Unit 41: Ask Sloane uses real records only', () => {
  let server;
  let baseUrl;
  const ask = async (message, history = []) => {
    const res = await fetch(`${baseUrl}/api/v1/ai/ask`, { method: 'POST', headers: auth, body: JSON.stringify({ message, history }) });
    assert.equal(res.status, 200);
    return (await res.json()).data;
  };
  const text = d => JSON.stringify(d);

  before(async () => {
    resetData(false);                    // an empty, real-style install
    clientDirectory.clearTrinova();
    const app = createApp();
    await new Promise(resolve => {
      server = app.listen(PORT, () => {
        baseUrl = `http://localhost:${PORT}`;
        resolve();
      });
    });
  });

  after(async () => {
    resetData(true);
    clientDirectory.clearTrinova();
    if (server) await new Promise(resolve => server.close(resolve));
  });

  describe('1. Empty install', () => {
    test('1.1 Practice questions say nothing is saved yet, with no example names', async () => {
      for (const q of ['Show high risk client alerts.', 'Which company needs the most urgent attention?', 'How many companies are flagged red?', 'What should I focus on today?']) {
        const d = await ask(q);
        assert.doesNotMatch(text(d), EXAMPLES, q);
      }
      const d = await ask('Show high risk client alerts.');
      assert.match(d.answer, /Nothing is saved in Sloane yet/);
    });

    test('1.2 The morning briefing is empty and honest', async () => {
      const res = await fetch(`${baseUrl}/api/v1/ai/executive-briefing`, { headers: auth });
      const b = (await res.json()).data;
      assert.doesNotMatch(text(b), EXAMPLES);
      assert.match(b.summary, /nothing to report yet/i);
      assert.deepEqual(b.priorities, []);
      assert.deepEqual(b.critical_risks, []);
      assert.deepEqual(b.upcoming_deadlines, []);
      assert.equal(b.client_count, 0);
    });

    test('1.3 Looking up a client that does not exist does not talk about "TriNova\'s portfolio"', async () => {
      const d = await ask('Is there a client named Zebra Plumbing?');
      assert.match(d.answer, /no client or company called/i);
      assert.doesNotMatch(d.answer, /portfolio|priority attention/i);
    });
  });

  describe('2. With real records', () => {
    before(async () => {
      await fetch(`${baseUrl}/api/v1/clients`, {
        method: 'POST', headers: auth,
        body: JSON.stringify({ name: 'Hollybush Bakery Ltd', no: '04040404', accounts: isoInDays(3), confirm: isoInDays(200) })
      });
      clientDirectory.setTrinovaClients([{ id: 'tn-4001', name: 'Marlow Plumbing Ltd', company_number: '05050505', accounts_due: isoInDays(-5) }]);
      await fetch(`${baseUrl}/api/v1/tasks`, {
        method: 'POST', headers: { ...auth, 'Idempotency-Key': randomUUID() },
        body: JSON.stringify({ title: 'Chase the landlord', general: true, isBlocked: true, blocker: 'Waiting for a reply' })
      });
    });

    test('2.1 The RED count names the clients that really are RED (Sloane and TriNova)', async () => {
      const d = await ask('How many companies are flagged red?');
      assert.match(d.answer, /2 filings are flagged RED/);
      assert.match(d.answer, /Hollybush Bakery Ltd/);
      assert.match(d.answer, /Marlow Plumbing Ltd/);
      assert.doesNotMatch(text(d), EXAMPLES);
    });

    test('2.2 The most urgent question picks a real client and gives its real reason', async () => {
      const d = await ask('Which company needs the most urgent attention, and why?');
      assert.match(d.answer, /Marlow Plumbing Ltd|Hollybush Bakery Ltd/);
      assert.doesNotMatch(d.answer, /strike-off/i, 'no invented strike-off notice');
    });

    test('2.3 The overview counts RED filings and stuck tasks', async () => {
      const d = await ask('What should I focus on today?');
      assert.match(d.answer, /2 filings are RED/);
      assert.match(d.answer, /1 task is stuck/);
      assert.ok(d.key_reasons.some(r => /Chase the landlord/.test(r)));
    });

    test('2.4 A TriNova client can be found by name', async () => {
      const d = await ask('Is there a client named Marlow Plumbing?');
      assert.doesNotMatch(d.answer, /no client or company called/i);
    });

    test('2.5 "Tell me more about the first company you mentioned" uses the earlier answer', async () => {
      const history = [
        { role: 'user', content: 'Which company needs the most urgent attention?' },
        { role: 'assistant', content: 'Marlow Plumbing Ltd is the most urgent.' }
      ];
      const d = await ask('Tell me more about the first company you mentioned.', history);
      assert.match(d.answer, /About Marlow Plumbing Ltd/);
      assert.ok(d.key_reasons.length > 0);
    });

    test('2.6 The morning briefing lists the real RED filings, stuck tasks and what is due soon', async () => {
      const res = await fetch(`${baseUrl}/api/v1/ai/executive-briefing`, { headers: auth });
      const b = (await res.json()).data;
      assert.doesNotMatch(text(b), EXAMPLES);
      assert.match(b.summary, /2 filings are RED and 1 task is stuck/);
      assert.ok(b.critical_risks.some(r => r.startsWith('Hollybush Bakery Ltd')));
      assert.ok(b.priorities.some(p => /Chase the landlord/.test(p)));
      assert.ok(b.upcoming_deadlines.some(x => x.startsWith('Hollybush Bakery Ltd: accounts due')));
      assert.ok(b.recommended_focus.some(x => /Chase the landlord/.test(x)));
      assert.equal(b.client_count, 2);
      assert.equal(b.blocked_tasks_count, 1);
    });
  });
});
