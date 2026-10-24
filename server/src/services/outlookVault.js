/**
 * Outlook Encrypted Token Vault & Storage Service
 * Implements AES-256-GCM encryption with atomic file writes, strict file permissions (0600),
 * and zero secret leakage.
 *
 * Encrypted blob schema:
 * {
 *   v: 1,
 *   iv: string (base64, 12 bytes),
 *   tag: string (base64, 16 bytes),
 *   ct: string (base64)
 * }
 */

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

import { outlookVaultFilePath } from '../data/paths.js';

const DEFAULT_VAULT_PATH = path.resolve(__dirname, '../../data-private/outlook-vault.json');

/**
 * Validates and converts a candidate key into a 32-byte Buffer.
 * Supports:
 * - 32-byte Buffer
 * - 64-character Hex string
 * - 32-character UTF-8 string (32 bytes)
 * - 44-character Base64 string decoding to 32 bytes
 *
 * @param {string|Buffer} [candidateKey] - Explicit key override or falls back to process.env.OUTLOOK_TOKEN_ENC_KEY
 * @returns {{ valid: boolean, key?: Buffer, error?: string }}
 */
export function validateKey(candidateKey) {
  const raw = candidateKey !== undefined ? candidateKey : process.env.OUTLOOK_TOKEN_ENC_KEY;

  if (!raw) {
    return {
      valid: false,
      error: 'OUTLOOK_TOKEN_ENC_KEY environment variable is missing or empty'
    };
  }

  if (Buffer.isBuffer(raw)) {
    if (raw.length === 32) return { valid: true, key: raw };
    return {
      valid: false,
      error: `Encryption key Buffer must be exactly 32 bytes (received ${raw.length} bytes)`
    };
  }

  if (typeof raw !== 'string') {
    return {
      valid: false,
      error: 'Encryption key must be a string or Buffer'
    };
  }

  const trimmed = raw.trim();

  // 1. 64-character hex string -> 32 bytes
  if (/^[0-9a-fA-F]{64}$/.test(trimmed)) {
    return { valid: true, key: Buffer.from(trimmed, 'hex') };
  }

  // 2. Base64 string decoding to 32 bytes
  if (/^[A-Za-z0-9+/=_-]{40,48}$/.test(trimmed)) {
    try {
      const b64Buf = Buffer.from(trimmed, 'base64');
      if (b64Buf.length === 32) {
        return { valid: true, key: b64Buf };
      }
    } catch (_) {}
  }

  // 3. UTF-8 string of exactly 32 bytes
  if (Buffer.byteLength(trimmed, 'utf8') === 32) {
    return { valid: true, key: Buffer.from(trimmed, 'utf8') };
  }

  return {
    valid: false,
    error: `OUTLOOK_TOKEN_ENC_KEY must resolve to exactly 32 bytes (256 bits). Received ${Buffer.byteLength(trimmed, 'utf8')} bytes.`
  };
}

/**
 * Checks if the Outlook token vault has a valid encryption key configured.
 * When false, server continues to start normally, but Outlook integration
 * status reports 'not_configured'.
 *
 * @param {string|Buffer} [keyOverride]
 * @returns {boolean}
 */
export function isConfigured(keyOverride) {
  return validateKey(keyOverride).valid;
}

/**
 * Encrypts a plaintext payload using AES-256-GCM.
 *
 * @param {string|Buffer|object} plaintext - Payload to encrypt
 * @param {string|Buffer} [keyOverride] - Optional key override
 * @returns {{ v: number, iv: string, tag: string, ct: string }}
 */
export function encrypt(plaintext, keyOverride) {
  const keyValidation = validateKey(keyOverride);
  if (!keyValidation.valid) {
    throw new Error(`Cannot encrypt: ${keyValidation.error}`);
  }

  const payload = typeof plaintext === 'string'
    ? plaintext
    : (Buffer.isBuffer(plaintext) ? plaintext.toString('utf8') : JSON.stringify(plaintext));

  // Generate unique 96-bit (12 bytes) IV for every encryption call
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', keyValidation.key, iv);

  const ct = Buffer.concat([
    cipher.update(Buffer.from(payload, 'utf8')),
    cipher.final()
  ]);

  const tag = cipher.getAuthTag();

  return {
    v: 1,
    iv: iv.toString('base64'),
    tag: tag.toString('base64'),
    ct: ct.toString('base64')
  };
}

/**
 * Decrypts an AES-256-GCM encrypted blob and verifies its authentication tag.
 * Throws if the ciphertext, IV, tag, or key has been modified or tampered with.
 *
 * @param {object|string} blob - Encrypted blob or JSON string { v: 1, iv, tag, ct }
 * @param {string|Buffer} [keyOverride] - Optional key override
 * @returns {string} Decrypted plaintext string
 */
export function decrypt(blob, keyOverride) {
  const keyValidation = validateKey(keyOverride);
  if (!keyValidation.valid) {
    throw new Error(`Cannot decrypt: ${keyValidation.error}`);
  }

  const parsed = typeof blob === 'string' ? JSON.parse(blob) : blob;

  if (!parsed || typeof parsed !== 'object') {
    throw new Error('Invalid encrypted blob: payload must be an object');
  }

  if (parsed.v !== 1) {
    throw new Error(`Unsupported encrypted blob version: ${parsed.v}`);
  }

  if (!parsed.iv || !parsed.tag || !parsed.ct) {
    throw new Error('Invalid encrypted blob structure: missing iv, tag, or ct');
  }

  const iv = Buffer.from(parsed.iv, 'base64');
  const tag = Buffer.from(parsed.tag, 'base64');
  const ct = Buffer.from(parsed.ct, 'base64');

  if (iv.length !== 12) {
    throw new Error(`Invalid IV length: expected 12 bytes, got ${iv.length}`);
  }

  if (tag.length !== 16) {
    throw new Error(`Invalid auth tag length: expected 16 bytes, got ${tag.length}`);
  }

  const decipher = crypto.createDecipheriv('aes-256-gcm', keyValidation.key, iv);
  decipher.setAuthTag(tag);

  try {
    const decrypted = Buffer.concat([
      decipher.update(ct),
      decipher.final()
    ]);
    return decrypted.toString('utf8');
  } catch (err) {
    throw new Error(`Decryption failed: authentication tag verification error or tampered ciphertext (${err.message})`);
  }
}

/**
 * Resolves the absolute path to the encrypted vault file.
 *
 * @param {string} [pathOverride]
 * @returns {string}
 */
export function getVaultPath(pathOverride) {
  if (pathOverride) return path.resolve(pathOverride);
  return outlookVaultFilePath() || DEFAULT_VAULT_PATH;
}

/**
 * Ensures the parent directory of the vault exists with strict mode 0700.
 *
 * @param {string} filePath
 */
function ensureDirectory(filePath) {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  }
  try {
    fs.chmodSync(dir, 0o700);
  } catch (_) {}
}

/**
 * Reads and decrypts data from the vault file.
 * Returns null if the file does not exist.
 *
 * @param {object} [options]
 * @param {string} [options.filePath] - Custom vault path
 * @param {string|Buffer} [options.key] - Custom key override
 * @returns {any|null} Parsed JSON data or null
 */
export function readVault(options = {}) {
  const filePath = getVaultPath(options.filePath);

  if (!fs.existsSync(filePath)) {
    return null;
  }

  const raw = fs.readFileSync(filePath, 'utf8');
  const blob = JSON.parse(raw);
  const decrypted = decrypt(blob, options.key);

  try {
    return JSON.parse(decrypted);
  } catch (_) {
    return decrypted;
  }
}

/**
 * Encrypts and writes data atomically to the vault file with mode 0600.
 * Uses temp file, fsync, and atomic rename.
 *
 * @param {any} data - Data to store in the vault
 * @param {object} [options]
 * @param {string} [options.filePath] - Custom vault path
 * @param {string|Buffer} [options.key] - Custom key override
 * @returns {{ v: number, iv: string, tag: string, ct: string }} The written encrypted blob
 */
export function writeVault(data, options = {}) {
  const filePath = getVaultPath(options.filePath);
  ensureDirectory(filePath);

  const serialized = typeof data === 'string' ? data : JSON.stringify(data);
  const blob = encrypt(serialized, options.key);
  const blobJson = JSON.stringify(blob, null, 2);

  const dir = path.dirname(filePath);
  const tempPath = path.join(dir, `.tmp_${crypto.randomBytes(8).toString('hex')}`);

  // 1. Write encrypted payload to temporary file with mode 0600
  fs.writeFileSync(tempPath, blobJson, { mode: 0o600 });
  try {
    fs.chmodSync(tempPath, 0o600);
  } catch (_) {}

  // 2. Perform explicit fsync to flush disk caches before rename
  const fd = fs.openSync(tempPath, 'r+');
  try {
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }

  // 3. Atomically replace target vault file
  fs.renameSync(tempPath, filePath);
  try {
    fs.chmodSync(filePath, 0o600);
  } catch (_) {}

  return blob;
}

/**
 * Deletes the vault file if it exists.
 *
 * @param {object} [options]
 * @param {string} [options.filePath] - Custom vault path
 * @returns {boolean} True if file was deleted, false if it did not exist
 */
export function deleteVault(options = {}) {
  const filePath = getVaultPath(options.filePath);
  if (fs.existsSync(filePath)) {
    fs.unlinkSync(filePath);
    return true;
  }
  return false;
}

export const outlookVault = {
  validateKey,
  isConfigured,
  encrypt,
  decrypt,
  getVaultPath,
  readVault,
  writeVault,
  deleteVault
};

export default outlookVault;
