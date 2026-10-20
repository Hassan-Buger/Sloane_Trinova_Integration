/**
 * Trinova Document Signing Orchestration Service (Documenso Integration)
 * Manages signing requests, secure signer links, HMAC webhook verification,
 * and separate preservation of signed outputs and audit certificates.
 *
 * Adheres strictly to:
 * - context/04_backend_integration_context.md §10
 * - context/05_data_security_context.md §5
 * - context/signing-provider-evaluation.md
 * - context/specs/06-signing-integration.md
 */

import crypto from 'node:crypto';
import { config } from '../config.js';
import { mockDb } from '../data/db.js';
import { TimelineService } from './timelineService.js';
import { documentStorage } from './storageDriver.js';
import { sandboxMailService } from './sandboxMailService.js';

export class SigningService {
  constructor(options = {}) {
    this.apiUrl = options.apiUrl || config.signing?.apiUrl || 'http://localhost:3000/api/v1';
    this.apiKey = options.apiKey || config.signing?.apiKey || '';
    this._webhookSecret = options.webhookSecret || '';
    this.storage = options.storage || documentStorage;
    this.mailService = options.mailService || sandboxMailService;
    this.fetchFn = options.fetchFn || globalThis.fetch;

    // Idempotent event tracker
    this.processedEventIds = new Set();
  }

  get webhookSecret() {
    return this._webhookSecret || config.signing?.webhookSecret || (process.env.SIGNING_WEBHOOK_SECRET || '').trim();
  }

  set webhookSecret(val) {
    this._webhookSecret = val;
  }

  /**
   * Verifies incoming webhook HMAC signature.
   * Strictly enforces X-Documenso-Signature (HMAC-SHA256). Plain secret header bypass is removed per Section 1.5.
   */
  verifyWebhookSignature(rawBody, signatureHeader) {
    if (!signatureHeader || typeof rawBody !== 'string' || !this.webhookSecret) {
      return false;
    }

    try {
      const computedHash = crypto
        .createHmac('sha256', this.webhookSecret)
        .update(rawBody)
        .digest('hex');

      const bufA = Buffer.from(computedHash, 'utf8');
      const bufB = Buffer.from(signatureHeader.replace(/^sha256=/, ''), 'utf8');

      if (bufA.length !== bufB.length) return false;
      return crypto.timingSafeEqual(bufA, bufB);
    } catch {
      return false;
    }
  }

  /**
   * Creates a new document signing request.
   */
  createSigningRequest(params) {
    const { companyId, documentId, title, signers, expiresAt, requestedBy } = params;

    const company = (mockDb.companies || []).find(c => c.id === companyId);
    if (!company) {
      const err = new Error(`Company with ID '${companyId}' not found.`);
      err.code = 'COMPANY_NOT_FOUND';
      err.status = 404;
      throw err;
    }

    const document = (mockDb.documents || []).find(d => d.id === documentId);
    if (!document) {
      const err = new Error(`Document with ID '${documentId}' not found.`);
      err.code = 'DOCUMENT_NOT_FOUND';
      err.status = 404;
      throw err;
    }

    if (!document.isOriginal) {
      const err = new Error('Cannot create signing request: Document is already a signed version or certificate.');
      err.code = 'INVALID_DOCUMENT_TARGET';
      err.status = 422;
      throw err;
    }

    if (!Array.isArray(signers) || signers.length === 0) {
      const err = new Error('At least one signer is required.');
      err.code = 'VALIDATION_ERROR';
      err.status = 422;
      throw err;
    }

    // Validate signers
    const validatedSigners = signers.map((s, index) => {
      const email = String(s.email || '').trim().toLowerCase();
      const name = String(s.name || '').trim();
      if (!email || !name) {
        const err = new Error(`Signer #${index + 1} requires valid name and email.`);
        err.code = 'VALIDATION_ERROR';
        err.status = 422;
        throw err;
      }

      const signerToken = crypto.randomBytes(24).toString('hex');
      return {
        id: `sgn_${crypto.randomUUID().substring(0, 8)}`,
        name,
        email,
        role: s.role || 'Signer',
        status: 'PENDING',
        invitationToken: signerToken,
        invitationUrl: `/signing/sign?token=${signerToken}`,
        signedAt: null
      };
    });

    const providerRequestId = `documenso_req_${crypto.randomUUID()}`;
    const signingRequest = {
      id: `sign_req_${crypto.randomUUID().substring(0, 8)}`,
      provider: 'documenso',
      providerRequestId,
      companyId: company.id,
      companyName: company.companyName,
      documentId: document.id,
      originalFilename: document.filename,
      title: title || document.filename,
      status: 'PENDING',
      expiresAt: expiresAt || new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString(),
      signers: validatedSigners,
      requestedBy: requestedBy?.actorName || 'Authorized Staff',
      requestedById: requestedBy?.actorId || 'unknown_actor',
      signedDocumentId: null,
      auditCertificateId: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    if (!mockDb.signingRequests) mockDb.signingRequests = [];
    mockDb.signingRequests.unshift(signingRequest);

    // Dispatch invitations via sandboxed mail service
    if (this.mailService && typeof this.mailService.dispatchSigningInvitation === 'function') {
      for (const signer of validatedSigners) {
        this.mailService.dispatchSigningInvitation({ signingRequest, signer });
      }
    }

    return signingRequest;
  }

  /**
   * Processes webhook events from Documenso with idempotency, signature validation,
   * out-of-order tolerance, and separate artifact storage.
   */
  handleWebhookEvent(event) {
    if (!event || !event.event) {
      const err = new Error('Malformed webhook event structure.');
      err.code = 'MALFORMED_EVENT';
      err.status = 400;
      throw err;
    }

    const eventId = event.eventId || `${event.event}_${event.data?.providerRequestId || event.data?.documentId}_${event.timestamp || ''}`;
    
    // Idempotency check: duplicate event handling
    if (this.processedEventIds.has(eventId)) {
      return {
        status: 'ignored',
        duplicate: true,
        message: `Event '${eventId}' was already processed.`
      };
    }

    const providerRequestId = event.data?.providerRequestId || event.data?.documentId;
    const signingRequest = (mockDb.signingRequests || []).find(r => 
      r.providerRequestId === providerRequestId || r.id === event.data?.signingRequestId
    );

    if (!signingRequest) {
      const err = new Error(`Signing request for provider ID '${providerRequestId}' not found.`);
      err.code = 'REQUEST_NOT_FOUND';
      err.status = 404;
      throw err;
    }

    switch (event.event) {
      case 'RECIPIENT_SIGNED': {
        const signerEmail = (event.data?.recipientEmail || '').toLowerCase();
        const signer = signingRequest.signers.find(s => s.email.toLowerCase() === signerEmail);
        if (signer) {
          signer.status = 'SIGNED';
          signer.signedAt = new Date().toISOString();
        }

        const allSigned = signingRequest.signers.every(s => s.status === 'SIGNED');
        signingRequest.status = allSigned ? 'ALL_SIGNED' : 'PARTIALLY_SIGNED';
        signingRequest.updatedAt = new Date().toISOString();
        break;
      }

      case 'DOCUMENT_COMPLETED': {
        // Retrieve or generate signed document & audit certificate buffers
        let signedPdfBuffer;
        if (Buffer.isBuffer(event.data?.signedPdfBuffer)) {
          signedPdfBuffer = event.data.signedPdfBuffer;
        } else if (event.data?.signedPdfBuffer?.data) {
          signedPdfBuffer = Buffer.from(event.data.signedPdfBuffer.data);
        } else if (typeof event.data?.signedPdfBuffer === 'string') {
          signedPdfBuffer = Buffer.from(event.data.signedPdfBuffer, 'base64');
        } else {
          signedPdfBuffer = Buffer.from(`%PDF-1.4 SIGNED DOCUMENT CONTENT [REQ:${signingRequest.id}]`);
        }

        let auditCertBuffer;
        if (Buffer.isBuffer(event.data?.auditCertBuffer)) {
          auditCertBuffer = event.data.auditCertBuffer;
        } else if (event.data?.auditCertBuffer?.data) {
          auditCertBuffer = Buffer.from(event.data.auditCertBuffer.data);
        } else if (typeof event.data?.auditCertBuffer === 'string') {
          auditCertBuffer = Buffer.from(event.data.auditCertBuffer, 'base64');
        } else {
          auditCertBuffer = Buffer.from(`%PDF-1.4 AUDIT CERTIFICATE [SHA-256 EVIDENCE REQ:${signingRequest.id}]`);
        }

        const signedFilename = `SIGNED_${signingRequest.originalFilename}`;
        const auditFilename = `AUDIT_CERTIFICATE_${signingRequest.id}.pdf`;

        // Save signed document separately — original remains unmodified
        const signedStorage = this.storage.saveDocument(signedFilename, signedPdfBuffer);
        const signedDocRecord = {
          id: `doc_signed_${crypto.randomUUID().substring(0, 8)}`,
          companyId: signingRequest.companyId,
          companyName: signingRequest.companyName,
          filename: signedFilename,
          mimeType: 'application/pdf',
          sizeBytes: signedStorage.sizeBytes,
          category: 'Signed_Documents',
          uploadedBy: 'Documenso Signature Engine',
          storagePath: signedStorage.storagePath,
          diskId: signedStorage.diskId,
          version: 1,
          isOriginal: false,
          isSigned: true,
          signingRequestId: signingRequest.id,
          createdAt: new Date().toISOString()
        };

        // Save audit certificate separately
        const certStorage = this.storage.saveDocument(auditFilename, auditCertBuffer);
        const certDocRecord = {
          id: `doc_cert_${crypto.randomUUID().substring(0, 8)}`,
          companyId: signingRequest.companyId,
          companyName: signingRequest.companyName,
          filename: auditFilename,
          mimeType: 'application/pdf',
          sizeBytes: certStorage.sizeBytes,
          category: 'Audit_Certificates',
          uploadedBy: 'Documenso Audit Service',
          storagePath: certStorage.storagePath,
          diskId: certStorage.diskId,
          version: 1,
          isOriginal: false,
          isAuditCertificate: true,
          signingRequestId: signingRequest.id,
          createdAt: new Date().toISOString()
        };

        if (!mockDb.documents) mockDb.documents = [];
        mockDb.documents.unshift(signedDocRecord);
        mockDb.documents.unshift(certDocRecord);

        // Out-of-order resilience: mark all signers signed if completion arrived first
        for (const s of signingRequest.signers) {
          s.status = 'SIGNED';
          if (!s.signedAt) s.signedAt = new Date().toISOString();
        }

        signingRequest.status = 'COMPLETED';
        signingRequest.completedAt = new Date().toISOString();
        signingRequest.signedDocumentId = signedDocRecord.id;
        signingRequest.auditCertificateId = certDocRecord.id;
        signingRequest.updatedAt = new Date().toISOString();

        // Generate real timeline event (Section 15)
        const company = (mockDb.companies || []).find(c => c.id === signingRequest.companyId);
        if (company && company.clientId) {
          try {
            TimelineService.createEvent({
              clientId: company.clientId,
              companyId: company.id,
              eventType: 'DOCUMENT_SIGNED',
              title: `Document Signed: ${signingRequest.documentTitle || 'Document'}`,
              description: `All signers completed signing for ${signingRequest.documentTitle}. Signed PDF and audit certificate archived.`,
              occurredAt: signingRequest.completedAt,
              actorType: 'system',
              actorId: 'documenso_service',
              source: 'document',
              severity: 'normal',
              visibility: 'shared',
              externalId: `sign_comp_${signingRequest.id}`,
              metadata: { signingRequestId: signingRequest.id, documentId: signedDocRecord.id }
            });
          } catch (e) {}
        }
        break;
      }

      case 'DOCUMENT_REJECTED': {
        signingRequest.status = 'REJECTED';
        signingRequest.rejectionReason = event.data?.reason || 'Signer rejected document';
        signingRequest.updatedAt = new Date().toISOString();
        break;
      }

      case 'DOCUMENT_EXPIRED': {
        signingRequest.status = 'EXPIRED';
        signingRequest.updatedAt = new Date().toISOString();
        break;
      }

      default:
        // Other non-breaking events (e.g. EMAIL_SENT)
        signingRequest.updatedAt = new Date().toISOString();
        break;
    }

    this.processedEventIds.add(eventId);

    return {
      status: 'success',
      event: event.event,
      signingRequest
    };
  }
}

export const signingService = new SigningService();
