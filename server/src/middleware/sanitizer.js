/**
 * Log Sanitization Filter
 * Strictly redacts credentials, tokens, private CEO notes, and document buffers
 * per context/05_data_security_context.md §7.
 */

const REDACTED_KEYS = new Set([
  'authorization',
  'x-trinova-api-key',
  'api-key',
  'apikey',
  'password',
  'secret',
  'token',
  'bearer',
  'notes',
  'brain',
  'private_notes',
  'buffer',
  'file_content'
]);

export function sanitizeForLog(data) {
  if (data === null || data === undefined) return data;

  if (typeof data === 'string') {
    // Redact Bearer tokens in raw strings
    return data.replace(/Bearer\s+[A-Za-z0-9-_.]+/gi, 'Bearer [REDACTED]');
  }

  if (Array.isArray(data)) {
    return data.map(item => sanitizeForLog(item));
  }

  if (typeof data === 'object') {
    const sanitized = {};
    for (const [key, value] of Object.entries(data)) {
      const lowerKey = key.toLowerCase();
      if (REDACTED_KEYS.has(lowerKey)) {
        sanitized[key] = '[REDACTED]';
      } else if (typeof value === 'object' && value !== null) {
        sanitized[key] = sanitizeForLog(value);
      } else {
        sanitized[key] = value;
      }
    }
    return sanitized;
  }

  return data;
}

export const logger = {
  info(msg, meta = null) {
    if (meta) {
      console.log(`[INFO] ${msg}`, JSON.stringify(sanitizeForLog(meta)));
    } else {
      console.log(`[INFO] ${msg}`);
    }
  },
  warn(msg, meta = null) {
    if (meta) {
      console.warn(`[WARN] ${msg}`, JSON.stringify(sanitizeForLog(meta)));
    } else {
      console.warn(`[WARN] ${msg}`);
    }
  },
  error(msg, meta = null) {
    if (meta) {
      console.error(`[ERROR] ${msg}`, JSON.stringify(sanitizeForLog(meta)));
    } else {
      console.error(`[ERROR] ${msg}`);
    }
  }
};
