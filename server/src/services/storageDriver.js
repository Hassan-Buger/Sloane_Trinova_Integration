/**
 * Secure File Storage Driver & Presigned URL Generator
 * Manages document storage, file validation, separate original/signed preservation,
 * and temporary signed download tokens.
 *
 * Adheres strictly to:
 * - context/05_data_security_context.md §5 (Document security)
 * - context/specs/05-messages-notes-documents.md §3.3
 */

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export class DocumentStorageDriver {
  constructor(options = {}) {
    this.storageDir = options.storageDir || path.resolve(__dirname, '../../storage/documents');
    this.tokenSecret = options.tokenSecret || process.env.STORAGE_PRESIGNED_TOKEN_SECRET || process.env.SLON_TOKEN_SECRET || '';
    this.maxFileSizeBytes = options.maxFileSizeBytes || 15 * 1024 * 1024; // 15MB ceiling
    
    this.whitelistedMimeTypes = new Set([
      'application/pdf',
      'image/png',
      'image/jpeg',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'text/plain',
      'text/csv'
    ]);

    this.blockedExtensions = new Set([
      '.exe', '.bat', '.cmd', '.sh', '.bin', '.js', '.vbs', '.msi', '.ps1', '.py', '.php'
    ]);

    // Ensure storage directory exists
    try {
      fs.mkdirSync(this.storageDir, { recursive: true });
    } catch {
      // Ignore if exists
    }
  }

  /**
   * Validates file safety, extension, size, and MIME type.
   */
  validateFile(filename, mimeType, sizeBytes) {
    if (!filename || typeof filename !== 'string') {
      const err = new Error('Filename is required.');
      err.code = 'INVALID_FILENAME';
      err.status = 422;
      throw err;
    }

    const ext = path.extname(filename).toLowerCase();
    if (this.blockedExtensions.has(ext)) {
      const err = new Error(`Disallowed file extension '${ext}'. Executable and script files are prohibited.`);
      err.code = 'DISALLOWED_FILE_TYPE';
      err.status = 422;
      throw err;
    }

    if (sizeBytes > this.maxFileSizeBytes) {
      const mbLimit = Math.round(this.maxFileSizeBytes / (1024 * 1024));
      const err = new Error(`File size (${(sizeBytes / (1024 * 1024)).toFixed(2)}MB) exceeds the maximum allowed limit of ${mbLimit}MB.`);
      err.code = 'FILE_TOO_LARGE';
      err.status = 422;
      throw err;
    }

    if (mimeType && !this.whitelistedMimeTypes.has(mimeType.toLowerCase())) {
      const err = new Error(`MIME type '${mimeType}' is not supported. Supported types: PDF, Word, Excel, PNG, JPEG, CSV.`);
      err.code = 'UNSUPPORTED_MIME_TYPE';
      err.status = 422;
      throw err;
    }

    return true;
  }

  /**
   * Securely saves binary content to disk with isolated filename.
   */
  saveDocument(filename, buffer) {
    const safeExt = path.extname(filename).toLowerCase();
    const diskId = `doc_${crypto.randomUUID()}${safeExt}`;
    const targetPath = path.join(this.storageDir, diskId);

    fs.writeFileSync(targetPath, buffer);

    return {
      diskId,
      storagePath: targetPath,
      sizeBytes: buffer.length
    };
  }

  /**
   * Reads document content from disk.
   */
  readDocument(storagePath) {
    if (!fs.existsSync(storagePath)) {
      const err = new Error('Document binary file not found on storage.');
      err.code = 'FILE_NOT_FOUND';
      err.status = 404;
      throw err;
    }
    return fs.readFileSync(storagePath);
  }

  /**
   * Generates temporary HMAC-signed download token (valid for 15 minutes).
   */
  generatePresignedToken(documentId, actorId, expiresInMs = 15 * 60 * 1000) {
    const expiresAt = Date.now() + expiresInMs;
    const payload = `${documentId}:${actorId}:${expiresAt}`;
    const signature = crypto.createHmac('sha256', this.tokenSecret).update(payload).digest('hex');
    const token = Buffer.from(JSON.stringify({ documentId, actorId, expiresAt, signature })).toString('base64url');
    return {
      token,
      expiresAt: new Date(expiresAt).toISOString()
    };
  }

  /**
   * Verifies pre-signed download token.
   */
  verifyPresignedToken(tokenStr) {
    try {
      const raw = Buffer.from(tokenStr, 'base64url').toString('utf8');
      const { documentId, actorId, expiresAt, signature } = JSON.parse(raw);

      if (Date.now() > expiresAt) {
        return { valid: false, code: 'TOKEN_EXPIRED', message: 'Pre-signed download token has expired.' };
      }

      const payload = `${documentId}:${actorId}:${expiresAt}`;
      const expectedSignature = crypto.createHmac('sha256', this.tokenSecret).update(payload).digest('hex');

      if (!crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expectedSignature))) {
        return { valid: false, code: 'INVALID_TOKEN_SIGNATURE', message: 'Pre-signed token signature is invalid.' };
      }

      return { valid: true, documentId, actorId };
    } catch {
      return { valid: false, code: 'MALFORMED_TOKEN', message: 'Malformed pre-signed token.' };
    }
  }
}

export const documentStorage = new DocumentStorageDriver();
