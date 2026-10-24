/**
 * Saves Sloane's data to a real database so nothing is lost when the server restarts.
 *
 * How it works
 * - The routes keep working on the in-memory lists in ./db.js (mockDb).
 * - After every request that changes something (POST / PATCH / PUT / DELETE) the server calls
 *   `persistence.scheduleFlush()`. A flush compares each list with what was last saved and
 *   writes only the rows that were added, changed, moved or removed.
 * - On start-up `persistence.start()` loads the saved rows back into the lists.
 *
 * Where it saves
 * - DATABASE_URL set to a postgres:// address  -> PostgreSQL
 * - otherwise a SQLite file (SLOANE_DB_PATH, or SLOANE_DATA_DIR/sloane.db)
 * - in the automated tests it is off unless a test turns it on.
 * If SQLite is not available on this Node version and no DATABASE_URL is set, Sloane keeps
 * running but reports `memory` (data is lost on restart) so that the owner can be warned.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { mockDb, COLLECTIONS } from './db.js';
import { databaseFilePath, dataDir } from './paths.js';
import { auditStore } from '../middleware/audit.js';
import { sessionStore } from '../services/sessionStore.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const STORE_MIGRATIONS_DIR = path.join(__dirname, 'migrations', 'store');

/* ------------------------------------------------------------------------------------------
 * Drivers. Both expose the same small async interface.
 * ---------------------------------------------------------------------------------------- */

export class SqliteDriver {
  constructor(file) {
    this.kind = 'sqlite';
    this.file = file;
    this.db = null;
  }

  async init() {
    const { DatabaseSync } = await import('node:sqlite');
    if (this.file !== ':memory:') {
      fs.mkdirSync(path.dirname(this.file), { recursive: true, mode: 0o700 });
    }
    this.db = new DatabaseSync(this.file);
    this.db.exec('PRAGMA journal_mode = WAL;');
    this.db.exec('PRAGMA synchronous = NORMAL;');
  }

  async exec(sql) {
    this.db.exec(sql);
  }

  async all(sql, params = []) {
    return this.db.prepare(sql).all(...params);
  }

  async transaction(work) {
    this.db.exec('BEGIN');
    try {
      const run = async (sql, params = []) => { this.db.prepare(sql).run(...params); };
      await work(run);
      this.db.exec('COMMIT');
    } catch (err) {
      try { this.db.exec('ROLLBACK'); } catch (_) { /* nothing to roll back */ }
      throw err;
    }
  }

  async close() {
    if (this.db) this.db.close();
    this.db = null;
  }
}

export class PostgresDriver {
  constructor(connectionString, options = {}) {
    this.kind = 'postgres';
    this.connectionString = connectionString;
    this.options = options;
    this.pool = null;
  }

  async init() {
    const pg = await import('pg');
    const Pool = pg.default?.Pool || pg.Pool;
    const ssl = process.env.DATABASE_SSL === 'true' ? { rejectUnauthorized: false } : undefined;
    this.pool = this.options.pool || new Pool({ connectionString: this.connectionString, ssl, max: 4 });
  }

  // `?` placeholders are used in the shared SQL; Postgres wants $1, $2, ...
  static convert(sql) {
    let n = 0;
    return sql.replace(/\?/g, () => `$${++n}`);
  }

  async exec(sql) {
    await this.pool.query(sql);
  }

  async all(sql, params = []) {
    const res = await this.pool.query(PostgresDriver.convert(sql), params);
    return res.rows;
  }

  async transaction(work) {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const run = async (sql, params = []) => { await client.query(PostgresDriver.convert(sql), params); };
      await work(run);
      await client.query('COMMIT');
    } catch (err) {
      try { await client.query('ROLLBACK'); } catch (_) { /* ignore */ }
      throw err;
    } finally {
      client.release();
    }
  }

  async close() {
    if (this.pool) await this.pool.end();
    this.pool = null;
  }
}

/** Chooses the driver from the environment. Returns null when saving to a database is not possible. */
export async function createDriverFromEnv() {
  const url = (process.env.DATABASE_URL || '').trim();
  if (/^postgres(ql)?:\/\//i.test(url)) {
    return new PostgresDriver(url);
  }
  try {
    await import('node:sqlite');
  } catch (_) {
    return null;
  }
  return new SqliteDriver(databaseFilePath());
}

/* ------------------------------------------------------------------------------------------
 * The persistence manager
 * ---------------------------------------------------------------------------------------- */

export class Persistence {
  /**
   * @param {object} [options]
   * @param {object} [options.driver] A SqliteDriver / PostgresDriver (or a test double)
   * @param {object} [options.data]   The data object whose lists are saved (defaults to mockDb)
   */
  constructor(options = {}) {
    this.driver = options.driver || null;
    this.data = options.data || mockDb;
    this.saved = new Map();      // collection -> Map(id -> { json, position })
    this.chain = Promise.resolve();
    this.timer = null;
    this.ready = false;
    this.lastSavedAt = null;
    this.lastError = null;
    this.mode = 'memory';
  }

  /** Every saved list: the data collections plus the audit log. */
  collections() {
    const list = {};
    for (const [name, def] of Object.entries(COLLECTIONS)) {
      list[name] = {
        id: def.id,
        get: () => this.data[name],
        set: rows => { this.data[name].length = 0; this.data[name].push(...rows); }
      };
    }
    list.auditLog = {
      id: r => r.id,
      get: () => auditStore.logs,
      set: rows => { auditStore.logs = rows; },
      // Newest first, and stable when a new entry is added at the front.
      position: r => -(Date.parse(r.timestamp) || 0)
    };
    // Sign-in sessions: saved (as hashes) so a deploy or restart does not sign the owner out.
    list.sessions = {
      id: r => r.id,
      get: () => sessionStore.exportSessions(),
      set: rows => sessionStore.importSessions(rows),
      position: r => -(r.expiresAtMs || 0)
    };
    return list;
  }

  /**
   * Will the saved data still be there after the next update? A Postgres database always is.
   * A SQLite file is only safe on a mounted volume; on a hosted server's own disk (production,
   * with no volume or file path chosen) it is wiped by each deploy.
   */
  isDurable() {
    if (!this.ready) return false;
    if (this.driver.kind === 'postgres') return true;
    if (process.env.NODE_ENV !== 'production') return true;
    return Boolean(dataDir() || process.env.SLOANE_DB_PATH);
  }

  status() {
    return {
      kind: this.ready ? this.driver.kind : 'memory',
      persistent: this.ready,
      durable: this.isDurable(),
      lastSavedAt: this.lastSavedAt,
      lastError: this.lastError
    };
  }

  async migrate() {
    let appliedRows;
    try {
      appliedRows = await this.driver.all('SELECT id FROM sloane_schema_migrations');
    } catch (_) {
      // First run on this database: the bookkeeping table does not exist yet.
      await this.driver.exec(
        'CREATE TABLE sloane_schema_migrations (id VARCHAR(120) PRIMARY KEY, applied_at VARCHAR(40) NOT NULL)'
      );
      appliedRows = [];
    }
    const applied = new Set(appliedRows.map(r => r.id));
    const files = fs.readdirSync(STORE_MIGRATIONS_DIR)
      .filter(f => f.endsWith('.sql') && !f.endsWith('_down.sql'))
      .sort();
    const results = [];
    for (const file of files) {
      const id = file.replace(/\.sql$/, '');
      if (applied.has(id)) continue;
      const sql = fs.readFileSync(path.join(STORE_MIGRATIONS_DIR, file), 'utf8');
      await this.driver.exec(sql);
      await this.driver.transaction(run => run(
        'INSERT INTO sloane_schema_migrations (id, applied_at) VALUES (?, ?)',
        [id, new Date().toISOString()]
      ));
      results.push(id);
    }
    return results;
  }

  /**
   * Opens the database, creates the tables, and loads whatever was saved.
   * On the very first run the current (starting) data is saved instead.
   */
  async start() {
    if (!this.driver) {
      this.driver = await createDriverFromEnv();
    }
    if (!this.driver) {
      this.ready = false;
      this.mode = 'memory';
      return this.status();
    }
    await this.driver.init();
    await this.migrate();

    const rows = await this.driver.all(
      'SELECT collection, record_id, position, data FROM sloane_records ORDER BY collection, position'
    );
    const flag = (await this.driver.all("SELECT value FROM sloane_meta WHERE key = 'initialised'"))[0];
    const collections = this.collections();

    if (flag || rows.length > 0) {
      const grouped = new Map();
      for (const row of rows) {
        if (!grouped.has(row.collection)) grouped.set(row.collection, []);
        let record;
        try { record = JSON.parse(row.data); } catch (_) { continue; }
        grouped.get(row.collection).push({ id: row.record_id, position: Number(row.position), record, json: row.data });
      }
      for (const [name, def] of Object.entries(collections)) {
        const items = grouped.get(name) || [];
        def.set(items.map(i => i.record));
        this.saved.set(name, new Map(items.map(i => [i.id, { json: i.json, position: i.position }])));
      }
      this.ready = true;
    } else {
      // First run: keep the starting data and save it.
      this.ready = true;
      await this._flushOnce(true);
      await this.driver.transaction(run => run(
        "INSERT INTO sloane_meta (key, value) VALUES ('initialised', ?)",
        [new Date().toISOString()]
      ));
    }
    this.mode = this.driver.kind;
    return this.status();
  }

  /** Save soon (batches a burst of changes into one write). Safe to call at any time. */
  scheduleFlush() {
    if (!this.ready) return;
    if (this.timer) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      this.flush().catch(() => { /* recorded in lastError */ });
    }, 25);
    if (this.timer.unref) this.timer.unref();
  }

  /** Save now. Resolves when everything pending has been written. */
  flush() {
    if (!this.ready) return Promise.resolve(this.status());
    if (this.timer) { clearTimeout(this.timer); this.timer = null; }
    this.chain = this.chain.then(() => this._flushOnce()).catch(err => {
      this.lastError = err.message;
      console.error('[PERSISTENCE] Save failed:', err.message);
    });
    return this.chain.then(() => this.status());
  }

  async _flushOnce(initial = false) {
    const upserts = [];
    const deletes = [];
    const nextSaved = new Map();

    for (const [name, def] of Object.entries(this.collections())) {
      const previous = this.saved.get(name) || new Map();
      const current = new Map();
      const rows = def.get() || [];
      rows.forEach((record, position) => {
        const id = String(def.id(record) ?? '').trim();
        if (!id) return;
        current.set(id, { json: JSON.stringify(record), position: def.position ? def.position(record, position) : position });
      });
      for (const [id, now] of current) {
        const before = previous.get(id);
        if (!before || before.json !== now.json || before.position !== now.position) {
          upserts.push({ collection: name, id, position: now.position, json: now.json });
        }
      }
      for (const id of previous.keys()) {
        if (!current.has(id)) deletes.push({ collection: name, id });
      }
      nextSaved.set(name, current);
    }

    if (upserts.length === 0 && deletes.length === 0) return;

    const stamp = new Date().toISOString();
    await this.driver.transaction(async run => {
      for (const d of deletes) {
        await run('DELETE FROM sloane_records WHERE collection = ? AND record_id = ?', [d.collection, d.id]);
      }
      for (const u of upserts) {
        await run(
          'INSERT INTO sloane_records (collection, record_id, position, data, updated_at) VALUES (?, ?, ?, ?, ?) ' +
          'ON CONFLICT (collection, record_id) DO UPDATE SET position = excluded.position, data = excluded.data, updated_at = excluded.updated_at',
          [u.collection, u.id, u.position, u.json, stamp]
        );
      }
    });

    this.saved = nextSaved;
    this.lastSavedAt = stamp;
    this.lastError = null;
  }

  async stop() {
    if (this.ready) await this.flush();
    this.ready = false;
    if (this.driver) await this.driver.close();
  }
}

/** The one instance the running server uses. */
export const persistence = new Persistence();
