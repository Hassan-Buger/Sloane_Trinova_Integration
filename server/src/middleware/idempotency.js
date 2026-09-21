/**
 * Idempotency Middleware for API Mutation Requests
 * Guarantees that retrying a mutation with the same Idempotency-Key
 * returns the identical response without re-executing side effects or duplicating records.
 *
 * Adheres strictly to:
 * - context/04_backend_integration_context.md §5 & §7
 * - context/specs/04-tasks-workflow-read-write.md
 */

import crypto from 'node:crypto';

class IdempotencyStore {
  constructor(ttlMs = 24 * 60 * 60 * 1000) { // Default 24 hours TTL
    this.store = new Map();
    this.ttlMs = ttlMs;
  }

  generateFingerprint(req) {
    const raw = JSON.stringify({
      path: req.path,
      method: req.method,
      body: req.body || {}
    });
    return crypto.createHash('sha256').update(raw).digest('hex');
  }

  get(key) {
    const record = this.store.get(key);
    if (!record) return null;

    if (Date.now() - record.timestamp > this.ttlMs) {
      this.store.delete(key);
      return null;
    }

    return record;
  }

  set(key, fingerprint, statusCode, body) {
    this.store.set(key, {
      fingerprint,
      statusCode,
      body,
      timestamp: Date.now()
    });
  }

  clear() {
    this.store.clear();
  }
}

export const idempotencyStore = new IdempotencyStore();

const UUID_V4_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Middleware requiring and enforcing Idempotency-Key header on mutation requests.
 */
export function requireIdempotency(req, res, next) {
  const keyHeader = req.headers['idempotency-key'] || req.headers['x-idempotency-key'];

  if (!keyHeader) {
    return res.status(400).json({
      error: {
        code: 'MISSING_IDEMPOTENCY_KEY',
        message: 'Idempotency-Key header (UUID v4) is required for this operation.'
      }
    });
  }

  const idempotencyKey = String(keyHeader).trim();

  if (!UUID_V4_REGEX.test(idempotencyKey)) {
    return res.status(400).json({
      error: {
        code: 'INVALID_IDEMPOTENCY_KEY',
        message: 'Idempotency-Key header must be a valid UUID v4 format.'
      }
    });
  }

  const fingerprint = idempotencyStore.generateFingerprint(req);
  const existing = idempotencyStore.get(idempotencyKey);

  if (existing) {
    // Detect payload mismatch under identical key
    if (existing.fingerprint !== fingerprint) {
      return res.status(409).json({
        error: {
          code: 'IDEMPOTENCY_KEY_REUSE_PAYLOAD_MISMATCH',
          message: 'Idempotency key was previously used with a different request payload.'
        }
      });
    }

    // Return previously saved response
    res.setHeader('X-Cache-Lookup', 'HIT (Idempotent replay)');
    return res.status(existing.statusCode).json(existing.body);
  }

  // Intercept json response to cache it
  const originalJson = res.json.bind(res);
  res.json = function(data) {
    // Only cache successful or client error responses (don't cache 5xx server bugs)
    if (res.statusCode < 500) {
      idempotencyStore.set(idempotencyKey, fingerprint, res.statusCode, data);
    }
    return originalJson(data);
  };

  req.idempotencyKey = idempotencyKey;
  next();
}
