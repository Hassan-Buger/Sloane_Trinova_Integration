/**
 * Unit 59 Test Suite: two-way task sync with the TriNova portal
 *
 * Runs against a fake portal built from TriNova's contract (GET /staff, GET /tasks?updated_since,
 * POST /tasks with Idempotency-Key, PATCH /tasks/:id, error envelope, Retry-After). Verifies:
 * - Nothing runs without the task key, or while switched off; switching on needs the key
 * - Only TriNova Accounting tasks are sent; other businesses never leave Sloane
 * - A new task is sent once (external_ref = Sloane id, stable Idempotency-Key, client id as a number)
 * - A change in Sloane sends only the changed fields; Sloane-only details are never sent
 * - A change in the portal is taken; new portal tasks appear in Sloane; both-changed uses the later one, completed always wins
 * - Delete in Sloane = "cancelled" on the portal (never deleted); delete in the portal = Sloane's Bin; neither comes back
 * - People are matched by email and remembered; unmatched staff are reported
 * - 401 / 404 / 429 / 5xx become plain sentences, with a longer wait after each failure
 * - The webhook needs a correct signature and a recent time, and only triggers a fresh pull
 * - Routes: owner only; the key is never shown
 */

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import crypto from 'node:crypto';

import { createApp } from '../src/app.js';
import { mockDb, DEFAULT_BUSINESSES } from '../src/data/db.js';
import { clientDirectory } from '../src/services/clientDirectory.js';
import { createTaskRecord } from '../src/routes/tasks.js';
import {
  runSync, setEnabled, getStatus, preview, tick, backoffMinutes, verifyWebhook, changedFields, _internals
} from '../src/services/trinovaTaskSync.js';
import { TEST_API_KEY } from './fixtures.js';
import { loginCookie } from './support.js';

const PORT = 5059;
const PORTAL_PORT = 5159;
const TASK_KEY = 'test-task-key-not-real';
const SECRET = 'test-webhook-secret-not-real';
const KEYS = ['businesses', 'clients', 'companies', 'tasks', 'teamMembers', 'bin', 'appMeta', 'clientBusiness'];
const stampNow = Date.now();
let tick_ = 0;
const stamp = () => new Date(stampNow + (++tick_) * 1000).toISOString();

/* ---------------- a fake TriNova portal, from the contract ---------------- */
function fakePortal() {
  const state = {
    calls: [], tasks: [], nextId: 2000, idem: new Map(), force: null,
    staff: [
      { id: 1, name: 'Priya Sharma', email: 'priya@trinova.com' },
      { id: 2, name: 'Mark Harrison', email: 'mark@trinova.com' },
      { id: 3, name: 'Sarah Jenkins', email: 'sarah@trinova.com' }
    ]
  };
  const server = http.createServer((req, res) => {
    let raw = '';
    req.on('data', c => { raw += c; });
    req.on('end', () => {
      const url = new URL(req.url, 'http://x');
      const body = raw ? JSON.parse(raw) : null;
      state.calls.push({ method: req.method, path: url.pathname, query: Object.fromEntries(url.searchParams), body, headers: req.headers });
      const send = (code, json, headers = {}) => { res.writeHead(code, { 'Content-Type': 'application/json', ...headers }); res.end(JSON.stringify(json)); };
      if (req.headers.authorization !== `Bearer ${TASK_KEY}`) return send(401, { error: { code: 'INVALID_CREDENTIAL', message: 'bad key' } });
      if (state.force) return send(state.force.status, state.force.json || {}, state.force.headers || {});
      const p = url.pathname.replace(/^\/api\/v1/, '');
      if (req.method === 'GET' && p === '/staff') {
        // The live portal lists staff a page at a time (2 here) and says how many there are in all
        const page = Number(url.searchParams.get('page') || 1);
        return send(200, { status: 'success', data: state.staff.slice((page - 1) * 2, page * 2), meta: { total: state.staff.length } });
      }
      if (req.method === 'GET' && p === '/tasks') {
        const since = url.searchParams.get('updated_since');
        const page = Number(url.searchParams.get('page') || 1);
        const per = Number(url.searchParams.get('per_page') || 50);
        const all = state.tasks.filter(t => !since || t.updated_at > since);
        const rows = all.slice((page - 1) * per, page * per);
        return send(200, { status: 'success', data: rows, meta: { total: all.length, page, per_page: per } });
      }
      if (req.method === 'POST' && p === '/tasks') {
        const key = req.headers['idempotency-key'];
        if (key && state.idem.has(key)) return send(201, { status: 'success', data: state.idem.get(key) });
        if (!body.title) return send(422, { error: { code: 'VALIDATION_ERROR', message: "The 'title' field is required." } });
        const staff = state.staff.find(s => s.id === body.assignee_id);
        const task = { id: state.nextId++, is_deleted: false, created_at: stamp(), updated_at: stamp(), assignee_name: staff ? staff.name : null, ...body };
        state.tasks.push(task);
        if (key) state.idem.set(key, task);
        return send(201, { status: 'success', data: task });
      }
      const m = p.match(/^\/tasks\/(\d+)$/);
      if (req.method === 'PATCH' && m) {
        const t = state.tasks.find(x => String(x.id) === m[1]);
        if (!t) return send(404, { error: { code: 'TASK_NOT_FOUND', message: `Task with ID '${m[1]}' was not found.` } });
        Object.assign(t, body, { updated_at: stamp() });
        return send(200, { status: 'success', data: t });
      }
      return send(404, { status: 'error', error: { code: 'NOT_FOUND', message: 'API endpoint not found.' } });
    });
  });
  return { state, server };
}

const trinovaClient = (id, name) => ({ id: String(id), name, source: 'trinova', companyNumber: `0000${id}`, raw: {} });
const mkTask = (title, extra = {}, ref = null) => createTaskRecord({ ref, title, description: '', actor: { actorId: 'a', actorName: 'Test' }, extra: { businessArea: 'TriNova Accounting', ...extra } });
const findTask = title => mockDb.tasks.find(t => t.title === title);

describe('Unit 59: two-way task sync with the TriNova portal', () => {
  let saved;
  let portal;
  let app;
  let server;
  let baseUrl;
  const savedEnv = {};

  before(async () => {
    saved = {};
    for (const k of KEYS) { mockDb[k] = mockDb[k] || []; saved[k] = [...mockDb[k]]; mockDb[k].length = 0; }
    saved.trinova = new Map(clientDirectory.trinova);
    clientDirectory.trinova = new Map([['5', trinovaClient(5, 'Acme Ltd')], ['6', trinovaClient(6, 'Bright Ltd')]]);
    mockDb.businesses.push(...DEFAULT_BUSINESSES.map(b => ({ ...b })));
    mockDb.teamMembers.push({ id: 'tm_priya', name: 'Priya S', email: 'PRIYA@trinova.com' }, { id: 'tm_kirsty', name: 'Kirsty Allen', email: 'kirsty@example.test' });

    portal = fakePortal();
    await new Promise(r => portal.server.listen(PORTAL_PORT, r));
    for (const k of ['TRINOVA_API_URL', 'TRINOVA_TASKS_API_KEY', 'TRINOVA_WEBHOOK_SECRET']) savedEnv[k] = process.env[k];
    process.env.TRINOVA_API_URL = `http://localhost:${PORTAL_PORT}/api/v1`;
    app = createApp();
    await new Promise(r => { server = app.listen(PORT, () => { baseUrl = `http://localhost:${PORT}`; r(); }); });
  });

  after(async () => {
    for (const k of Object.keys(savedEnv)) { if (savedEnv[k] === undefined) delete process.env[k]; else process.env[k] = savedEnv[k]; }
    await new Promise(r => portal.server.close(r));
    await new Promise(r => server.close(r));
    for (const k of KEYS) { mockDb[k].length = 0; mockDb[k].push(...saved[k]); }
    clientDirectory.trinova = saved.trinova;
  });

  describe('1. Off until there is a key and the owner says so', () => {
    test('1.1 no key: nothing runs, and it cannot be switched on', async () => {
      delete process.env.TRINOVA_TASKS_API_KEY;
      assert.equal(getStatus().configured, false);
      assert.match(setEnabled(true).error, /has not given Sloane a task key/);
      assert.deepEqual(await runSync(), { ran: false, reason: 'not_configured' });
      assert.equal(portal.state.calls.length, 0);
    });

    test('1.2 with a key but switched off, nothing runs either', async () => {
      process.env.TRINOVA_TASKS_API_KEY = TASK_KEY;
      assert.equal(getStatus().enabled, false);
      assert.deepEqual(await runSync(), { ran: false, reason: 'off' });
      assert.equal(await tick(), null);
      assert.equal(portal.state.calls.length, 0);
    });

    test('1.3 the preview says what would be sent, and keeps other businesses out', () => {
      mkTask('Year end for Acme', { dueDate: '2026-11-15', priority: 'High', department: 'Accounts' }, { companyId: '5', clientId: '5', clientName: 'Acme Ltd' });
      mkTask('Firm CPD training', { dueDate: '2026-12-01' });
      mkTask('Plan the term', { businessArea: 'Emerald Education' });
      mkTask('CFI audit', { businessArea: 'CFI Awarding' });
      mkTask('Sloane-only client task', {}, { companyId: 'c9', clientId: 'c9', clientName: 'Added in Sloane Ltd' });
      assert.deepEqual(preview(), { wouldSend: 2, wouldUpdate: 0, wouldCancel: 0, notSent: 1 });
    });
  });

  describe('2. Sending tasks', () => {
    before(() => { setEnabled(true); });

    test('2.1 the first run matches people, sends new TriNova tasks once, and never sends other businesses', async () => {
      const out = await runSync();
      assert.equal(out.ran, true);
      assert.equal(out.ok, true);
      assert.equal(out.pushed, 2);
      const posts = portal.state.calls.filter(c => c.method === 'POST' && c.path.endsWith('/tasks'));
      assert.equal(posts.length, 2);
      const acme = posts.find(c => c.body.title === 'Year end for Acme');
      assert.equal(acme.body.client_id, 5, 'the portal client id is a number');
      assert.equal(acme.body.external_ref, findTask('Year end for Acme').id, 'Sloane id is the external_ref');
      assert.equal(acme.body.status, 'open');
      assert.equal(acme.body.priority, 'high');
      assert.equal(acme.body.due_date, '2026-11-15');
      assert.equal(acme.body.department, 'Accounts');
      assert.match(acme.headers['idempotency-key'], /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-a[0-9a-f]{3}-[0-9a-f]{12}$/);
      assert.equal(acme.headers['x-requested-with'], 'sloane');
      assert.equal(posts.find(c => c.body.title === 'Firm CPD training').body.client_id, null);
      assert.equal(portal.state.tasks.some(t => /Plan the term|CFI audit|Sloane-only/.test(t.title)), false);
      assert.equal(typeof findTask('Year end for Acme').portal.id, 'number');
      assert.equal(out.skipped, 1);
    });

    test('2.2 the person is matched by email (any capitals) and remembered', () => {
      assert.equal(mockDb.teamMembers.find(m => m.id === 'tm_priya').portalId, '1');
      assert.equal(getStatus().staff.count, 3, 'all pages of staff were read');
      assert.deepEqual(getStatus().staff.notMatched.sort(), ['Mark Harrison', 'Sarah Jenkins']);
    });

    test('2.3 a second run sends nothing again (no duplicates), and asks only for changes', async () => {
      const before = portal.state.calls.filter(c => c.method === 'POST').length;
      const out = await runSync();
      assert.equal(out.pushed, 0);
      assert.equal(portal.state.calls.filter(c => c.method === 'POST').length, before);
      const get = portal.state.calls.filter(c => c.method === 'GET' && c.path.endsWith('/tasks')).pop();
      assert.ok(get.query.updated_since, 'the second pull only asks for what changed');
    });

    test('2.4 a retried create with the same Idempotency-Key makes no second task on the portal', () => {
      const key = _internals.idempotencyKeyFor('tsk_same');
      assert.equal(key, _internals.idempotencyKeyFor('tsk_same'));
      assert.notEqual(key, _internals.idempotencyKeyFor('tsk_other'));
    });

    test('2.5 changing a task in Sloane sends only what changed, and never Sloane-only details', async () => {
      const t = findTask('Year end for Acme');
      t.dueDate = '2026-12-05';
      t.progressNotes = [{ text: 'secret note' }];
      t.nextAction = 'Call the client';
      t.repeat = 'monthly';
      assert.deepEqual(changedFields(t), { due_date: '2026-12-05' });
      portal.state.calls.length = 0;
      await runSync();
      const patch = portal.state.calls.find(c => c.method === 'PATCH');
      assert.deepEqual(patch.body, { due_date: '2026-12-05' });
      assert.equal(JSON.stringify(portal.state.calls).includes('secret note'), false);
      assert.equal(JSON.stringify(portal.state.calls).includes('Call the client'), false);
      assert.equal(portal.state.tasks.find(x => x.external_ref === t.id).due_date, '2026-12-05');
    });

    test('2.6 giving a task to a matched person sends their portal id', async () => {
      const t = findTask('Firm CPD training');
      t.assigneeId = 'tm_priya';
      t.assigneeName = 'Priya S';
      portal.state.calls.length = 0;
      await runSync();
      assert.deepEqual(portal.state.calls.find(c => c.method === 'PATCH').body, { assignee_id: 1 }, 'the id goes back as the number the portal uses');
    });
  });

  describe('3. Taking changes from the portal', () => {
    test('3.1 a change in the portal is taken, and Sloane-only details stay', async () => {
      const t = findTask('Year end for Acme');
      const p = portal.state.tasks.find(x => x.external_ref === t.id);
      Object.assign(p, { status: 'in_progress', priority: 'urgent', is_blocked: 1, blocked_reason: 'Waiting for bank statements', assignee_id: 1, updated_at: stamp() });
      await runSync();
      assert.equal(t.status, 'In_Progress');
      assert.equal(t.priority, 'Urgent');
      assert.equal(t.isBlocked, true);
      assert.equal(t.blocker, 'Waiting for bank statements');
      assert.equal(t.assigneeId, 'tm_priya');
      assert.equal(t.repeat, 'monthly');
      assert.equal(t.nextAction, 'Call the client');
      assert.equal(t.progressNotes.length, 1);
      assert.deepEqual(changedFields(t), {}, 'nothing is waiting to go back');
    });

    test('3.2 a task made in the portal appears in Sloane under TriNova Accounting', async () => {
      portal.state.tasks.push({
        id: 3001, external_ref: null, client_id: 6, company_number: '00006', title: 'Quarterly VAT Return Q3', description: 'Verify CIS',
        status: 'open', priority: 'medium', due_date: '2026-11-07', assignee_id: 2, assignee_email: 'mark@trinova.com', assignee_name: 'Mark Harrison',
        department: 'VAT & Bookkeeping', is_blocked: false, blocked_reason: null, created_at: stamp(), updated_at: stamp(), is_deleted: false
      });
      await runSync();
      const t = findTask('Quarterly VAT Return Q3');
      assert.ok(t, 'it was created');
      assert.equal(t.origin, 'trinova');
      assert.equal(t.businessArea, 'TriNova Accounting');
      assert.equal(t.clientId, '6');
      assert.equal(t.companyName, 'Bright Ltd');
      assert.equal(t.department, 'VAT & Bookkeeping');
      assert.equal(t.assigneeName, 'Mark Harrison', 'a person not on the Team page keeps their name');
      assert.equal(t.priority, 'Normal', 'the portal\u2019s "medium" is Sloane\u2019s ordinary priority');
      assert.equal(t.status, 'Pending', 'the portal\u2019s "open" means Pending');
      assert.equal(t.assigneeId, null);
      assert.equal(t.portal.id, 3001);
      // It is now a normal linked task, so a second run does not make a copy
      portal.state.calls.length = 0;
      await runSync();
      assert.equal(mockDb.tasks.filter(x => x.title === 'Quarterly VAT Return Q3').length, 1);
      assert.equal(portal.state.calls.filter(c => c.method === 'PATCH' || c.method === 'POST').length, 0, 'taking the portal\u2019s values sends nothing back');
    });

    test('3.2b more than one page of portal tasks are all read (meta.total, no has_more)', async () => {
      for (let i = 0; i < 120; i++) {
        portal.state.tasks.push({ id: 5000 + i, external_ref: null, client_id: null, title: `Bulk task ${i}`, description: '', status: 'open', priority: 'normal', due_date: null, assignee_id: null, department: null, is_blocked: 0, blocked_reason: null, created_at: stamp(), updated_at: stamp(), is_deleted: 0 });
      }
      await runSync();
      assert.equal(mockDb.tasks.filter(t => /^Bulk task \d+$/.test(t.title)).length, 120);
      const pages = portal.state.calls.filter(c => c.method === 'GET' && c.path.endsWith('/tasks')).map(c => c.query.page);
      assert.ok(pages.includes('3'), 'it kept asking until it had everything');
    });

    test('3.2c the portal has no "normal": Normal and Medium both go as "medium" and nothing flips back', async () => {
      const t = findTask('Quarterly VAT Return Q3');
      t.priority = 'Medium';
      assert.deepEqual(changedFields(t), {}, 'Medium and the portal\u2019s medium are the same');
      t.priority = 'Normal';
      assert.deepEqual(changedFields(t), {});
      t.priority = 'Low';
      assert.deepEqual(changedFields(t), { priority: 'low' });
      t.priority = 'Normal';
    });

    test('3.2d one person with two portal accounts is not swapped back and forth', async () => {
      // Kirsty has two accounts on the portal (ids 20 and 25). The task already belongs to account 20.
      portal.state.staff.push({ id: 20, name: 'Kirsty Allen', email: 'kirsty.allen@trinova.com' }, { id: 25, name: 'Kirsty Allen', email: 'kirsty@trinova.com' });
      mockDb.teamMembers.find(m => m.id === 'tm_kirsty').email = 'kirsty@trinova.com';
      const t = findTask('Quarterly VAT Return Q3');
      const p = portal.state.tasks.find(x => x.id === 3001);
      Object.assign(p, { assignee_id: 20, assignee_name: 'Kirsty Allen', assignee_email: 'kirsty.allen@trinova.com', updated_at: stamp() });
      portal.state.calls.length = 0;
      await runSync();
      assert.equal(t.assigneeId, 'tm_kirsty', 'matched to the Team page by name');
      assert.equal(portal.state.calls.filter(c => c.method === 'PATCH').length, 0, 'the portal\u2019s own account is kept, nothing sent');
      assert.deepEqual(getStatus().staff.notMatched.includes('Kirsty Allen'), false, 'two accounts, one person: not reported as missing');
    });

    test('3.3 both sides changed: the later change wins, and "completed" always wins', async () => {
      const t = findTask('Firm CPD training');
      const p = portal.state.tasks.find(x => x.external_ref === t.id);
      // Sloane changes the date first; the portal changes it later -> the portal's date wins
      t.dueDate = '2027-01-10'; t.updatedAt = new Date(Date.now() - 5000).toISOString();
      Object.assign(p, { due_date: '2027-02-20', updated_at: new Date(Date.now() + 60000).toISOString() });
      await runSync();
      assert.equal(t.dueDate, '2027-02-20');
      // Sloane finishes it while the portal says in progress (later): finished wins, and is sent
      t.status = 'Completed'; t.updatedAt = new Date(Date.now() - 1000).toISOString();
      Object.assign(p, { status: 'in_progress', updated_at: new Date(Date.now() + 120000).toISOString() });
      await runSync();
      assert.equal(t.status, 'Completed');
      assert.equal(portal.state.tasks.find(x => x.external_ref === t.id).status, 'completed');
    });

    test('3.4 finished in the portal closes the task in Sloane, and a repeating task makes the next one', async () => {
      const t = findTask('Year end for Acme');
      t.repeat = 'monthly';
      const p = portal.state.tasks.find(x => x.external_ref === t.id);
      Object.assign(p, { status: 'completed', updated_at: stamp() });
      await runSync();
      assert.equal(t.status, 'Completed');
      assert.ok(t.nextTaskId, 'the next one was made');
    });
  });

  describe('4. Deleting', () => {
    test('4.1 deleted in Sloane: marked cancelled on the portal (never deleted), and does not come back', async () => {
      const t = findTask('Firm CPD training');
      const portalId = t.portal.id;
      const idx = mockDb.tasks.indexOf(t);
      const [rec] = mockDb.tasks.splice(idx, 1);
      mockDb.bin.unshift({ id: 'bin_t1', kind: 'task', label: rec.title, where: '', deletedAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 864e5).toISOString(), removed: [{ collection: 'tasks', index: idx, record: rec }], changes: [] });
      portal.state.calls.length = 0;
      await runSync();
      const patches = portal.state.calls.filter(c => c.method === 'PATCH');
      assert.deepEqual(patches.map(c => [c.path.split('/').pop(), c.body]), [[String(portalId), { status: 'cancelled' }]]);
      assert.equal(portal.state.calls.some(c => c.method === 'DELETE'), false);
      assert.equal(mockDb.bin[0].portalNotified, true);
      portal.state.calls.length = 0;
      await runSync();
      assert.equal(portal.state.calls.filter(c => c.method === 'PATCH').length, 0, 'told only once');
      assert.equal(mockDb.tasks.some(x => x.title === 'Firm CPD training'), false, 'the portal copy did not recreate it');
    });

    test('4.2 deleted in the portal: goes to the Bin and TriNova is not told to cancel it', async () => {
      const t = findTask('Quarterly VAT Return Q3');
      const p = portal.state.tasks.find(x => x.id === 3001);
      Object.assign(p, { is_deleted: true, updated_at: stamp() });
      portal.state.calls.length = 0;
      await runSync();
      assert.equal(mockDb.tasks.includes(t), false);
      const entry = mockDb.bin.find(b => b.kind === 'task' && b.label === 'Quarterly VAT Return Q3');
      assert.ok(entry);
      assert.equal(entry.portalNotified, true);
      assert.equal(portal.state.calls.filter(c => c.method === 'PATCH').length, 0);
    });
  });

  describe('5. When TriNova says no', () => {
    const run = async (force) => { portal.state.force = force; try { return await runSync(); } finally { portal.state.force = null; } };
    before(() => { _internals.meta().failures = 0; _internals.meta().nextAttemptAt = null; });

    test('5.1 tasks not switched on yet (404) is said plainly, and Sloane waits', async () => {
      const out = await run({ status: 404, json: { status: 'error', error: { code: 'NOT_FOUND', message: 'API endpoint not found.' } } });
      assert.equal(out.ok, false);
      assert.equal(out.error, 'TriNova has not switched on tasks yet.');
      assert.equal(getStatus().failures, 1);
      assert.ok(getStatus().nextAttemptAt);
      assert.equal(await tick(), null, 'the timer waits');
    });

    test('5.2 a refused key, a 429 with Retry-After, and a 500', async () => {
      _internals.meta().nextAttemptAt = null;
      assert.equal((await run({ status: 401, json: { error: { code: 'INVALID_CREDENTIAL' } } })).error, 'TriNova did not accept Sloane’s task key.');
      _internals.meta().nextAttemptAt = null;
      const slow = await run({ status: 429, json: { error: { code: 'RATE_LIMIT_EXCEEDED' } }, headers: { 'Retry-After': '120' } });
      assert.match(slow.error, /slow down/);
      const wait = Date.parse(getStatus().nextAttemptAt) - Date.now();
      assert.ok(wait > 100000 && wait < 130000, 'waits the 2 minutes TriNova asked for');
      _internals.meta().nextAttemptAt = null;
      assert.match((await run({ status: 500, json: {} })).error, /problem on its side/);
    });

    test('5.3 waits get longer with each failure, up to an hour; a good run clears it', async () => {
      assert.deepEqual([1, 2, 3, 4, 5, 6, 7, 8].map(backoffMinutes), [1, 2, 4, 8, 16, 32, 60, 60]);
      _internals.meta().nextAttemptAt = null;
      const ok = await runSync();
      assert.equal(ok.ok, true);
      assert.equal(getStatus().failures, 0);
      assert.equal(getStatus().lastError, null);
      assert.equal(getStatus().nextAttemptAt, null);
    });
  });

  describe('6. The webhook', () => {
    const sign = body => `sha256=${crypto.createHmac('sha256', SECRET).update(body).digest('hex')}`;
    const post = (body, sig) => fetch(`${baseUrl}/api/v1/integrations/trinova/webhooks/tasks`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(sig ? { 'X-Trinova-Signature': sig } : {}) }, body });

    test('6.1 it is switched off until there is a secret', async () => {
      delete process.env.TRINOVA_WEBHOOK_SECRET;
      assert.equal((await post('{}', 'sha256=00')).status, 503);
    });

    test('6.2 a wrong or missing signature is refused; a stale message is refused', async () => {
      process.env.TRINOVA_WEBHOOK_SECRET = SECRET;
      const body = JSON.stringify({ event: 'task.updated', timestamp: new Date().toISOString(), task: { id: 1 } });
      assert.equal((await post(body)).status, 401);
      assert.equal((await post(body, 'sha256=' + 'ab'.repeat(32))).status, 401);
      assert.equal((await post(body, sign(body + ' '))).status, 401, 'a changed body no longer matches');
      const old = JSON.stringify({ event: 'task.updated', timestamp: new Date(Date.now() - 3600000).toISOString(), task: { id: 1 } });
      assert.equal((await post(old, sign(old))).status, 401);
      assert.equal(verifyWebhook('not json', sign('not json'), SECRET).code, 'BAD_BODY');
    });

    test('6.3 a good message is accepted and makes Sloane ask the portal afresh', async () => {
      portal.state.tasks.push({ id: 3002, external_ref: null, client_id: null, title: 'Practice insurance review', status: 'pending', priority: 'low', due_date: null, assignee_id: null, department: 'Admin', is_blocked: false, blocked_reason: null, created_at: stamp(), updated_at: stamp(), is_deleted: false });
      const body = JSON.stringify({ event: 'task.updated', timestamp: new Date().toISOString(), task: { id: 3002, status: 'completed' } });
      const res = await post(body, sign(body));
      assert.equal(res.status, 202);
      for (let i = 0; i < 40 && !findTask('Practice insurance review'); i++) await new Promise(r => setTimeout(r, 50));
      const t = findTask('Practice insurance review');
      assert.ok(t, 'the task was fetched from the portal');
      assert.equal(t.status, 'Pending', 'what the message claimed is not trusted; the portal was asked');
      assert.equal(t.clientId, null);
    });
  });

  describe('7. Routes', () => {
    test('7.1 only the signed-in owner can see, switch or run it; the key is never shown', async () => {
      assert.equal((await fetch(`${baseUrl}/api/v1/integrations/trinova/task-sync`)).status, 401);
      const key = await fetch(`${baseUrl}/api/v1/integrations/trinova/task-sync`, { headers: { Authorization: `Bearer ${TEST_API_KEY}` } });
      assert.ok([401, 403].includes(key.status));
      const cookie = await loginCookie(baseUrl);
      const h = { Cookie: cookie, 'Content-Type': 'application/json' };
      const read = await fetch(`${baseUrl}/api/v1/integrations/trinova/task-sync`, { headers: h });
      assert.equal(read.status, 200);
      const text = await read.text();
      assert.equal(text.includes(TASK_KEY) || text.includes(SECRET), false);
      const body = JSON.parse(text).data;
      assert.equal(body.configured, true);
      assert.equal(body.enabled, true);
      assert.equal((await fetch(`${baseUrl}/api/v1/integrations/trinova/task-sync`, { method: 'PUT', headers: h, body: JSON.stringify({ enabled: 'yes' }) })).status, 422);
      const off = await fetch(`${baseUrl}/api/v1/integrations/trinova/task-sync`, { method: 'PUT', headers: h, body: JSON.stringify({ enabled: false }) });
      assert.equal((await off.json()).data.enabled, false);
      assert.equal((await fetch(`${baseUrl}/api/v1/integrations/trinova/task-sync/run`, { method: 'POST', headers: h, body: '{}' })).status, 409);
      await fetch(`${baseUrl}/api/v1/integrations/trinova/task-sync`, { method: 'PUT', headers: h, body: JSON.stringify({ enabled: true }) });
      const run = await fetch(`${baseUrl}/api/v1/integrations/trinova/task-sync/run`, { method: 'POST', headers: h, body: '{}' });
      assert.equal(run.status, 200);
      assert.equal((await run.json()).message, 'Synced.');
    });
  });
});
