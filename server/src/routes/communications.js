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
import { clientDirectory } from '../services/clientDirectory.js';
import { sendError, cleanText } from './helpers.js';
import { takeOut, putInBin } from '../services/bin.js';

const MIME_BY_EXTENSION = {
  '.pdf': 'application/pdf',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.txt': 'text/plain',
  '.csv': 'text/csv'
};

const NOTE_NOT_FOUND = 'We could not find that note. It may already have been deleted.';
const DOC_NOT_FOUND = 'We could not find that document. It may already have been deleted.';
const CLIENT_NOT_FOUND = 'We could not find that client. Refresh the Clients page and try again.';

/**
 * Keeps the history entry that mirrors a note in step with the note.
 * On delete it returns the removed history entry, so it can go to the Bin with the note.
 */
function mirrorNoteInHistory(note, change) {
  const events = mockDb.timeline_events || [];
  const idx = events.findIndex(e => e.source === 'trinova' && e.externalId === note.id);
  if (idx === -1) return null;
  if (change === 'delete') {
    return takeOut('timeline_events', idx);
  }
  events[idx].description = note.text.substring(0, 160) + (note.text.length > 160 ? '...' : '');
  return null;
}

/** The client a company or client id belongs to, for "where it came from" in the Bin. */
function clientNameFor(companyId) {
  const comp = (mockDb.companies || []).find(c => c.id === companyId);
  const client = clientDirectory.find(comp ? comp.clientId : companyId) || clientDirectory.find(companyId);
  return (client && client.name) || (comp && comp.companyName) || '';
}

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

    const company = clientDirectory.findCompany(companyId);
    if (!company) {
      return res.status(404).json({
        error: {
          code: 'COMPANY_NOT_FOUND',
          message: CLIENT_NOT_FOUND
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
          message: 'We could not find that conversation.'
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
          message: 'We could not find that conversation, so the message was not sent.'
        }
      });
    }

    const bodyText = (req.body?.body || '').trim();
    if (!bodyText) {
      return res.status(422).json({
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Please type a message before sending.'
        }
      });
    }

    if (bodyText.length > 4000) {
      return res.status(422).json({
        error: {
          code: 'VALIDATION_ERROR',
          message: 'A message can be up to 4,000 characters.'
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
      message: 'Message sent.',
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

    const company = clientDirectory.findCompany(companyId);
    if (!company) {
      return res.status(404).json({
        error: {
          code: 'COMPANY_NOT_FOUND',
          message: CLIENT_NOT_FOUND
        }
      });
    }

    // --- Strict Privacy Boundary Check (context/05_data_security_context.md §2) ---
    const isExplicitlyConfirmed = req.body?.confirm_write_to_trinova === true || req.body?.confirmWriteToTrinova === true;
    if (!isExplicitlyConfirmed) {
      return res.status(422).json({
        error: {
          code: 'PRIVACY_BOUNDARY_CONFIRMATION_REQUIRED',
          message: 'Please confirm that you want to save this note (confirm_write_to_trinova: true). Notes are never saved automatically.'
        }
      });
    }

    const noteText = (req.body?.text || '').trim();
    if (!noteText) {
      return res.status(422).json({
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Please write something in the note.'
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
          message: 'Choose who can see this note: only the team, or the client too.'
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
      message: 'Note saved.',
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

    const company = clientDirectory.findCompany(companyId);
    if (!company) {
      return res.status(404).json({
        error: {
          code: 'COMPANY_NOT_FOUND',
          message: CLIENT_NOT_FOUND
        }
      });
    }

    const filename = typeof req.body?.filename === 'string' ? req.body.filename.trim() : req.body?.filename;
    const extension = typeof filename === 'string' && filename.includes('.') ? filename.slice(filename.lastIndexOf('.')).toLowerCase() : '';
    const mimeType = req.body?.mimeType || MIME_BY_EXTENSION[extension] || 'application/pdf';
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
            message: 'Please choose a file to add.'
          }
        });
      }
    } catch {
      return res.status(422).json({
        error: {
          code: 'INVALID_FILE_ENCODING',
          message: 'That file could not be read. Please try another one.'
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
      message: 'Document added.',
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
          message: DOC_NOT_FOUND
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
          message: 'This download link is not valid. Please go back and click Download again.'
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
          message: DOC_NOT_FOUND
        }
      });
    }

    try {
      const fileBuffer = documentStorage.readDocument(documentStorage.pathFor(doc));
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
          message: DOC_NOT_FOUND
        }
      });
    }

    res.status(200).json({
      status: 'success',
      data: sanitizeDocument(doc)
    });
  });

  // =========================================================================
  // 4. Change or remove notes and documents
  // =========================================================================

  /**
   * PATCH /api/v1/companies/:companyId/notes/:noteId
   * Changes the text (and who may see it) of a client note.
   */
  app.patch('/api/v1/companies/:companyId/notes/:noteId', authenticate, requireScope('sloane:write'), (req, res) => {
    req.auditAction = 'internal_note_updated';
    req.resourceType = 'company_note';
    req.resourceId = req.params.noteId;

    const note = (mockDb.notes || []).find(n => n.id === req.params.noteId && n.companyId === req.params.companyId);
    if (!note) return sendError(res, 404, 'NOTE_NOT_FOUND', NOTE_NOT_FOUND);

    const body = req.body || {};
    if (body.text !== undefined) {
      const text = cleanText(body.text);
      if (!text) return sendError(res, 422, 'VALIDATION_ERROR', 'A note cannot be empty. Use Delete to remove it.');
      if (text.length > 4000) return sendError(res, 422, 'VALIDATION_ERROR', 'A note can be up to 4,000 characters.');
      note.text = text;
    }
    if (body.visibility !== undefined) {
      if (!['staff_only', 'client_visible'].includes(body.visibility)) {
        return sendError(res, 422, 'INVALID_VISIBILITY', 'Choose who can see this note: only the team, or the client too.');
      }
      note.visibility = body.visibility;
    }
    note.editedAt = new Date().toISOString();
    mirrorNoteInHistory(note, 'update');

    res.status(200).json({ status: 'success', message: 'Note updated.', data: note });
  });

  /**
   * DELETE /api/v1/companies/:companyId/notes/:noteId
   */
  app.delete('/api/v1/companies/:companyId/notes/:noteId', authenticate, requireScope('sloane:write'), (req, res) => {
    req.auditAction = 'internal_note_deleted';
    req.resourceType = 'company_note';
    req.resourceId = req.params.noteId;

    const idx = (mockDb.notes || []).findIndex(n => n.id === req.params.noteId && n.companyId === req.params.companyId);
    if (idx === -1) return sendError(res, 404, 'NOTE_NOT_FOUND', NOTE_NOT_FOUND);

    const item = takeOut('notes', idx);
    const note = item.record;
    const historyItem = mirrorNoteInHistory(note, 'delete');
    const text = String(note.text || '').trim();
    const entry = putInBin({
      kind: 'note',
      label: text.length > 60 ? `${text.slice(0, 60)}...` : (text || 'Note'),
      where: clientNameFor(note.companyId),
      removed: [item, historyItem]
    });
    res.status(200).json({ status: 'success', message: 'Note moved to the Bin. You can put it back from the Bin within 30 days.', data: { id: note.id, binId: entry.id } });
  });

  /**
   * PATCH /api/v1/documents/:id
   * Renames a document or changes its category. The file itself is not touched.
   */
  app.patch('/api/v1/documents/:id', authenticate, requireScope('sloane:write'), (req, res) => {
    req.auditAction = 'document_updated';
    req.resourceType = 'document';
    req.resourceId = req.params.id;

    const doc = (mockDb.documents || []).find(d => d.id === req.params.id);
    if (!doc) return sendError(res, 404, 'DOCUMENT_NOT_FOUND', DOC_NOT_FOUND);

    const body = req.body || {};
    if (body.filename !== undefined) {
      const filename = cleanText(body.filename);
      if (!filename) return sendError(res, 422, 'VALIDATION_ERROR', 'Please type a name for the document.');
      if (filename.length > 200 || /[\\/:*?"<>|]/.test(filename)) {
        return sendError(res, 422, 'VALIDATION_ERROR', 'The document name can be up to 200 characters and cannot contain \\ / : * ? " < > |');
      }
      // Keep the original file type: renaming must not turn a PDF into something else.
      const oldExt = doc.filename.includes('.') ? doc.filename.slice(doc.filename.lastIndexOf('.')).toLowerCase() : '';
      const newExt = filename.includes('.') ? filename.slice(filename.lastIndexOf('.')).toLowerCase() : '';
      doc.filename = oldExt && newExt !== oldExt ? `${filename}${oldExt}` : filename;
    }
    if (body.category !== undefined) {
      const category = cleanText(body.category);
      if (!category || category.length > 60) return sendError(res, 422, 'VALIDATION_ERROR', 'Please choose a category (up to 60 characters).');
      doc.category = category;
    }
    doc.updatedAt = new Date().toISOString();

    res.status(200).json({ status: 'success', message: 'Document updated.', data: sanitizeDocument(doc) });
  });

  /**
   * DELETE /api/v1/documents/:id
   * Moves the document to the Bin. Its file is kept until the Bin item is deleted for good.
   */
  app.delete('/api/v1/documents/:id', authenticate, requireScope('sloane:write'), (req, res) => {
    req.auditAction = 'document_deleted';
    req.resourceType = 'document';
    req.resourceId = req.params.id;

    const idx = (mockDb.documents || []).findIndex(d => d.id === req.params.id);
    if (idx === -1) return sendError(res, 404, 'DOCUMENT_NOT_FOUND', DOC_NOT_FOUND);

    const doc = mockDb.documents[idx];
    // A document that has been sent for signing is part of that record: keep it.
    // A cancelled or expired request no longer needs the document; any other one does.
    const inUse = (mockDb.signingRequests || []).find(r =>
      (r.documentId === doc.id || r.signedDocumentId === doc.id || r.auditCertificateId === doc.id) &&
      !['CANCELLED', 'EXPIRED'].includes(r.status));
    if (inUse) {
      return sendError(res, 409, 'DOCUMENT_IN_USE',
        'This document is part of a signing request that is still open, so it cannot be deleted. Cancel the request first.');
    }

    const entry = putInBin({ kind: 'document', label: doc.filename || 'Document', where: clientNameFor(doc.companyId), removed: [takeOut('documents', idx)] });
    res.status(200).json({ status: 'success', message: 'Document moved to the Bin. You can put it back from the Bin within 30 days.', data: { id: doc.id, binId: entry.id } });
  });
}
