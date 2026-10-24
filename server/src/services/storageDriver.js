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
import { documentsDirPath } from '../data/paths.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export class DocumentStorageDriver {
  constructor(options = {}) {
    this.storageDir = options.storageDir || documentsDirPath();
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
      const err = new Error('Please choose a file.');
      err.code = 'INVALID_FILENAME';
      err.status = 422;
      throw err;
    }

    const ext = path.extname(filename).toLowerCase();
    if (this.blockedExtensions.has(ext)) {
      const err = new Error(`Files ending in '${ext}' cannot be added, because programs and scripts are not allowed.`);
      err.code = 'DISALLOWED_FILE_TYPE';
      err.status = 422;
      throw err;
    }

    if (sizeBytes > this.maxFileSizeBytes) {
      const mbLimit = Math.round(this.maxFileSizeBytes / (1024 * 1024));
      const err = new Error(`That file is ${(sizeBytes / (1024 * 1024)).toFixed(1)} MB, which is more than the ${mbLimit} MB limit. Please choose a smaller file.`);
      err.code = 'FILE_TOO_LARGE';
      err.status = 422;
      throw err;
    }

    if (mimeType && !this.whitelistedMimeTypes.has(mimeType.toLowerCase())) {
      const err = new Error('That kind of file is not supported. You can add PDF, Word, Excel, picture, text and CSV files.');
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
   * Where a stored document lives right now. Documents remember their file name on disk
   * (diskId), so they are still found if the storage folder is mounted somewhere else later.
   */
  pathFor(doc) {
    if (doc && doc.diskId) return path.join(this.storageDir, path.basename(doc.diskId));
    return doc ? doc.storagePath : null;
  }

  /**
   * Deletes a stored file. Only files inside the storage folder can ever be removed.
   * Returns true when a file was removed.
   */
  deleteDocument(doc) {
    const target = this.pathFor(typeof doc === 'string' ? { storagePath: doc } : doc);
    if (!target) return false;
    const resolved = path.resolve(target);
    if (!resolved.startsWith(path.resolve(this.storageDir) + path.sep)) return false;
    try {
      fs.unlinkSync(resolved);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Reads document content from disk.
   */
  readDocument(storagePath) {
    if (!fs.existsSync(storagePath)) {
      const err = new Error('The file for this document is missing from the server. Please add it again.');
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
        return { valid: false, code: 'TOKEN_EXPIRED', message: 'This download link has expired. Please go back and click Download again.' };
      }

      const payload = `${documentId}:${actorId}:${expiresAt}`;
      const expectedSignature = crypto.createHmac('sha256', this.tokenSecret).update(payload).digest('hex');

      if (!crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expectedSignature))) {
        return { valid: false, code: 'INVALID_TOKEN_SIGNATURE', message: 'This download link is not valid. Please go back and click Download again.' };
      }

      return { valid: true, documentId, actorId };
    } catch {
      return { valid: false, code: 'MALFORMED_TOKEN', message: 'This download link is not valid. Please go back and click Download again.' };
    }
  }
}

export const documentStorage = new DocumentStorageDriver();
