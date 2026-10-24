/**
 * Unit 32 Test Suite: Security hygiene
 *
 * Verifies:
 * - There is no built-in "staff" login or default password anywhere (only the owner can sign in)
 * - No TriNova key is committed in the code, and Sloane's own key is never sent to TriNova
 * - No committed secrets or default credentials remain in the shipped source files
 */

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { createApp } from '../src/app.js';
import { config } from '../src/config.js';
import { TEST_PASSWORD } from './fixtures.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '../..');

const PORT = 5032;

function listSourceFiles(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (['node_modules', 'tests', 'storage', 'data-private', '.git', 'docs', 'scripts-private'].includes(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) listSourceFiles(full, out);
    else if (/\.(js|html|json|yml|yaml|sh|ps1|css)$/.test(entry.name)) out.push(full);
  }
  return out;
}

describe('Unit 32: Security hygiene', () => {
  let server;
  let baseUrl;

  before(async () => {
    const app = createApp();
    await new Promise(resolve => {
      server = app.listen(PORT, () => {
        baseUrl = `http://localhost:${PORT}`;
        resolve();
      });
    });
  });

  after(async () => {
    if (server) await new Promise(resolve => server.close(resolve));
  });

  describe('1. No back-door logins', () => {
    for (const email of ['staff.one@example.invalid', 'staff@trinovaaccounting.co.uk']) {
      test(`1.x ${email} with the old default password is refused`, async () => {
        const res = await fetch(`${baseUrl}/api/v1/auth/login`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email, password: 'password123' })
        });
        assert.equal(res.status, 401);
        assert.equal(res.headers.get('set-cookie'), null);
      });
    }

    test('1.3 The owner can still sign in with the real password', async () => {
      const res = await fetch(`${baseUrl}/api/v1/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: process.env.SLON_OWNER_EMAIL, password: TEST_PASSWORD })
      });
      assert.equal(res.status, 200);
    });
  });

  describe('2. TriNova key handling', () => {
    test('2.1 With no TRINOVA_API_KEY set, no key is sent (there is no committed default)', () => {
      const saved = process.env.TRINOVA_API_KEY;
      delete process.env.TRINOVA_API_KEY;
      try {
        assert.equal(config.trinova.apiKey, '');
      } finally {
        if (saved !== undefined) process.env.TRINOVA_API_KEY = saved;
      }
    });

    test('2.2 Sloane\'s own SLON_API_KEY is never reused as the TriNova key', () => {
      const saved = process.env.TRINOVA_API_KEY;
      delete process.env.TRINOVA_API_KEY;
      try {
        assert.ok(process.env.SLON_API_KEY, 'test fixture sets SLON_API_KEY');
        assert.notEqual(config.trinova.apiKey, process.env.SLON_API_KEY);
      } finally {
        if (saved !== undefined) process.env.TRINOVA_API_KEY = saved;
      }
    });
  });

  describe('3. Shipped source contains no committed secrets', () => {
    const files = listSourceFiles(rootDir).filter(f => !f.includes(`${path.sep}docs${path.sep}`));

    test('3.1 No committed TriNova key (tn_sec_live_...) in any shipped file', () => {
      const hits = files.filter(f => /tn_sec_live_[A-Za-z0-9_]+/.test(fs.readFileSync(f, 'utf8')));
      assert.deepEqual(hits.map(h => path.relative(rootDir, h)), []);
    });

    test('3.2 No default password literal in server code', () => {
      const serverFiles = files.filter(f => f.includes(`${path.sep}server${path.sep}src${path.sep}`));
      const hits = serverFiles.filter(f => /password123/.test(fs.readFileSync(f, 'utf8')));
      assert.deepEqual(hits.map(h => path.relative(rootDir, h)), []);
    });

    test('3.3 No private-key blocks, Anthropic/OpenAI-style keys or AWS keys in shipped files', () => {
      const pattern = /-----BEGIN [A-Z ]*PRIVATE KEY-----|sk-ant-[A-Za-z0-9_-]{20,}|sk-[A-Za-z0-9]{32,}|AKIA[0-9A-Z]{16}|AIza[0-9A-Za-z_-]{35}/;
      const hits = files.filter(f => pattern.test(fs.readFileSync(f, 'utf8')));
      assert.deepEqual(hits.map(h => path.relative(rootDir, h)), []);
    });
  });
});
