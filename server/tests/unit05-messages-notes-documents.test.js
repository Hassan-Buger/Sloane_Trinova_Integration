/**
 * Automated Test Suite for Unit 05: Messages, Internal Notes & Document Management API
 * Validates compliance with:
 * - context/specs/05-messages-notes-documents.md
 * - context/04_backend_integration_context.md §4–5, §7
 * - context/05_data_security_context.md §2, §5, §6
 * - context/06_testing_deployment_context.md §4 & §5
 */

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import crypto from 'node:crypto';
import { createApp } from '../src/app.js';
import { mockDb } from '../src/data/db.js';
import { auditStore } from '../src/middleware/audit.js';

describe('Unit 05: Messages, Internal Notes & Document Management API', () => {
  const TEST_PORT = 4995;
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

  // =========================================================================
  // 1. Messages & Conversations Tests
  // =========================================================================

  test('Messages: GET /api/v1/companies/:id/conversations returns thread list', async () => {
    const res = await request('/api/v1/companies/comp_woofington_park_01/conversations', { headers: READONLY_HEADER });
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.status, 'success');
    assert.ok(Array.isArray(res.body.data));
    assert.ok(res.body.data.length >= 1);
    assert.strictEqual(res.body.data[0].id, 'conv_woofington_emergency');
  });

  test('Messages: GET /api/v1/conversations/:id/messages returns chronological stream', async () => {
    const res = await request('/api/v1/conversations/conv_woofington_emergency/messages', { headers: READONLY_HEADER });
    assert.strictEqual(res.status, 200);
    assert.ok(Array.isArray(res.body.data));
    assert.strictEqual(res.body.data.length, 2);
    assert.strictEqual(res.body.data[0].id, 'msg_woof_01');
    assert.strictEqual(res.body.data[1].id, 'msg_woof_02');
  });

  test('Messages: POST /conversations/:id/messages enforces Idempotency-Key and prevents duplicates', async () => {
    const key = crypto.randomUUID();
    const payload = {
      body: 'Formal strike-off objection has been submitted to Companies House.'
    };

    const initialCount = (mockDb.messages || []).length;

    // First attempt -> message created
    const res1 = await request('/api/v1/conversations/conv_woofington_emergency/messages', {
      method: 'POST',
      headers: {
        ...READWRITE_HEADER,
        'Idempotency-Key': key
      },
      body: payload
    });

    assert.strictEqual(res1.status, 201);
    assert.strictEqual(res1.body.status, 'success');
    assert.strictEqual(res1.body.data.body, payload.body);
    const msgId = res1.body.data.id;
    assert.strictEqual((mockDb.messages || []).length, initialCount + 1);

    // Second attempt with same Idempotency-Key -> returns identical cached message
    const res2 = await request('/api/v1/conversations/conv_woofington_emergency/messages', {
      method: 'POST',
      headers: {
        ...READWRITE_HEADER,
        'Idempotency-Key': key
      },
      body: payload
    });

    assert.strictEqual(res2.status, 201);
    assert.strictEqual(res2.headers['x-cache-lookup'], 'HIT (Idempotent replay)');
    assert.strictEqual(res2.body.data.id, msgId);
    assert.strictEqual((mockDb.messages || []).length, initialCount + 1, 'No duplicate message created');
  });

  // =========================================================================
  // 2. Privacy Boundary & Internal Notes Tests
  // =========================================================================

  test('Privacy Boundary: POST /notes without explicit confirmation flag is rejected with 422', async () => {
    // Omits confirm_write_to_trinova
    const res = await request('/api/v1/companies/comp_woofington_park_01/notes', {
      method: 'POST',
      headers: READWRITE_HEADER,
      body: {
        text: 'Private thought that should not automatically sync.'
      }
    });

    assert.strictEqual(res.status, 422);
    assert.strictEqual(res.body.error.code, 'PRIVACY_BOUNDARY_CONFIRMATION_REQUIRED');
    assert.ok(res.body.error.message.includes('confirm_write_to_trinova: true'));
  });

  test('Privacy Boundary: POST /notes with explicit confirmation succeeds and defaults to staff_only', async () => {
    const res = await request('/api/v1/companies/comp_woofington_park_01/notes', {
      method: 'POST',
      headers: READWRITE_HEADER,
      body: {
        text: 'Agreed fee structure for emergency defense.',
        confirm_write_to_trinova: true
        // visibility omitted -> must default to staff_only
      }
    });

    assert.strictEqual(res.status, 201);
    assert.strictEqual(res.body.status, 'success');
    assert.strictEqual(res.body.data.visibility, 'staff_only');
    assert.strictEqual(res.body.data.explicitConfirmation, true);
    assert.strictEqual(res.body.data.authorName, 'Kirsty Allen (CEO Command Centre)');
  });

  test('Notes: Rejects invalid visibility values', async () => {
    const res = await request('/api/v1/companies/comp_woofington_park_01/notes', {
      method: 'POST',
      headers: READWRITE_HEADER,
      body: {
        text: 'Test note',
        confirm_write_to_trinova: true,
        visibility: 'public_broadcast' // Invalid
      }
    });

    assert.strictEqual(res.status, 422);
    assert.strictEqual(res.body.error.code, 'INVALID_VISIBILITY');
  });

  // =========================================================================
  // 3. Document Management & Upload Tests
  // =========================================================================

  test('Documents: Upload rejects disallowed file extensions (.exe / script)', async () => {
    const res = await request('/api/v1/companies/comp_woofington_park_01/documents/upload', {
      method: 'POST',
      headers: {
        ...READWRITE_HEADER,
        'Idempotency-Key': crypto.randomUUID()
      },
      body: {
        filename: 'malicious_payload.exe',
        mimeType: 'application/octet-stream',
        content: 'binary_content_here'
      }
    });

    assert.strictEqual(res.status, 422);
    assert.strictEqual(res.body.error.code, 'DISALLOWED_FILE_TYPE');
  });

  test('Documents: Upload rejects file exceeding 15MB size limit', async () => {
    // 16MB string
    const largeBuffer = Buffer.alloc(16 * 1024 * 1024, 'a');

    const res = await request('/api/v1/companies/comp_woofington_park_01/documents/upload', {
      method: 'POST',
      headers: {
        ...READWRITE_HEADER,
        'Idempotency-Key': crypto.randomUUID()
      },
      body: {
        filename: 'oversized_scan.pdf',
        mimeType: 'application/pdf',
        contentBase64: largeBuffer.toString('base64')
      }
    });

    assert.strictEqual(res.status, 422);
    assert.strictEqual(res.body.error.code, 'FILE_TOO_LARGE');
  });

  test('Documents: Uploads valid PDF with Idempotency-Key and preserves original flag', async () => {
    const key = crypto.randomUUID();
    const pdfContent = Buffer.from('%PDF-1.4 sample pdf content for test');

    const uploadPayload = {
      filename: 'Signed_Objection_Notice_2026.pdf',
      mimeType: 'application/pdf',
      contentBase64: pdfContent.toString('base64'),
      category: 'Statutory_Filings'
    };

    const initialDocs = (mockDb.documents || []).length;

    const res1 = await request('/api/v1/companies/comp_woofington_park_01/documents/upload', {
      method: 'POST',
      headers: {
        ...READWRITE_HEADER,
        'Idempotency-Key': key
      },
      body: uploadPayload
    });

    assert.strictEqual(res1.status, 201);
    assert.strictEqual(res1.body.status, 'success');
    assert.strictEqual(res1.body.data.filename, 'Signed_Objection_Notice_2026.pdf');
    assert.strictEqual(res1.body.data.isOriginal, true);
    assert.strictEqual(res1.body.data.version, 1);
    const docId = res1.body.data.id;
    assert.strictEqual((mockDb.documents || []).length, initialDocs + 1);

    // Replay upload with same key -> returns original document metadata
    const res2 = await request('/api/v1/companies/comp_woofington_park_01/documents/upload', {
      method: 'POST',
      headers: {
        ...READWRITE_HEADER,
        'Idempotency-Key': key
      },
      body: uploadPayload
    });

    assert.strictEqual(res2.status, 201);
    assert.strictEqual(res2.headers['x-cache-lookup'], 'HIT (Idempotent replay)');
    assert.strictEqual(res2.body.data.id, docId);
    assert.strictEqual((mockDb.documents || []).length, initialDocs + 1);
  });

  // =========================================================================
  // 4. Authorized Document Download & Presigned Tokens
  // =========================================================================

  test('Documents: Generates pre-signed download token and downloads binary file', async () => {
    // 1. First upload a document so we have a physical file on disk
    const pdfBuffer = Buffer.from('%PDF-1.4 live binary document stream verification');
    const uploadRes = await request('/api/v1/companies/comp_alpha_delta_01/documents/upload', {
      method: 'POST',
      headers: {
        ...READWRITE_HEADER,
        'Idempotency-Key': crypto.randomUUID()
      },
      body: {
        filename: 'Alpha_Delta_Accounts_Signed.pdf',
        mimeType: 'application/pdf',
        contentBase64: pdfBuffer.toString('base64')
      }
    });

    const docId = uploadRes.body.data.id;

    // 2. Request pre-signed download token
    const tokenRes = await request(`/api/v1/documents/${docId}/download-token`, {
      headers: READONLY_HEADER
    });

    assert.strictEqual(tokenRes.status, 200);
    assert.ok(tokenRes.body.data.token);
    assert.ok(tokenRes.body.data.downloadUrl);

    // 3. Perform download using valid token without headers
    const downloadRes = await request(tokenRes.body.data.downloadUrl);
    assert.strictEqual(downloadRes.status, 200);
    assert.strictEqual(downloadRes.headers['content-type'], 'application/pdf');
    assert.strictEqual(downloadRes.body, pdfBuffer.toString('utf8'));
  });

  test('Documents: Download rejects missing or forged pre-signed token', async () => {
    // Missing token
    const noToken = await request('/api/v1/documents/download');
    assert.strictEqual(noToken.status, 401);

    // Tampered token
    const badToken = await request('/api/v1/documents/download?token=forged_token_value_xyz');
    assert.strictEqual(badToken.status, 403);
  });

  // =========================================================================
  // 5. Audit Logging Verification
  // =========================================================================

  test('Audit: Message, note, and document operations are captured in audit log', () => {
    const logs = auditStore.getLogs();

    const msgLog = logs.find(l => l.action === 'portal_message_sent');
    const noteLog = logs.find(l => l.action === 'internal_note_created');
    const uploadLog = logs.find(l => l.action === 'document_uploaded');
    const presignedLog = logs.find(l => l.action === 'document_presigned_url_generated');

    assert.ok(msgLog, 'portal_message_sent audit log must be recorded');
    assert.ok(noteLog, 'internal_note_created audit log must be recorded');
    assert.ok(uploadLog, 'document_uploaded audit log must be recorded');
    assert.ok(presignedLog, 'document_presigned_url_generated audit log must be recorded');
  });
});
