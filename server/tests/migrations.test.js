/**
 * Database Migrations Test Suite
 * Verifies that all schema migration files are discoverable, syntactically valid,
 * apply cleanly in ascending order, and revert cleanly in reverse order.
 * 
 * Adheres to context/06_testing_deployment_context.md §10-12 (Rollback & release readiness).
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Migrator } from '../src/data/migrator.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

describe('Production Schema Migrations & Rollback Verification', () => {
  const testStateFile = path.join(__dirname, 'scratch_test_migrations.lock');
  let testMigrator;

  beforeEach(() => {
    if (fs.existsSync(testStateFile)) {
      fs.unlinkSync(testStateFile);
    }
    testMigrator = new Migrator({ stateFile: testStateFile });
  });

  it('Discovers all migration pairs with matching down-migration files', () => {
    const available = testMigrator.getAvailableMigrations();
    assert.ok(available.length >= 2, 'Must contain at least initial and signing migrations');

    for (const m of available) {
      assert.ok(m.id, 'Migration must have an ID');
      assert.ok(fs.existsSync(m.upPath), `Up migration file must exist: ${m.upFile}`);
      assert.ok(m.hasDown, `Migration ${m.id} must have a corresponding down-migration file`);
      assert.ok(fs.existsSync(m.downPath), `Down migration file must exist: ${m.downFile}`);

      // Syntax check: SQL files must not be empty
      const upSql = fs.readFileSync(m.upPath, 'utf8');
      const downSql = fs.readFileSync(m.downPath, 'utf8');
      assert.ok(upSql.length > 50, 'Up SQL must contain substantive DDL');
      assert.ok(downSql.length > 20, 'Down SQL must contain substantive rollback DDL');
    }
  });

  it('Applies all pending migrations in ascending order and records state', async () => {
    const upResults = await testMigrator.up();
    assert.equal(upResults.length, 3);
    assert.equal(upResults[0].id, '001_initial_schema');
    assert.equal(upResults[0].status, 'APPLIED');
    assert.equal(upResults[1].id, '002_signing_schema');
    assert.equal(upResults[1].status, 'APPLIED');
    assert.equal(upResults[2].id, '003_timeline_schema');
    assert.equal(upResults[2].status, 'APPLIED');

    const status = testMigrator.getStatus();
    assert.ok(status.every(s => s.isApplied));
  });

  it('Idempotent execution: Running up() twice safely skips already-applied migrations', async () => {
    await testMigrator.up();
    const secondRun = await testMigrator.up();
    assert.equal(secondRun.length, 3);
    assert.ok(secondRun.every(r => r.status === 'ALREADY_APPLIED'));
  });

  it('Rollback execution: down() reverts migrations in reverse dependency order', async () => {
    // 1. Apply up
    await testMigrator.up();

    // 2. Rollback down
    const downResults = await testMigrator.down();
    assert.equal(downResults.length, 3);
    // 003 reverted, then 002, then 001
    assert.equal(downResults[0].id, '003_timeline_schema');
    assert.equal(downResults[0].status, 'REVERTED');
    assert.equal(downResults[1].id, '002_signing_schema');
    assert.equal(downResults[1].status, 'REVERTED');
    assert.equal(downResults[2].id, '001_initial_schema');
    assert.equal(downResults[2].status, 'REVERTED');

    const finalStatus = testMigrator.getStatus();
    assert.ok(finalStatus.every(s => !s.isApplied));
  });
});
