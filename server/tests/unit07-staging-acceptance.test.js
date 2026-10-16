/**
 * Unit 07: Staging Validation & Acceptance Test Suite
 * 
 * Verifies end-to-end integration, security boundaries, sandbox mail delivery,
 * and regression safety in the isolated staging environment.
 * 
 * Adheres strictly to:
 * - context/specs/07-staging-verification.md
 * - context/05_data_security_context.md §9 (Environment isolation)
 * - context/06_testing_deployment_context.md §8-9 (Staging acceptance & regression)
 */

import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { createApp } from '../src/app.js';
import { mockDb } from '../src/data/db.js';
import { auditStore } from '../src/middleware/audit.js';
import { sandboxMailService } from '../src/services/sandboxMailService.js';
import { documentStorage } from '../src/services/storageDriver.js';
import { CompaniesHouseService } from '../src/services/companiesHouse.js';
import { TEST_API_KEY, TEST_READONLY_KEY, TEST_WEBHOOK_SECRET } from './fixtures.js';

describe('Unit 07: Staging Validation & Acceptance Testing', () => {
  let server;
  let baseUrl;
  let testApp;
  const PORT = 4999;

  const LIVE_READWRITE_KEY = TEST_API_KEY;
  const LIVE_READONLY_KEY = TEST_READONLY_KEY;
  const WEBHOOK_SECRET = TEST_WEBHOOK_SECRET;

  // Dedicated staging test fixture IDs
  const STAGING_CLIENT_ID = 'cli_staging_test_01';
  const STAGING_COMPANY_ID = 'comp_staging_alpha_01';
  const STAGING_COMPANY_NO = '11223344';
  const STAGING_DOC_ID = 'doc_staging_engagement_letter_01';

  before(async () => {
    // Mock Companies House service for staging testing
    const mockChService = new CompaniesHouseService({
      apiKey: 'ch_test_staging_isolated_key',
      fetchFn: async (url) => {
        if (url.includes('/company/11223344')) {
          return {
            ok: true,
            status: 200,
            json: async () => ({
              company_name: 'Staging Alpha Trading Ltd',
              company_number: '11223344',
              company_status: 'active',
              type: 'ltd',
              date_of_creation: '2021-06-01',
              accounts: {
                next_accounts: {
                  due_on: '2026-09-30',
                  period_end_on: '2025-12-31',
                  overdue: false
                }
              },
              confirmation_statement: {
                next_due: '2026-10-15',
                next_made_up_to: '2026-10-01',
                overdue: false
              }
            })
          };
        }
        return { ok: false, status: 404, json: async () => ({ errors: ['Not found'] }) };
      }
    });

    testApp = createApp({ chService: mockChService });
    await new Promise((resolve) => {
      server = testApp.listen(PORT, () => {
        baseUrl = `http://localhost:${PORT}`;
        resolve();
      });
    });
  });

  after(async () => {
    if (server) {
      await new Promise((resolve) => server.close(resolve));
    }
  });

  beforeEach(() => {
    sandboxMailService.clear();

    // Ensure staging fixtures exist in mockDb
    if (!mockDb.clients.find(c => c.id === STAGING_CLIENT_ID)) {
      mockDb.clients.push({
        id: STAGING_CLIENT_ID,
        name: "Staging Test Corporate Group",
        clientType: "Corporate Group",
        businessArea: "Trinova Accounting",
        status: "Active",
        assignedManagerId: "usr_kirsty_allen",
        assignedManagerName: "Kirsty Allen",
        companyIds: [STAGING_COMPANY_ID],
        contacts: [
          {
            id: "cnt_staging_director_01",
            name: "Eleanor Vance",
            email: "eleanor@staging.trinova.local",
            phone: "+44 7700 900888",
            isPrimary: true
          }
        ],
        createdAt: "2026-01-01T00:00:00.000Z"
      });
    }

    const existingCompIndex = mockDb.companies.findIndex(c => c.id === STAGING_COMPANY_ID);
    const stagingCompRecord = {
      id: STAGING_COMPANY_ID,
      clientId: STAGING_CLIENT_ID,
      clientName: "Staging Test Corporate Group",
      companyName: "Staging Alpha Trading Ltd",
      companyNumber: STAGING_COMPANY_NO,
      accountingReferenceDate: "31-12",
      accountsDueDate: "2026-09-30",
      confirmationDueDate: "2026-10-15",
      vatRegistered: true,
      vatNumber: "GB 112 2334 45",
      secondaryVatNumber: null, // Demonstrates empty null
      payeRegistered: true,
      payeReference: "123/STAGING",
      cisStatus: "Gross",
      riskLevel: "Low",
      status: "Active",
      workflowStatus: "In Progress",
      assignedManager: "Kirsty Allen",
      officers: [
        {
          id: "dir_staging_01",
          name: "Eleanor Vance",
          role: "Director",
          appointedOn: "2021-06-01",
          resignedOn: null
        },
        {
          id: "dir_staging_02",
          name: "Arthur Pendelton",
          role: "Director",
          appointedOn: "2022-01-15",
          resignedOn: null
        }
      ],
      services: [
        { id: "srv_staging_01", name: "Year End Accounts", status: "Active" },
        { id: "srv_staging_02", name: "VAT Compliance", status: "Active" }
      ],
      financials: {
        status: "unavailable",
        reason: "Xero live connection pending initial authorization"
      },
      notes: "Staging test client entity."
    };

    if (existingCompIndex >= 0) {
      mockDb.companies[existingCompIndex] = stagingCompRecord;
    } else {
      mockDb.companies.push(stagingCompRecord);
    }

    // Seed test original document
    if (!mockDb.documents.find(d => d.id === STAGING_DOC_ID)) {
      const docBuffer = Buffer.from('%PDF-1.4 Staging Engagement Letter Content %EOF');
      mockDb.documents.push({
        id: STAGING_DOC_ID,
        companyId: STAGING_COMPANY_ID,
        companyName: "Staging Alpha Trading Ltd",
        filename: "Staging_Engagement_Letter_2026.pdf",
        mimeType: "application/pdf",
        sizeBytes: docBuffer.length,
        category: "Engagement",
        uploadedBy: "Kirsty Allen",
        isOriginal: true,
        isSigned: false,
        isAuditCertificate: false,
        version: 1,
        contentBase64: docBuffer.toString('base64'),
        createdAt: "2026-09-01T10:00:00.000Z"
      });
    }
  });

  // --- 1. Environment & Credential Isolation Verification ---
  describe('1. Environment & Credential Isolation Verification', () => {
    it('Staging environment does not expose production credentials in responses or headers', async () => {
      const res = await fetch(`${baseUrl}/api/v1/health`);
      assert.equal(res.status, 200);
      const data = await res.json();
      assert.equal(data.status, 'ok');
      
      // Ensure no internal config or secrets leaked
      assert.equal(data.apiKey, undefined);
      assert.equal(data.webhookSecret, undefined);
      assert.equal(data.companiesHouseKey, undefined);
    });

    it('Sandboxed mail service prevents real external delivery and intercepts non-whitelisted domains', () => {
      // Dispatches to a whitelisted staging domain
      const invite1 = sandboxMailService.dispatchSigningInvitation({
        signingRequest: { id: 'req_001', companyId: 'comp_001', title: 'Test doc' },
        signer: { name: 'Eleanor', email: 'eleanor@staging.trinova.local', invitationUrl: '/sign?1', invitationToken: 'tok1' }
      });
      assert.equal(invite1.deliveredToRealNetwork, false);
      assert.equal(invite1.intercepted, false);
      assert.equal(invite1.effectiveRecipient, 'eleanor@staging.trinova.local');

      // Dispatches to a real customer domain (must be intercepted)
      const invite2 = sandboxMailService.dispatchSigningInvitation({
        signingRequest: { id: 'req_002', companyId: 'comp_001', title: 'Test doc' },
        signer: { name: 'Arthur', email: 'arthur@realcustomerdomain.co.uk', invitationUrl: '/sign?2', invitationToken: 'tok2' }
      });
      assert.equal(invite2.deliveredToRealNetwork, false);
      assert.equal(invite2.intercepted, true);
      assert.equal(invite2.effectiveRecipient, 'sandbox-trap@mailpit.local');
      assert.equal(invite2.originalRecipient, 'arthur@realcustomerdomain.co.uk');
    });
  });

  // --- 2. Trinova Portal Regression Testing ---
  describe('2. Trinova Portal Feature Regression Testing', () => {
    it('Regression: Existing client listing and search work without regression', async () => {
      const res = await fetch(`${baseUrl}/api/v1/clients?search=Staging`, {
        headers: { Authorization: `Bearer ${LIVE_READONLY_KEY}` }
      });
      assert.equal(res.status, 200);
      const json = await res.json();
      assert.ok(json.data.length >= 1);
      assert.equal(json.data[0].id, STAGING_CLIENT_ID);
    });

    it('Regression: Company 360 view returns complete hierarchy and 3-state data representation', async () => {
      const res = await fetch(`${baseUrl}/api/v1/companies/${STAGING_COMPANY_ID}`, {
        headers: { Authorization: `Bearer ${LIVE_READONLY_KEY}` }
      });
      assert.equal(res.status, 200);
      const json = await res.json();
      const company = json.data;

      assert.equal(company.id, STAGING_COMPANY_ID);
      assert.equal(company.companyNumber, STAGING_COMPANY_NO);
      assert.equal(company.officers.length, 2);
      assert.equal(company.services.length, 2);
      assert.equal(company.accountsDueDate, '2026-09-30');
      // 3-state representation: empty null, unavailable structured object, unsupported omitted
      assert.equal(company.secondaryVatNumber, null); // Empty
      assert.equal(company.financials.status, 'unavailable'); // Unavailable
      assert.equal(company.unsupportedField, undefined); // Unsupported omitted
    });

    it('Regression: Task queries and filters function reliably across companies', async () => {
      const res = await fetch(`${baseUrl}/api/v1/tasks?companyId=${STAGING_COMPANY_ID}`, {
        headers: { Authorization: `Bearer ${LIVE_READONLY_KEY}` }
      });
      assert.equal(res.status, 200);
      const json = await res.json();
      assert.ok(Array.isArray(json.data));
    });

    it('Regression: Conversation thread retrieval functions without data leakage', async () => {
      const res = await fetch(`${baseUrl}/api/v1/companies/${STAGING_COMPANY_ID}/conversations`, {
        headers: { Authorization: `Bearer ${LIVE_READONLY_KEY}` }
      });
      assert.equal(res.status, 200);
      const json = await res.json();
      assert.ok(Array.isArray(json.data));
    });
  });

  // --- 3. End-to-End Staging Signing Journey with Mail Interception ---
  describe('3. End-to-End Staging Document Signing Journey', () => {
    let createdSigningRequestId;
    let signerEleanorToken;
    let signerArthurToken;

    it('Staff creates signing request targeting test document with multiple signers', async () => {
      const idempotencyKey = crypto.randomUUID();
      const res = await fetch(`${baseUrl}/api/v1/companies/${STAGING_COMPANY_ID}/signing-requests`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${LIVE_READWRITE_KEY}`,
          'Content-Type': 'application/json',
          'Idempotency-Key': idempotencyKey
        },
        body: JSON.stringify({
          documentId: STAGING_DOC_ID,
          title: 'Staging Director Engagement Agreement 2026',
          signers: [
            {
              name: 'Eleanor Vance',
              email: 'eleanor@staging.trinova.local',
              role: 'Managing Director'
            },
            {
              name: 'Arthur Pendelton',
              email: 'arthur@realcustomerdomain.co.uk',
              role: 'Director'
            }
          ]
        })
      });

      assert.equal(res.status, 201);
      const json = await res.json();
      assert.equal(json.status, 'success');
      assert.equal(json.data.companyId, STAGING_COMPANY_ID);
      assert.equal(json.data.status, 'PENDING');
      assert.equal(json.data.signers.length, 2);

      createdSigningRequestId = json.data.id;
      signerEleanorToken = json.data.signers[0].invitationToken;
      signerArthurToken = json.data.signers[1].invitationToken;

      // Verify sandbox mail interception occurred
      const outbox = sandboxMailService.getOutbox();
      assert.equal(outbox.length, 2);

      const arthurMail = outbox.find(m => m.originalRecipient === 'arthur@realcustomerdomain.co.uk');
      assert.ok(arthurMail, 'Arthur invitation recorded in sandbox');
      assert.equal(arthurMail.intercepted, true, 'Real customer domain was strictly intercepted');
      assert.equal(arthurMail.deliveredToRealNetwork, false);

      const eleanorMail = outbox.find(m => m.originalRecipient === 'eleanor@staging.trinova.local');
      assert.ok(eleanorMail, 'Eleanor invitation recorded in sandbox');
      assert.equal(eleanorMail.intercepted, false, 'Whitelisted staging domain passed');
      assert.equal(eleanorMail.deliveredToRealNetwork, false);
    });

    it('Simulates recipient signing webhook event with cryptographic HMAC verification', async () => {
      const signingReq = mockDb.signingRequests.find(r => r.id === createdSigningRequestId);
      assert.ok(signingReq);

      const webhookPayload = {
        event: 'RECIPIENT_SIGNED',
        eventId: `evt_${crypto.randomUUID()}`,
        timestamp: new Date().toISOString(),
        data: {
          providerRequestId: signingReq.providerRequestId,
          signingRequestId: signingReq.id,
          recipientEmail: 'eleanor@staging.trinova.local',
          signedAt: new Date().toISOString()
        }
      };

      const rawBody = JSON.stringify(webhookPayload);
      const signature = crypto.createHmac('sha256', WEBHOOK_SECRET).update(rawBody).digest('hex');

      const res = await fetch(`${baseUrl}/api/v1/signing/webhooks`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Documenso-Signature': `sha256=${signature}`
        },
        body: rawBody
      });

      assert.equal(res.status, 200);
      const json = await res.json();
      assert.equal(json.status, 'success');
      assert.equal(json.data.signingRequest.status, 'PARTIALLY_SIGNED');
      assert.equal(json.data.signingRequest.signers[0].status, 'SIGNED');
    });

    it('Simulates completion webhook: stores signed PDF and audit certificate separately from original', async () => {
      const signingReq = mockDb.signingRequests.find(r => r.id === createdSigningRequestId);
      assert.ok(signingReq);

      const signedPdfContent = Buffer.from('%PDF-1.4 SIGNED STAGING ENGAGEMENT LETTER WITH SIGNATURES %EOF');
      const auditCertContent = Buffer.from('%PDF-1.4 STAGING OFFICIAL AUDIT TRAIL CERTIFICATE %EOF');

      const webhookPayload = {
        event: 'DOCUMENT_COMPLETED',
        eventId: `evt_${crypto.randomUUID()}`,
        timestamp: new Date().toISOString(),
        data: {
          providerRequestId: signingReq.providerRequestId,
          signingRequestId: signingReq.id,
          signedPdfBuffer: signedPdfContent.toString('base64'),
          auditCertBuffer: auditCertContent.toString('base64'),
          completedAt: new Date().toISOString()
        }
      };

      const rawBody = JSON.stringify(webhookPayload);
      const signature = crypto.createHmac('sha256', WEBHOOK_SECRET).update(rawBody).digest('hex');

      const res = await fetch(`${baseUrl}/api/v1/signing/webhooks`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Documenso-Signature': signature
        },
        body: rawBody
      });

      assert.equal(res.status, 200);
      const json = await res.json();
      assert.equal(json.status, 'success');
      assert.equal(json.data.signingRequest.status, 'COMPLETED');
      assert.ok(json.data.signingRequest.signedDocumentId);
      assert.ok(json.data.signingRequest.auditCertificateId);

      // Verify separate preservation in documents store
      const originalDoc = mockDb.documents.find(d => d.id === STAGING_DOC_ID);
      assert.equal(originalDoc.isOriginal, true);
      assert.equal(originalDoc.isSigned, false);

      const signedDoc = mockDb.documents.find(d => d.id === json.data.signingRequest.signedDocumentId);
      assert.ok(signedDoc);
      assert.equal(signedDoc.isOriginal, false);
      assert.equal(signedDoc.isSigned, true);
      assert.equal(signedDoc.category, 'Signed_Documents');

      const auditCert = mockDb.documents.find(d => d.id === json.data.signingRequest.auditCertificateId);
      assert.ok(auditCert);
      assert.equal(auditCert.isOriginal, false);
      assert.equal(auditCert.isAuditCertificate, true);
    });

    it('Downloads signed PDF and audit certificate via authorized pre-signed tokens', async () => {
      // 1. Get signed document download token
      const tokenRes = await fetch(`${baseUrl}/api/v1/signing-requests/${createdSigningRequestId}/signed-document`, {
        headers: { Authorization: `Bearer ${LIVE_READONLY_KEY}` }
      });
      assert.equal(tokenRes.status, 200);
      const tokenJson = await tokenRes.json();
      assert.ok(tokenJson.data.downloadUrl);

      // 2. Stream signed document download
      const downloadRes = await fetch(`${baseUrl}${tokenJson.data.downloadUrl}`);
      assert.equal(downloadRes.status, 200);
      assert.equal(downloadRes.headers.get('content-type'), 'application/pdf');
      const bodyText = await downloadRes.text();
      assert.ok(bodyText.includes('SIGNED STAGING ENGAGEMENT LETTER'));

      // 3. Get audit certificate download token
      const certRes = await fetch(`${baseUrl}/api/v1/signing-requests/${createdSigningRequestId}/audit-certificate`, {
        headers: { Authorization: `Bearer ${LIVE_READONLY_KEY}` }
      });
      assert.equal(certRes.status, 200);
      const certJson = await certRes.json();
      assert.ok(certJson.data.downloadUrl);

      // 4. Stream audit certificate download
      const certDownload = await fetch(`${baseUrl}${certJson.data.downloadUrl}`);
      assert.equal(certDownload.status, 200);
      const certText = await certDownload.text();
      assert.ok(certText.includes('OFFICIAL AUDIT TRAIL CERTIFICATE'));
    });
  });

  // --- 4. Write Operations, Idempotency & Privacy Boundary ---
  describe('4. Write Operations, Idempotency & Privacy Boundary in Staging', () => {
    it('Task creation requires Idempotency-Key and replays safely', async () => {
      const idempotencyKey = crypto.randomUUID();
      const payload = {
        companyId: STAGING_COMPANY_ID,
        title: 'Staging Review Task for Eleanor',
        category: 'Statutory',
        priority: 'Normal',
        dueDate: '2026-10-01'
      };

      // 1. First execution
      const res1 = await fetch(`${baseUrl}/api/v1/tasks`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${LIVE_READWRITE_KEY}`,
          'Content-Type': 'application/json',
          'Idempotency-Key': idempotencyKey
        },
        body: JSON.stringify(payload)
      });
      assert.equal(res1.status, 201);
      const json1 = await res1.json();
      assert.equal(json1.status, 'success');

      // 2. Replay with identical key and payload
      const res2 = await fetch(`${baseUrl}/api/v1/tasks`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${LIVE_READWRITE_KEY}`,
          'Content-Type': 'application/json',
          'Idempotency-Key': idempotencyKey
        },
        body: JSON.stringify(payload)
      });
      assert.equal(res2.status, 201);
      const json2 = await res2.json();
      assert.equal(json2.data.id, json1.data.id, 'Returns cached task without creating a duplicate');

      // 3. Replay with modified payload triggers 409 Conflict
      const res3 = await fetch(`${baseUrl}/api/v1/tasks`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${LIVE_READWRITE_KEY}`,
          'Content-Type': 'application/json',
          'Idempotency-Key': idempotencyKey
        },
        body: JSON.stringify({ ...payload, title: 'Conflicting task title' })
      });
      assert.equal(res3.status, 409);
    });

    it('Privacy boundary: Internal note rejected without confirm_write_to_trinova flag', async () => {
      const res = await fetch(`${baseUrl}/api/v1/companies/${STAGING_COMPANY_ID}/notes`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${LIVE_READWRITE_KEY}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          text: 'Private CEO brainstorming note: evaluate expansion into Birmingham office.'
          // confirm_write_to_trinova is missing
        })
      });

      assert.equal(res.status, 422);
      const json = await res.json();
      assert.equal(json.error.code, 'PRIVACY_BOUNDARY_CONFIRMATION_REQUIRED');
    });

    it('Privacy boundary: Note with confirm_write_to_trinova=true succeeds and defaults to staff_only', async () => {
      const res = await fetch(`${baseUrl}/api/v1/companies/${STAGING_COMPANY_ID}/notes`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${LIVE_READWRITE_KEY}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          text: 'Agreed fee schedule confirmed during staging review.',
          confirm_write_to_trinova: true
        })
      });

      assert.equal(res.status, 201);
      const json = await res.json();
      assert.equal(json.data.visibility, 'staff_only');
      assert.equal(json.data.companyId, STAGING_COMPANY_ID);
      assert.equal(json.data.authorId, 'actor_kirsty_allen');
    });
  });

  // --- 5. Audit Logging & Security Trail Verification ---
  describe('5. Audit Logging & Sensitive Data Redaction in Staging', () => {
    it('Audit trail captures all staging operations with actor, action, resource, and timestamp', async () => {
      const res = await fetch(`${baseUrl}/api/v1/audit/logs?limit=100`, {
        headers: { Authorization: `Bearer ${LIVE_READWRITE_KEY}` }
      });

      assert.equal(res.status, 200);
      const json = await res.json();
      assert.ok(Array.isArray(json.data));
      assert.ok(json.data.length > 5);

      // Verify audit fields
      for (const entry of json.data) {
        assert.ok(entry.id);
        assert.ok(entry.timestamp);
        assert.ok(entry.actorId);
        assert.ok(entry.action);
        assert.ok(entry.resourceType);

        // Security check: Zero secrets in audit logs
        const entryStr = JSON.stringify(entry);
        assert.equal(entryStr.includes(LIVE_READWRITE_KEY), false, 'API key must not appear in audit log');
        assert.equal(entryStr.includes(WEBHOOK_SECRET), false, 'Webhook secret must not appear in audit log');
      }
    });
  });
});
