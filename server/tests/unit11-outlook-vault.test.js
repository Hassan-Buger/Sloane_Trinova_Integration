/**
 * Automated Unit Test Suite for Unit 11 / Task P2.1:
 * Encrypted Token Vault & Storage Service (AES-256-GCM)
 */

import { test, describe, before, after, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  outlookVault,
  validateKey,
  isConfigured,
  encrypt,
  decrypt,
  getVaultPath,
  readVault,
  writeVault,
  deleteVault
} from '../src/services/outlookVault.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const TEST_DIR = path.resolve(__dirname, '../data-private/test-vault');
const TEST_VAULT_FILE = path.join(TEST_DIR, 'test-outlook-vault.json');

// Generate deterministic 32-byte test keys
const TEST_KEY_HEX = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
const TEST_KEY_B64 = crypto.randomBytes(32).toString('base64');
const TEST_KEY_BUF = crypto.randomBytes(32);
const TEST_KEY_ALT = crypto.randomBytes(32).toString('hex'); // completely different 32-byte key

describe('Task P2.1: Outlook Token Vault Encryption (AES-256-GCM)', () => {
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
    deleteVault({ filePath: TEST_VAULT_FILE });
  });

  // 1. Key Validation & isConfigured
  describe('Key Validation & Configuration Gate', () => {
    test('1. Validates 64-character hex encryption keys (32 bytes)', () => {
      const res = validateKey(TEST_KEY_HEX);
      assert.equal(res.valid, true);
      assert.equal(res.key.length, 32);
    });

    test('2. Validates 44-character base64 encryption keys (32 bytes)', () => {
      const res = validateKey(TEST_KEY_B64);
      assert.equal(res.valid, true);
      assert.equal(res.key.length, 32);
    });

    test('3. Validates 32-byte Buffer encryption keys', () => {
      const res = validateKey(TEST_KEY_BUF);
      assert.equal(res.valid, true);
      assert.equal(res.key.length, 32);
    });

    test('4. Validates 32-character UTF-8 string keys', () => {
      const utf8Key = '12345678901234567890123456789012'; // 32 characters = 32 bytes
      const res = validateKey(utf8Key);
      assert.equal(res.valid, true);
      assert.equal(res.key.length, 32);
    });

    test('5. Rejects missing, undefined, or empty encryption key', () => {
      assert.equal(validateKey(undefined).valid, false);
      assert.equal(validateKey('').valid, false);
      assert.equal(validateKey(null).valid, false);
    });

    test('6. Rejects encryption keys of invalid byte lengths', () => {
      assert.equal(validateKey('too_short').valid, false);
      assert.equal(validateKey('1234567890123456').valid, false); // 16 bytes
      assert.equal(validateKey('1234567890123456789012345678901').valid, false); // 31 bytes
      assert.equal(validateKey('123456789012345678901234567890123').valid, false); // 33 bytes
    });

    test('7. isConfigured() checks environment variable or key override', () => {
      const prev = process.env.OUTLOOK_TOKEN_ENC_KEY;
      try {
        delete process.env.OUTLOOK_TOKEN_ENC_KEY;
        assert.equal(isConfigured(), false, 'isConfigured must be false when env var is unset');

        process.env.OUTLOOK_TOKEN_ENC_KEY = 'invalid_short_key';
        assert.equal(isConfigured(), false, 'isConfigured must be false when env var is invalid length');

        process.env.OUTLOOK_TOKEN_ENC_KEY = TEST_KEY_HEX;
        assert.equal(isConfigured(), true, 'isConfigured must be true when env var is 32 bytes');
      } finally {
        if (prev) process.env.OUTLOOK_TOKEN_ENC_KEY = prev;
        else delete process.env.OUTLOOK_TOKEN_ENC_KEY;
      }
    });
  });

  // 2. Encryption & Decryption Round-Trip & Tamper Protection
  describe('AES-256-GCM Cryptographic Integrity', () => {
    test('8. Round-trip encryption and decryption preserves plaintext strings', () => {
      const plaintext = 'Sloane Trinova Microsoft Graph Integration Token 2026';
      const blob = encrypt(plaintext, TEST_KEY_HEX);

      assert.equal(blob.v, 1);
      assert.ok(typeof blob.iv === 'string', 'IV must be base64 string');
      assert.ok(typeof blob.tag === 'string', 'Auth tag must be base64 string');
      assert.ok(typeof blob.ct === 'string', 'Ciphertext must be base64 string');

      // Verify IV is 12 bytes and tag is 16 bytes
      assert.equal(Buffer.from(blob.iv, 'base64').length, 12, 'IV must be 12 bytes');
      assert.equal(Buffer.from(blob.tag, 'base64').length, 16, 'Tag must be 16 bytes');

      const decrypted = decrypt(blob, TEST_KEY_HEX);
      assert.equal(decrypted, plaintext);
    });

    test('9. Round-trip encryption and decryption preserves structured JSON objects', () => {
      const tokenBundle = {
        accessToken: 'at_test_sample_token_xyz',
        refreshToken: 'rt_test_sample_refresh_token_abc',
        expiresAt: 1789900000000,
        scopes: ['Mail.Read', 'Calendars.Read', 'offline_access']
      };

      const blob = encrypt(tokenBundle, TEST_KEY_B64);
      const decryptedStr = decrypt(blob, TEST_KEY_B64);
      const decryptedObj = JSON.parse(decryptedStr);

      assert.deepEqual(decryptedObj, tokenBundle);
    });

    test('10. Tampered ciphertext is strictly rejected with authentication tag error', () => {
      const plaintext = 'Secret Kirsty Executive Session Credentials';
      const blob = encrypt(plaintext, TEST_KEY_HEX);

      // Flip characters in ciphertext
      const ctBuf = Buffer.from(blob.ct, 'base64');
      ctBuf[0] = ctBuf[0] ^ 0xff; // flip bits
      const tamperedBlob = { ...blob, ct: ctBuf.toString('base64') };

      assert.throws(() => {
        decrypt(tamperedBlob, TEST_KEY_HEX);
      }, /Decryption failed|authentication tag/i);
    });

    test('11. Tampered auth tag is strictly rejected', () => {
      const plaintext = 'Critical Outlook OAuth Refresh Token';
      const blob = encrypt(plaintext, TEST_KEY_HEX);

      // Alter auth tag
      const tagBuf = Buffer.from(blob.tag, 'base64');
      tagBuf[tagBuf.length - 1] = tagBuf[tagBuf.length - 1] ^ 0x01;
      const tamperedBlob = { ...blob, tag: tagBuf.toString('base64') };

      assert.throws(() => {
        decrypt(tamperedBlob, TEST_KEY_HEX);
      }, /Decryption failed|authentication tag/i);
    });

    test('12. Tampered IV is strictly rejected', () => {
      const plaintext = 'Sensitive Token Payload';
      const blob = encrypt(plaintext, TEST_KEY_HEX);

      const ivBuf = Buffer.from(blob.iv, 'base64');
      ivBuf[0] = ivBuf[0] ^ 0x01;
      const tamperedBlob = { ...blob, iv: ivBuf.toString('base64') };

      assert.throws(() => {
        decrypt(tamperedBlob, TEST_KEY_HEX);
      }, /Decryption failed|authentication tag/i);
    });

    test('13. Decryption with wrong key is strictly rejected', () => {
      const plaintext = 'Confidential Vault Record';
      const blob = encrypt(plaintext, TEST_KEY_HEX);

      assert.throws(() => {
        decrypt(blob, TEST_KEY_ALT);
      }, /Decryption failed|authentication tag/i);
    });

    test('14. Encrypt/Decrypt throws when called with invalid or missing key', () => {
      assert.throws(() => {
        encrypt('data', 'short_key');
      }, /Cannot encrypt/i);

      assert.throws(() => {
        decrypt({ v: 1, iv: 'AA==', tag: 'BB==', ct: 'CC==' }, 'short_key');
      }, /Cannot decrypt/i);
    });
  });

  // 3. Vault File Storage, Zero Secret Leakage, Atomic Writes & Permissions
  describe('Vault File Persistence, Atomicity & Secret Hygiene', () => {
    test('15. writeVault and readVault persist and retrieve structured data correctly', () => {
      const sampleConnection = {
        actorId: 'actor_kirsty_allen',
        status: 'connected',
        accountEmail: 'kirsty.allen@trinova.co.uk',
        displayName: 'Kirsty Allen',
        tenantId: 'tenant_test_123',
        scopes: ['Mail.Read', 'Calendars.Read', 'offline_access'],
        refreshToken: 'rt_mock_token_77777',
        accessToken: 'at_mock_token_88888',
        accessTokenExpiresAt: Date.now() + 3600000,
        emailSyncEnabled: true,
        calendarSyncEnabled: true,
        mailFolderIds: ['Inbox'],
        connectedAt: new Date().toISOString()
      };

      writeVault(sampleConnection, { filePath: TEST_VAULT_FILE, key: TEST_KEY_HEX });
      assert.ok(fs.existsSync(TEST_VAULT_FILE), 'Vault file must exist on disk');

      const restored = readVault({ filePath: TEST_VAULT_FILE, key: TEST_KEY_HEX });
      assert.deepEqual(restored, sampleConnection);
    });

    test('16. File contents on disk contain zero plaintext substring of known test tokens or client data', () => {
      const sensitivePayload = {
        refreshToken: 'kirsty_super_secret_refresh_token_ultra_unique_9999',
        accessToken: 'kirsty_super_secret_access_token_ultra_unique_8888',
        accountEmail: 'kirsty.allen@trinova.co.uk',
        displayName: 'Kirsty Allen'
      };

      writeVault(sensitivePayload, { filePath: TEST_VAULT_FILE, key: TEST_KEY_HEX });

      // Read raw file content directly from disk
      const rawDiskContent = fs.readFileSync(TEST_VAULT_FILE, 'utf8');

      // Assert zero plaintext matches for tokens, email, display name, and property names
      assert.equal(
        rawDiskContent.includes('kirsty_super_secret_refresh_token_ultra_unique_9999'),
        false,
        'Disk file must not contain raw refresh token'
      );
      assert.equal(
        rawDiskContent.includes('kirsty_super_secret_access_token_ultra_unique_8888'),
        false,
        'Disk file must not contain raw access token'
      );
      assert.equal(
        rawDiskContent.includes('kirsty.allen@trinova.co.uk'),
        false,
        'Disk file must not contain raw email address'
      );
      assert.equal(
        rawDiskContent.includes('refreshToken'),
        false,
        'Disk file must not contain refreshToken JSON key'
      );
      assert.equal(
        rawDiskContent.includes('accessToken'),
        false,
        'Disk file must not contain accessToken JSON key'
      );

      // Verify the file content on disk is strictly a valid encrypted blob JSON object
      const parsedBlob = JSON.parse(rawDiskContent);
      assert.equal(parsedBlob.v, 1);
      assert.ok(parsedBlob.iv && parsedBlob.tag && parsedBlob.ct);
    });

    test('17. Vault file is created with 0600 permissions and directory with 0700', () => {
      writeVault({ test: true }, { filePath: TEST_VAULT_FILE, key: TEST_KEY_HEX });

      if (process.platform !== 'win32') {
        const fileStat = fs.statSync(TEST_VAULT_FILE);
        const fileMode = fileStat.mode & 0o777;
        assert.equal(fileMode, 0o600, 'Vault file must have mode 0600 (-rw-------)');

        const dirStat = fs.statSync(TEST_DIR);
        const dirMode = dirStat.mode & 0o777;
        assert.equal(dirMode, 0o700, 'Vault directory must have mode 0700 (drwx------)');
      } else {
        // On Windows NTFS, chmod does not map 1:1 with POSIX permissions, but must execute cleanly without error
        assert.ok(fs.existsSync(TEST_VAULT_FILE));
      }
    });

    test('18. Atomic writes leave no leftover temporary files in directory', () => {
      writeVault({ test: 'atomic_one' }, { filePath: TEST_VAULT_FILE, key: TEST_KEY_HEX });
      writeVault({ test: 'atomic_two' }, { filePath: TEST_VAULT_FILE, key: TEST_KEY_HEX });

      const files = fs.readdirSync(TEST_DIR);
      const tmpFiles = files.filter(f => f.startsWith('.tmp_'));
      assert.equal(tmpFiles.length, 0, 'No temporary atomic swap files must remain after write');
      assert.equal(files.includes(path.basename(TEST_VAULT_FILE)), true);
    });

    test('19. deleteVault safely unlinks file and subsequent readVault returns null', () => {
      writeVault({ toDelete: true }, { filePath: TEST_VAULT_FILE, key: TEST_KEY_HEX });
      assert.equal(fs.existsSync(TEST_VAULT_FILE), true);

      const deleted = deleteVault({ filePath: TEST_VAULT_FILE });
      assert.equal(deleted, true);
      assert.equal(fs.existsSync(TEST_VAULT_FILE), false);

      const readAfter = readVault({ filePath: TEST_VAULT_FILE, key: TEST_KEY_HEX });
      assert.equal(readAfter, null);

      const secondDelete = deleteVault({ filePath: TEST_VAULT_FILE });
      assert.equal(secondDelete, false);
    });
  });
});
