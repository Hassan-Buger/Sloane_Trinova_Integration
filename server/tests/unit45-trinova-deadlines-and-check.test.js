/**
 * Unit 45 Test Suite: TriNova's deadlines feed and the "Check TriNova data" button
 *
 * Verifies (with a stand-in for the TriNova portal, so nothing real is contacted):
 * - The deadlines feed is understood whether it lists companies or individual deadlines
 * - Filed deadlines are skipped, UK dates are read, rows that cannot be read are only counted
 * - TriNova's deadlines appear on the Deadlines list, your own dates still win, and a date
 *   missing from the feed is filled in from the TriNova client record
 * - The check reports field names and counts, never client names, emails, numbers or dates
 * - The check button needs a sign-in, says plainly when TriNova is not set up, and cannot be
 *   run again within a few seconds
 */

import { test, describe, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import { createApp } from '../src/app.js';
import { mockDb } from '../src/data/db.js';
import { clientDirectory } from '../src/services/clientDirectory.js';
import { trinovaDeadlines, normaliseTrinovaDeadlines, toIsoDate } from '../src/services/trinovaDeadlines.js';
import { runTrinovaCheck } from '../src/services/trinovaCheck.js';
import { buildDeadlineList } from '../src/routes/statutory.js';
import { TEST_API_KEY } from './fixtures.js';

const PORT = 5045;
const TRINOVA_KEY = 'unit45-trinova-key-not-a-real-secret';
const auth = { Authorization: `Bearer ${TEST_API_KEY}` };
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

// Real-looking values that must never appear in a check report
const SECRET_NAME = 'Hollybush Secret Bakery Ltd';
const SECRET_EMAIL = 'owner@hollybush-secret.example';
const SECRET_NUMBER = '09876543';
const SECRET_DATE = '2027-03-31';

describe('Unit 45: TriNova deadlines and the data check', () => {
  describe('1. Reading the deadlines feed', () => {
    test('1.1 one row per company, snake_case fields', () => {
      const r = normaliseTrinovaDeadlines({
        status: 'success',
        data: [
          { company_number: '01234567', company_name: 'Alpha Ltd', accounts_due: '2027-01-31', confirmation_statement_due: '2026-12-01T00:00:00Z', year_end: '2026-04-30' },
          { companyNumber: 'sc123456', name: 'Beta Ltd', accountsDueDate: '2027-02-28' }
        ]
      });
      assert.equal(r.listFound, true);
      assert.equal(r.total, 2);
      assert.equal(r.understood, 2);
      const alpha = r.rows.find(x => x.companyNumber === '01234567');
      assert.equal(alpha.name, 'Alpha Ltd');
      assert.equal(alpha.accountsDueDate, '2027-01-31');
      assert.equal(alpha.confirmationDueDate, '2026-12-01');
      assert.equal(alpha.yearEnd, '2026-04-30');
      const beta = r.rows.find(x => x.companyNumber === 'SC123456');
      assert.equal(beta.name, 'Beta Ltd', 'a plain "name" on a company row is the company name');
    });

    test('1.2 one row per deadline: grouped by company, filed ones skipped, earliest open date kept', () => {
      const r = normaliseTrinovaDeadlines({
        data: {
          items: [
            { company_number: '01234567', company_name: 'Alpha Ltd', type: 'Annual accounts', due_date: '2027-01-31' },
            { company_number: '01234567', company_name: 'Alpha Ltd', type: 'Annual accounts', due_date: '2026-01-31', status: 'Filed' },
            { company_number: '01234567', company_name: 'Alpha Ltd', type: 'Confirmation statement', due_date: '01/12/2026' },
            { company_number: '01234567', name: 'VAT return', due_date: '2026-11-07' },
            { company: { company_number: '07654321', name: 'Gamma Ltd' }, title: 'CS01', dueDate: '2026-10-30' }
          ]
        }
      });
      assert.equal(r.total, 5);
      const alpha = r.rows.find(x => x.companyNumber === '01234567');
      assert.equal(alpha.accountsDueDate, '2027-01-31', 'the filed 2026 accounts are skipped');
      assert.equal(alpha.confirmationDueDate, '2026-12-01', 'UK date read');
      assert.equal(alpha.name, 'Alpha Ltd');
      const gamma = r.rows.find(x => x.companyNumber === '07654321');
      assert.equal(gamma.name, 'Gamma Ltd');
      assert.equal(gamma.confirmationDueDate, '2026-10-30');
      assert.equal(r.understood, 4, 'the VAT row is not a Companies House deadline, so it is only counted');
    });

    test('1.3 a company row with its own list of deadlines', () => {
      const r = normaliseTrinovaDeadlines([
        { id: 9, name: 'Delta Ltd', company_number: '11112222', deadlines: [
          { type: 'accounts', due_date: '2027-05-31' },
          { type: 'confirmation', due_date: '2027-01-15', completed: true }
        ] }
      ]);
      assert.equal(r.rows.length, 1);
      assert.equal(r.rows[0].name, 'Delta Ltd');
      assert.equal(r.rows[0].accountsDueDate, '2027-05-31');
      assert.equal(r.rows[0].confirmationDueDate, null, 'a completed deadline is not shown as due');
    });

    test('1.4 an answer with no list, and dates in odd formats', () => {
      assert.equal(normaliseTrinovaDeadlines({ status: 'ok', message: 'nothing' }).listFound, false);
      assert.equal(toIsoDate('2027-03-31T10:00:00Z'), '2027-03-31');
      assert.equal(toIsoDate('5/4/2027'), '2027-04-05');
      assert.equal(toIsoDate('next Tuesday'), null);
      assert.equal(toIsoDate(null), null);
    });
  });

  describe('2. On the Deadlines list', () => {
    const added = [];

    beforeEach(() => {
      trinovaDeadlines.clear();
      clientDirectory.clearTrinova();
      for (const id of added.splice(0)) {
        const i = mockDb.statutoryTracker.findIndex(r => r.id === id);
        if (i >= 0) mockDb.statutoryTracker.splice(i, 1);
      }
    });

    after(() => {
      trinovaDeadlines.clear();
      clientDirectory.clearTrinova();
      for (const id of added.splice(0)) {
        const i = mockDb.statutoryTracker.findIndex(r => r.id === id);
        if (i >= 0) mockDb.statutoryTracker.splice(i, 1);
      }
    });

    test('2.1 a TriNova deadline shows as "trinova", linked to the TriNova client, with a missing date filled in', () => {
      clientDirectory.setTrinovaClients([
        { id: 501, name: 'Epsilon Ltd', company_number: '55556666', confirmation_statement_due: '2026-12-20' }
      ]);
      trinovaDeadlines.setFeed({ data: [{ company_number: '55556666', type: 'Annual accounts', due_date: '2027-02-28' }] });

      const row = buildDeadlineList().find(r => r.companyNumber === '55556666');
      assert.ok(row, 'the TriNova deadline is on the list');
      assert.equal(row.origin, 'trinova');
      assert.equal(row.clientId, '501');
      assert.equal(row.name, 'Epsilon Ltd', 'the name comes from the TriNova client when the feed has none');
      assert.equal(row.accountsDueDate, '2027-02-28');
      assert.equal(row.confirmationDueDate, '2026-12-20', 'filled in from the TriNova client record');
    });

    test('2.2 your own dates still win over TriNova\'s', () => {
      trinovaDeadlines.setFeed({ data: [{ company_number: '77778888', company_name: 'Zeta Ltd', accounts_due: '2027-02-28' }] });
      const mine = { id: 'dl_unit45_mine', origin: 'manual', companyNumber: '77778888', name: 'Zeta Ltd', accountsDueDate: '2027-06-30', confirmationDueDate: null, status: 'Active', notes: '' };
      mockDb.statutoryTracker.unshift(mine);
      added.push(mine.id);

      const rows = buildDeadlineList().filter(r => r.companyNumber === '77778888');
      assert.equal(rows.length, 1, 'one row per company');
      assert.equal(rows[0].origin, 'manual');
      assert.equal(rows[0].accountsDueDate, '2027-06-30');
    });

    test('2.3 nothing from TriNova when the feed is empty', () => {
      trinovaDeadlines.setFeed({ data: [] });
      assert.equal(buildDeadlineList().filter(r => r.origin === 'trinova').length, 0);
    });
  });

  describe('3. The check report holds no client data', () => {
    const fakeTrinova = async (path) => {
      if (path === '/health') return { status: 200, ok: true, json: { status: 'ok' } };
      if (path === '/auth/verify') return { status: 200, ok: true, json: { status: 'authenticated', actor: { name: 'Sloane integration' } } };
      if (path.startsWith('/clients')) {
        return { status: 200, ok: true, json: { data: [{ id: 42, name: SECRET_NAME, email: SECRET_EMAIL, company_number: SECRET_NUMBER, accounts_due: SECRET_DATE }], pagination: { hasMore: false } } };
      }
      if (path === '/statutory') {
        return { status: 200, ok: true, json: { data: [{ company_number: SECRET_NUMBER, company_name: SECRET_NAME, type: 'Annual accounts', due_date: SECRET_DATE }] } };
      }
      if (path.startsWith('/companies/42')) return { status: 404, ok: false, json: { error: { code: 'NOT_FOUND', message: 'No such route' } } };
      return { status: 404, ok: false, json: null };
    };

    test('3.1 field names and counts only', async () => {
      const lines = [];
      const report = await runTrinovaCheck({ get: fakeTrinova, base: 'https://trinova.example/api/v1', log: l => lines.push(l) });
      const text = JSON.stringify(report) + lines.join('\n');
      for (const secret of [SECRET_NAME, SECRET_EMAIL, SECRET_NUMBER, SECRET_DATE, 'Hollybush']) {
        assert.equal(text.includes(secret), false, `the report must not contain "${secret}"`);
      }
      assert.equal(report.summary.keyAccepted, true);
      assert.deepEqual(report.summary.deadlines, { listFound: true, rowsInFeed: 1, rowsSloaneCanRead: 1, companiesWithDates: 1 });
      const steps = report.steps.map(s => s.path);
      assert.ok(steps.includes('/statutory'));
      assert.ok(steps.includes('/companies/42/notes'), 'notes are asked about too');
      assert.ok(lines.some(l => /Sloane can read 1 of 1 row/.test(l)));
    });

    test('3.2 a refused key stops the check and says so plainly', async () => {
      const get = async (path) => path === '/auth/verify'
        ? { status: 401, ok: false, json: { error: { code: 'UNAUTHORIZED', message: 'Bad key' } } }
        : { status: 200, ok: true, json: { status: 'ok' } };
      const report = await runTrinovaCheck({ get, base: 'x' });
      assert.equal(report.summary.keyAccepted, false);
      assert.match(report.summary.message, /refused the key/);
      assert.equal(report.steps.length, 2, 'no client questions are asked with a refused key');
    });
  });

  describe('4. The check button and the live deadlines feed', () => {
    let server;
    let baseUrl;
    const realFetch = globalThis.fetch;
    const savedEnv = {};
    let trinovaCalls;

    before(async () => {
      savedEnv.NODE_ENV = process.env.NODE_ENV;
      savedEnv.TRINOVA_API_KEY = process.env.TRINOVA_API_KEY;
      const app = createApp();
      await new Promise(resolve => {
        server = app.listen(PORT, () => {
          baseUrl = `http://localhost:${PORT}`;
          resolve();
        });
      });
      globalThis.fetch = async (url, opts) => {
        const href = String(url);
        if (href.startsWith(baseUrl)) return realFetch(url, opts);
        trinovaCalls.push({ url: href, headers: opts?.headers || {} });
        const path = new URL(href).pathname.replace(/^\/api\/v1/, '');
        if (path === '/health') return json({ status: 'ok' });
        if (path === '/auth/verify') return json({ status: 'authenticated' });
        if (path === '/clients') return json({ data: [{ id: 77, name: 'Eta Ltd', company_number: '33334444' }], pagination: { hasMore: false } });
        if (path === '/statutory') return json({ data: [{ company_number: '33334444', type: 'Annual accounts', due_date: '2027-03-31' }] });
        return json({ error: { code: 'NOT_FOUND', message: 'Not here' } }, 404);
      };
    });

    beforeEach(() => {
      trinovaCalls = [];
      trinovaDeadlines.clear();
      clientDirectory.clearTrinova();
      process.env.NODE_ENV = 'development';   // so the live TriNova path is used
      delete process.env.TRINOVA_API_KEY;
    });

    after(async () => {
      globalThis.fetch = realFetch;
      process.env.NODE_ENV = savedEnv.NODE_ENV;
      if (savedEnv.TRINOVA_API_KEY === undefined) delete process.env.TRINOVA_API_KEY; else process.env.TRINOVA_API_KEY = savedEnv.TRINOVA_API_KEY;
      trinovaDeadlines.clear();
      clientDirectory.clearTrinova();
      if (server) await new Promise(resolve => server.close(resolve));
    });

    test('4.1 the button needs a sign-in', async () => {
      const res = await realFetch(`${baseUrl}/api/v1/integrations/trinova/check`);
      assert.equal(res.status, 401);
    });

    test('4.2 with no TriNova key it says so and calls nobody', async () => {
      const res = await realFetch(`${baseUrl}/api/v1/integrations/trinova/check`, { headers: auth });
      const body = await res.json();
      assert.equal(res.status, 200);
      assert.equal(body.data.configured, false);
      assert.match(body.data.message, /not set up/);
      assert.equal(trinovaCalls.length, 0);
    });

    test('4.3 with a key: the report comes back, the key goes only to TriNova, and a second run is held back', async () => {
      process.env.TRINOVA_API_KEY = TRINOVA_KEY;
      const res = await realFetch(`${baseUrl}/api/v1/integrations/trinova/check`, { headers: auth });
      const body = await res.json();
      assert.equal(res.status, 200);
      assert.equal(body.data.configured, true);
      assert.ok(Array.isArray(body.data.lines) && body.data.lines.length > 0);
      assert.equal(body.data.report.summary.deadlines.rowsSloaneCanRead, 1);
      assert.equal(JSON.stringify(body).includes(TRINOVA_KEY), false, 'the key is never sent to the browser');
      assert.equal(JSON.stringify(body).includes('Eta Ltd'), false, 'no client names in the report');
      const withKey = trinovaCalls.filter(c => (c.headers.Authorization || '') === `Bearer ${TRINOVA_KEY}`);
      assert.ok(withKey.length >= 3, 'TriNova is asked with the TriNova key');
      assert.equal(trinovaCalls.some(c => (c.headers.Authorization || '').includes(TEST_API_KEY)), false, 'Sloane\'s own key is never sent to TriNova');

      const again = await realFetch(`${baseUrl}/api/v1/integrations/trinova/check`, { headers: auth });
      assert.equal(again.status, 429);
      assert.match((await again.json()).error.message, /wait a few seconds/);
    });

    test('4.4 the Deadlines list reads TriNova\'s feed and says it did', async () => {
      process.env.TRINOVA_API_KEY = TRINOVA_KEY;
      const res = await realFetch(`${baseUrl}/api/v1/statutory?refresh=1`, { headers: auth });
      const body = await res.json();
      assert.equal(res.status, 200);
      const row = body.data.find(r => r.companyNumber === '33334444');
      assert.ok(row, 'the TriNova deadline is listed');
      assert.equal(row.origin, 'trinova');
      assert.equal(row.name, 'Eta Ltd');
      assert.equal(row.accountsDueDate, '2027-03-31');
      assert.equal(body.meta.trinovaDeadlinesStatus, 'ok');
      assert.ok(body.meta.trinovaDeadlineCount >= 1);
      assert.ok(trinovaCalls.some(c => c.url.includes('/statutory')), 'TriNova\'s deadlines feed was read');
    });

    test('4.5 a TriNova without a deadlines feed is reported as not available, and the list still loads', async () => {
      process.env.TRINOVA_API_KEY = TRINOVA_KEY;
      const saved = globalThis.fetch;
      globalThis.fetch = async (url, opts) => {
        if (String(url).includes('/statutory') && !String(url).startsWith(baseUrl)) return json({ error: { code: 'NOT_FOUND', message: 'No route' } }, 404);
        return saved(url, opts);
      };
      try {
        const res = await realFetch(`${baseUrl}/api/v1/statutory?refresh=1`, { headers: auth });
        const body = await res.json();
        assert.equal(res.status, 200);
        assert.equal(body.meta.trinovaDeadlinesStatus, 'not_available');
      } finally {
        globalThis.fetch = saved;
      }
    });
  });

  describe('5. The button is on the panel', () => {
    test('5.1 index.html has the button and app.js handles it', async () => {
      const fs = await import('node:fs');
      const path = await import('node:path');
      const { fileURLToPath } = await import('node:url');
      const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
      const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
      const app = fs.readFileSync(path.join(root, 'scripts', 'app.js'), 'utf8');
      assert.ok(html.includes('id="btnCheckTrinovaData"'));
      assert.ok(app.includes("getElementById('btnCheckTrinovaData')"));
      assert.ok(app.includes('handleCheckTrinovaData'));
      assert.equal(app.includes("'TriNova is connected.'"), false, 'the server check no longer claims TriNova is connected');
    });
  });
});
