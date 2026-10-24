/**
 * Unit 35 Test Suite: Tasks and Team (full create / read / change / delete)
 *
 * Verifies:
 * - A task can be created for a Sloane client, a live TriNova client, or with no client
 * - A task can be edited (title, due date, priority, status), reassigned and deleted
 * - Validation, 404 and 409 answers are plain English, and every change is audited
 * - Team members can be added, changed and removed; a person with open tasks cannot be removed
 */

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

import { createApp } from '../src/app.js';
import { mockDb } from '../src/data/db.js';
import { auditStore } from '../src/middleware/audit.js';
import { clientDirectory } from '../src/services/clientDirectory.js';
import { TEST_API_KEY, TEST_READONLY_KEY } from './fixtures.js';

const PORT = 5035;
const auth = () => ({ Authorization: `Bearer ${TEST_API_KEY}`, 'Content-Type': 'application/json' });
const authWithKey = () => ({ ...auth(), 'Idempotency-Key': randomUUID() });

describe('Unit 35: Tasks and Team', () => {
  let server;
  let baseUrl;

  const post = (path, body, headers = authWithKey()) =>
    fetch(`${baseUrl}/api/v1${path}`, { method: 'POST', headers, body: JSON.stringify(body) });
  const patch = (path, body) => fetch(`${baseUrl}/api/v1${path}`, { method: 'PATCH', headers: auth(), body: JSON.stringify(body) });
  const del = path => fetch(`${baseUrl}/api/v1${path}`, { method: 'DELETE', headers: auth() });
  const get = path => fetch(`${baseUrl}/api/v1${path}`, { headers: auth() });
  const lastAudit = () => auditStore.logs[0];

  before(async () => {
    clientDirectory.setTrinovaClients([
      { id: 'tn-1001', name: 'Live TriNova Client Ltd', company_number: '55550001', accounts_due: '2027-02-28' }
    ]);
    const app = createApp();
    await new Promise(resolve => {
      server = app.listen(PORT, () => {
        baseUrl = `http://localhost:${PORT}`;
        resolve();
      });
    });
  });

  after(async () => {
    clientDirectory.clearTrinova();
    if (server) await new Promise(resolve => server.close(resolve));
  });

  describe('1. Creating tasks', () => {
    test('1.1 A general task with no client can be created', async () => {
      const res = await post('/tasks', { title: 'Ring the accountant', general: true, dueDate: '2026-12-24', priority: 'High' });
      assert.equal(res.status, 201);
      const task = (await res.json()).data;
      assert.equal(task.title, 'Ring the accountant');
      assert.equal(task.clientId, null);
      assert.equal(task.priority, 'High');
      assert.equal(lastAudit().action, 'task_created');
    });

    test('1.2 A task can be attached to a live TriNova client (not stored in Sloane)', async () => {
      const res = await post('/tasks', { title: 'Chase bank statements', clientId: 'tn-1001' });
      assert.equal(res.status, 201);
      const task = (await res.json()).data;
      assert.equal(task.clientId, 'tn-1001');
      assert.equal(task.companyName, 'Live TriNova Client Ltd');

      const list = await (await get('/companies/tn-1001/tasks')).json();
      assert.ok(list.data.find(t => t.id === task.id), 'shows on that client');
    });

    test('1.3 A task can be attached to a client added in Sloane', async () => {
      const client = (await (await post('/clients', { name: 'Unit35 Own Client' }, auth())).json()).data;
      const res = await post('/tasks', { title: 'Own client task', clientId: client.id });
      assert.equal(res.status, 201);
      assert.equal((await res.json()).data.companyId, client.companyIds[0]);
    });

    test('1.4 The task is added to the client\'s history', async () => {
      const res = await post('/tasks', { title: 'History task', clientId: 'tn-1001' });
      const task = (await res.json()).data;
      const hist = await (await get('/clients/tn-1001/timeline')).json();
      assert.ok(hist.data.find(e => e.eventType === 'TASK_CREATED' && e.externalId === task.id));
    });

    test('1.5 No client and not marked general: asked to choose, in plain words', async () => {
      const res = await post('/tasks', { title: 'Where does this go?' });
      assert.equal(res.status, 422);
      assert.match((await res.json()).error.message, /Choose which client/);
    });

    test('1.6 An unknown client is refused with a plain message', async () => {
      const res = await post('/tasks', { title: 'x', clientId: 'does-not-exist' });
      assert.equal(res.status, 422);
      assert.match((await res.json()).error.message, /could not find that client/i);
    });

    test('1.7 Empty title, bad date, bad priority and bad status are refused', async () => {
      const cases = [
        [{ title: '  ', general: true }, /give the task a title/i],
        [{ title: 'x', general: true, dueDate: '2026-02-31' }, /real date/i],
        [{ title: 'x', general: true, dueDate: 'tomorrow' }, /real date/i],
        [{ title: 'x', general: true, priority: 'Whenever' }, /Priority must be/],
        [{ title: 'x', general: true, status: 'Maybe' }, /not a status/i],
        [{ title: 'x'.repeat(300), general: true }, /up to 255/]
      ];
      for (const [body, pattern] of cases) {
        const res = await post('/tasks', body);
        assert.equal(res.status, 422, JSON.stringify(body));
        assert.match((await res.json()).error.message, pattern);
      }
    });

    test('1.8 Read-only keys cannot create tasks', async () => {
      const res = await post('/tasks', { title: 'x', general: true }, { Authorization: `Bearer ${TEST_READONLY_KEY}`, 'Content-Type': 'application/json', 'Idempotency-Key': randomUUID() });
      assert.equal(res.status, 403);
    });
  });

  describe('2. Changing, reassigning and deleting tasks', () => {
    let taskId;
    let jess;

    before(async () => {
      taskId = (await (await post('/tasks', { title: 'Original title', general: true })).json()).data.id;
      jess = mockDb.teamMembers.find(m => m.name === 'Jessica Taylor');
    });

    test('2.1 Title, due date and priority can be changed', async () => {
      const res = await patch(`/tasks/${taskId}`, { title: 'New title', dueDate: '2027-01-15', priority: 'Urgent' });
      assert.equal(res.status, 200);
      const task = (await res.json()).data;
      assert.equal(task.title, 'New title');
      assert.equal(task.dueDate, '2027-01-15');
      assert.equal(task.priority, 'Urgent');
      assert.equal(lastAudit().action, 'task_updated');
    });

    test('2.2 The due date can be cleared', async () => {
      const res = await patch(`/tasks/${taskId}`, { dueDate: null });
      assert.equal((await res.json()).data.dueDate, null);
    });

    test('2.3 A task can be given to a team member (name comes from the team list)', async () => {
      const res = await patch(`/tasks/${taskId}`, { assigneeId: jess.id });
      assert.equal(res.status, 200);
      const task = (await res.json()).data;
      assert.equal(task.assigneeId, jess.id);
      assert.equal(task.assigneeName, 'Jessica Taylor');
    });

    test('2.4 Reassigning to an unknown person is refused with a plain message', async () => {
      const res = await patch(`/tasks/${taskId}`, { assigneeId: 'usr_nobody' });
      assert.equal(res.status, 422);
      assert.match((await res.json()).error.message, /could not find that team member/i);
    });

    test('2.5 A task can be unassigned', async () => {
      const res = await patch(`/tasks/${taskId}`, { assigneeId: null });
      const task = (await res.json()).data;
      assert.equal(task.assigneeId, null);
      assert.equal(task.assigneeName, null);
    });

    test('2.6 Reassigning a client task writes a history entry', async () => {
      const t = (await (await post('/tasks', { title: 'Reassign me', clientId: 'tn-1001' })).json()).data;
      await patch(`/tasks/${t.id}`, { assigneeId: jess.id });
      const hist = await (await get('/clients/tn-1001/timeline')).json();
      assert.ok(hist.data.find(e => e.eventType === 'TASK_REASSIGNED' && e.metadata.taskId === t.id));
    });

    test('2.7 A bad field changes nothing at all (no half-saved task)', async () => {
      const before = (await (await get(`/tasks/${taskId}`)).json()).data;
      const res = await patch(`/tasks/${taskId}`, { title: 'Should not stick', dueDate: 'nonsense' });
      assert.equal(res.status, 422);
      const after = (await (await get(`/tasks/${taskId}`)).json()).data;
      assert.equal(after.title, before.title);
      assert.equal(after.version, before.version);
    });

    test('2.8 A task changed somewhere else is reported as a conflict in plain words', async () => {
      const res = await patch(`/tasks/${taskId}`, { title: 'Late edit', version: 1 });
      assert.equal(res.status, 409);
      assert.match((await res.json()).error.message, /changed somewhere else/i);
    });

    test('2.9 A task can be moved to another client or made general', async () => {
      const moved = await patch(`/tasks/${taskId}`, { clientId: 'tn-1001' });
      assert.equal((await moved.json()).data.clientId, 'tn-1001');
      const general = await patch(`/tasks/${taskId}`, { clientId: null });
      assert.equal((await general.json()).data.clientId, null);
    });

    test('2.10 A task can be cancelled, and then ticked off is refused', async () => {
      const t = (await (await post('/tasks', { title: 'Cancel me', general: true })).json()).data;
      assert.equal((await patch(`/tasks/${t.id}`, { status: 'Cancelled' })).status, 200);
      const done = await post(`/tasks/${t.id}/complete`, {});
      assert.equal(done.status, 422);
    });

    test('2.11 A task can be deleted; deleting again says it is gone', async () => {
      const t = (await (await post('/tasks', { title: 'Delete me', general: true })).json()).data;
      const res = await del(`/tasks/${t.id}`);
      assert.equal(res.status, 200);
      assert.equal(lastAudit().action, 'task_deleted');
      assert.equal(mockDb.tasks.find(x => x.id === t.id), undefined);
      const again = await del(`/tasks/${t.id}`);
      assert.equal(again.status, 404);
      assert.match((await again.json()).error.message, /already have been deleted/i);
    });

    test('2.12 Patch of an unknown task is a plain 404', async () => {
      const res = await patch('/tasks/tsk_missing', { title: 'x' });
      assert.equal(res.status, 404);
      assert.match((await res.json()).error.message, /could not find that task/i);
    });

    test('2.13 Read-only keys cannot change or delete tasks', async () => {
      const ro = { Authorization: `Bearer ${TEST_READONLY_KEY}`, 'Content-Type': 'application/json' };
      assert.equal((await fetch(`${baseUrl}/api/v1/tasks/${taskId}`, { method: 'PATCH', headers: ro, body: '{}' })).status, 403);
      assert.equal((await fetch(`${baseUrl}/api/v1/tasks/${taskId}`, { method: 'DELETE', headers: ro })).status, 403);
    });
  });

  describe('3. Team members', () => {
    let memberId;

    test('3.1 A person can be added', async () => {
      const res = await post('/team', { name: 'Priya Shah', role: 'Bookkeeper', email: 'priya@example.com' }, auth());
      assert.equal(res.status, 201);
      const m = (await res.json()).data;
      memberId = m.id;
      assert.equal(m.role, 'Bookkeeper');
      assert.equal(m.openTasks, 0);
      assert.equal(lastAudit().action, 'team_member_created');
    });

    test('3.2 The same name twice is a plain conflict', async () => {
      const res = await post('/team', { name: 'priya shah' }, auth());
      assert.equal(res.status, 409);
      assert.match((await res.json()).error.message, /already on your team/);
    });

    test('3.3 Name is required and email must look right', async () => {
      assert.equal((await post('/team', { name: '  ' }, auth())).status, 400);
      const bad = await post('/team', { name: 'Someone', email: 'not-an-email' }, auth());
      assert.equal(bad.status, 400);
      assert.match((await bad.json()).error.message, /email address does not look right/);
    });

    test('3.4 Task counts are shown, and renaming updates their tasks', async () => {
      const t = (await (await post('/tasks', { title: 'Priya task', general: true, assigneeId: memberId })).json()).data;
      const list = (await (await get('/team')).json()).data;
      assert.equal(list.find(m => m.id === memberId).openTasks, 1);

      const res = await patch(`/team/${memberId}`, { name: 'Priya Patel' });
      assert.equal(res.status, 200);
      assert.equal(mockDb.tasks.find(x => x.id === t.id).assigneeName, 'Priya Patel');
    });

    test('3.5 Someone with open tasks cannot be removed', async () => {
      const res = await del(`/team/${memberId}`);
      assert.equal(res.status, 409);
      assert.match((await res.json()).error.message, /still has 1 open task/);
    });

    test('3.6 Once their tasks are finished, they can be removed', async () => {
      for (const t of mockDb.tasks.filter(x => x.assigneeId === memberId)) {
        await post(`/tasks/${t.id}/complete`, {}, auth());
      }
      const res = await del(`/team/${memberId}`);
      assert.equal(res.status, 200);
      assert.equal(lastAudit().action, 'team_member_deleted');
      assert.equal((await del(`/team/${memberId}`)).status, 404);
    });

    test('3.7 Read-only keys cannot add team members', async () => {
      const res = await fetch(`${baseUrl}/api/v1/team`, { method: 'POST', headers: { Authorization: `Bearer ${TEST_READONLY_KEY}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'X Y' }) });
      assert.equal(res.status, 403);
    });
  });
});
