/**
 * Trinova Messages, Internal Notes & Document Management API Routes
 * Implements message threads, privacy-bounded internal notes, document upload/validation,
 * and authorized presigned downloads.
 *
 * Adheres strictly to:
 * - context/04_backend_integration_context.md §4–5, §7
 * - context/05_data_security_context.md §2 (Privacy boundary), §5 (Document security)
 * - context/specs/05-messages-notes-documents.md
 */

import { mockDb } from '../data/db.js';
import { requireIdempotency } from '../middleware/idempotency.js';
import { documentStorage } from '../services/storageDriver.js';
import { TimelineService } from '../services/timelineService.js';

/**
 * Strips sensitive internal server storage paths and disk IDs from API responses per Section 1.5.
 */
function sanitizeDocument(doc) {
  if (!doc || typeof doc !== 'object') return doc;
  const { storagePath, diskId, ...safe } = doc;
  return safe;
}

export function registerCommunicationRoutes(app, { authenticate, requireScope }) {
  // =========================================================================
  // 1. Messages & Conversations Endpoints
  // =========================================================================

  /**
   * GET /api/v1/companies/:companyId/conversations
   * Reads conversation threads for a specific company.
   */
  app.get('/api/v1/companies/:companyId/conversations', authenticate, requireScope('sloane:read'), (req, res) => {
    const { companyId } = req.params;
    req.auditAction = 'read_company_conversations';
    req.resourceType = 'conversation';
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

    const conversations = (mockDb.conversations || []).filter(c => c.companyId === companyId);

    res.status(200).json({
      status: 'success',
      data: conversations,
      meta: {
        companyId,
        companyName: company.companyName,
        total: conversations.length
      }
    });
  });

  /**
   * GET /api/v1/conversations/:id/messages
   * Reads chronologically ordered message stream for a conversation.
   */
  app.get('/api/v1/conversations/:id/messages', authenticate, requireScope('sloane:read'), (req, res) => {
    const { id } = req.params;
    req.auditAction = 'read_conversation_messages';
    req.resourceType = 'conversation';
    req.resourceId = id;

    const conversation = (mockDb.conversations || []).find(c => c.id === id);
    if (!conversation) {
      return res.status(404).json({
        error: {
          code: 'CONVERSATION_NOT_FOUND',
          message: `Conversation with ID '${id}' not found.`
        }
      });
    }

    const messages = (mockDb.messages || [])
      .filter(m => m.conversationId === id)
      .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());

    res.status(200).json({
      status: 'success',
      data: messages,
      meta: {
        conversationId: id,
        subject: conversation.subject,
        total: messages.length
      }
    });
  });

  /**
   * POST /api/v1/conversations/:id/messages
   * Sends a portal message with mandatory Idempotency-Key and actor attribution.
   */
  app.post('/api/v1/conversations/:id/messages', authenticate, requireScope('sloane:write'), requireIdempotency, (req, res) => {
    const { id } = req.params;

    const conversation = (mockDb.conversations || []).find(c => c.id === id);
    if (!conversation) {
      return res.status(404).json({
        error: {
          code: 'CONVERSATION_NOT_FOUND',
          message: `Cannot send message: Conversation '${id}' not found.`
        }
      });
    }

    const bodyText = (req.body?.body || '').trim();
    if (!bodyText) {
      return res.status(422).json({
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Message body cannot be empty.'
        }
      });
    }

    if (bodyText.length > 4000) {
      return res.status(422).json({
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Message body exceeds 4,000 characters limit.'
        }
      });
    }

    const newMessage = {
      id: `msg_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
      conversationId: id,
      senderId: req.actor?.actorId || 'unknown_actor',
      senderName: req.actor?.actorName || 'Staff Member',
      senderType: 'staff',
      body: bodyText,
      createdAt: new Date().toISOString(),
      idempotencyKey: req.idempotencyKey
    };

    if (!mockDb.messages) mockDb.messages = [];
    mockDb.messages.push(newMessage);

    // Update conversation metadata
    conversation.lastMessageAt = newMessage.createdAt;
    conversation.messageCount = (conversation.messageCount || 0) + 1;

    req.auditAction = 'portal_message_sent';
    req.resourceType = 'conversation';
    req.resourceId = id;

    res.status(201).json({
      status: 'success',
      message: 'Portal message sent successfully.',
      data: newMessage
    });
  });

  // =========================================================================
  // 2. Internal Notes Endpoints (Strict Privacy Boundary Enforcement)
  // =========================================================================

  /**
   * GET /api/v1/companies/:companyId/notes
   * Reads internal notes for a company.
   */
  app.get('/api/v1/companies/:companyId/notes', authenticate, requireScope('sloane:read'), (req, res) => {
    const { companyId } = req.params;
    req.auditAction = 'read_company_notes';
    req.resourceType = 'company_note';
    req.resourceId = companyId;
    const allNotes = (mockDb.notes || []).filter(n => n.companyId === companyId);

    // Enforce visibility by actor role (Section 1.5)
    // Only staff actors or actors with write scope can view staff_only notes
    const isStaff = req.actor?.role === 'staff' || req.actor?.scopes?.includes('sloane:write');
    const notes = isStaff ? allNotes : allNotes.filter(n => n.visibility !== 'staff_only');

    res.status(200).json({
      status: 'success',
      data: notes,
      meta: {
        companyId,
        total: notes.length
      }
    });
  });

  /**
   * POST /api/v1/companies/:companyId/notes
   * Creates an internal company note.
   * STRICT PRIVACY BOUNDARY: Requires explicit user opt-in confirmation (confirm_write_to_trinova: true).
   * Defaults to staff_only visibility.
   */
  app.post('/api/v1/companies/:companyId/notes', authenticate, requireScope('sloane:write'), (req, res) => {
    const { companyId } = req.params;

    const company = (mockDb.companies || []).find(c => c.id === companyId);
    if (!company) {
      return res.status(404).json({
        error: {
          code: 'COMPANY_NOT_FOUND',
          message: `Company with ID '${companyId}' not found.`
        }
      });
    }

    // --- Strict Privacy Boundary Check (context/05_data_security_context.md §2) ---
    const isExplicitlyConfirmed = req.body?.confirm_write_to_trinova === true || req.body?.confirmWriteToTrinova === true;
    if (!isExplicitlyConfirmed) {
      return res.status(422).json({
        error: {
          code: 'PRIVACY_BOUNDARY_CONFIRMATION_REQUIRED',
          message: 'Writing internal notes to Trinova requires explicit user opt-in confirmation (confirm_write_to_trinova: true). Background or automatic sync of private notes is forbidden.'
        }
      });
    }

    const noteText = (req.body?.text || '').trim();
    if (!noteText) {
      return res.status(422).json({
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Note text cannot be empty.'
        }
      });
    }

    // Default visibility is staff_only per context/specs/05-messages-notes-documents.md §2
    const visibility = req.body?.visibility || 'staff_only';
    const allowedVisibilities = ['staff_only', 'client_visible'];
    if (!allowedVisibilities.includes(visibility)) {
      return res.status(422).json({
        error: {
          code: 'INVALID_VISIBILITY',
          message: `Visibility '${visibility}' is invalid. Permitted values: [${allowedVisibilities.join(', ')}].`
        }
      });
    }

    const newNote = {
      id: `not_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
      companyId: company.id,
      companyName: company.companyName,
      text: noteText,
      visibility,
      authorId: req.actor?.actorId || 'unknown_actor',
      authorName: req.actor?.actorName || 'Authorized Staff',
      explicitConfirmation: true,
      createdAt: new Date().toISOString()
    };

    if (!mockDb.notes) mockDb.notes = [];
    mockDb.notes.unshift(newNote);

    req.auditAction = 'internal_note_created';
    req.resourceType = 'company_note';
    req.resourceId = newNote.id;

    // Generate real timeline event (Section 15)
    if (company && company.clientId) {
      try {
        TimelineService.createEvent({
          clientId: company.clientId,
          companyId: company.id,
          eventType: 'NOTE_CREATED',
          title: `Internal Note Added: ${company.companyName}`,
          description: newNote.text.substring(0, 160) + (newNote.text.length > 160 ? '...' : ''),
          occurredAt: newNote.createdAt,
          actorType: 'user',
          actorId: newNote.authorId,
          source: 'trinova',
          severity: 'normal',
          visibility: 'shared',
          externalId: newNote.id,
          metadata: { noteId: newNote.id, author: newNote.authorName }
        });
      } catch (e) {
        // Non-blocking
      }
    }

    res.status(201).json({
      status: 'success',
      message: `Internal note created with '${visibility}' visibility.`,
      data: newNote
    });
  });

  // =========================================================================
  // 3. Document Management Endpoints
  // =========================================================================

  /**
   * GET /api/v1/companies/:companyId/documents
   * Lists document metadata for a specific company.
   */
  app.get('/api/v1/companies/:companyId/documents', authenticate, requireScope('sloane:read'), (req, res) => {
    const { companyId } = req.params;
    req.auditAction = 'read_company_documents';
    req.resourceType = 'document';
    req.resourceId = companyId;

    const documents = (mockDb.documents || []).filter(d => d.companyId === companyId).map(sanitizeDocument);

    res.status(200).json({
      status: 'success',
      data: documents,
      meta: {
        companyId,
        total: documents.length
      }
    });
  });

  /**
   * POST /api/v1/companies/:companyId/documents/upload
   * Uploads and validates a document with mandatory Idempotency-Key and MIME/size verification.
   */
  app.post('/api/v1/companies/:companyId/documents/upload', authenticate, requireScope('sloane:write'), requireIdempotency, (req, res) => {
    const { companyId } = req.params;

    const company = (mockDb.companies || []).find(c => c.id === companyId);
    if (!company) {
      return res.status(404).json({
        error: {
          code: 'COMPANY_NOT_FOUND',
          message: `Cannot upload document: Company '${companyId}' not found.`
        }
      });
    }

    const filename = req.body?.filename;
    const mimeType = req.body?.mimeType || 'application/pdf';
    const category = req.body?.category || 'General';

    // Decode file content (handles base64 string or plain text)
    let buffer;
    try {
      if (req.body?.contentBase64) {
        buffer = Buffer.from(req.body.contentBase64, 'base64');
      } else if (req.body?.content) {
        buffer = Buffer.from(req.body.content, 'utf8');
      } else {
        return res.status(422).json({
          error: {
            code: 'VALIDATION_ERROR',
            message: 'File content is required (provide contentBase64 or content).'
          }
        });
      }
    } catch {
      return res.status(422).json({
        error: {
          code: 'INVALID_FILE_ENCODING',
          message: 'Failed to decode file payload.'
        }
      });
    }

    // Validate size, extensions, and MIME type
    try {
      documentStorage.validateFile(filename, mimeType, buffer.length);
    } catch (validationErr) {
      return res.status(validationErr.status || 422).json({
        error: {
          code: validationErr.code || 'FILE_VALIDATION_FAILED',
          message: validationErr.message
        }
      });
    }

    // Save document to secure storage
    const storageResult = documentStorage.saveDocument(filename, buffer);

    const newDoc = {
      id: `doc_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
      companyId: company.id,
      companyName: company.companyName,
      filename,
      mimeType,
      sizeBytes: storageResult.sizeBytes,
      category,
      uploadedBy: req.actor?.actorName || 'Authorized Staff',
      storagePath: storageResult.storagePath,
      diskId: storageResult.diskId,
      version: 1,
      isOriginal: true, // Preserved original document flag
      idempotencyKey: req.idempotencyKey,
      createdAt: new Date().toISOString()
    };

    if (!mockDb.documents) mockDb.documents = [];
    mockDb.documents.unshift(newDoc);

    req.auditAction = 'document_uploaded';
    req.resourceType = 'document';
    req.resourceId = newDoc.id;

    // Generate real timeline event (Section 15)
    if (company && company.clientId) {
      try {
        TimelineService.createEvent({
          clientId: company.clientId,
          companyId: company.id,
          eventType: 'DOCUMENT_UPLOADED',
          title: `Document Uploaded: ${newDoc.filename}`,
          description: `Uploaded to category ${newDoc.category} by ${newDoc.uploadedBy}.`,
          occurredAt: newDoc.createdAt,
          actorType: 'user',
          actorId: req.actor?.actorId || 'actor_staff',
          source: 'document',
          severity: 'normal',
          visibility: 'shared',
          externalId: newDoc.id,
          metadata: { documentId: newDoc.id, filename: newDoc.filename, category: newDoc.category, sizeBytes: newDoc.sizeBytes }
        });
      } catch (e) {
        // Non-blocking
      }
    }

    res.status(201).json({
      status: 'success',
      message: 'Document uploaded and validated successfully.',
      data: sanitizeDocument(newDoc)
    });
  });

  /**
   * GET /api/v1/documents/:id/download-token
   * Generates a temporary HMAC pre-signed token for secure file download.
   */
  app.get('/api/v1/documents/:id/download-token', authenticate, requireScope('sloane:read'), (req, res) => {
    const { id } = req.params;

    const doc = (mockDb.documents || []).find(d => d.id === id);
    if (!doc) {
      return res.status(404).json({
        error: {
          code: 'DOCUMENT_NOT_FOUND',
          message: `Document with ID '${id}' not found.`
        }
      });
    }

    const { token, expiresAt } = documentStorage.generatePresignedToken(doc.id, req.actor?.actorId || 'anonymous');

    req.auditAction = 'document_presigned_url_generated';
    req.resourceType = 'document';
    req.resourceId = doc.id;

    res.status(200).json({
      status: 'success',
      data: {
        documentId: doc.id,
        filename: doc.filename,
        token,
        downloadUrl: `/api/v1/documents/download?token=${encodeURIComponent(token)}`,
        expiresAt
      }
    });
  });

  /**
   * GET /api/v1/documents/download
   * Streams file content via valid pre-signed token or Authorization header.
   */
  app.get('/api/v1/documents/download', (req, res) => {
    const tokenStr = req.query.token;

    if (!tokenStr) {
      return res.status(401).json({
        error: {
          code: 'TOKEN_REQUIRED',
          message: 'Download requires a valid pre-signed token query parameter (?token=...).'
        }
      });
    }

    const verification = documentStorage.verifyPresignedToken(tokenStr);
    if (!verification.valid) {
      return res.status(403).json({
        error: {
          code: verification.code,
          message: verification.message
        }
      });
    }

    const doc = (mockDb.documents || []).find(d => d.id === verification.documentId);
    if (!doc) {
      return res.status(404).json({
        error: {
          code: 'DOCUMENT_NOT_FOUND',
          message: 'Associated document was not found.'
        }
      });
    }

    try {
      const fileBuffer = documentStorage.readDocument(doc.storagePath);
      res.setHeader('Content-Type', doc.mimeType || 'application/octet-stream');
      res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(doc.filename)}"`);
      res.setHeader('Content-Length', fileBuffer.length);
      res.status(200);
      res.end(fileBuffer);
    } catch (err) {
      return res.status(err.status || 500).json({
        error: {
          code: err.code || 'DOWNLOAD_FAILED',
          message: err.message
        }
      });
    }
  });

  /**
   * GET /api/v1/documents/:id
   * Retrieves document metadata.
   */
  app.get('/api/v1/documents/:id', authenticate, requireScope('sloane:read'), (req, res) => {
    const { id } = req.params;
    req.auditAction = 'read_document_detail';
    req.resourceType = 'document';
    req.resourceId = id;

    const doc = (mockDb.documents || []).find(d => d.id === id);
    if (!doc) {
      return res.status(404).json({
        error: {
          code: 'DOCUMENT_NOT_FOUND',
          message: `Document with ID '${id}' not found.`
        }
      });
    }

    res.status(200).json({
      status: 'success',
      data: sanitizeDocument(doc)
    });
  });
}
