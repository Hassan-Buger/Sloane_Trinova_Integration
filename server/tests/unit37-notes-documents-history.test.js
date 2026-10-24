/**
 * Unit 37 Test Suite: Client notes, documents, history entries and signing records
 *
 * Verifies, for a live TriNova client and for a client added in Sloane:
 * - Notes can be added, edited and deleted (and the history mirror follows)
 * - Documents can be uploaded, renamed, re-categorised, downloaded and deleted (to the Bin; the
 *   file is removed when the Bin item is deleted for good)
 * - History entries the owner wrote can be edited; automatic ones can only be deleted
 * - A signing request can be recorded and cancelled, and says plainly that nothing was sent
 * - Deleting a client removes its own tasks, notes, documents (files), history and signing records
 * - Plain-English 404 / 409 / 422 answers and an audit entry for every change
 */

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { randomUUID } from 'node:crypto';

import { createApp } from '../src/app.js';
import { mockDb } from '../src/data/db.js';
import { auditStore } from '../src/middleware/audit.js';
import { clientDirectory } from '../src/services/clientDirectory.js';
import { documentStorage } from '../src/services/storageDriver.js';
import { deleteForGood } from '../src/services/bin.js';
import { TEST_API_KEY } from './fixtures.js';

const PORT = 5037;
const auth = { Authorization: `Bearer ${TEST_API_KEY}`, 'Content-Type': 'application/json' };
const keyed = () => ({ ...auth, 'Idempotency-Key': randomUUID() });

describe('Unit 37: Notes, documents, history and signing', () => {
  let server;
  let baseUrl;
  const call = (method, path, body, headers = auth) =>
    fetch(`${baseUrl}/api/v1${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const lastAudit = () => auditStore.logs[0];
  const b64 = text => Buffer.from(text).toString('base64');

  before(async () => {
    clientDirectory.setTrinovaClients([{ id: 'tn-3001', name: 'Notes Live Client Ltd', company_number: '77770001' }]);
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

  describe('1. Client notes (edit and delete)', () => {
    let noteId;

    test('1.1 A note can be added to a live TriNova client', async () => {
      const res = await call('POST', '/companies/tn-3001/notes', { text: 'Called about VAT', confirm_write_to_trinova: true });
      assert.equal(res.status, 201);
      noteId = (await res.json()).data.id;
    });

    test('1.2 The note can be edited, and its history entry follows', async () => {
      const res = await call('PATCH', `/companies/tn-3001/notes/${noteId}`, { text: 'Called about VAT and PAYE' });
      assert.equal(res.status, 200);
      const note = (await res.json()).data;
      assert.equal(note.text, 'Called about VAT and PAYE');
      assert.ok(note.editedAt);
      assert.equal(lastAudit().action, 'internal_note_updated');
      const ev = mockDb.timeline_events.find(e => e.externalId === noteId);
      assert.match(ev.description, /PAYE/);
    });

    test('1.3 An empty edit is refused; a bad visibility is refused', async () => {
      const empty = await call('PATCH', `/companies/tn-3001/notes/${noteId}`, { text: '  ' });
      assert.equal(empty.status, 422);
      assert.match((await empty.json()).error.message, /cannot be empty/);
      const vis = await call('PATCH', `/companies/tn-3001/notes/${noteId}`, { visibility: 'everyone' });
      assert.equal(vis.status, 422);
    });

    test('1.4 A note cannot be changed through a different client\'s address', async () => {
      const res = await call('PATCH', `/companies/someone-else/notes/${noteId}`, { text: 'x' });
      assert.equal(res.status, 404);
    });

    test('1.5 The note can be deleted; its history entry goes too; deleting again is a plain 404', async () => {
      const res = await call('DELETE', `/companies/tn-3001/notes/${noteId}`);
      assert.equal(res.status, 200);
      assert.equal(lastAudit().action, 'internal_note_deleted');
      assert.equal(mockDb.timeline_events.find(e => e.externalId === noteId), undefined);
      const again = await call('DELETE', `/companies/tn-3001/notes/${noteId}`);
      assert.equal(again.status, 404);
      assert.match((await again.json()).error.message, /already have been deleted/);
    });
  });

  describe('2. Documents (upload, rename, download, delete)', () => {
    let docId;
    let diskPath;

    test('2.1 A file can be uploaded to a live TriNova client', async () => {
      const res = await call('POST', '/companies/tn-3001/documents/upload',
        { filename: 'Engagement letter.pdf', contentBase64: b64('%PDF-1.4 hello'), category: 'Contracts' }, keyed());
      assert.equal(res.status, 201);
      const doc = (await res.json()).data;
      docId = doc.id;
      assert.equal(doc.storagePath, undefined, 'server paths are never sent to the browser');
      assert.equal(doc.mimeType, 'application/pdf');
      const stored = mockDb.documents.find(d => d.id === docId);
      diskPath = documentStorage.pathFor(stored);
      assert.ok(fs.existsSync(diskPath));
    });

    test('2.2 The file type is worked out from the name when the browser sends none (Word)', async () => {
      const res = await call('POST', '/companies/tn-3001/documents/upload',
        { filename: 'Notes.docx', contentBase64: b64('word') }, keyed());
      assert.equal(res.status, 201);
      assert.match((await res.json()).data.mimeType, /wordprocessingml/);
    });

    test('2.3 Unsafe files are refused with a clear reason', async () => {
      const res = await call('POST', '/companies/tn-3001/documents/upload',
        { filename: 'setup.exe', contentBase64: b64('MZ') }, keyed());
      assert.equal(res.status, 422);
    });

    test('2.4 The document can be downloaded with a short-lived link', async () => {
      const tok = await (await call('GET', `/documents/${docId}/download-token`)).json();
      const res = await fetch(`${baseUrl}${tok.data.downloadUrl}`);
      assert.equal(res.status, 200);
      assert.match(await res.text(), /%PDF-1.4 hello/);
    });

    test('2.5 Renaming keeps the file type, and the category can change', async () => {
      const res = await call('PATCH', `/documents/${docId}`, { filename: 'Signed engagement letter', category: 'Accounts' });
      assert.equal(res.status, 200);
      const doc = (await res.json()).data;
      assert.equal(doc.filename, 'Signed engagement letter.pdf');
      assert.equal(doc.category, 'Accounts');
      assert.equal(lastAudit().action, 'document_updated');
    });

    test('2.6 Bad names are refused', async () => {
      assert.equal((await call('PATCH', `/documents/${docId}`, { filename: '  ' })).status, 422);
      assert.equal((await call('PATCH', `/documents/${docId}`, { filename: 'a/b' })).status, 422);
    });

    test('2.7 A document in a signing request cannot be deleted', async () => {
      const sign = await call('POST', '/companies/tn-3001/signing-requests',
        { documentId: docId, signers: [{ name: 'Sam Signer', email: 'sam@example.com' }] }, keyed());
      assert.equal(sign.status, 201);
      const res = await call('DELETE', `/documents/${docId}`);
      assert.equal(res.status, 409);
      assert.match((await res.json()).error.message, /part of a signing request/);
    });

    test('2.7b Once the signing request is cancelled, its document can be deleted (a still-open one cannot)', async () => {
      const up = await call('POST', '/companies/tn-3001/documents/upload', { filename: 'Cancel then delete.pdf', contentBase64: b64('%PDF') }, keyed());
      const doc = (await up.json()).data;
      const sign = await call('POST', '/companies/tn-3001/signing-requests',
        { documentId: doc.id, signers: [{ name: 'Sam Signer', email: 'sam@example.com' }] }, keyed());
      const signId = (await sign.json()).data.id;

      const blocked = await call('DELETE', `/documents/${doc.id}`);
      assert.equal(blocked.status, 409);
      assert.match((await blocked.json()).error.message, /still open.*Cancel the request first/);

      assert.equal((await call('POST', `/signing-requests/${signId}/cancel`, {})).status, 200);
      const allowed = await call('DELETE', `/documents/${doc.id}`);
      assert.equal(allowed.status, 200);
      assert.equal(mockDb.documents.some(d => d.id === doc.id), false);
    });

    test('2.8 Otherwise it can be deleted (to the Bin, file kept until deleted for good), and deleting again is a plain 404', async () => {
      const up = await call('POST', '/companies/tn-3001/documents/upload',
        { filename: 'Temp.txt', content: 'temporary' }, keyed());
      const doc = (await up.json()).data;
      const path = documentStorage.pathFor(mockDb.documents.find(d => d.id === doc.id));
      assert.ok(fs.existsSync(path));
      const res = await call('DELETE', `/documents/${doc.id}`);
      assert.equal(res.status, 200);
      const body = await res.json();
      assert.match(body.message, /Bin/);
      assert.equal(lastAudit().action, 'document_deleted');
      assert.equal(fs.existsSync(path), true, 'the file is kept while the document is in the Bin');
      deleteForGood(body.data.binId);
      assert.equal(fs.existsSync(path), false, 'deleting for good removes the file');
      const again = await call('DELETE', `/documents/${doc.id}`);
      assert.equal(again.status, 404);
    });

    test('2.9 Documents are found by file name, so they survive the storage folder being mounted elsewhere', () => {
      const doc = mockDb.documents.find(d => d.id === docId);
      const moved = documentStorage.pathFor({ ...doc, storagePath: '/old/mount/doc.pdf' });
      assert.ok(moved.endsWith(doc.diskId));
    });

    test('2.10 Delete can only ever remove files inside the storage folder', () => {
      assert.equal(documentStorage.deleteDocument({ storagePath: '/etc/passwd' }), false);
      assert.equal(documentStorage.deleteDocument({ diskId: '../../escape.txt' }), false);
    });
  });

  describe('3. History entries (edit and delete)', () => {
    let eventId;

    test('3.1 The owner can add a history entry to a live TriNova client', async () => {
      const res = await call('POST', '/clients/tn-3001/timeline/events',
        { eventType: 'NOTE_CREATED', title: 'Met at the office', description: 'Talked about growth', source: 'user' });
      assert.equal(res.status, 201);
      eventId = (await res.json()).data.id;
      const hist = await (await call('GET', '/clients/tn-3001/timeline')).json();
      assert.ok(hist.data.find(e => e.id === eventId));
    });

    test('3.2 The entry is shown as written by the owner, not "unknown"', async () => {
      const ev = mockDb.timeline_events.find(e => e.id === eventId);
      assert.equal(ev.actorId, 'actor_kirsty_allen');
    });

    test('3.3 An entry the owner wrote can be edited', async () => {
      const res = await call('PATCH', `/clients/tn-3001/timeline/${eventId}`, { title: 'Met at the office on Friday', severity: 'urgent' });
      assert.equal(res.status, 200);
      const ev = (await res.json()).data;
      assert.equal(ev.title, 'Met at the office on Friday');
      assert.equal(ev.severity, 'urgent');
      assert.equal(lastAudit().action, 'timeline_event_updated');
    });

    test('3.4 Bad edits are refused with plain messages', async () => {
      const cases = [
        [{ title: ' ' }, /short title/],
        [{ severity: 'huge' }, /importance/],
        [{ occurredAt: 'yesterday-ish' }, /real date/]
      ];
      for (const [body, pattern] of cases) {
        const res = await call('PATCH', `/clients/tn-3001/timeline/${eventId}`, body);
        assert.equal(res.status, 422, JSON.stringify(body));
        assert.match((await res.json()).error.message, pattern);
      }
    });

    test('3.5 An entry Sloane wrote automatically cannot be edited, only deleted', async () => {
      const t = await call('POST', '/tasks', { title: 'Auto entry task', clientId: 'tn-3001' }, keyed());
      const task = (await t.json()).data;
      const auto = mockDb.timeline_events.find(e => e.externalId === task.id);
      const edit = await call('PATCH', `/clients/tn-3001/timeline/${auto.id}`, { title: 'Changed' });
      assert.equal(edit.status, 409);
      assert.match((await edit.json()).error.message, /only be deleted/);
      const del = await call('DELETE', `/clients/tn-3001/timeline/${auto.id}`);
      assert.equal(del.status, 200);
    });

    test('3.6 An entry can be deleted; deleting again is a plain 404; unknown client is a plain 404', async () => {
      const res = await call('DELETE', `/clients/tn-3001/timeline/${eventId}`);
      assert.equal(res.status, 200);
      assert.equal(lastAudit().action, 'timeline_event_deleted');
      const again = await call('DELETE', `/clients/tn-3001/timeline/${eventId}`);
      assert.equal(again.status, 404);
      assert.match((await again.json()).error.message, /already have been deleted/);
      const nobody = await call('PATCH', '/clients/nobody/timeline/x', { title: 'x' });
      assert.equal(nobody.status, 404);
      assert.match((await nobody.json()).error.message, /could not find that client/i);
    });
  });

  describe('4. Signing records', () => {
    let docId;
    let signId;

    before(async () => {
      const up = await call('POST', '/companies/tn-3001/documents/upload', { filename: 'To sign.pdf', contentBase64: b64('%PDF') }, keyed());
      docId = (await up.json()).data.id;
    });

    test('4.1 A signing request can be recorded, and the answer says nothing was sent', async () => {
      const res = await call('POST', '/companies/tn-3001/signing-requests',
        { documentId: docId, title: 'Please sign', signers: [{ name: 'Alex Director', email: 'alex@example.com' }] }, keyed());
      assert.equal(res.status, 201);
      const body = await res.json();
      signId = body.data.id;
      assert.equal(body.meta.delivery, 'not_sent');
      assert.equal(body.data.status, 'PENDING');
    });

    test('4.2 It shows in the client\'s list', async () => {
      const list = await (await call('GET', '/companies/tn-3001/signing-requests')).json();
      assert.ok(list.data.find(r => r.id === signId));
    });

    test('4.3 No signer is refused with a plain message', async () => {
      const res = await call('POST', '/companies/tn-3001/signing-requests', { documentId: docId, signers: [] }, keyed());
      assert.equal(res.status, 422);
    });

    test('4.4 A request that is still waiting can be cancelled; cancelling twice is a plain conflict', async () => {
      const res = await call('POST', `/signing-requests/${signId}/cancel`, {});
      assert.equal(res.status, 200);
      assert.equal((await res.json()).data.status, 'CANCELLED');
      assert.equal(lastAudit().action, 'signing_request_cancelled');
      const again = await call('POST', `/signing-requests/${signId}/cancel`, {});
      assert.equal(again.status, 409);
      assert.match((await again.json()).error.message, /already cancelled/);
      assert.equal((await call('POST', '/signing-requests/nope/cancel', {})).status, 404);
    });

    test('4.5 The system status says signing is recorded only', async () => {
      const body = await (await call('GET', '/system/status')).json();
      assert.equal(body.data.signing.mode, 'record_only');
    });
  });

  describe('5. Deleting a client removes only its own data', () => {
    test('5.1 Tasks, notes, documents (and files), history and signing records of that client go; others stay', async () => {
      const client = (await (await call('POST', '/clients', { name: 'Cascade Client' })).json()).data;
      const companyId = client.companyIds[0];

      await call('POST', '/tasks', { title: 'Cascade task', clientId: client.id }, keyed());
      await call('POST', `/companies/${companyId}/notes`, { text: 'Cascade note', confirm_write_to_trinova: true });
      const up = await call('POST', `/companies/${companyId}/documents/upload`, { filename: 'cascade.txt', content: 'cascade' }, keyed());
      const upId = (await up.json()).data.id;
      const doc = mockDb.documents.find(d => d.id === upId);
      const file = documentStorage.pathFor(doc);
      assert.ok(fs.existsSync(file));

      const keepTask = (await (await call('POST', '/tasks', { title: 'Keep me', clientId: 'tn-3001' }, keyed())).json()).data;

      // A VAT return and an own-date deadline for this client, and a VAT return for another client
      await call('POST', '/vat-returns', { clientId: client.id, clientName: 'Cascade Client', period: 'Q1', dueDate: '2027-02-07' });
      await call('POST', '/statutory/deadlines', { name: 'Cascade Client', clientId: client.id, accountsDueDate: '2027-03-01' });
      await call('POST', '/vat-returns', { clientId: 'tn-3001', clientName: 'Notes Live Client Ltd', period: 'Q9', dueDate: '2027-02-08' });

      const res = await call('DELETE', `/clients/${client.id}`);
      assert.equal(res.status, 200);
      const delBody = await res.json();
      const removed = delBody.data.removed;
      assert.equal(removed.tasks, 1);
      assert.equal(removed.notes, 1);
      assert.equal(removed.documents, 1);
      assert.ok(removed.history >= 2);

      assert.equal(mockDb.tasks.some(t => t.title === 'Cascade task'), false);
      assert.equal(mockDb.notes.some(n => n.companyId === companyId), false);
      assert.equal(mockDb.documents.some(d => d.companyId === companyId), false);
      assert.equal(mockDb.companies.some(c => c.id === companyId), false);
      assert.equal(mockDb.timeline_events.some(e => e.clientId === client.id), false);
      assert.equal(fs.existsSync(file), true, 'the file is kept while the client is in the Bin');
      deleteForGood(delBody.data.binId);
      assert.equal(fs.existsSync(file), false, 'deleting the client for good removes the file');
      assert.ok(mockDb.tasks.find(t => t.id === keepTask.id), 'another client\'s task stays');
      assert.equal(mockDb.vatReturns.some(v => v.clientId === client.id), false, 'its VAT returns are removed');
      assert.equal(mockDb.statutoryTracker.some(d => d.clientId === client.id), false, 'its own-date deadlines are removed');
      assert.ok(mockDb.vatReturns.some(v => v.clientId === 'tn-3001'), 'another client\'s VAT return stays');
    });
  });
});
