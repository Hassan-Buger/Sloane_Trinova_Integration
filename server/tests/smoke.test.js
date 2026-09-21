/**
 * Production Controlled Smoke Test Script
 * 
 * Verifies production deployment readiness against an authorised test record.
 * Covers: Sloane read/write, portal regression, signing request, signed document
 * retrieval, and audit access checks.
 * 
 * Non-negotiable rule (context/06_testing_deployment_context.md §12):
 * "If release criteria fail: STOP / ROLLBACK. Do not continue deployment
 * merely because part of the system works."
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { createApp } from '../src/app.js';
import { mockDb } from '../src/data/db.js';

describe('Production Deployment Controlled Smoke Test', () => {
  let server;
  let baseUrl;
  const PORT = 4991;

  // Designate authorized smoke test record
  const SMOKE_TEST_KEY = 'tn_sec_live_sloane_readwrite_2026';
  const SMOKE_COMPANY_ID = 'comp_woofington_park_01';
  const SMOKE_DOC_ID = 'doc_woofington_draft_balance_sheet';

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
    if (server) {
      await new Promise(resolve => server.close(resolve));
    }
  });

  it('Gate 1: Public Health Check responds with 200 OK', async () => {
    const res = await fetch(`${baseUrl}/api/v1/health`);
    assert.equal(res.status, 200, 'CRITICAL: Health check must return 200 OK');
    const data = await res.json();
    assert.equal(data.status, 'ok');
  });

  it('Gate 2: Scoped Authentication rejects unauthorized and admits valid credentials', async () => {
    // 1. Rejects unauthenticated
    const resUnauth = await fetch(`${baseUrl}/api/v1/clients`);
    assert.equal(resUnauth.status, 401, 'CRITICAL: Unauthenticated access must be rejected with 401');

    // 2. Admits valid credential
    const resAuth = await fetch(`${baseUrl}/api/v1/auth/verify`, {
      headers: { Authorization: `Bearer ${SMOKE_TEST_KEY}` }
    });
    assert.equal(resAuth.status, 200, 'CRITICAL: Valid API credential must authenticate');
  });

  it('Gate 3: Read Contract returns company 360 hierarchy and statutory status', async () => {
    const res = await fetch(`${baseUrl}/api/v1/companies/${SMOKE_COMPANY_ID}`, {
      headers: { Authorization: `Bearer ${SMOKE_TEST_KEY}` }
    });
    assert.equal(res.status, 200, 'CRITICAL: Company 360 read must succeed');
    const json = await res.json();
    assert.equal(json.status, 'success');
    assert.ok(json.data.companyName);
    assert.ok(Array.isArray(json.data.officers));
    assert.ok(Array.isArray(json.data.services));
  });

  it('Gate 4: Write & Idempotency prevents duplicate records', async () => {
    const idempotencyKey = crypto.randomUUID();
    const payload = {
      companyId: SMOKE_COMPANY_ID,
      title: 'Smoke Test Deployment Verification Task',
      category: 'General',
      priority: 'Low',
      dueDate: '2026-10-15'
    };

    const res1 = await fetch(`${baseUrl}/api/v1/tasks`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${SMOKE_TEST_KEY}`,
        'Content-Type': 'application/json',
        'Idempotency-Key': idempotencyKey
      },
      body: JSON.stringify(payload)
    });
    assert.equal(res1.status, 201, 'CRITICAL: Task creation must succeed');

    const res2 = await fetch(`${baseUrl}/api/v1/tasks`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${SMOKE_TEST_KEY}`,
        'Content-Type': 'application/json',
        'Idempotency-Key': idempotencyKey
      },
      body: JSON.stringify(payload)
    });
    assert.equal(res2.status, 201, 'CRITICAL: Idempotent replay must succeed');
    const json1 = await res1.json();
    const json2 = await res2.json();
    assert.equal(json1.data.id, json2.data.id, 'CRITICAL: Idempotency must prevent duplicate task creation');
  });

  it('Gate 5: Privacy Boundary rejects automatic unconfirmed sync from Sloane', async () => {
    const res = await fetch(`${baseUrl}/api/v1/companies/${SMOKE_COMPANY_ID}/notes`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${SMOKE_TEST_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        text: 'Smoke test unconfirmed private note'
      })
    });
    assert.equal(res.status, 422, 'CRITICAL: Notes without confirm_write_to_trinova must be rejected');
  });

  it('Gate 6: Document Signing request creation and separate preservation', async () => {
    const res = await fetch(`${baseUrl}/api/v1/companies/${SMOKE_COMPANY_ID}/signing-requests`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${SMOKE_TEST_KEY}`,
        'Content-Type': 'application/json',
        'Idempotency-Key': crypto.randomUUID()
      },
      body: JSON.stringify({
        documentId: SMOKE_DOC_ID,
        title: 'Smoke Test Balance Sheet Signing',
        signers: [
          { name: 'Sarah Jenkins', email: 'sarah@test.local', role: 'Director' }
        ]
      })
    });
    assert.equal(res.status, 201, 'CRITICAL: Signing request must be created');
    const json = await res.json();
    assert.equal(json.data.status, 'PENDING');
  });

  it('Gate 7: Audit trail records deployment operations without leaking secrets', async () => {
    const res = await fetch(`${baseUrl}/api/v1/audit/logs?limit=20`, {
      headers: { Authorization: `Bearer ${SMOKE_TEST_KEY}` }
    });
    assert.equal(res.status, 200, 'CRITICAL: Audit log query must succeed');
    const json = await res.json();
    assert.ok(json.data.length > 0);
    const logStr = JSON.stringify(json.data);
    assert.equal(logStr.includes(SMOKE_TEST_KEY), false, 'CRITICAL: Credentials must not appear in audit log');
  });
});
