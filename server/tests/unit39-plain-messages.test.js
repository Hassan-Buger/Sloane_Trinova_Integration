/**
 * Unit 39 Test Suite: Plain-English messages
 *
 * The messages the browser shows (sign-in, session, uploads, downloads, missing items,
 * Companies House, task rules) must read like a person wrote them: no developer words.
 */

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

import { createApp } from '../src/app.js';
import { documentStorage } from '../src/services/storageDriver.js';
import { companiesHouseService } from '../src/services/companiesHouse.js';
import { WorkflowEngine } from '../src/services/workflow.js';
import { TEST_API_KEY } from './fixtures.js';

const PORT = 5039;
const auth = { Authorization: `Bearer ${TEST_API_KEY}`, 'Content-Type': 'application/json' };
const JARGON = /payload|UUID|MIME|HMAC|Idempotency|pre-signed|presigned|token endpoint|\bAPI\b|binary|scope|JSON|vault|endpoint|credential|contentBase64/i;

describe('Unit 39: Plain-English messages', () => {
  let server;
  let baseUrl;

  const message = async res => (await res.json()).error?.message || '';
  const call = (method, path, body, headers = auth) =>
    fetch(`${baseUrl}/api/v1${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined });

  before(async () => {
    const app = createApp();
    await new Promise(resolve => {
      server = app.listen(PORT, () => {
        baseUrl = `http://localhost:${PORT}`;
        resolve();
      });
    });
  });

  after(async () => {
    if (server) await new Promise(resolve => server.close(resolve));
  });

  describe('1. Signing in and sessions', () => {
    test('1.1 Missing sign-in (session timed out) asks the person to sign in', async () => {
      const res = await fetch(`${baseUrl}/api/v1/clients`);
      assert.equal(res.status, 401);
      const msg = await message(res);
      assert.match(msg, /sign in to Sloane/i);
      assert.doesNotMatch(msg, JARGON);
    });

    test('1.2 Leaving out the password says what to type', async () => {
      const res = await call('POST', '/auth/login', { email: 'someone@example.com' }, { 'Content-Type': 'application/json' });
      assert.equal(res.status, 400);
      const msg = await message(res);
      assert.match(msg, /type your email and password/i);
      assert.doesNotMatch(msg, JARGON);
    });

    test('1.3 A wrong password is a calm, generic answer', async () => {
      const res = await call('POST', '/auth/login', { email: 'someone@example.com', password: 'nope' }, { 'Content-Type': 'application/json' });
      assert.equal(res.status, 401);
      assert.match(await message(res), /Invalid email or password/);
    });
  });

  describe('2. Things that cannot be found', () => {
    test('2.1 Unknown client, company, document, conversation and signing request all say "We could not find"', async () => {
      const cases = [
        ['GET', '/clients/nope'],
        ['GET', '/companies/nope'],
        ['GET', '/documents/nope'],
        ['GET', '/conversations/nope/messages'],
        ['GET', '/signing-requests/nope']
      ];
      for (const [method, path] of cases) {
        const res = await call(method, path);
        assert.equal(res.status, 404, `${method} ${path}`);
        const msg = await message(res);
        assert.match(msg, /could not find/i, `${method} ${path}: ${msg}`);
        assert.doesNotMatch(msg, JARGON, `${method} ${path}: ${msg}`);
        assert.doesNotMatch(msg, /with ID/i, `${method} ${path}: ${msg}`);
      }
    });
  });

  describe('3. Uploading and downloading files', () => {
    test('3.1 A file that is too big says how big and what the limit is', () => {
      assert.throws(
        () => documentStorage.validateFile('big.pdf', 'application/pdf', 20 * 1024 * 1024),
        err => {
          assert.equal(err.code, 'FILE_TOO_LARGE');
          assert.match(err.message, /20\.0 MB.*15 MB limit/);
          assert.doesNotMatch(err.message, JARGON);
          return true;
        }
      );
    });

    test('3.2 A program file is refused in plain words', () => {
      assert.throws(
        () => documentStorage.validateFile('setup.exe', 'application/pdf', 100),
        err => {
          assert.equal(err.code, 'DISALLOWED_FILE_TYPE');
          assert.match(err.message, /cannot be added/);
          assert.doesNotMatch(err.message, JARGON);
          return true;
        }
      );
    });

    test('3.3 An unsupported kind of file lists what can be added', () => {
      assert.throws(
        () => documentStorage.validateFile('movie.mp4', 'video/mp4', 100),
        err => {
          assert.equal(err.code, 'UNSUPPORTED_MIME_TYPE');
          assert.match(err.message, /PDF, Word, Excel/);
          assert.doesNotMatch(err.message, JARGON);
          return true;
        }
      );
    });

    test('3.4 An upload with no file says to choose one', async () => {
      const res = await call('POST', '/companies/comp_woofington_park_01/documents/upload', { filename: 'a.pdf' }, { ...auth, 'Idempotency-Key': randomUUID() });
      assert.equal(res.status, 422);
      const msg = await message(res);
      assert.match(msg, /choose a file/i);
      assert.doesNotMatch(msg, JARGON);
    });

    test('3.5 A download link that is missing, forged or expired explains what to do', async () => {
      const missing = await fetch(`${baseUrl}/api/v1/documents/download`);
      assert.equal(missing.status, 401);
      assert.match(await message(missing), /click Download again/);

      const forged = await fetch(`${baseUrl}/api/v1/documents/download?token=forged_token_value`);
      assert.equal(forged.status, 403);
      const forgedMsg = await message(forged);
      assert.match(forgedMsg, /click Download again/);
      assert.doesNotMatch(forgedMsg, JARGON);

      const expired = documentStorage.generatePresignedToken('doc_x', 'actor', -1000);
      const expiredRes = await fetch(`${baseUrl}/api/v1/documents/download?token=${encodeURIComponent(expired.token)}`);
      assert.equal(expiredRes.status, 403);
      const expiredMsg = await message(expiredRes);
      assert.match(expiredMsg, /expired/);
      assert.doesNotMatch(expiredMsg, JARGON);
    });

    test('3.6 A missing stored file says so plainly', () => {
      assert.throws(
        () => documentStorage.readDocument('/definitely/not/here.pdf'),
        err => {
          assert.equal(err.code, 'FILE_NOT_FOUND');
          assert.match(err.message, /missing from the server/);
          assert.doesNotMatch(err.message, JARGON);
          return true;
        }
      );
    });
  });

  describe('4. Retrying a request that did not go through', () => {
    test('4.1 A missing or bad request key tells the person to try again', async () => {
      const missing = await call('POST', '/tasks', { title: 'x', general: true });
      assert.equal(missing.status, 400);
      const msg1 = await message(missing);
      assert.match(msg1, /try again/i);
      assert.doesNotMatch(msg1, JARGON);

      const bad = await call('POST', '/tasks', { title: 'x', general: true }, { ...auth, 'Idempotency-Key': 'not-a-uuid' });
      assert.equal(bad.status, 400);
      assert.doesNotMatch(await message(bad), JARGON);
    });

    test('4.2 Re-using a key for something different is explained', async () => {
      const key = randomUUID();
      const headers = { ...auth, 'Idempotency-Key': key };
      assert.equal((await call('POST', '/tasks', { title: 'First', general: true }, headers)).status, 201);
      const again = await call('POST', '/tasks', { title: 'Different', general: true }, headers);
      assert.equal(again.status, 409);
      const msg = await message(again);
      assert.match(msg, /try again/i);
      assert.doesNotMatch(msg, JARGON);
    });
  });

  describe('5. Questions, notes, signing and tasks', () => {
    test('5.1 An empty question and an over-long question are explained', async () => {
      const empty = await call('POST', '/ai/ask', { message: '  ' });
      assert.equal(empty.status, 422);
      assert.match(await message(empty), /type a question/i);
      const long = await call('POST', '/ai/ask', { message: 'x'.repeat(1200) });
      assert.equal(long.status, 422);
      const msg = await message(long);
      assert.match(msg, /too long/);
      assert.doesNotMatch(msg, JARGON);
    });

    test('5.2 A signing request with no signer says who to add', async () => {
      const docs = await (await call('GET', '/companies/comp_woofington_park_01/documents')).json();
      const doc = docs.data[0];
      const res = await call('POST', '/companies/comp_woofington_park_01/signing-requests',
        { documentId: doc.id, signers: [] }, { ...auth, 'Idempotency-Key': randomUUID() });
      assert.equal(res.status, 422);
      const msg = await message(res);
      assert.match(msg, /at least one person/i);
      assert.doesNotMatch(msg, JARGON);
    });

    test('5.3 Ticking off a finished, cancelled or stuck task explains what to do', () => {
      const done = WorkflowEngine.validateTaskCompletion({ id: 't', status: 'Completed' });
      assert.match(done.message, /already done/);
      const cancelled = WorkflowEngine.validateTaskCompletion({ id: 't', status: 'Cancelled' });
      assert.match(cancelled.message, /cancelled/);
      const stuck = WorkflowEngine.validateTaskCompletion({ id: 't', status: 'Pending', isBlocked: true, blocker: 'Waiting for bank' });
      assert.match(stuck.message, /stuck/);
      for (const r of [done, cancelled, stuck]) {
        assert.doesNotMatch(r.message, JARGON);
        assert.doesNotMatch(r.message, /'t'/, 'task ids are not shown to people');
      }
    });

    test('5.4 Business messages call it a business, not a "business area"', async () => {
      const dup = await call('POST', '/businesses', { name: 'TriNova Accounting', type: 'x' });
      assert.equal(dup.status, 409);
      const msg = await message(dup);
      assert.match(msg, /already exists/);
      assert.doesNotMatch(msg, /business area/i);
    });
  });

  describe('6. Companies House', () => {
    test('6.1 An unknown or badly typed number is explained', async () => {
      await assert.rejects(
        () => companiesHouseService.fetchCompanyProfile(''),
        err => {
          assert.doesNotMatch(err.message, JARGON);
          return true;
        }
      );
    });
  });
});
