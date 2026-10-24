/**
 * Unit 33 Test Suite: Saving data to a real database
 *
 * Verifies:
 * - Data created through the API is still there after a restart (SQLite file)
 * - Changes, deletions and ordering are saved, and an emptied list stays empty
 * - The audit log is saved
 * - The database tables are created by a migration that can safely run twice
 * - The PostgreSQL driver saves and restores the same way (tested against pg-mem)
 * - Example data is only loaded in tests / explicit demo mode, never in a real install
 */

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';

import { createApp } from '../src/app.js';
import { mockDb, resetData, buildInitialData, DEFAULT_BUSINESSES } from '../src/data/db.js';
import { auditStore } from '../src/middleware/audit.js';
import { sessionStore } from '../src/services/sessionStore.js';
import { loginCookie } from './support.js';
import { Persistence, SqliteDriver, PostgresDriver } from '../src/data/persistence.js';
import { databaseFilePath, documentsDirPath, outlookVaultFilePath } from '../src/data/paths.js';
import { persistence } from '../src/data/persistence.js';
import { TEST_API_KEY } from './fixtures.js';

const require = createRequire(import.meta.url);
const PORT = 5033;
const auth = { Authorization: `Bearer ${TEST_API_KEY}`, 'Content-Type': 'application/json' };

function tempDbFile() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sloane-persist-'));
  return { dir, file: path.join(dir, 'sloane.db') };
}

describe('Unit 33: Persistence', () => {
  let server;
  let baseUrl;
  let tmp;

  before(async () => {
    tmp = tempDbFile();
    resetData(true);
    persistence.driver = new SqliteDriver(tmp.file);
    await persistence.start();

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
    await persistence.stop();
    persistence.driver = null;
    fs.rmSync(tmp.dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  });

  // Simulates a server restart: save, close the database, wipe the in-memory lists,
  // then open the same file again and load whatever was saved.
  async function reload() {
    await persistence.stop();
    resetData(false);
    mockDb.businesses.length = 0;
    auditStore.logs = [];
    sessionStore.sessions.clear();
    persistence.driver = new SqliteDriver(tmp.file);
    persistence.saved = new Map();
    await persistence.start();
  }

  describe('1. Data survives a restart', () => {
    test('1.1 A business added through the API is still there after a restart', async () => {
      const res = await fetch(`${baseUrl}/api/v1/businesses`, {
        method: 'POST', headers: auth, body: JSON.stringify({ name: 'Persist Test Co', type: 'Testing' })
      });
      assert.equal(res.status, 201);
      const created = (await res.json()).data;

      await reload();
      const found = mockDb.businesses.find(b => b.id === created.id);
      assert.ok(found, 'business must be restored from the database');
      assert.equal(found.name, 'Persist Test Co');
    });

    test('1.2 A client added in Sloane (with its company) and a task survive a restart', async () => {
      const cRes = await fetch(`${baseUrl}/api/v1/clients`, {
        method: 'POST', headers: auth, body: JSON.stringify({ name: 'Persisted Client Ltd', biz: 'Trinova Accounting', no: '99999999' })
      });
      assert.equal(cRes.status, 201);
      const client = (await cRes.json()).data;
      const companyId = client.companyIds[0];

      const tRes = await fetch(`${baseUrl}/api/v1/tasks`, {
        method: 'POST',
        headers: { ...auth, 'Idempotency-Key': randomUUID() },
        body: JSON.stringify({ companyId, title: 'Persisted task', dueDate: '2026-12-01' })
      });
      assert.equal(tRes.status, 201);
      const task = (await tRes.json()).data;

      await reload();
      assert.ok(mockDb.clients.find(c => c.id === client.id), 'client restored');
      assert.ok(mockDb.companies.find(c => c.id === companyId), 'company restored');
      const restoredTask = mockDb.tasks.find(t => t.id === task.id);
      assert.ok(restoredTask, 'task restored');
      assert.equal(restoredTask.title, 'Persisted task');
      assert.equal(restoredTask.dueDate, '2026-12-01');
    });

    test('1.3 Edits are saved (PATCH) and deletions are saved (DELETE)', async () => {
      const created = (await (await fetch(`${baseUrl}/api/v1/businesses`, {
        method: 'POST', headers: auth, body: JSON.stringify({ name: 'To Edit', type: 'Before' })
      })).json()).data;
      await fetch(`${baseUrl}/api/v1/businesses/${created.id}`, {
        method: 'PATCH', headers: auth, body: JSON.stringify({ type: 'After' })
      });
      const doomed = (await (await fetch(`${baseUrl}/api/v1/businesses`, {
        method: 'POST', headers: auth, body: JSON.stringify({ name: 'To Delete', type: 'Gone' })
      })).json()).data;
      const del = await fetch(`${baseUrl}/api/v1/businesses/${doomed.id}`, { method: 'DELETE', headers: auth });
      assert.equal(del.status, 200);

      await reload();
      assert.equal(mockDb.businesses.find(b => b.id === created.id).type, 'After');
      assert.equal(mockDb.businesses.find(b => b.id === doomed.id), undefined);
    });

    test('1.4 The order of a list is kept (newest client first)', async () => {
      for (const n of ['Order A', 'Order B']) {
        await fetch(`${baseUrl}/api/v1/clients`, { method: 'POST', headers: auth, body: JSON.stringify({ name: n }) });
      }
      const before = mockDb.clients.map(c => c.id);
      await reload();
      assert.deepEqual(mockDb.clients.map(c => c.id), before);
      assert.equal(mockDb.clients[0].name, 'Order B');
    });

    test('1.5 The audit log is saved too', async () => {
      await fetch(`${baseUrl}/api/v1/businesses`, {
        method: 'POST', headers: auth, body: JSON.stringify({ name: 'Audit Persist', type: 'x' })
      });
      await persistence.flush();
      await reload();
      assert.ok(auditStore.logs.some(l => l.action === 'create_business_area'), 'audit entry restored');
    });

    test('1.6 A list that the owner emptied stays empty after a restart (not re-filled with defaults)', async () => {
      for (const b of [...mockDb.businesses]) {
        const res = await fetch(`${baseUrl}/api/v1/businesses/${b.id}`, { method: 'DELETE', headers: auth });
        // businesses that still have clients refuse with 409; remove those clients first
        if (res.status === 409) {
          for (const c of mockDb.clients.filter(c => c.businessArea === b.name || c.clientType === b.name)) {
            if (c.addedInSloane) await fetch(`${baseUrl}/api/v1/clients/${c.id}`, { method: 'DELETE', headers: auth });
          }
          mockDb.clients.splice(0, mockDb.clients.length, ...mockDb.clients.filter(c => c.businessArea !== b.name && c.clientType !== b.name));
          await fetch(`${baseUrl}/api/v1/businesses/${b.id}`, { method: 'DELETE', headers: auth });
        }
      }
      assert.equal(mockDb.businesses.length, 0);
      await reload();
      assert.equal(mockDb.businesses.length, 0, 'must not be re-seeded');
    });
  });

  describe('1b. Staying signed in across a restart', () => {
    test('1b.1 A signed-in browser is still signed in after the server restarts', async () => {
      const cookie = await loginCookie(baseUrl);
      const before = await fetch(`${baseUrl}/api/v1/auth/session`, { headers: { Cookie: cookie } });
      assert.equal(before.status, 200);

      await reload();   // wipes memory (including sessions), then loads what was saved
      const after = await fetch(`${baseUrl}/api/v1/auth/session`, { headers: { Cookie: cookie } });
      assert.equal(after.status, 200, 'the same cookie must still work after a restart');
      assert.equal((await after.json()).status, 'authenticated');
    });

    test('1b.2 The saved data holds a hash, never the cookie value itself', async () => {
      const cookie = await loginCookie(baseUrl);
      const raw = decodeURIComponent(cookie.split('=')[1]);
      await persistence.flush();
      const rows = await persistence.driver.all("SELECT record_id, data FROM sloane_records WHERE collection = 'sessions'");
      assert.ok(rows.length >= 1);
      for (const r of rows) {
        assert.ok(!r.record_id.includes(raw) && !r.data.includes(raw), 'the cookie value must not be stored');
        assert.match(r.record_id, /^[0-9a-f]{64}$/);
      }
    });

    test('1b.3 Signing out is saved too: after a restart that cookie no longer works', async () => {
      const cookie = await loginCookie(baseUrl);
      const out = await fetch(`${baseUrl}/api/v1/auth/logout`, { method: 'POST', headers: { Cookie: cookie } });
      assert.equal(out.status, 200);
      await reload();
      const res = await fetch(`${baseUrl}/api/v1/auth/session`, { headers: { Cookie: cookie } });
      assert.equal(res.status, 401);
    });

    test('1b.4 A session that has run out is not brought back', async () => {
      const cookie = await loginCookie(baseUrl);
      const raw = decodeURIComponent(cookie.split('=')[1]);
      sessionStore.sessions.get(sessionStore.hashId(raw)).expiresAtMs = Date.now() - 1000;
      await persistence.flush();
      await reload();
      const res = await fetch(`${baseUrl}/api/v1/auth/session`, { headers: { Cookie: cookie } });
      assert.equal(res.status, 401);
    });
  });

  describe('2. Database setup', () => {
    test('2.1 Tables are created by a migration and running start twice does not repeat it', async () => {
      const { file } = tempDbFile();
      const p1 = new Persistence({ driver: new SqliteDriver(file) });
      resetData(false);
      await p1.start();
      await p1.stop();
      const p2 = new Persistence({ driver: new SqliteDriver(file) });
      await p2.start();
      const rows = await p2.driver.all('SELECT id FROM sloane_schema_migrations');
      assert.equal(rows.length, 1);
      assert.equal(rows[0].id, '001_sloane_records');
      await p2.stop();
    });

    test('2.2 The status call reports where data is saved', async () => {
      const res = await fetch(`${baseUrl}/api/v1/health`);
      const body = await res.json();
      assert.equal(body.storage, 'sqlite');
    });

    test('2.3 /system/status tells the owner in plain facts whether data is saved permanently', async () => {
      const res = await fetch(`${baseUrl}/api/v1/system/status`, { headers: auth });
      assert.equal(res.status, 200);
      const body = (await res.json()).data;
      assert.equal(body.storage.persistent, true);
      assert.equal(body.storage.kind, 'sqlite');
      assert.equal(typeof body.trinova.configured, 'boolean');
    });

    test('2.4 /system/status needs a sign-in', async () => {
      const res = await fetch(`${baseUrl}/api/v1/system/status`);
      assert.equal(res.status, 401);
    });
  });

  describe('3. Where files live (Railway volume support)', () => {
    test('3.1 SLOANE_DATA_DIR moves the database, documents and Outlook vault together', () => {
      const saved = { ...process.env };
      try {
        delete process.env.SLOANE_DB_PATH;
        delete process.env.STORAGE_ROOT_PATH;
        delete process.env.OUTLOOK_VAULT_PATH;
        delete process.env.RAILWAY_VOLUME_MOUNT_PATH;
        process.env.SLOANE_DATA_DIR = path.join(os.tmpdir(), 'vol');
        assert.equal(databaseFilePath(), path.join(os.tmpdir(), 'vol', 'sloane.db'));
        assert.equal(documentsDirPath(), path.join(os.tmpdir(), 'vol', 'documents'));
        assert.equal(outlookVaultFilePath(), path.join(os.tmpdir(), 'vol', 'outlook-vault.json'));
      } finally {
        for (const k of ['SLOANE_DATA_DIR', 'SLOANE_DB_PATH', 'STORAGE_ROOT_PATH', 'OUTLOOK_VAULT_PATH', 'RAILWAY_VOLUME_MOUNT_PATH']) {
          if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k];
        }
      }
    });

    test('3.2 Railway\'s own volume variable is used when SLOANE_DATA_DIR is not set', () => {
      const saved = { d: process.env.SLOANE_DATA_DIR, r: process.env.RAILWAY_VOLUME_MOUNT_PATH, p: process.env.SLOANE_DB_PATH };
      try {
        delete process.env.SLOANE_DATA_DIR;
        delete process.env.SLOANE_DB_PATH;
        process.env.RAILWAY_VOLUME_MOUNT_PATH = path.join(os.tmpdir(), 'rw');
        assert.equal(databaseFilePath(), path.join(os.tmpdir(), 'rw', 'sloane.db'));
      } finally {
        if (saved.d === undefined) delete process.env.SLOANE_DATA_DIR; else process.env.SLOANE_DATA_DIR = saved.d;
        if (saved.r === undefined) delete process.env.RAILWAY_VOLUME_MOUNT_PATH; else process.env.RAILWAY_VOLUME_MOUNT_PATH = saved.r;
        if (saved.p === undefined) delete process.env.SLOANE_DB_PATH; else process.env.SLOANE_DB_PATH = saved.p;
      }
    });
  });

  describe('3b. Temporary disks are called out', () => {
    test('3b.1 SQLite on a hosted server with no volume is reported as not durable; with a volume or in development it is', () => {
      const saved = { env: process.env.NODE_ENV, dir: process.env.SLOANE_DATA_DIR, rv: process.env.RAILWAY_VOLUME_MOUNT_PATH, db: process.env.SLOANE_DB_PATH };
      try {
        delete process.env.SLOANE_DATA_DIR; delete process.env.RAILWAY_VOLUME_MOUNT_PATH; delete process.env.SLOANE_DB_PATH;
        const p = new Persistence({ driver: new SqliteDriver(':memory:') });
        p.ready = true;
        process.env.NODE_ENV = 'production';
        assert.equal(p.isDurable(), false, 'production + no volume');
        process.env.SLOANE_DATA_DIR = path.join(os.tmpdir(), 'vol');
        assert.equal(p.isDurable(), true, 'production + volume');
        delete process.env.SLOANE_DATA_DIR;
        process.env.NODE_ENV = 'development';
        assert.equal(p.isDurable(), true, 'development');
        p.driver = new PostgresDriver('postgres://x');
        process.env.NODE_ENV = 'production';
        assert.equal(p.isDurable(), true, 'Postgres is always durable');
        p.ready = false;
        assert.equal(p.isDurable(), false, 'not running');
      } finally {
        for (const [k, v] of Object.entries({ NODE_ENV: saved.env, SLOANE_DATA_DIR: saved.dir, RAILWAY_VOLUME_MOUNT_PATH: saved.rv, SLOANE_DB_PATH: saved.db })) {
          if (v === undefined) delete process.env[k]; else process.env[k] = v;
        }
      }
    });

    test('3b.2 The status call says whether the saved data will survive an update', async () => {
      const res = await fetch(`${baseUrl}/api/v1/system/status`, { headers: auth });
      const body = (await res.json()).data;
      assert.equal(typeof body.storage.durable, 'boolean');
    });
  });

  describe('4. PostgreSQL driver (against pg-mem)', () => {
    test('4.1 Placeholders are converted from ? to $1, $2 ...', () => {
      assert.equal(PostgresDriver.convert('a = ? AND b = ?'), 'a = $1 AND b = $2');
    });

    test('4.2 Save, change, delete and restore through the Postgres driver', async () => {
      const { newDb } = require('pg-mem');
      const memDb = newDb();
      const { Pool } = memDb.adapters.createPg();
      const pool = new Pool();

      const data = buildInitialData(false);
      const p1 = new Persistence({ driver: new PostgresDriver('postgres://unused', { pool }), data });
      await p1.start();
      assert.equal(p1.status().kind, 'postgres');

      data.businesses.push({ id: 'biz-pg', name: 'Postgres Co', type: 'DB', status: 'Active' });
      data.businesses.find(b => b.id === 'biz-1').type = 'Changed in PG';
      data.businesses.splice(data.businesses.findIndex(b => b.id === 'biz-2'), 1);
      await p1.flush();

      const data2 = buildInitialData(false);
      data2.businesses.length = 0;
      const p2 = new Persistence({ driver: new PostgresDriver('postgres://unused', { pool }), data: data2 });
      await p2.start();
      assert.ok(data2.businesses.find(b => b.id === 'biz-pg'));
      assert.equal(data2.businesses.find(b => b.id === 'biz-1').type, 'Changed in PG');
      assert.equal(data2.businesses.find(b => b.id === 'biz-2'), undefined);
    });
  });

  describe('5. Example data is for tests and demos only', () => {
    test('5.1 A real install starts with the default businesses and nothing else', () => {
      const real = buildInitialData(false);
      assert.deepEqual(real.businesses.map(b => b.name), DEFAULT_BUSINESSES.map(b => b.name));
      for (const name of ['clients', 'companies', 'tasks', 'statutoryTracker', 'notes', 'documents', 'timeline_events', 'teamMembers', 'ceoNotes']) {
        assert.equal(real[name].length, 0, `${name} must start empty`);
      }
    });

    test('5.2 Demo mode includes the example clients, tasks and deadlines', () => {
      const demo = buildInitialData(true);
      assert.ok(demo.clients.length > 0);
      assert.ok(demo.tasks.length > 0);
      assert.ok(demo.statutoryTracker.length > 0);
      assert.ok(demo.statutoryTracker.every(r => r.id), 'example deadlines get ids so they can be edited');
      assert.ok(demo.teamMembers.length > 0);
    });
  });
});
