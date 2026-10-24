/**
 * Where Sloane keeps its files.
 *
 * On a host with a disposable disk (Railway, Docker) everything Sloane saves must live on a
 * mounted volume, or it is lost on every deploy. Point SLOANE_DATA_DIR at the volume
 * (Railway also provides RAILWAY_VOLUME_MOUNT_PATH automatically once a volume is attached)
 * and the database file, uploaded documents and Outlook sign-in vault all go there.
 *
 * Each of them can still be moved individually:
 *   SLOANE_DB_PATH, STORAGE_ROOT_PATH, OUTLOOK_VAULT_PATH
 */

import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SERVER_ROOT = path.resolve(__dirname, '../..');

/** The shared data folder (a mounted volume in production), or null when none is set. */
export function dataDir() {
  const dir = (process.env.SLOANE_DATA_DIR || process.env.RAILWAY_VOLUME_MOUNT_PATH || '').trim();
  return dir ? path.resolve(dir) : null;
}

export function databaseFilePath() {
  if (process.env.SLOANE_DB_PATH) return path.resolve(process.env.SLOANE_DB_PATH);
  const dir = dataDir();
  return dir ? path.join(dir, 'sloane.db') : path.join(SERVER_ROOT, 'data-private', 'sloane.db');
}

export function documentsDirPath() {
  if (process.env.STORAGE_ROOT_PATH) return path.resolve(process.env.STORAGE_ROOT_PATH);
  const dir = dataDir();
  if (dir) return path.join(dir, 'documents');
  // Automated tests must never write into the real documents folder.
  if (process.env.NODE_TEST_CONTEXT || process.env.NODE_ENV === 'test') {
    return path.join(os.tmpdir(), 'sloane-test-documents');
  }
  return path.join(SERVER_ROOT, 'storage', 'documents');
}

export function outlookVaultFilePath() {
  if (process.env.OUTLOOK_VAULT_PATH) return path.resolve(process.env.OUTLOOK_VAULT_PATH);
  const dir = dataDir();
  return dir ? path.join(dir, 'outlook-vault.json') : path.join(SERVER_ROOT, 'data-private', 'outlook-vault.json');
}
