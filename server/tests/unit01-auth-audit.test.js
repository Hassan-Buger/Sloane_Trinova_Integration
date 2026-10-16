/**
 * Automated Test Suite for Unit 01: Server-to-Server Auth & Audit Infrastructure
 * Uses Node.js native test runner (node:test).
 */

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createApp } from '../src/app.js';
import { auditStore } from '../src/middleware/audit.js';
import { sanitizeForLog } from '../src/middleware/sanitizer.js';
import { TEST_API_KEY, TEST_READONLY_KEY, TEST_REVOKED_KEY, TEST_EXPIRED_KEY } from './fixtures.js';

describe('Unit 01: Server-to-Server Auth & Audit Infrastructure', () => {
  let server;
  let baseUrl;
  const TEST_PORT = 4999;

  before(async () => {
    const app = createApp();
    await new Promise(resolve => {
      server = app.listen(TEST_PORT, () => {
        baseUrl = `http://localhost:${TEST_PORT}`;
        resolve();
      });
    });
  });

  after(async () => {
    await new Promise(resolve => server.close(resolve));
  });

  // Helper for HTTP requests
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

  test('Public endpoint: GET /api/v1/health succeeds without credentials', async () => {
    const res = await request('/api/v1/health');
    assert.equal(res.status, 200);
    assert.equal(res.body.status, 'ok');
    assert.equal(res.body.service, 'trinova-api-server');
  });

  test('Auth check: Missing authorization header returns 401 Unauthorized', async () => {
    const res = await request('/api/v1/auth/verify');
    assert.equal(res.status, 401);
    assert.equal(res.body.error.code, 'UNAUTHORIZED');
  });

  test('Auth check: Invalid Bearer credential returns 401 Unauthorized', async () => {
    const res = await request('/api/v1/auth/verify', {
      headers: {
        'Authorization': 'Bearer tn_sec_invalid_token_12345'
      }
    });
    assert.equal(res.status, 401);
    assert.equal(res.body.error.code, 'INVALID_CREDENTIALS');
  });

  test('Auth check: Revoked credential returns 401 with CREDENTIAL_REVOKED code', async () => {
    const res = await request('/api/v1/auth/verify', {
      headers: {
        'Authorization': `Bearer ${TEST_REVOKED_KEY}`
      }
    });
    assert.equal(res.status, 401);
    assert.equal(res.body.error.code, 'CREDENTIAL_REVOKED');
  });

  test('Auth check: Expired credential returns 401 with CREDENTIAL_EXPIRED code', async () => {
    const res = await request('/api/v1/auth/verify', {
      headers: {
        'Authorization': `Bearer ${TEST_EXPIRED_KEY}`
      }
    });
    assert.equal(res.status, 401);
    assert.equal(res.body.error.code, 'CREDENTIAL_EXPIRED');
  });

  test('Auth check: Valid Bearer token succeeds and resolves actor', async () => {
    const res = await request('/api/v1/auth/verify', {
      headers: {
        'Authorization': `Bearer ${TEST_API_KEY}`
      }
    });
    assert.equal(res.status, 200);
    assert.equal(res.body.status, 'authenticated');
    assert.equal(res.body.actor.actorId, 'actor_kirsty_allen');
    assert.ok(res.body.actor.scopes.includes('sloane:read'));
    assert.ok(res.body.actor.scopes.includes('sloane:write'));
  });

  test('Auth check: Valid X-Trinova-API-Key header succeeds', async () => {
    const res = await request('/api/v1/auth/verify', {
      headers: {
        'X-Trinova-API-Key': TEST_API_KEY
      }
    });
    assert.equal(res.status, 200);
    assert.equal(res.body.status, 'authenticated');
  });

  test('Scope authorization: Insufficient scope returns 403 Forbidden', async () => {
    // Read-only key attempting to hit write endpoint
    const res = await request('/api/v1/test/mutate', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${TEST_READONLY_KEY}`
      }
    });
    assert.equal(res.status, 403);
    assert.equal(res.body.error.code, 'FORBIDDEN');
    assert.match(res.body.error.message, /Required scope: 'sloane:write'/);
  });

  test('Scope authorization: Sufficient scope succeeds on mutation endpoint', async () => {
    const res = await request('/api/v1/test/mutate', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${TEST_API_KEY}`
      }
    });
    assert.equal(res.status, 201);
    assert.equal(res.body.status, 'success');
  });

  test('Audit logging: Records actor, action, status, and timestamp on API access', async () => {
    auditStore.clear();

    await request('/api/v1/test/mutate', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${TEST_API_KEY}`
      }
    });

    const logs = auditStore.getLogs();
    assert.ok(logs.length > 0, 'Audit log entry must be recorded');
    const latest = logs[0];

    assert.equal(latest.actorId, 'actor_kirsty_allen');
    assert.equal(latest.action, 'test_mutation_executed');
    assert.equal(latest.statusCode, 201);
    assert.ok(latest.timestamp, 'Timestamp must be recorded');
    assert.ok(!isNaN(Date.parse(latest.timestamp)), 'Timestamp must be valid ISO date');
  });

  test('Log sanitization: Sensitive fields and private notes are redacted', () => {
    const sensitivePayload = {
      user: 'Kirsty',
      authorization: 'Bearer secret_token_xyz',
      'x-trinova-api-key': 'secret_key_123',
      notes: 'Confidential CEO observation regarding Sarah Jenkins',
      brain: 'Private strategy discussion details',
      nested: {
        token: 'refresh_secret',
        cleanField: 'allowed'
      }
    };

    const sanitized = sanitizeForLog(sensitivePayload);

    assert.equal(sanitized.authorization, '[REDACTED]');
    assert.equal(sanitized['x-trinova-api-key'], '[REDACTED]');
    assert.equal(sanitized.notes, '[REDACTED]');
    assert.equal(sanitized.brain, '[REDACTED]');
    assert.equal(sanitized.nested.token, '[REDACTED]');
    assert.equal(sanitized.nested.cleanField, 'allowed');
  });
});
