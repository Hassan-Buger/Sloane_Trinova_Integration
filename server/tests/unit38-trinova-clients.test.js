/**
 * Unit 38 Test Suite: Reading live clients from TriNova
 *
 * Verifies (with a stand-in for the TriNova portal, so nothing real is contacted):
 * - With no TRINOVA_API_KEY, Sloane does not call TriNova at all and says so
 * - With a key, the key is sent as the bearer token, and Sloane's own key never is
 * - Clients from TriNova and clients added in Sloane appear together
 * - Clients read from TriNova can then have tasks, notes and documents attached
 * - A TriNova outage is reported as "unreachable" while Sloane's own clients still show
 * - The full client list is read page by page for deadlines
 */

import { test, describe, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

import { createApp } from '../src/app.js';
import { mockDb } from '../src/data/db.js';
import { clientDirectory, normaliseTrinovaClient } from '../src/services/clientDirectory.js';
import { TEST_API_KEY } from './fixtures.js';

const PORT = 5038;
const TRINOVA_KEY = 'unit38-trinova-key-not-a-real-secret';
const auth = { Authorization: `Bearer ${TEST_API_KEY}`, 'Content-Type': 'application/json' };

describe('Unit 38: TriNova clients', () => {
  let server;
  let baseUrl;
  const realFetch = globalThis.fetch;
  let trinovaCalls;
  let trinovaHandler;
  const savedEnv = {};

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
      return trinovaHandler(href, opts);
    };
  });

  beforeEach(() => {
    trinovaCalls = [];
    trinovaHandler = async () => new Response(JSON.stringify({ data: [], pagination: { hasMore: false } }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    clientDirectory.clearTrinova();
    process.env.NODE_ENV = 'development';   // so /clients uses the live path, not the sample list
    delete process.env.TRINOVA_API_KEY;
  });

  after(async () => {
    globalThis.fetch = realFetch;
    process.env.NODE_ENV = savedEnv.NODE_ENV;
    if (savedEnv.TRINOVA_API_KEY === undefined) delete process.env.TRINOVA_API_KEY; else process.env.TRINOVA_API_KEY = savedEnv.TRINOVA_API_KEY;
    clientDirectory.clearTrinova();
    if (server) await new Promise(resolve => server.close(resolve));
  });

  const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

  describe('1. Without a key', () => {
    test('1.1 TriNova is not called, and the answer says why', async () => {
      const res = await realFetch(`${baseUrl}/api/v1/clients`, { headers: auth });
      const body = await res.json();
      assert.equal(res.status, 200);
      assert.equal(body.meta.trinovaStatus, 'not_configured');
      assert.equal(trinovaCalls.length, 0);
    });

    test('1.2 Clients added in Sloane still show', async () => {
      const created = await (await realFetch(`${baseUrl}/api/v1/clients`, { method: 'POST', headers: auth, body: JSON.stringify({ name: 'Unit38 Own Client' }) })).json();
      const body = await (await realFetch(`${baseUrl}/api/v1/clients`, { headers: auth })).json();
      assert.ok(body.data.find(c => c.id === created.data.id));
    });
  });

  describe('2. With a key', () => {
    test('2.1 The TriNova key (not Sloane\'s own key) is sent', async () => {
      process.env.TRINOVA_API_KEY = TRINOVA_KEY;
      trinovaHandler = async () => json({ data: [{ id: 'tn-9001', name: 'Live One', company_number: '88880001' }], pagination: { hasMore: false } });
      const res = await realFetch(`${baseUrl}/api/v1/clients`, { headers: auth });
      assert.equal(res.status, 200);
      assert.equal(trinovaCalls.length, 1);
      assert.equal(trinovaCalls[0].headers.Authorization, `Bearer ${TRINOVA_KEY}`);
      assert.notEqual(trinovaCalls[0].headers.Authorization, `Bearer ${TEST_API_KEY}`);
    });

    test('2.2 Live and Sloane clients appear together, and the status is ok', async () => {
      process.env.TRINOVA_API_KEY = TRINOVA_KEY;
      trinovaHandler = async () => json({ data: [{ id: 'tn-9002', name: 'Live Two' }], pagination: { hasMore: false } });
      const body = await (await realFetch(`${baseUrl}/api/v1/clients`, { headers: auth })).json();
      assert.equal(body.meta.trinovaStatus, 'ok');
      assert.ok(body.data.find(c => c.id === 'tn-9002'));
      assert.ok(body.data.find(c => c.addedInSloane), 'Sloane client also listed');
    });

    test('2.3 After they are read, tasks, notes and documents can be attached to them', async () => {
      process.env.TRINOVA_API_KEY = TRINOVA_KEY;
      trinovaHandler = async () => json({ data: [{ id: 'tn-9003', name: 'Attach To Me' }], pagination: { hasMore: false } });
      await realFetch(`${baseUrl}/api/v1/clients`, { headers: auth });

      const task = await realFetch(`${baseUrl}/api/v1/tasks`, { method: 'POST', headers: { ...auth, 'Idempotency-Key': randomUUID() }, body: JSON.stringify({ title: 'For live client', clientId: 'tn-9003' }) });
      assert.equal(task.status, 201);
      const note = await realFetch(`${baseUrl}/api/v1/companies/tn-9003/notes`, { method: 'POST', headers: auth, body: JSON.stringify({ text: 'A note', confirm_write_to_trinova: true }) });
      assert.equal(note.status, 201);
      const doc = await realFetch(`${baseUrl}/api/v1/companies/tn-9003/documents/upload`, { method: 'POST', headers: { ...auth, 'Idempotency-Key': randomUUID() }, body: JSON.stringify({ filename: 'x.txt', content: 'hello' }) });
      assert.equal(doc.status, 201);
    });

    test('2.4 A client that was never read from TriNova is refused with a plain message', async () => {
      const res = await realFetch(`${baseUrl}/api/v1/companies/tn-never-seen/notes`, { method: 'POST', headers: auth, body: JSON.stringify({ text: 'x', confirm_write_to_trinova: true }) });
      assert.equal(res.status, 404);
      assert.match((await res.json()).error.message, /could not find that client/i);
    });
  });

  describe('3. When TriNova is down', () => {
    test('3.1 The status is "unreachable" and Sloane\'s own clients still show', async () => {
      process.env.TRINOVA_API_KEY = TRINOVA_KEY;
      trinovaHandler = async () => { throw new Error('connect ECONNREFUSED'); };
      const res = await realFetch(`${baseUrl}/api/v1/clients`, { headers: auth });
      const body = await res.json();
      assert.equal(res.status, 200);
      assert.equal(body.meta.trinovaStatus, 'unreachable');
      assert.ok(body.data.every(c => c.addedInSloane));
    });

    test('3.2 A TriNova error answer is treated the same way', async () => {
      process.env.TRINOVA_API_KEY = TRINOVA_KEY;
      trinovaHandler = async () => json({ error: 'nope' }, 503);
      const body = await (await realFetch(`${baseUrl}/api/v1/clients`, { headers: auth })).json();
      assert.equal(body.meta.trinovaStatus, 'unreachable');
    });
  });

  describe('5. Search, filter and paging happen in Sloane (so they really work)', () => {
    const feed = () => {
      process.env.TRINOVA_API_KEY = TRINOVA_KEY;
      trinovaHandler = async () => json({
        data: [
          { id: 'f1', name: 'Alpha Bakery Ltd', company_number: '10000001', directors: ['Ann Baker'] },
          { id: 'f2', name: 'Bravo Builders Ltd', company_number: '10000002', directors: 'Bob Builder' },
          { id: 'f3', name: 'Charlie Cars Ltd', company_number: '10000003', notes: 'vintage specialist' }
        ],
        pagination: { hasMore: false }
      });
    };
    const list = async qs => (await (await realFetch(`${baseUrl}/api/v1/clients${qs}`, { headers: auth })).json());
    const names = body => body.data.filter(c => !c.addedInSloane).map(c => c.name);

    test('5.1 The search the Clients page sends (q) finds by name, company number, director and note', async () => {
      feed();
      assert.deepEqual(names(await list('?q=bravo')), ['Bravo Builders Ltd']);
      assert.deepEqual(names(await list('?q=10000003')), ['Charlie Cars Ltd']);
      assert.deepEqual(names(await list('?q=ann%20baker')), ['Alpha Bakery Ltd']);
      assert.deepEqual(names(await list('?q=vintage')), ['Charlie Cars Ltd']);
      assert.deepEqual(names(await list('?search=nothing-matches')), []);
    });

    test('5.2 Paging works and the whole list is the default', async () => {
      feed();
      const all = await list('');
      assert.equal(names(all).length, 3);
      const first = await list('?per_page=2&page=1');
      assert.equal(first.pagination.hasMore, true);
      const second = await list('?per_page=2&page=2');
      assert.equal(second.pagination.hasMore, false);
    });

    test('5.3 A TriNova client can be put under one of my businesses, and the business filter then finds it', async () => {
      feed();
      await list('');
      const set = await realFetch(`${baseUrl}/api/v1/clients/f2/business`, { method: 'PUT', headers: auth, body: JSON.stringify({ businessArea: 'MTDflow' }) });
      assert.equal(set.status, 200);
      assert.deepEqual(names(await list('?type=MTDflow')), ['Bravo Builders Ltd']);
      assert.equal((await list('')).data.find(c => c.id === 'f2').businessArea, 'MTDflow');

      const biz = (await (await realFetch(`${baseUrl}/api/v1/businesses`, { headers: auth })).json()).data.find(b => b.name === 'MTDflow');
      assert.ok(biz.clientCount >= 1, 'business count includes the TriNova client');
    });

    test('5.4 A business that still has TriNova clients cannot be removed; renaming moves them across', async () => {
      feed();
      await list('');
      const biz = (await (await realFetch(`${baseUrl}/api/v1/businesses`, { headers: auth })).json()).data.find(b => b.name === 'MTDflow');
      const del = await realFetch(`${baseUrl}/api/v1/businesses/${biz.id}`, { method: 'DELETE', headers: auth });
      assert.equal(del.status, 409);
      const ren = await realFetch(`${baseUrl}/api/v1/businesses/${biz.id}`, { method: 'PATCH', headers: auth, body: JSON.stringify({ name: 'MTDflow Renamed' }) });
      assert.equal(ren.status, 200);
      assert.deepEqual(names(await list('?type=MTDflow%20Renamed')), ['Bravo Builders Ltd']);
      await realFetch(`${baseUrl}/api/v1/businesses/${biz.id}`, { method: 'PATCH', headers: auth, body: JSON.stringify({ name: 'MTDflow' }) });
    });

    test('5.5 A business that does not exist, or a client that does not exist, is a plain error; null takes it back out', async () => {
      feed();
      await list('');
      const noBiz = await realFetch(`${baseUrl}/api/v1/clients/f1/business`, { method: 'PUT', headers: auth, body: JSON.stringify({ businessArea: 'Made Up Ltd' }) });
      assert.equal(noBiz.status, 422);
      assert.match((await noBiz.json()).error.message, /does not exist/);
      const noClient = await realFetch(`${baseUrl}/api/v1/clients/zzz/business`, { method: 'PUT', headers: auth, body: JSON.stringify({ businessArea: 'MTDflow' }) });
      assert.equal(noClient.status, 404);
      const cleared = await realFetch(`${baseUrl}/api/v1/clients/f2/business`, { method: 'PUT', headers: auth, body: JSON.stringify({ businessArea: null }) });
      assert.equal(cleared.status, 200);
      assert.deepEqual(names(await list('?type=MTDflow')), []);
    });
  });

  describe('6. Search works without TriNova too, and Refresh really asks TriNova again', () => {
    test('6.1 With no TriNova key, the search (q) and business filter (type) the page sends still narrow the list', async () => {
      const mk = async (name, biz) => (await (await realFetch(`${baseUrl}/api/v1/clients`, { method: 'POST', headers: auth, body: JSON.stringify({ name, biz }) })).json()).data;
      await mk('Search Apple Ltd', 'MTDflow');
      await mk('Search Banana Ltd', 'CFI Awarding');
      const list = async qs => (await (await realFetch(`${baseUrl}/api/v1/clients${qs}`, { headers: auth })).json()).data.map(c => c.name);
      assert.deepEqual((await list('?q=apple')).filter(n => n.startsWith('Search')), ['Search Apple Ltd']);
      const byType = await list('?type=CFI%20Awarding');
      assert.ok(byType.includes('Search Banana Ltd'));
      assert.ok(!byType.includes('Search Apple Ltd'));
      const both = await list('?q=banana&type=CFI%20Awarding');
      assert.deepEqual(both.filter(n => n.startsWith('Search')), ['Search Banana Ltd']);
    });

    test('6.2 "Refresh" (refresh=1) goes back to TriNova even when the list was read a moment ago', async () => {
      process.env.TRINOVA_API_KEY = TRINOVA_KEY;
      let calls = 0;
      trinovaHandler = async () => { calls++; return json({ data: [{ id: `r${calls}`, name: `Read number ${calls}` }], pagination: { hasMore: false } }); };
      await realFetch(`${baseUrl}/api/v1/clients`, { headers: auth });
      await realFetch(`${baseUrl}/api/v1/clients`, { headers: auth });   // remembered: no new call
      assert.equal(calls, 1);
      const fresh = await (await realFetch(`${baseUrl}/api/v1/clients?refresh=1`, { headers: auth })).json();
      assert.equal(calls, 2);
      assert.ok(fresh.data.some(c => c.name === 'Read number 2'));
    });

    test('6.3 If a forced refresh fails, the answer says TriNova is unreachable', async () => {
      process.env.TRINOVA_API_KEY = TRINOVA_KEY;
      trinovaHandler = async () => json({ data: [{ id: 'k1', name: 'Known Client' }], pagination: { hasMore: false } });
      await realFetch(`${baseUrl}/api/v1/clients?refresh=1`, { headers: auth });
      trinovaHandler = async () => { throw new Error('connect ECONNREFUSED'); };
      const body = await (await realFetch(`${baseUrl}/api/v1/clients?refresh=1`, { headers: auth })).json();
      assert.equal(body.meta.trinovaStatus, 'unreachable');
      assert.ok(body.data.some(c => c.name === 'Known Client'), 'still shows what it knew');
    });
  });

  describe('4. Reading the whole list (for deadlines)', () => {
    test('4.1 refresh() reads every page and remembers the clients', async () => {
      process.env.TRINOVA_API_KEY = TRINOVA_KEY;
      trinovaHandler = async href => {
        const page = Number(new URL(href).searchParams.get('page'));
        if (page === 1) return json({ data: [{ id: 'a1', name: 'A1' }, { id: 'a2', name: 'A2' }], pagination: { hasMore: true } });
        return json({ data: [{ id: 'a3', name: 'A3' }], pagination: { hasMore: false } });
      };
      const all = await clientDirectory.refresh({ force: true });
      // refresh() does nothing under NODE_ENV=test, but this test runs as 'development'
      assert.deepEqual(all.map(c => c.id).sort(), ['a1', 'a2', 'a3']);
      assert.equal(trinovaCalls.length, 2);
    });

    test('4.2 A failed refresh keeps what was known and records why', async () => {
      process.env.TRINOVA_API_KEY = TRINOVA_KEY;
      clientDirectory.setTrinovaClients([{ id: 'keep', name: 'Keep Me' }]);
      trinovaHandler = async () => json({}, 500);
      const all = await clientDirectory.refresh({ force: true });
      assert.ok(all.find(c => c.id === 'keep'));
      assert.match(clientDirectory.lastError, /500/);
    });

    test('4.3 Messy TriNova records are tidied into one shape', () => {
      const c = normaliseTrinovaClient({
        id: 42, company_name: ' Messy Ltd ', company_number: 12345, directors: 'A One, B Two',
        accounts_due: '2027-01-01', vat_registered: 1, tax_reference: 'GB1'
      });
      assert.equal(c.id, '42');
      assert.equal(c.name, 'Messy Ltd');
      assert.equal(c.companyNumber, '12345');
      assert.deepEqual(c.directors, ['A One', 'B Two']);
      assert.equal(c.vatNumber, 'GB1');
      assert.equal(normaliseTrinovaClient(null), null);
      assert.equal(normaliseTrinovaClient({ name: 'No id' }), null);
    });
  });
});
