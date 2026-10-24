/**
 * Shared helpers for tests that need to act as the signed-in owner (browser session)
 * rather than as an API key.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { TEST_PASSWORD } from './fixtures.js';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

/**
 * The text of the whole front end's page logic: scripts/app.js plus every module in
 * scripts/features/ (the pages were split out of app.js into those modules).
 */
export function frontendSource() {
  const featuresDir = path.join(rootDir, 'scripts', 'features');
  const parts = [fs.readFileSync(path.join(rootDir, 'scripts', 'app.js'), 'utf8')];
  for (const f of fs.readdirSync(featuresDir).filter(n => n.endsWith('.js')).sort()) {
    parts.push(fs.readFileSync(path.join(featuresDir, f), 'utf8'));
  }
  return parts.join('\n');
}

/** Signs in as the owner and returns the Cookie header to send on later requests. */
export async function loginCookie(baseUrl) {
  const res = await fetch(`${baseUrl}/api/v1/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: process.env.SLON_OWNER_EMAIL, password: TEST_PASSWORD })
  });
  if (res.status !== 200) throw new Error(`Test login failed with ${res.status}`);
  const setCookie = res.headers.get('set-cookie') || '';
  return setCookie.split(';')[0];
}
