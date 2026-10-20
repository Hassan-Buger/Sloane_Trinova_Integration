/**
 * Automated Unit Test Suite for Unit 12 / Task P2.2:
 * Outlook Connection Record Schema & Repository Functions
 */

import { test, describe, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  outlookConnectionStore,
  validateConnectionSchema,
  getConnection,
  saveConnection,
  deleteConnection,
  getSanitizedStatus,
  VALID_STATUSES
} from '../src/services/outlookConnectionStore.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const TEST_DIR = path.resolve(__dirname, '../data-private/test-connection-store');
const TEST_VAULT_FILE = path.join(TEST_DIR, 'test-connection-vault.json');
const TEST_KEY_HEX = crypto.randomBytes(32).toString('hex');

describe('Task P2.2: Outlook Connection Record Schema & Store', () => {
  before(() => {
    if (!fs.existsSync(TEST_DIR)) {
      fs.mkdirSync(TEST_DIR, { recursive: true, mode: 0o700 });
    }
  });

  after(() => {
    try {
      if (fs.existsSync(TEST_VAULT_FILE)) fs.unlinkSync(TEST_VAULT_FILE);
      if (fs.existsSync(TEST_DIR)) fs.rmdirSync(TEST_DIR);
    } catch (_) {}
  });

  beforeEach(() => {
    deleteConnection({ filePath: TEST_VAULT_FILE });
  });

  // 1. Schema Validation Tests
  describe('Connection Schema Validation', () => {
    test('1. Validates and normalizes complete connection record', () => {
      const input = {
        actorId: 'actor_kirsty_allen',
        status: 'connected',
        accountEmail: 'kirsty.allen@trinova.co.uk',
        displayName: 'Kirsty Allen',
        tenantId: 'tenant_uuid_123',
        scopes: ['Mail.Read', 'Calendars.Read', 'offline_access'],
        refreshToken: 'rt_mock_token_abc',
        accessToken: 'at_mock_token_xyz',
        accessTokenExpiresAt: 1789900000000,
        emailSyncEnabled: true,
        calendarSyncEnabled: false,
        mailFolderIds: ['Inbox', 'Archive']
      };

      const normalized = validateConnectionSchema(input);
      assert.equal(normalized.actorId, 'actor_kirsty_allen');
      assert.equal(normalized.status, 'connected');
      assert.equal(normalized.accountEmail, 'kirsty.allen@trinova.co.uk');
      assert.equal(normalized.displayName, 'Kirsty Allen');
      assert.equal(normalized.tenantId, 'tenant_uuid_123');
      assert.deepEqual(normalized.scopes, ['Mail.Read', 'Calendars.Read', 'offline_access']);
      assert.equal(normalized.refreshToken, 'rt_mock_token_abc');
      assert.equal(normalized.accessToken, 'at_mock_token_xyz');
      assert.equal(normalized.accessTokenExpiresAt, 1789900000000);
      assert.equal(normalized.emailSyncEnabled, true);
      assert.equal(normalized.calendarSyncEnabled, false);
      assert.deepEqual(normalized.mailFolderIds, ['Inbox', 'Archive']);
      assert.ok(normalized.connectedAt);
      assert.equal(normalized.lastSyncAt, null);
      assert.equal(normalized.lastError, null);
    });

    test('2. Rejects connection with missing actorId', () => {
      assert.throws(() => {
        validateConnectionSchema({
          accountEmail: 'kirsty@trinova.com',
          refreshToken: 'rt_test'
        });
      }, /actorId/i);
    });

    test('3. Rejects connection with missing accountEmail', () => {
      assert.throws(() => {
        validateConnectionSchema({
          actorId: 'actor_kirsty_allen',
          refreshToken: 'rt_test'
        });
      }, /accountEmail/i);
    });

    test('4. Rejects connection with missing refreshToken', () => {
      assert.throws(() => {
        validateConnectionSchema({
          actorId: 'actor_kirsty_allen',
          accountEmail: 'kirsty@trinova.com'
        });
      }, /refreshToken/i);
    });

    test('5. Rejects invalid connection status', () => {
      assert.throws(() => {
        validateConnectionSchema({
          actorId: 'actor_kirsty_allen',
          accountEmail: 'kirsty@trinova.com',
          refreshToken: 'rt_test',
          status: 'invalid_status_value'
        });
      }, /Invalid connection status/i);
    });

    test('6. Applies default values for optional schema fields', () => {
      const minimal = {
        actorId: 'actor_kirsty_allen',
        accountEmail: 'kirsty.allen@trinova.co.uk',
        refreshToken: 'rt_minimal_test'
      };

      const normalized = validateConnectionSchema(minimal);
      assert.equal(normalized.status, 'connected');
      assert.equal(normalized.emailSyncEnabled, true);
      assert.equal(normalized.calendarSyncEnabled, true);
      assert.deepEqual(normalized.mailFolderIds, ['Inbox']);
      assert.deepEqual(normalized.scopes, []);
      assert.ok(normalized.connectedAt);
    });
  });

  // 2. Repository Functions: getConnection, saveConnection, deleteConnection
  describe('Repository Lifecycle & Persistence', () => {
    test('7. getConnection returns null when no connection exists', () => {
      const conn = getConnection({ filePath: TEST_VAULT_FILE, key: TEST_KEY_HEX });
      assert.equal(conn, null);
    });

    test('8. saveConnection saves encrypted record and getConnection retrieves it', () => {
      const record = {
        actorId: 'actor_kirsty_allen',
        status: 'connected',
        accountEmail: 'kirsty.allen@trinova.co.uk',
        displayName: 'Kirsty Allen',
        tenantId: 'tenant_test_456',
        scopes: ['Mail.Read', 'Calendars.Read', 'offline_access'],
        refreshToken: 'rt_sample_refresh_token_777',
        accessToken: 'at_sample_access_token_888',
        accessTokenExpiresAt: Date.now() + 3600000,
        emailSyncEnabled: true,
        calendarSyncEnabled: true,
        mailFolderIds: ['Inbox']
      };

      const saved = saveConnection(record, { filePath: TEST_VAULT_FILE, key: TEST_KEY_HEX });
      assert.equal(saved.accountEmail, 'kirsty.allen@trinova.co.uk');

      const retrieved = getConnection({ filePath: TEST_VAULT_FILE, key: TEST_KEY_HEX });
      assert.deepEqual(retrieved, saved);

      // Verify encrypted storage on disk
      const rawDisk = fs.readFileSync(TEST_VAULT_FILE, 'utf8');
      assert.equal(rawDisk.includes('rt_sample_refresh_token_777'), false, 'Raw disk must not contain token');
      const parsedBlob = JSON.parse(rawDisk);
      assert.equal(parsedBlob.v, 1);
      assert.ok(parsedBlob.ct);
    });

    test('9. saveConnection supports partial updates merging with existing record', () => {
      const initial = {
        actorId: 'actor_kirsty_allen',
        status: 'connected',
        accountEmail: 'kirsty.allen@trinova.co.uk',
        displayName: 'Kirsty Allen',
        tenantId: 'tenant_test_456',
        scopes: ['Mail.Read', 'Calendars.Read', 'offline_access'],
        refreshToken: 'rt_original_token',
        accessToken: 'at_original_token',
        accessTokenExpiresAt: 1000
      };

      saveConnection(initial, { filePath: TEST_VAULT_FILE, key: TEST_KEY_HEX });

      // Partial update: rotate access token and update sync timestamp
      const nowIso = new Date().toISOString();
      const updated = saveConnection({
        accessToken: 'at_new_rotated_token',
        accessTokenExpiresAt: 2000,
        lastSyncAt: nowIso
      }, { filePath: TEST_VAULT_FILE, key: TEST_KEY_HEX });

      assert.equal(updated.accessToken, 'at_new_rotated_token');
      assert.equal(updated.accessTokenExpiresAt, 2000);
      assert.equal(updated.lastSyncAt, nowIso);
      assert.equal(updated.refreshToken, 'rt_original_token', 'Unmodified fields must be preserved');
      assert.equal(updated.accountEmail, 'kirsty.allen@trinova.co.uk');
    });

    test('10. deleteConnection permanently purges connection record', () => {
      saveConnection({
        actorId: 'actor_kirsty_allen',
        accountEmail: 'kirsty@trinova.com',
        refreshToken: 'rt_to_purge'
      }, { filePath: TEST_VAULT_FILE, key: TEST_KEY_HEX });

      assert.ok(getConnection({ filePath: TEST_VAULT_FILE, key: TEST_KEY_HEX }));

      const deleted = deleteConnection({ filePath: TEST_VAULT_FILE });
      assert.equal(deleted, true);

      const postDelete = getConnection({ filePath: TEST_VAULT_FILE, key: TEST_KEY_HEX });
      assert.equal(postDelete, null);
    });
  });

  // 3. Sanitized Status for Public API Responses
  describe('Sanitized Status Exposure', () => {
    test('11. getSanitizedStatus returns disconnected when connection is null', () => {
      const status = getSanitizedStatus(null);
      assert.deepEqual(status, { status: 'disconnected', connected: false });
    });

    test('12. getSanitizedStatus exposes safe fields and strictly excludes tokens', () => {
      const connection = {
        actorId: 'actor_kirsty_allen',
        status: 'connected',
        accountEmail: 'kirsty.allen@trinova.co.uk',
        displayName: 'Kirsty Allen',
        tenantId: 'tenant_id_123',
        scopes: ['Mail.Read', 'Calendars.Read'],
        refreshToken: 'SUPER_SECRET_REFRESH_TOKEN',
        accessToken: 'SUPER_SECRET_ACCESS_TOKEN',
        accessTokenExpiresAt: 999999999,
        emailSyncEnabled: true,
        calendarSyncEnabled: false,
        mailFolderIds: ['Inbox'],
        connectedAt: '2026-10-20T12:00:00.000Z',
        lastSyncAt: '2026-10-20T12:05:00.000Z',
        lastError: null
      };

      const sanitized = getSanitizedStatus(connection);

      // Verify tokens and expiry are NOT present
      assert.equal(sanitized.refreshToken, undefined);
      assert.equal(sanitized.accessToken, undefined);
      assert.equal(sanitized.accessTokenExpiresAt, undefined);

      // Verify safe metadata IS present
      assert.equal(sanitized.status, 'connected');
      assert.equal(sanitized.connected, true);
      assert.equal(sanitized.accountEmail, 'kirsty.allen@trinova.co.uk');
      assert.equal(sanitized.displayName, 'Kirsty Allen');
      assert.equal(sanitized.tenantId, 'tenant_id_123');
      assert.deepEqual(sanitized.scopes, ['Mail.Read', 'Calendars.Read']);
      assert.equal(sanitized.emailSyncEnabled, true);
      assert.equal(sanitized.calendarSyncEnabled, false);
      assert.deepEqual(sanitized.mailFolderIds, ['Inbox']);
      assert.equal(sanitized.connectedAt, '2026-10-20T12:00:00.000Z');
      assert.equal(sanitized.lastSyncAt, '2026-10-20T12:05:00.000Z');
      assert.equal(sanitized.lastError, null);
    });
  });
});
