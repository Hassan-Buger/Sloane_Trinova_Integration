/**
 * Unit 34 Test Suite: My Private Notes saved on the server
 *
 * Verifies:
 * - Notes can be written, listed, edited and deleted by the signed-in owner
 * - An API key (not a browser session) can never read or change private notes
 * - Notes written in the browser before can be moved to the server once, without duplicates
 * - Validation and plain-English errors
 * - Private notes never appear in the AI's view of the practice or in the audit log text
 */

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';

import { createApp } from '../src/app.js';
import { mockDb } from '../src/data/db.js';
import { auditStore } from '../src/middleware/audit.js';
import { TEST_API_KEY } from './fixtures.js';
import { loginCookie } from './support.js';

const PORT = 5034;

describe('Unit 34: Private notes on the server', () => {
  let server;
  let baseUrl;
  let cookie;
  let json;

  before(async () => {
    const app = createApp();
    await new Promise(resolve => {
      server = app.listen(PORT, () => {
        baseUrl = `http://localhost:${PORT}`;
        resolve();
      });
    });
    cookie = await loginCookie(baseUrl);
    json = { 'Content-Type': 'application/json', Cookie: cookie };
  });

  after(async () => {
    if (server) await new Promise(resolve => server.close(resolve));
  });

  describe('1. Create, read, edit, delete', () => {
    let noteId;

    test('1.1 The owner can write a note', async () => {
      const res = await fetch(`${baseUrl}/api/v1/ceo-notes`, {
        method: 'POST', headers: json, body: JSON.stringify({ text: '  Ring the bank about the loan  ' })
      });
      assert.equal(res.status, 201);
      const note = (await res.json()).data;
      assert.equal(note.text, 'Ring the bank about the loan');
      assert.ok(note.id.startsWith('cn_'));
      assert.equal(note.ownerId, undefined, 'the owner id is not sent back');
      noteId = note.id;
    });

    test('1.2 The note is in the list', async () => {
      const res = await fetch(`${baseUrl}/api/v1/ceo-notes`, { headers: { Cookie: cookie } });
      const body = await res.json();
      assert.equal(res.status, 200);
      assert.ok(body.data.find(n => n.id === noteId));
    });

    test('1.3 The note can be edited and records when', async () => {
      const res = await fetch(`${baseUrl}/api/v1/ceo-notes/${noteId}`, {
        method: 'PATCH', headers: json, body: JSON.stringify({ text: 'Ring the bank on Monday' })
      });
      assert.equal(res.status, 200);
      const note = (await res.json()).data;
      assert.equal(note.text, 'Ring the bank on Monday');
      assert.ok(note.editedAt);
    });

    test('1.4 An empty note is refused with a plain message', async () => {
      const res = await fetch(`${baseUrl}/api/v1/ceo-notes`, {
        method: 'POST', headers: json, body: JSON.stringify({ text: '   ' })
      });
      assert.equal(res.status, 400);
      assert.match((await res.json()).error.message, /write something/i);
    });

    test('1.5 Emptying a note while editing is refused', async () => {
      const res = await fetch(`${baseUrl}/api/v1/ceo-notes/${noteId}`, {
        method: 'PATCH', headers: json, body: JSON.stringify({ text: '' })
      });
      assert.equal(res.status, 400);
      assert.match((await res.json()).error.message, /cannot be empty/i);
    });

    test('1.6 The note can be deleted, and then it is gone (404 with a plain message)', async () => {
      const del = await fetch(`${baseUrl}/api/v1/ceo-notes/${noteId}`, { method: 'DELETE', headers: { Cookie: cookie } });
      assert.equal(del.status, 200);
      const again = await fetch(`${baseUrl}/api/v1/ceo-notes/${noteId}`, { method: 'DELETE', headers: { Cookie: cookie } });
      assert.equal(again.status, 404);
      assert.match((await again.json()).error.message, /no longer exists/i);
    });

    test('1.7 Each change is recorded in the audit log (without the note text)', async () => {
      const actions = auditStore.logs.map(l => l.action);
      for (const a of ['private_note_created', 'private_note_updated', 'private_note_deleted']) {
        assert.ok(actions.includes(a), `${a} missing`);
      }
      assert.ok(!JSON.stringify(auditStore.logs).includes('Ring the bank'));
    });
  });

  describe('2. Privacy', () => {
    test('2.1 No sign-in: refused', async () => {
      const res = await fetch(`${baseUrl}/api/v1/ceo-notes`);
      assert.equal(res.status, 401);
    });

    test('2.2 An API key cannot read private notes', async () => {
      const res = await fetch(`${baseUrl}/api/v1/ceo-notes`, { headers: { Authorization: `Bearer ${TEST_API_KEY}` } });
      assert.equal(res.status, 403);
      assert.equal((await res.json()).error.code, 'SESSION_REQUIRED');
    });

    test('2.3 An API key cannot write or delete private notes either', async () => {
      const post = await fetch(`${baseUrl}/api/v1/ceo-notes`, {
        method: 'POST', headers: { Authorization: `Bearer ${TEST_API_KEY}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ text: 'x' })
      });
      assert.equal(post.status, 403);
      const del = await fetch(`${baseUrl}/api/v1/ceo-notes/anything`, { method: 'DELETE', headers: { Authorization: `Bearer ${TEST_API_KEY}` } });
      assert.equal(del.status, 403);
    });

    test('2.4 A note that belongs to someone else is not visible or editable', async () => {
      mockDb.ceoNotes.push({ id: 'cn_other', ownerId: 'actor_someone_else', text: 'not yours', createdAt: new Date().toISOString(), editedAt: null });
      const list = await (await fetch(`${baseUrl}/api/v1/ceo-notes`, { headers: { Cookie: cookie } })).json();
      assert.ok(!list.data.find(n => n.id === 'cn_other'));
      const patch = await fetch(`${baseUrl}/api/v1/ceo-notes/cn_other`, { method: 'PATCH', headers: json, body: JSON.stringify({ text: 'mine now' }) });
      assert.equal(patch.status, 404);
      mockDb.ceoNotes.splice(mockDb.ceoNotes.findIndex(n => n.id === 'cn_other'), 1);
    });

    test('2.5 Private notes are not part of what the AI is shown', async () => {
      await fetch(`${baseUrl}/api/v1/ceo-notes`, { method: 'POST', headers: json, body: JSON.stringify({ text: 'SECRET-PRIVATE-MARKER-123' }) });
      const ai = await fetch(`${baseUrl}/api/v1/ai/executive-briefing`, { headers: { Authorization: `Bearer ${TEST_API_KEY}` } });
      assert.ok(!(await ai.text()).includes('SECRET-PRIVATE-MARKER-123'));
    });
  });

  describe('3. Moving browser-only notes to the server', () => {
    test('3.1 Old notes are imported once, newest first, keeping their dates', async () => {
      const notes = [
        { id: 'b-1', text: 'Old note one', createdAt: '2026-01-02T10:00:00.000Z' },
        { id: 'b-2', text: 'Old note two', createdAt: '2026-03-04T10:00:00.000Z', editedAt: '2026-03-05T10:00:00.000Z' }
      ];
      const res = await fetch(`${baseUrl}/api/v1/ceo-notes/import`, { method: 'POST', headers: json, body: JSON.stringify({ notes }) });
      assert.equal(res.status, 200);
      assert.deepEqual((await res.json()).data, { imported: 2, skipped: 0 });

      const list = (await (await fetch(`${baseUrl}/api/v1/ceo-notes`, { headers: { Cookie: cookie } })).json()).data;
      const two = list.find(n => n.text === 'Old note two');
      assert.equal(two.createdAt, '2026-03-04T10:00:00.000Z');
      assert.equal(two.editedAt, '2026-03-05T10:00:00.000Z');
    });

    test('3.2 Running the import again does not create duplicates', async () => {
      const notes = [{ id: 'b-1', text: 'Old note one', createdAt: '2026-01-02T10:00:00.000Z' }];
      const res = await fetch(`${baseUrl}/api/v1/ceo-notes/import`, { method: 'POST', headers: json, body: JSON.stringify({ notes }) });
      assert.deepEqual((await res.json()).data, { imported: 0, skipped: 1 });
      const list = (await (await fetch(`${baseUrl}/api/v1/ceo-notes`, { headers: { Cookie: cookie } })).json()).data;
      assert.equal(list.filter(n => n.text === 'Old note one').length, 1);
    });

    test('3.3 Empty entries are skipped and a bad payload is refused', async () => {
      const ok = await fetch(`${baseUrl}/api/v1/ceo-notes/import`, { method: 'POST', headers: json, body: JSON.stringify({ notes: [{ id: 'x', text: '  ' }] }) });
      assert.deepEqual((await ok.json()).data, { imported: 0, skipped: 1 });
      const bad = await fetch(`${baseUrl}/api/v1/ceo-notes/import`, { method: 'POST', headers: json, body: JSON.stringify({}) });
      assert.equal(bad.status, 400);
    });
  });
});
