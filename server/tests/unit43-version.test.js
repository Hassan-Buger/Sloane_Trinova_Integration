/**
 * Unit 43 Test Suite: The version of Sloane is visible, so updates can be checked
 *
 * Verifies:
 * - /api/v1/health (public) reports the real version from package.json and the deployed commit
 * - The version is shown in the sidebar, on the sign-in page and in Settings
 * - The cache-busting numbers in index.html always match the version, so an update reaches everyone
 */

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { createApp } from '../src/app.js';
import { APP_VERSION, buildId } from '../src/version.js';
import { frontendSource } from './support.js';
import { TEST_API_KEY } from './fixtures.js';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = rel => fs.readFileSync(path.join(rootDir, rel), 'utf8');
const pkg = JSON.parse(read('package.json'));
const PORT = 5043;

describe('Unit 43: Version', () => {
  let server;
  let baseUrl;
  const saved = {};

  before(async () => {
    for (const k of ['RAILWAY_GIT_COMMIT_SHA', 'SOURCE_COMMIT', 'GIT_COMMIT', 'SOURCE_VERSION']) saved[k] = process.env[k];
    const app = createApp();
    await new Promise(resolve => {
      server = app.listen(PORT, () => {
        baseUrl = `http://localhost:${PORT}`;
        resolve();
      });
    });
  });

  after(async () => {
    for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
    if (server) await new Promise(resolve => server.close(resolve));
  });

  test('1. The version is a proper x.y.z number and is the one in package.json', () => {
    assert.match(pkg.version, /^\d+\.\d+\.\d+$/);
    assert.equal(APP_VERSION, pkg.version);
  });

  test('2. The public health check reports that version (not a fixed 1.0.0)', async () => {
    const body = await (await fetch(`${baseUrl}/api/v1/health`)).json();
    assert.equal(body.version, pkg.version);
  });

  test('3. The deployed commit is reported when the host says it (Railway), shortened to 7 characters', async () => {
    delete process.env.GIT_COMMIT; delete process.env.SOURCE_COMMIT; delete process.env.SOURCE_VERSION;
    delete process.env.RAILWAY_GIT_COMMIT_SHA;
    assert.equal(buildId(), null);
    process.env.RAILWAY_GIT_COMMIT_SHA = '7add334b02cd2a04d3a3d1f0f2f4c8d5e6a7b8c9';
    assert.equal(buildId(), '7add334');
    const body = await (await fetch(`${baseUrl}/api/v1/health`)).json();
    assert.equal(body.build, '7add334');
  });

  test('4. Settings status also carries the version (for support)', async () => {
    const res = await fetch(`${baseUrl}/api/v1/system/status`, { headers: { Authorization: `Bearer ${TEST_API_KEY}` } });
    const body = (await res.json()).data;
    assert.equal(body.version, pkg.version);
  });

  test('5. The version shows in the sidebar, on the sign-in page and in the Settings card', () => {
    const html = read('index.html');
    assert.match(html, /id="appVersion"/);
    assert.match(html, /id="authVersion"/);
    const src = frontendSource();
    assert.match(src, /async showVersion\(\)/);
    assert.match(src, /this\.showVersion\(\);/);
    assert.match(src, /Version \$\{d\.version/);
  });

  test('6. Every cache-busting number in index.html matches the version, so nobody keeps old files', () => {
    const html = read('index.html');
    const marks = [...html.matchAll(/\?v=(\d+\.\d+\.\d+)/g)].map(m => m[1]);
    assert.ok(marks.length >= 6, 'styles and script are all versioned');
    for (const v of marks) assert.equal(v, pkg.version, 'update the ?v= numbers in index.html when the version changes');
  });
});
