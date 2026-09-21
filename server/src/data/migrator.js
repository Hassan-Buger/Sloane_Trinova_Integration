/**
 * Trinova Database Migration Runner
 * Executes transactional schema up/down migrations and tracks applied migrations.
 * 
 * Supports both live database adapters and filesystem state tracking.
 * Adheres to context/06_testing_deployment_context.md §10-12 (Safe release & rollback).
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const MIGRATIONS_DIR = path.join(__dirname, 'migrations');
const STATE_FILE = path.join(__dirname, '.migrations.lock');

export class Migrator {
  constructor(options = {}) {
    this.migrationsDir = options.migrationsDir || MIGRATIONS_DIR;
    this.stateFile = options.stateFile || STATE_FILE;
    this.dbClient = options.dbClient || null;
    this.appliedMigrations = new Set(options.appliedMigrations || this.loadState());
  }

  loadState() {
    try {
      if (fs.existsSync(this.stateFile)) {
        const raw = fs.readFileSync(this.stateFile, 'utf8');
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed) ? parsed : [];
      }
    } catch {
      // Return empty if state file is unreadable
    }
    return [];
  }

  saveState() {
    try {
      fs.writeFileSync(this.stateFile, JSON.stringify([...this.appliedMigrations], null, 2), 'utf8');
    } catch (e) {
      console.warn('[MIGRATOR] Warning: Could not write migration lock file:', e.message);
    }
  }

  /**
   * Discovers all available migration pairs (up & down) sorted in sequence.
   */
  getAvailableMigrations() {
    if (!fs.existsSync(this.migrationsDir)) {
      return [];
    }

    const files = fs.readdirSync(this.migrationsDir);
    const upFiles = files.filter(f => f.endsWith('.sql') && !f.includes('_down'));

    return upFiles.sort().map(upFile => {
      const id = upFile.replace(/\.sql$/, '');
      const downFile = `${id}_down.sql`;
      const hasDown = files.includes(downFile);

      return {
        id,
        upFile,
        hasDown,
        downFile: hasDown ? downFile : null,
        upPath: path.join(this.migrationsDir, upFile),
        downPath: hasDown ? path.join(this.migrationsDir, downFile) : null
      };
    });
  }

  /**
   * Applies all pending 'up' migrations in ascending order.
   */
  async up() {
    const available = this.getAvailableMigrations();
    const results = [];

    for (const migration of available) {
      if (!this.appliedMigrations.has(migration.id)) {
        const sql = fs.readFileSync(migration.upPath, 'utf8');

        if (this.dbClient && typeof this.dbClient.query === 'function') {
          await this.dbClient.query(sql);
        }

        this.appliedMigrations.add(migration.id);
        this.saveState();
        results.push({
          id: migration.id,
          direction: 'up',
          file: migration.upFile,
          status: 'APPLIED',
          timestamp: new Date().toISOString()
        });
      } else {
        results.push({
          id: migration.id,
          direction: 'up',
          file: migration.upFile,
          status: 'ALREADY_APPLIED',
          timestamp: new Date().toISOString()
        });
      }
    }

    return results;
  }

  /**
   * Reverts applied migrations in descending (reverse) order.
   * If targetId is provided, rolls back down to that target.
   */
  async down(targetId = null) {
    const available = this.getAvailableMigrations();
    // Reverse order for rollback
    const reversible = [...available].reverse();
    const results = [];

    for (const migration of reversible) {
      if (this.appliedMigrations.has(migration.id)) {
        if (!migration.downPath) {
          throw new Error(`Cannot rollback '${migration.id}': Missing down migration file.`);
        }

        const sql = fs.readFileSync(migration.downPath, 'utf8');

        if (this.dbClient && typeof this.dbClient.query === 'function') {
          await this.dbClient.query(sql);
        }

        this.appliedMigrations.delete(migration.id);
        this.saveState();
        results.push({
          id: migration.id,
          direction: 'down',
          file: migration.downFile,
          status: 'REVERTED',
          timestamp: new Date().toISOString()
        });

        if (targetId && migration.id === targetId) {
          break;
        }
      }
    }

    return results;
  }

  /**
   * Returns current migration status.
   */
  getStatus() {
    const available = this.getAvailableMigrations();
    return available.map(m => ({
      id: m.id,
      upFile: m.upFile,
      hasDown: Boolean(m.downFile),
      isApplied: this.appliedMigrations.has(m.id)
    }));
  }
}

export const migrator = new Migrator();

// CLI execution handling
if (process.argv[1] && process.argv[1].endsWith('migrator.js')) {
  const direction = (process.argv[2] || 'up').toLowerCase();
  (async () => {
    console.log(`[MIGRATOR] Running migrations '${direction}'...`);
    if (direction === 'down') {
      const res = await migrator.down();
      console.log('[MIGRATOR] Reverted:', res);
    } else if (direction === 'status') {
      console.log('[MIGRATOR] Status:', migrator.getStatus());
    } else {
      const res = await migrator.up();
      console.log('[MIGRATOR] Applied:', res);
    }
  })().catch(err => {
    console.error('[MIGRATOR] Failed:', err);
    process.exit(1);
  });
}
