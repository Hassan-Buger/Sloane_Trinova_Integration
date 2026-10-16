/**
 * Trinova Document Signing REST & Webhook API Routes
 * Implements signing request orchestration, secure HMAC webhook ingestion,
 * and authorized download endpoints for signed PDFs and audit certificates.
 *
 * Adheres strictly to:
 * - context/04_backend_integration_context.md §10
 * - context/05_data_security_context.md §5, §6
 * - context/signing-provider-evaluation.md
 * - context/specs/06-signing-integration.md
 */

import { mockDb } from '../data/db.js';
import { requireIdempotency } from '../middleware/idempotency.js';
import { signingService } from '../services/signingService.js';
import { documentStorage } from '../services/storageDriver.js';

export function registerSigningRoutes(app, { authenticate, requireScope }) {
  /**
   * GET /api/v1/companies/:companyId/signing-requests
   * Reads all signing requests for a company.
   */
  app.get('/api/v1/companies/:companyId/signing-requests', authenticate, requireScope('sloane:read'), (req, res) => {
    const { companyId } = req.params;
    req.auditAction = 'read_company_signing_requests';
    req.resourceType = 'signing_request';
    req.resourceId = companyId;

    const company = (mockDb.companies || []).find(c => c.id === companyId);
    if (!company) {
      return res.status(404).json({
        error: {
          code: 'COMPANY_NOT_FOUND',
          message: `Company with ID '${companyId}' not found.`
        }
      });
    }

    const requests = (mockDb.signingRequests || []).filter(r => r.companyId === companyId);

    res.status(200).json({
      status: 'success',
      data: requests,
      meta: {
        companyId,
        companyName: company.companyName,
        total: requests.length
      }
    });
  });

  /**
   * GET /api/v1/signing-requests/:id
   * Reads details of a single signing request.
   */
  app.get('/api/v1/signing-requests/:id', authenticate, requireScope('sloane:read'), (req, res) => {
    const { id } = req.params;
    req.auditAction = 'read_signing_request_detail';
    req.resourceType = 'signing_request';
    req.resourceId = id;

    const signingReq = (mockDb.signingRequests || []).find(r => r.id === id);
    if (!signingReq) {
      return res.status(404).json({
        error: {
          code: 'SIGNING_REQUEST_NOT_FOUND',
          message: `Signing request with ID '${id}' not found.`
        }
      });
    }

    res.status(200).json({
      status: 'success',
      data: signingReq
    });
  });

  /**
   * POST /api/v1/companies/:companyId/signing-requests
   * Creates a new signing request with mandatory Idempotency-Key and actor attribution.
   */
  app.post('/api/v1/companies/:companyId/signing-requests', authenticate, requireScope('sloane:write'), requireIdempotency, (req, res) => {
    const { companyId } = req.params;

    try {
      const signingRequest = signingService.createSigningRequest({
        companyId,
        documentId: req.body?.documentId,
        title: req.body?.title,
        signers: req.body?.signers,
        expiresAt: req.body?.expiresAt,
        requestedBy: req.actor
      });

      req.auditAction = 'signing_request_created';
      req.resourceType = 'signing_request';
      req.resourceId = signingRequest.id;

      res.status(201).json({
        status: 'success',
        message: 'Signing request successfully created and invitation tokens generated.',
        data: signingRequest
      });
    } catch (err) {
      return res.status(err.status || 422).json({
        error: {
          code: err.code || 'SIGNING_REQUEST_FAILED',
          message: err.message
        }
      });
    }
  });

  /**
   * POST /api/v1/signing/webhooks
   * Webhook ingestion endpoint for Documenso signatures.
   * Cryptographically verifies HMAC-SHA256 signature and handles events idempotently.
   */
  app.post('/api/v1/signing/webhooks', (req, res) => {
    const signatureHeader = req.headers['x-documenso-signature'];
    const rawBody = req.rawBody || JSON.stringify(req.body || {});

    // Cryptographic HMAC verification (Section 1.5)
    const isSignatureValid = signingService.verifyWebhookSignature(rawBody, signatureHeader);
    if (!isSignatureValid) {
      return res.status(401).json({
        error: {
          code: 'INVALID_WEBHOOK_SIGNATURE',
          message: 'Webhook signature verification failed. The signature does not match the configured signing secret.'
        }
      });
    }

    try {
      const result = signingService.handleWebhookEvent(req.body);

      req.auditAction = 'signing_webhook_processed';
      req.resourceType = 'signing_request';
      req.resourceId = req.body?.data?.providerRequestId || req.body?.data?.documentId;

      res.status(200).json({
        status: 'success',
        message: `Webhook event '${req.body?.event}' processed successfully.`,
        data: result
      });
    } catch (err) {
      return res.status(err.status || 422).json({
        error: {
          code: err.code || 'WEBHOOK_PROCESSING_FAILED',
          message: err.message
        }
      });
    }
  });

  /**
   * GET /api/v1/signing-requests/:id/signed-document
   * Generates a pre-signed token to download the completed signed PDF.
   */
  app.get('/api/v1/signing-requests/:id/signed-document', authenticate, requireScope('sloane:read'), (req, res) => {
    const { id } = req.params;

    const signingReq = (mockDb.signingRequests || []).find(r => r.id === id);
    if (!signingReq) {
      return res.status(404).json({
        error: {
          code: 'SIGNING_REQUEST_NOT_FOUND',
          message: `Signing request with ID '${id}' not found.`
        }
      });
    }

    if (signingReq.status !== 'COMPLETED' || !signingReq.signedDocumentId) {
      return res.status(400).json({
        error: {
          code: 'SIGNED_DOCUMENT_NOT_READY',
          message: `Signing request '${id}' is in status '${signingReq.status}'. Signed document is only available once fully completed.`
        }
      });
    }

    const { token, expiresAt } = documentStorage.generatePresignedToken(signingReq.signedDocumentId, req.actor?.actorId || 'anonymous');

    req.auditAction = 'signed_document_download_token_generated';
    req.resourceType = 'document';
    req.resourceId = signingReq.signedDocumentId;

    res.status(200).json({
      status: 'success',
      data: {
        signingRequestId: id,
        documentId: signingReq.signedDocumentId,
        token,
        downloadUrl: `/api/v1/documents/download?token=${encodeURIComponent(token)}`,
        expiresAt
      }
    });
  });

  /**
   * GET /api/v1/signing-requests/:id/audit-certificate
   * Generates a pre-signed token to download the tamper-evident audit certificate PDF.
   */
  app.get('/api/v1/signing-requests/:id/audit-certificate', authenticate, requireScope('sloane:read'), (req, res) => {
    const { id } = req.params;

    const signingReq = (mockDb.signingRequests || []).find(r => r.id === id);
    if (!signingReq) {
      return res.status(404).json({
        error: {
          code: 'SIGNING_REQUEST_NOT_FOUND',
          message: `Signing request with ID '${id}' not found.`
        }
      });
    }

    if (signingReq.status !== 'COMPLETED' || !signingReq.auditCertificateId) {
      return res.status(400).json({
        error: {
          code: 'AUDIT_CERTIFICATE_NOT_READY',
          message: `Signing request '${id}' is in status '${signingReq.status}'. Audit certificate is only available once fully completed.`
        }
      });
    }

    const { token, expiresAt } = documentStorage.generatePresignedToken(signingReq.auditCertificateId, req.actor?.actorId || 'anonymous');

    req.auditAction = 'audit_certificate_download_token_generated';
    req.resourceType = 'document';
    req.resourceId = signingReq.auditCertificateId;

    res.status(200).json({
      status: 'success',
      data: {
        signingRequestId: id,
        documentId: signingReq.auditCertificateId,
        token,
        downloadUrl: `/api/v1/documents/download?token=${encodeURIComponent(token)}`,
        expiresAt
      }
    });
  });
}
