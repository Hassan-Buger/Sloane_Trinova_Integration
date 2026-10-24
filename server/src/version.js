/**
 * Which version of Sloane is running, so the owner (and the developer) can see at a glance
 * that the latest update is live.
 *
 * - APP_VERSION comes from the root package.json (bump it with every release).
 * - The build is the short git commit that the host deployed. Railway sets
 *   RAILWAY_GIT_COMMIT_SHA; other hosts use SOURCE_COMMIT / GIT_COMMIT / SOURCE_VERSION.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

function readVersion() {
  for (const rel of ['../../package.json', '../package.json']) {
    try {
      const v = JSON.parse(fs.readFileSync(path.resolve(here, rel), 'utf8')).version;
      if (v) return String(v);
    } catch (_) { /* try the next place */ }
  }
  return 'unknown';
}

export const APP_VERSION = readVersion();

/** The short commit that is running, or null when the host does not say. */
export function buildId() {
  const sha = process.env.RAILWAY_GIT_COMMIT_SHA || process.env.SOURCE_COMMIT || process.env.GIT_COMMIT || process.env.SOURCE_VERSION || '';
  const clean = String(sha).trim();
  return clean ? clean.slice(0, 7) : null;
}
