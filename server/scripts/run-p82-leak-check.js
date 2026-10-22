/**
 * Task P8.2 Verification Script: Logged-out leak check
 * Implements SPEC.md §6.1:
 * - Runs in a fresh server process with real secrets supplied via env
 * - Hits all 12 paths without session cookies:
 *   /
 *   /index.html
 *   /scripts/app.js
 *   /scripts/services/api.js
 *   /scripts/services/auth.js
 *   /scripts/data/seed.js
 *   /styles/views.css
 *   /api/v1/clients
 *   /api/v1/tasks
 *   /api/v1/outlook/diary
 *   /api/v1/outlook/flagged-emails
 *   /api/v1/integrations/outlook/status
 * - Greps response bodies for sensitive entities & secrets:
 *   woofington|jenkins|alpha delta|cfi awarding|rgb elevations|@[a-z0-9.-]+\.(co\.uk|com|org)|refresh_token|access_token|client_secret|password123|tn_sec_|documenso_webhook
 * - Verifies every sensitive_hits=0, seed.js is 404, and /api/v1/* is 401
 */

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from '../src/app.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '../..');

// Required environment secrets supplied
process.env.SLON_API_KEY = 'tn_live_key_p82_test_verification_001';
process.env.SLON_OWNER_EMAIL = 'owner@example.co.uk';
process.env.SLON_OWNER_PASSWORD_HASH = '$2a$10$abcdefghijklmnopqrstuvwxyz0123456789ABCDEFGHIJKLM';
process.env.STORAGE_PRESIGNED_TOKEN_SECRET = 'secret_token_p82_presigned_storage_001';
process.env.OUTLOOK_TOKEN_ENC_KEY = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
process.env.OUTLOOK_CLIENT_ID = 'test-outlook-client-id-p82';

const PORT = 4000;
const app = createApp();

const server = app.listen(PORT, async () => {
  const BASE = `http://127.0.0.1:${PORT}`;
  const paths = [
    '/',
    '/index.html',
    '/scripts/app.js',
    '/scripts/services/api.js',
    '/scripts/services/auth.js',
    '/scripts/data/seed.js',
    '/styles/views.css',
    '/api/v1/clients',
    '/api/v1/tasks',
    '/api/v1/outlook/diary',
    '/api/v1/outlook/flagged-emails',
    '/api/v1/integrations/outlook/status'
  ];

  const SENSITIVE_REGEX = /woofington|jenkins|alpha delta|cfi awarding|rgb elevations|@[a-z0-9.-]+\.(co\.uk|com|org)|refresh_token|access_token|client_secret|password123|tn_sec_|documenso_webhook/gi;

  const results = [];
  let allPassed = true;

  console.log('Task P8.2: Running §6.1 Logged-Out Leak Check...');
  console.log('Target BASE: ' + BASE);
  console.log('Regex: /woofington|jenkins|alpha delta|cfi awarding|rgb elevations|@[a-z0-9.-]+\\.(co\\.uk|com|org)|refresh_token|access_token|client_secret|password123|tn_sec_|documenso_webhook/i\n');

  for (const p of paths) {
    try {
      const res = await fetch(`${BASE}${p}`);
      const body = await res.text();
      const code = res.status;

      const matches = body.match(SENSITIVE_REGEX) || [];
      const hits = matches.length;

      const line = `${p.padEnd(38)} status=${code}  sensitive_hits=${hits}`;
      console.log(line);

      // Verify expectations
      if (hits !== 0) {
        allPassed = false;
        console.error(`  [FAIL] Expected sensitive_hits=0 for ${p}, got ${hits}. Matches:`, matches.slice(0, 5));
      }

      if (p === '/scripts/data/seed.js' && code !== 404) {
        allPassed = false;
        console.error(`  [FAIL] Expected status=404 for ${p}, got ${code}`);
      }

      if (p.startsWith('/api/v1/') && code !== 401) {
        allPassed = false;
        console.error(`  [FAIL] Expected status=401 for ${p}, got ${code}`);
      }

      results.push({ path: p, status: code, sensitive_hits: hits, matches });
    } catch (err) {
      allPassed = false;
      console.error(`Error requesting ${p}:`, err.message);
    }
  }

  server.close(() => {
    if (!allPassed) {
      console.error('\nVerification FAILED: One or more checks did not meet §6.1 expectations.');
      process.exit(1);
    } else {
      console.log('\nVerification PASSED: All 12 endpoints satisfied §6.1 criteria with zero leaks.');
      process.exit(0);
    }
  });
});
