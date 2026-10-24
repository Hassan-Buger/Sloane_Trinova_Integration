/**
 * Unit 47 Test Suite: the Bin (deleted items kept for 30 days)
 *
 * Verifies:
 * - A deleted task, team member, business, deadline, VAT return, note and private note go to the
 *   Bin and can be put back exactly as they were
 * - A deleted client goes to the Bin with its tasks, notes, documents and history, and they all
 *   come back together; its uploaded file is kept until the item is deleted for good
 * - Putting a person back re-links their finished tasks
 * - A business cannot be put back over a new business with the same name
 * - "Delete for good", "Empty the Bin" and the 30-day clear-out remove items (and files) for good
 * - Only the signed-in owner can open the Bin (it can hold private notes)
 */

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { randomUUID } from 'node:crypto';

import { createApp } from '../src/app.js';
import { mockDb, COLLECTIONS } from '../src/data/db.js';
import { documentStorage } from '../src/services/storageDriver.js';
import { putInBin, takeOut, clearExpired, BIN_DAYS } from '../src/services/bin.js';
import { TEST_API_KEY } from './fixtures.js';
import { loginCookie } from './support.js';

const PORT = 5047;

describe('Unit 47: the Bin', () => {
  let server;
  let baseUrl;
  let cookie;
  const headers = (extra = {}) => ({ 'Content-Type': 'application/json', Cookie: cookie, ...extra });
  const call = async (method, path, body, extra) => {
    const res = await fetch(`${baseUrl}/api/v1${path}`, { method, headers: headers(extra), body: body ? JSON.stringify(body) : undefined });
    let json = null;
    try { json = await res.json(); } catch (_) { /* no body */ }
    return { status: res.status, body: json };
  };
  const keyed = () => ({ 'Idempotency-Key': randomUUID() });
  const binIds = () => (mockDb.bin || []).map(e => e.id);

  before(async () => {
    const app = createApp();
    await new Promise(resolve => {
      server = app.listen(PORT, () => {
        baseUrl = `http://localhost:${PORT}`;
        resolve();
      });
    });
    cookie = await loginCookie(baseUrl);
  });

  after(async () => {
    if (server) await new Promise(resolve => server.close(resolve));
  });

  test('47.1 the Bin is saved with everything else, and starts as a list', () => {
    assert.ok(COLLECTIONS.bin, 'the Bin is a saved collection');
    assert.ok(Array.isArray(mockDb.bin));
    assert.equal(BIN_DAYS, 30);
  });

  test('47.2 only the signed-in owner can open the Bin', async () => {
    const res = await fetch(`${baseUrl}/api/v1/bin`, { headers: { Authorization: `Bearer ${TEST_API_KEY}` } });
    assert.equal(res.status, 403);
    const anon = await fetch(`${baseUrl}/api/v1/bin`);
    assert.equal(anon.status, 401);
  });

  test('47.3 a deleted task goes to the Bin and comes back exactly as it was', async () => {
    const task = (await call('POST', '/tasks', { title: 'Bin task 47', general: true }, keyed())).body.data;
    const del = await call('DELETE', `/tasks/${task.id}`);
    assert.equal(del.status, 200);
    assert.match(del.body.message, /Bin/);
    assert.equal(mockDb.tasks.some(t => t.id === task.id), false);

    const list = (await call('GET', '/bin')).body;
    const item = list.data.find(i => i.id === del.body.data.binId);
    assert.ok(item, 'listed in the Bin');
    assert.equal(item.kind, 'task');
    assert.equal(item.kindLabel, 'Task');
    assert.equal(item.label, 'Bin task 47');
    assert.equal(item.daysLeft, 30);
    assert.equal(list.meta.keepDays, 30);

    const back = await call('POST', `/bin/${item.id}/restore`, {});
    assert.equal(back.status, 200);
    assert.match(back.body.message, /put back/);
    const restored = mockDb.tasks.find(t => t.id === task.id);
    assert.ok(restored, 'the task is back');
    assert.equal(restored.title, 'Bin task 47');
    assert.equal(binIds().includes(item.id), false, 'no longer in the Bin');

    const twice = await call('POST', `/bin/${item.id}/restore`, {});
    assert.equal(twice.status, 404);
  });

  test('47.4 a deleted client goes to the Bin with its tasks, notes, documents and history, and they all come back', async () => {
    const client = (await call('POST', '/clients', { name: 'Bin Client 47' })).body.data;
    const companyId = client.companyIds[0];
    await call('POST', '/tasks', { title: 'Bin client task', clientId: client.id }, keyed());
    await call('POST', `/companies/${companyId}/notes`, { text: 'Bin client note', confirm_write_to_trinova: true });
    const up = await call('POST', `/companies/${companyId}/documents/upload`, { filename: 'bin47.txt', content: 'keep me' }, keyed());
    const doc = mockDb.documents.find(d => d.id === up.body.data.id);
    const file = documentStorage.pathFor(doc);
    const historyBefore = mockDb.timeline_events.filter(e => e.clientId === client.id).length;
    assert.ok(historyBefore >= 1);

    const del = await call('DELETE', `/clients/${client.id}`);
    assert.equal(del.status, 200);
    assert.match(del.body.message, /Bin/);
    assert.equal(mockDb.clients.some(c => c.id === client.id), false);
    assert.equal(mockDb.documents.some(d => d.id === doc.id), false);
    assert.ok(fs.existsSync(file), 'the file is kept while the client is in the Bin');

    const item = (await call('GET', '/bin')).body.data.find(i => i.id === del.body.data.binId);
    assert.equal(item.kind, 'client');
    assert.match(item.alsoIncludes, /1 task/);
    assert.match(item.alsoIncludes, /1 note/);
    assert.match(item.alsoIncludes, /1 document/);
    assert.match(item.alsoIncludes, /history entr/);

    const back = await call('POST', `/bin/${item.id}/restore`, {});
    assert.equal(back.status, 200);
    assert.ok(mockDb.clients.some(c => c.id === client.id), 'client back');
    assert.ok(mockDb.companies.some(c => c.id === companyId), 'its company back');
    assert.ok(mockDb.tasks.some(t => t.title === 'Bin client task'), 'its task back');
    assert.ok(mockDb.notes.some(n => n.companyId === companyId && n.text === 'Bin client note'), 'its note back');
    assert.ok(mockDb.documents.some(d => d.id === doc.id), 'its document back');
    assert.equal(mockDb.timeline_events.filter(e => e.clientId === client.id).length, historyBefore, 'its history back');

    // And the document still downloads: the file was never deleted
    assert.ok(fs.existsSync(file));
  });

  test('47.5 delete for good removes the item and its file; it cannot be put back afterwards', async () => {
    const client = (await call('POST', '/clients', { name: 'Gone For Good 47' })).body.data;
    const up = await call('POST', `/companies/${client.companyIds[0]}/documents/upload`, { filename: 'gone47.txt', content: 'bye' }, keyed());
    const file = documentStorage.pathFor(mockDb.documents.find(d => d.id === up.body.data.id));
    const delDoc = await call('DELETE', `/documents/${up.body.data.id}`);
    assert.ok(fs.existsSync(file));

    const gone = await call('DELETE', `/bin/${delDoc.body.data.binId}`);
    assert.equal(gone.status, 200);
    assert.match(gone.body.message, /deleted for good/);
    assert.equal(fs.existsSync(file), false, 'the file is deleted for good');
    assert.equal((await call('POST', `/bin/${delDoc.body.data.binId}/restore`, {})).status, 404);
    assert.equal((await call('DELETE', `/bin/${delDoc.body.data.binId}`)).status, 404);
  });

  test('47.6 putting a person back re-links their finished tasks', async () => {
    const member = (await call('POST', '/team', { name: 'Bin Person 47', role: 'Bookkeeper' })).body.data;
    const task = (await call('POST', '/tasks', { title: 'Finished by Bin Person', general: true, assigneeId: member.id }, keyed())).body.data;
    await call('POST', `/tasks/${task.id}/complete`, { resolutionNote: 'Done' });
    const del = await call('DELETE', `/team/${member.id}`);
    assert.equal(del.status, 200);
    assert.equal(mockDb.tasks.find(t => t.id === task.id).assigneeId, null, 'the link is cleared while they are in the Bin');

    const back = await call('POST', `/bin/${del.body.data.binId}/restore`, {});
    assert.equal(back.status, 200);
    assert.ok(mockDb.teamMembers.some(m => m.id === member.id));
    assert.equal(mockDb.tasks.find(t => t.id === task.id).assigneeId, member.id, 'the link is back');
  });

  test('47.7 a business cannot be put back over a new business with the same name', async () => {
    const biz = (await call('POST', '/businesses', { name: 'Bin Biz 47', type: 'Testing' })).body.data;
    const del = await call('DELETE', `/businesses/${biz.id}`);
    assert.equal(del.status, 200);
    await call('POST', '/businesses', { name: 'Bin Biz 47', type: 'Testing again' });

    const refused = await call('POST', `/bin/${del.body.data.binId}/restore`, {});
    assert.equal(refused.status, 409);
    assert.match(refused.body.error.message, /already a business called "Bin Biz 47"/);
    assert.ok(binIds().includes(del.body.data.binId), 'it stays in the Bin');
  });

  test('47.8 deadlines, VAT returns, client notes and history entries go to the Bin and come back', async () => {
    const dl = (await call('POST', '/statutory/deadlines', { name: 'Bin Deadline 47', companyNumber: 'BN470001', accountsDueDate: '2027-04-30' })).body.data;
    const vat = (await call('POST', '/vat-returns', { clientName: 'Bin VAT 47', period: 'Q1', dueDate: '2027-02-07' })).body.data;
    const client = (await call('POST', '/clients', { name: 'Bin Notes 47' })).body.data;
    const note = (await call('POST', `/companies/${client.companyIds[0]}/notes`, { text: 'A note for the Bin', confirm_write_to_trinova: true })).body.data;
    const ev = (await call('POST', `/clients/${client.id}/timeline/events`, { title: 'Bin history 47', description: 'Written for the Bin test', eventType: 'NOTE_CREATED', severity: 'normal' })).body.data;

    const dels = [
      await call('DELETE', `/statutory/deadlines/${dl.id}`),
      await call('DELETE', `/vat-returns/${vat.id}`),
      await call('DELETE', `/companies/${client.companyIds[0]}/notes/${note.id}`),
      await call('DELETE', `/clients/${client.id}/timeline/${ev.id}`)
    ];
    for (const d of dels) {
      assert.equal(d.status, 200);
      assert.match(d.body.message, /Bin/);
    }
    assert.equal(mockDb.notes.some(n => n.id === note.id), false);
    assert.equal(mockDb.timeline_events.some(e => e.externalId === note.id), false, 'the note\'s history line went with it');

    const kinds = (await call('GET', '/bin')).body.data.filter(i => dels.some(d => d.body.data.binId === i.id)).map(i => i.kind).sort();
    assert.deepEqual(kinds, ['deadline', 'history', 'note', 'vat_return']);

    for (const d of dels) assert.equal((await call('POST', `/bin/${d.body.data.binId}/restore`, {})).status, 200);
    assert.ok(mockDb.statutoryTracker.some(r => r.id === dl.id));
    assert.ok(mockDb.vatReturns.some(v => v.id === vat.id));
    assert.ok(mockDb.notes.some(n => n.id === note.id));
    assert.ok(mockDb.timeline_events.some(e => e.externalId === note.id), 'the note\'s history line is back');
    assert.ok(mockDb.timeline_events.some(e => e.id === ev.id));
  });

  test('47.9 a private note goes to the Bin and is only listed for the owner', async () => {
    const note = (await call('POST', '/ceo-notes', { text: 'Private thought for the Bin' })).body.data;
    const del = await call('DELETE', `/ceo-notes/${note.id}`);
    assert.equal(del.status, 200);
    const entry = mockDb.bin.find(e => e.id === del.body.data.binId);
    assert.equal(entry.ownerOnly, true);
    assert.equal(entry.kind, 'private_note');
    const back = await call('POST', `/bin/${entry.id}/restore`, {});
    assert.equal(back.status, 200);
    assert.ok(mockDb.ceoNotes.some(n => n.id === note.id));
  });

  test('47.10 items older than 30 days are deleted for good by the clear-out', () => {
    const fake = { id: 'tsk_bin47_old', title: 'Old task' };
    mockDb.tasks.push(fake);
    const longAgo = Date.now() - 31 * 24 * 60 * 60 * 1000;
    const entry = putInBin({ kind: 'task', label: 'Old task', removed: [takeOut('tasks', t => t.id === fake.id)] }, longAgo);
    assert.ok(binIds().includes(entry.id));
    const n = clearExpired();
    assert.ok(n >= 1);
    assert.equal(binIds().includes(entry.id), false);
  });

  test('47.11 "Empty the Bin" deletes everything in it for good', async () => {
    const task = (await call('POST', '/tasks', { title: 'Empty me 47', general: true }, keyed())).body.data;
    await call('DELETE', `/tasks/${task.id}`);
    assert.ok((mockDb.bin || []).length > 0);
    const res = await call('DELETE', '/bin');
    assert.equal(res.status, 200);
    assert.match(res.body.message, /emptied/);
    assert.equal(mockDb.bin.length, 0);
    assert.equal((await call('GET', '/bin')).body.data.length, 0);
  });
});
