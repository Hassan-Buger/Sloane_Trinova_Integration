/**
 * Automated Test Suite for Phase 1: Security Controls Verification
 * Validates:
 * - 1.1 Server-side auth, session lifecycle, password verification, rate limiting, generic errors
 * - 1.2 Scoped API keys loaded from environment
 * - 1.3 Static file server whitelist and dotfile/server file blocking
 * - 1.5 Webhook HMAC enforcement, notes role visibility, document metadata sanitization
 */

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import crypto from 'node:crypto';
import { createApp } from '../src/app.js';
import { mockDb } from '../src/data/db.js';
import { TEST_API_KEY, TEST_READONLY_KEY, TEST_WEBHOOK_SECRET, TEST_PASSWORD } from './fixtures.js';

describe('Phase 1: Security Hardening & Authentication Verification', () => {
  let server;
  let baseUrl;
  const PORT = 4990;

  before(async () => {
    // Add mock signing request for webhook test
    if (!mockDb.signingRequests) mockDb.signingRequests = [];
    mockDb.signingRequests.push({
      id: 'sign_req_phase1_test',
      providerRequestId: 'prov_phase1_test',
      status: 'PENDING',
      signers: [{ email: 'test@example.com', status: 'PENDING' }]
    });

    const app = createApp();
    await new Promise(resolve => {
      server = app.listen(PORT, () => {
        baseUrl = `http://localhost:${PORT}`;
        resolve();
      });
    });
  });

  after(async () => {
    if (server) {
      await new Promise(resolve => server.close(resolve));
    }
  });

  function request(path, options = {}) {
    return new Promise((resolve, reject) => {
      const url = new URL(path, baseUrl);
      const req = http.request(url, options, res => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          let parsed;
          try {
            parsed = JSON.parse(data);
          } catch {
            parsed = data;
          }
          resolve({ status: res.statusCode, headers: res.headers, body: parsed });
        });
      });
      req.on('error', reject);
      if (options.body) {
        req.write(typeof options.body === 'string' ? options.body : JSON.stringify(options.body));
      }
      req.end();
    });
  }

  // 1.1 Authentication & Session Management
  test('1.1.1 Login fails with unknown user with generic 401 error', async () => {
    const res = await request('/api/v1/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': '198.51.100.1' },
      body: { email: 'unknown@example.com', password: 'password123' }
    });
    assert.equal(res.status, 401);
    assert.equal(res.body.error?.code, 'INVALID_CREDENTIALS');
    assert.match(res.body.error?.message, /Invalid email or password/i);
  });

  test('1.1.2 Login fails with wrong password with identical generic 401 error', async () => {
    const res = await request('/api/v1/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': '198.51.100.2' },
      body: { email: 'kirsty@trinova.com', password: 'wrongpassword' }
    });
    assert.equal(res.status, 401);
    assert.equal(res.body.error?.code, 'INVALID_CREDENTIALS');
    assert.match(res.body.error?.message, /Invalid email or password/i);
  });

  test('1.1.3 Login rejects empty or malformed body with 400', async () => {
    const res = await request('/api/v1/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': '198.51.100.3' },
      body: { email: '' }
    });
    assert.equal(res.status, 400);
    assert.equal(res.body.error?.code, 'BAD_REQUEST');
  });

  test('1.1.4 Rate limiting locks out after 5 consecutive failed attempts per IP', async () => {
    const testIp = '203.0.113.99';
    for (let i = 0; i < 5; i++) {
      const res = await request('/api/v1/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': testIp },
        body: { email: 'kirsty@trinova.com', password: `bad_${i}` }
      });
      assert.equal(res.status, 401);
    }

    // 6th attempt should be blocked with 429
    const blockedRes = await request('/api/v1/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': testIp },
      body: { email: 'kirsty@trinova.com', password: TEST_PASSWORD }
    });
    assert.equal(blockedRes.status, 429);
    assert.ok(blockedRes.body.error?.code);
  });

  test('1.1.5 Login succeeds with correct credentials, sets HttpOnly SameSite cookie', async () => {
    const res = await request('/api/v1/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': '198.51.100.10' },
      body: { email: 'kirsty@trinova.com', password: TEST_PASSWORD }
    });
    assert.equal(res.status, 200);
    assert.equal(res.body.status, 'success');
    assert.equal((res.body.data?.user || res.body.user)?.email, 'kirsty@trinova.com');

    const setCookie = res.headers['set-cookie'];
    assert.ok(setCookie, 'Must set cookie header');
    const cookieStr = Array.isArray(setCookie) ? setCookie[0] : setCookie;
    assert.match(cookieStr, /slon_session=/);
    assert.match(cookieStr, /HttpOnly/i);
    assert.match(cookieStr, /SameSite=Strict/i);

    // Verify authenticated session can access protected /api/v1/clients endpoint
    const sessionCookie = cookieStr.split(';')[0];
    const clientRes = await request('/api/v1/clients', {
      headers: { Cookie: sessionCookie }
    });
    assert.equal(clientRes.status, 200);
    assert.ok(Array.isArray(clientRes.body.data));

    // Verify session verification endpoint
    const checkRes = await request('/api/v1/auth/session', {
      headers: { Cookie: sessionCookie }
    });
    assert.equal(checkRes.status, 200);
    assert.equal(checkRes.body.status, 'authenticated');
    assert.equal(checkRes.body.user.email, 'kirsty@trinova.com');

    // Logout destroys session and clears cookie
    const logoutRes = await request('/api/v1/auth/logout', {
      method: 'POST',
      headers: { Cookie: sessionCookie }
    });
    assert.equal(logoutRes.status, 200);

    // Subsequent access with old cookie returns 401
    const postLogoutRes = await request('/api/v1/clients', {
      headers: { Cookie: sessionCookie }
    });
    assert.equal(postLogoutRes.status, 401);
  });

  test('1.1.6 An existing browser session cannot make an invalid password appear to succeed in a fresh login attempt', async () => {
    // Establish valid session first
    const loginRes = await request('/api/v1/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': '198.51.100.20' },
      body: { email: 'kirsty@trinova.com', password: TEST_PASSWORD }
    });
    assert.equal(loginRes.status, 200);
    const setCookie = loginRes.headers['set-cookie'];
    const sessionCookie = (Array.isArray(setCookie) ? setCookie[0] : setCookie).split(';')[0];

    // Attempt second login with incorrect password while passing existing session cookie
    const badAttemptRes = await request('/api/v1/auth/login', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Forwarded-For': '198.51.100.21',
        Cookie: sessionCookie
      },
      body: { email: 'kirsty@trinova.com', password: 'incorrect_random_password' }
    });
    assert.equal(badAttemptRes.status, 401);
    assert.equal(badAttemptRes.body.error?.code, 'INVALID_CREDENTIALS');
  });

  test('1.1.7 Login succeeds with kirsty.allen@trinova.co.uk owner email and runtime fixture password', async () => {
    const res = await request('/api/v1/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': '198.51.100.22' },
      body: { email: 'kirsty.allen@trinova.co.uk', password: TEST_PASSWORD }
    });
    assert.equal(res.status, 200);
    assert.equal(res.body.status, 'success');
  });

  // 1.3 Static File Serving Whitelist & Dotfile Denial
  test('1.3.1 Serving sensitive files (config.js, .env.example, package.json) returns 404', async () => {
    const paths = [
      '/package.json',
      '/package-lock.json',
      '/.env.example',
      '/.env',
      '/server/src/config.js',
      '/server/src/server.js',
      '/src/server.js'
    ];

    for (const p of paths) {
      const res = await request(p);
      assert.equal(res.status, 404, `Path ${p} must return 404`);
    }
  });

  test('1.3.2 Whitelisted static assets return 200', async () => {
    const res = await request('/styles/tokens.css');
    assert.equal(res.status, 200);
    assert.match(res.headers['content-type'] || '', /text\/css/);
  });

  // 1.5 Webhook HMAC enforcement
  test('1.5.1 Webhook rejects plain secret header and requires valid HMAC signature', async () => {
    const payload = JSON.stringify({
      event: 'RECIPIENT_SIGNED',
      data: {
        signingRequestId: 'sign_req_phase1_test',
        recipientEmail: 'test@example.com',
        timestamp: new Date().toISOString()
      }
    });

    // Attempt with plain secret header (previously allowed backdoor)
    const plainRes = await request('/api/v1/signing/webhooks', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Documenso-Secret': TEST_WEBHOOK_SECRET
      },
      body: payload
    });
    assert.equal(plainRes.status, 401, 'Webhook with plain secret header without HMAC must be rejected');

    // Attempt with valid HMAC-SHA256 signature
    const hmac = crypto.createHmac('sha256', TEST_WEBHOOK_SECRET).update(payload).digest('hex');
    const validRes = await request('/api/v1/signing/webhooks', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Documenso-Signature': hmac
      },
      body: payload
    });
    assert.equal(validRes.status, 200, 'Webhook with valid HMAC signature must succeed');
  });

  // 1.5 Document sanitization: storagePath and diskId stripped
  test('1.5.2 Document endpoints strip storagePath and diskId from responses', async () => {
    const res = await request('/api/v1/companies/comp_woofington_park_01/documents', {
      headers: { Authorization: `Bearer ${TEST_API_KEY}` }
    });
    assert.equal(res.status, 200);
    const docs = res.body.data;
    assert.ok(docs.length > 0);
    for (const doc of docs) {
      assert.equal(doc.storagePath, undefined, 'storagePath must be stripped');
      assert.equal(doc.diskId, undefined, 'diskId must be stripped');
      assert.ok(doc.id, 'Document ID must be present');
      assert.ok(doc.filename, 'filename must be present');
    }
  });

  // 1.5 staff_only notes visibility filtering
  test('1.5.3 staff_only notes are filtered out for read-only actors', async () => {
    // Read with read-only actor
    const res = await request('/api/v1/companies/comp_woofington_park_01/notes', {
      headers: { Authorization: `Bearer ${TEST_READONLY_KEY}` }
    });
    assert.equal(res.status, 200);
    const notes = res.body.data;
    assert.ok(notes.every(n => n.visibility !== 'staff_only'), 'Read-only actor must not see staff_only notes');

    // Read with read-write staff actor
    const staffRes = await request('/api/v1/companies/comp_woofington_park_01/notes', {
      headers: { Authorization: `Bearer ${TEST_API_KEY}` }
    });
    assert.equal(staffRes.status, 200);
    const staffNotes = staffRes.body.data;
    const hasStaffNote = staffNotes.some(n => n.visibility === 'staff_only');
    assert.ok(hasStaffNote, 'Staff actor must see staff_only notes');
  });

  // Task P1.2: Login pre-fill and personal identity string removal
  test('1.1.8 Login form starts empty and unauthenticated HTML shell contains no kirsty identity strings', async () => {
    const res = await request('/');
    assert.equal(res.status, 200);
    const html = res.rawBody || res.body;
    assert.ok(typeof html === 'string', 'Root must return HTML string');

    // Page source contains no 'kirsty' string
    assert.doesNotMatch(html, /kirsty/i, 'Publicly served index.html must not contain any kirsty identity strings');

    // Login input has no pre-filled value attribute and uses generic placeholder
    assert.doesNotMatch(html, /id="loginEmail"[^>]*value=/i, 'loginEmail must not contain a hardcoded value attribute');
    assert.match(html, /id="loginEmail"[^>]*placeholder="name@trinova\.co\.uk"/i, 'loginEmail must have generic placeholder');
  });
});
