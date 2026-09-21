/**
 * Automated Test Suite for Unit 06: Trinova Document-Signing Workflow Integration
 * Validates compliance with:
 * - context/specs/06-signing-integration.md
 * - context/04_backend_integration_context.md §10
 * - context/05_data_security_context.md §5, §6
 * - context/06_testing_deployment_context.md §7 (Signing Acceptance Tests)
 */

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import crypto from 'node:crypto';
import { createApp } from '../src/app.js';
import { mockDb } from '../src/data/db.js';
import { config } from '../src/config.js';
import { auditStore } from '../src/middleware/audit.js';

describe('Unit 06: Trinova Document-Signing Workflow Integration', () => {
  const TEST_PORT = 4994;
  let server;
  let baseUrl;

  const READWRITE_HEADER = {
    'Authorization': 'Bearer tn_sec_live_sloane_readwrite_2026',
    'Content-Type': 'application/json'
  };

  const READONLY_HEADER = {
    'Authorization': 'Bearer tn_sec_live_sloane_readonly_2026',
    'Content-Type': 'application/json'
  };

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

  function generateWebhookSignature(bodyString, secret = config.signing.webhookSecret) {
    return crypto.createHmac('sha256', secret).update(bodyString).digest('hex');
  }

  // =========================================================================
  // 1. Signing Request Creation Tests
  // =========================================================================

  test('Signing: POST /signing-requests creates request with secure invitation tokens', async () => {
    const idempotencyKey = crypto.randomUUID();
    const payload = {
      documentId: 'doc_woofington_draft_balance_sheet',
      title: 'Woofington Park 2025 Balance Sheet Approval',
      signers: [
        { name: 'Sarah Jenkins', email: 'sarah@woofingtonpark.co.uk', role: 'Director' },
        { name: 'Mark Jenkins', email: 'mark@woofingtonpark.co.uk', role: 'Director' }
      ]
    };

    const res = await request('/api/v1/companies/comp_woofington_park_01/signing-requests', {
      method: 'POST',
      headers: {
        ...READWRITE_HEADER,
        'Idempotency-Key': idempotencyKey
      },
      body: payload
    });

    assert.strictEqual(res.status, 201);
    assert.strictEqual(res.body.status, 'success');
    assert.strictEqual(res.body.data.status, 'PENDING');
    assert.strictEqual(res.body.data.signers.length, 2);
    assert.strictEqual(res.body.data.signers[0].status, 'PENDING');
    assert.ok(res.body.data.signers[0].invitationToken);
    assert.ok(res.body.data.signers[0].invitationUrl);
    assert.strictEqual(res.body.data.originalFilename, 'Woofington_Draft_Balance_Sheet_2025.pdf');
  });

  test('Signing: Rejects request targeting a non-original or signed document', async () => {
    // Inject mock signed document
    mockDb.documents.push({
      id: 'doc_already_signed_999',
      companyId: 'comp_woofington_park_01',
      filename: 'Already_Signed.pdf',
      isOriginal: false,
      isSigned: true
    });

    const res = await request('/api/v1/companies/comp_woofington_park_01/signing-requests', {
      method: 'POST',
      headers: {
        ...READWRITE_HEADER,
        'Idempotency-Key': crypto.randomUUID()
      },
      body: {
        documentId: 'doc_already_signed_999',
        signers: [{ name: 'Sarah Jenkins', email: 'sarah@woofington.co.uk' }]
      }
    });

    assert.strictEqual(res.status, 422);
    assert.strictEqual(res.body.error.code, 'INVALID_DOCUMENT_TARGET');
  });

  // =========================================================================
  // 2. Webhook Cryptographic Verification Tests
  // =========================================================================

  test('Webhook: Rejects forged or missing HMAC signature with 401 Unauthorized', async () => {
    const rawPayload = JSON.stringify({
      event: 'DOCUMENT_COMPLETED',
      data: { providerRequestId: 'documenso_req_123' }
    });

    // 1. Missing signature
    const resNoSig = await request('/api/v1/signing/webhooks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: rawPayload
    });
    assert.strictEqual(resNoSig.status, 401);
    assert.strictEqual(resNoSig.body.error.code, 'INVALID_WEBHOOK_SIGNATURE');

    // 2. Forged signature
    const resForged = await request('/api/v1/signing/webhooks', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Documenso-Signature': 'forged_hmac_signature_value_1234567890abcdef'
      },
      body: rawPayload
    });
    assert.strictEqual(resForged.status, 401);
    assert.strictEqual(resForged.body.error.code, 'INVALID_WEBHOOK_SIGNATURE');
  });

  // =========================================================================
  // 3. Webhook Lifecycle, Separate Storage & Idempotency Tests
  // =========================================================================

  test('Webhook: Processes RECIPIENT_SIGNED event and transitions request status', async () => {
    // Create new request to test against
    const createRes = await request('/api/v1/companies/comp_woofington_park_01/signing-requests', {
      method: 'POST',
      headers: {
        ...READWRITE_HEADER,
        'Idempotency-Key': crypto.randomUUID()
      },
      body: {
        documentId: 'doc_woofington_draft_balance_sheet',
        signers: [
          { name: 'Sarah Jenkins', email: 'sarah@woofingtonpark.co.uk' },
          { name: 'Mark Jenkins', email: 'mark@woofingtonpark.co.uk' }
        ]
      }
    });

    const signingReq = createRes.body.data;

    // Dispatch webhook for first signer
    const eventPayload = {
      eventId: `evt_${crypto.randomUUID()}`,
      event: 'RECIPIENT_SIGNED',
      data: {
        providerRequestId: signingReq.providerRequestId,
        recipientEmail: 'sarah@woofingtonpark.co.uk'
      }
    };
    const bodyStr = JSON.stringify(eventPayload);
    const signature = generateWebhookSignature(bodyStr);

    const webhookRes = await request('/api/v1/signing/webhooks', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Documenso-Signature': signature
      },
      body: bodyStr
    });

    assert.strictEqual(webhookRes.status, 200);
    assert.strictEqual(webhookRes.body.status, 'success');

    // Verify signing request progress in DB
    const updatedReq = mockDb.signingRequests.find(r => r.id === signingReq.id);
    assert.strictEqual(updatedReq.status, 'PARTIALLY_SIGNED');
    const sarah = updatedReq.signers.find(s => s.email === 'sarah@woofingtonpark.co.uk');
    assert.strictEqual(sarah.status, 'SIGNED');
    assert.ok(sarah.signedAt);
  });

  test('Webhook: DOCUMENT_COMPLETED stores signed PDF & audit certificate separately from original', async () => {
    // 1. Create fresh request
    const createRes = await request('/api/v1/companies/comp_woofington_park_01/signing-requests', {
      method: 'POST',
      headers: {
        ...READWRITE_HEADER,
        'Idempotency-Key': crypto.randomUUID()
      },
      body: {
        documentId: 'doc_woofington_draft_balance_sheet',
        signers: [{ name: 'Sarah Jenkins', email: 'sarah@woofingtonpark.co.uk' }]
      }
    });

    const signingReq = createRes.body.data;
    const originalDoc = mockDb.documents.find(d => d.id === signingReq.documentId);
    assert.strictEqual(originalDoc.isOriginal, true);
    const originalFilename = originalDoc.filename;

    // 2. Dispatch DOCUMENT_COMPLETED webhook
    const eventId = `evt_completed_${crypto.randomUUID()}`;
    const completePayload = {
      eventId,
      event: 'DOCUMENT_COMPLETED',
      data: {
        providerRequestId: signingReq.providerRequestId,
        signedPdfBuffer: Buffer.from('%PDF-1.4 COMPLETED SIGNED CONTENT EVIDENCE'),
        auditCertBuffer: Buffer.from('%PDF-1.4 COMPLETED AUDIT CERTIFICATE SHA-256')
      }
    };
    const bodyStr = JSON.stringify(completePayload);
    const signature = generateWebhookSignature(bodyStr);

    const webhookRes1 = await request('/api/v1/signing/webhooks', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Documenso-Signature': signature
      },
      body: bodyStr
    });

    assert.strictEqual(webhookRes1.status, 200);
    assert.strictEqual(webhookRes1.body.status, 'success');

    // 3. Verify separation of artifacts
    const completedReq = mockDb.signingRequests.find(r => r.id === signingReq.id);
    assert.strictEqual(completedReq.status, 'COMPLETED');
    assert.ok(completedReq.completedAt);
    assert.ok(completedReq.signedDocumentId);
    assert.ok(completedReq.auditCertificateId);

    // Verify original document is intact and NOT overwritten
    const checkOriginal = mockDb.documents.find(d => d.id === signingReq.documentId);
    assert.strictEqual(checkOriginal.filename, originalFilename);
    assert.strictEqual(checkOriginal.isOriginal, true);
    assert.notStrictEqual(checkOriginal.id, completedReq.signedDocumentId);

    // Verify signed document record
    const signedDoc = mockDb.documents.find(d => d.id === completedReq.signedDocumentId);
    assert.ok(signedDoc);
    assert.strictEqual(signedDoc.isOriginal, false);
    assert.strictEqual(signedDoc.isSigned, true);
    assert.ok(signedDoc.filename.startsWith('SIGNED_'));

    // Verify audit certificate record
    const certDoc = mockDb.documents.find(d => d.id === completedReq.auditCertificateId);
    assert.ok(certDoc);
    assert.strictEqual(certDoc.isAuditCertificate, true);
    assert.ok(certDoc.filename.startsWith('AUDIT_CERTIFICATE_'));

    // 4. Duplicate Webhook delivery is handled idempotently
    const webhookRes2 = await request('/api/v1/signing/webhooks', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Documenso-Signature': signature
      },
      body: bodyStr
    });

    assert.strictEqual(webhookRes2.status, 200);
    assert.strictEqual(webhookRes2.body.data.duplicate, true);
    assert.strictEqual(webhookRes2.body.data.status, 'ignored');
  });

  test('Webhook: Out-of-order completion safely marks all signers completed', async () => {
    // Create request with 2 pending signers
    const createRes = await request('/api/v1/companies/comp_alpha_delta_01/signing-requests', {
      method: 'POST',
      headers: {
        ...READWRITE_HEADER,
        'Idempotency-Key': crypto.randomUUID()
      },
      body: {
        documentId: 'doc_alpha_year_end_accounts',
        signers: [
          { name: 'Amanda Smith', email: 'amanda@alphadelta.co.uk' },
          { name: 'External Auditor', email: 'auditor@auditfirm.co.uk' }
        ]
      }
    });

    const signingReq = createRes.body.data;

    // Directly dispatch DOCUMENT_COMPLETED without prior RECIPIENT_SIGNED events
    const completePayload = {
      eventId: `evt_ooo_${crypto.randomUUID()}`,
      event: 'DOCUMENT_COMPLETED',
      data: {
        providerRequestId: signingReq.providerRequestId
      }
    };
    const bodyStr = JSON.stringify(completePayload);
    const signature = generateWebhookSignature(bodyStr);

    const webhookRes = await request('/api/v1/signing/webhooks', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Documenso-Signature': signature
      },
      body: bodyStr
    });

    assert.strictEqual(webhookRes.status, 200);

    const checkReq = mockDb.signingRequests.find(r => r.id === signingReq.id);
    assert.strictEqual(checkReq.status, 'COMPLETED');
    // Both signers safely marked completed
    assert.ok(checkReq.signers.every(s => s.status === 'SIGNED'));
  });

  // =========================================================================
  // 4. Download Endpoints & Audit Logging Tests
  // =========================================================================

  test('Downloads: Authorized pre-signed links generated for signed PDF and audit certificate', async () => {
    const completedReq = mockDb.signingRequests.find(r => r.status === 'COMPLETED' && r.signedDocumentId && r.auditCertificateId);
    assert.ok(completedReq, 'Completed signing request must exist from previous tests');

    // 1. Signed Document pre-signed token
    const signedTokenRes = await request(`/api/v1/signing-requests/${completedReq.id}/signed-document`, {
      headers: READONLY_HEADER
    });
    assert.strictEqual(signedTokenRes.status, 200);
    assert.ok(signedTokenRes.body.data.token);
    assert.ok(signedTokenRes.body.data.downloadUrl);

    // 2. Audit Certificate pre-signed token
    const certTokenRes = await request(`/api/v1/signing-requests/${completedReq.id}/audit-certificate`, {
      headers: READONLY_HEADER
    });
    assert.strictEqual(certTokenRes.status, 200);
    assert.ok(certTokenRes.body.data.token);
    assert.ok(certTokenRes.body.data.downloadUrl);
  });

  test('Audit: Signing events record audit entries', () => {
    const logs = auditStore.getLogs();

    const createLog = logs.find(l => l.action === 'signing_request_created');
    const webhookLog = logs.find(l => l.action === 'signing_webhook_processed');
    const signedTokenLog = logs.find(l => l.action === 'signed_document_download_token_generated');

    assert.ok(createLog, 'signing_request_created audit log must be recorded');
    assert.strictEqual(createLog.resourceType, 'signing_request');

    assert.ok(webhookLog, 'signing_webhook_processed audit log must be recorded');

    assert.ok(signedTokenLog, 'signed_document_download_token_generated audit log must be recorded');
  });
});
