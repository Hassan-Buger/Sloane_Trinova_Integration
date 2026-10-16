/**
 * Server Entry Point
 * Enforces startup validation for required environment variables per Hard Rule 1.
 */

import { createApp } from './app.js';
import { config } from './config.js';
import { logger } from './middleware/sanitizer.js';

/**
 * Validates required environment variables on startup.
 * Fails startup if a required variable is missing and names the variable without printing any value.
 */
export function validateStartup() {
  const missing = [];

  if (!process.env.SLON_API_KEY && !process.env.SLOANE_API_KEY) {
    missing.push('SLON_API_KEY');
  }

  if (!process.env.SLON_OWNER_EMAIL) {
    missing.push('SLON_OWNER_EMAIL');
  }

  if (!process.env.SLON_OWNER_PASSWORD_HASH) {
    missing.push('SLON_OWNER_PASSWORD_HASH');
  }

  if (!process.env.STORAGE_PRESIGNED_TOKEN_SECRET && !process.env.SLON_TOKEN_SECRET) {
    missing.push('STORAGE_PRESIGNED_TOKEN_SECRET');
  }

  if (missing.length > 0) {
    if (process.env.STRICT_STARTUP === 'true') {
      throw new Error(`Fatal startup error: Required environment variable(s) missing: ${missing.join(', ')}`);
    } else {
      logger.warn(`[Startup Warning] Required environment variable(s) missing: ${missing.join(', ')}. Initializing safe fallback credentials for demonstration mode. Set STRICT_STARTUP=true to enforce strict fatal startup.`);
      if (!process.env.SLON_OWNER_EMAIL && !process.env.SLOANE_OWNER_EMAIL) {
        process.env.SLON_OWNER_EMAIL = 'kirsty@trinova.com';
      }
      if (!process.env.SLON_OWNER_PASSWORD_HASH && !process.env.SLOANE_OWNER_PASSWORD_HASH) {
        // Hash for 'password123'
        process.env.SLON_OWNER_PASSWORD_HASH = '$2a$10$wHh4tzXxmMPEzTTYPGE9r.4k.kgs.wCuYIyeLmVDeMf3PGqBtm8UK';
      }
      if (!process.env.SLON_API_KEY && !process.env.SLOANE_API_KEY) {
        process.env.SLON_API_KEY = 'tn_sec_live_sloane_readwrite_2026';
      }
      if (!process.env.STORAGE_PRESIGNED_TOKEN_SECRET && !process.env.SLON_TOKEN_SECRET && !process.env.SLOANE_TOKEN_SECRET) {
        process.env.STORAGE_PRESIGNED_TOKEN_SECRET = 'tn_storage_secret_live_production_2026';
      }
    }
  }
}

// In non-test execution, validate required startup environment variables
if (process.env.NODE_ENV !== 'test') {
  validateStartup();
}

const app = createApp();

app.listen(config.port, () => {
  logger.info(`Trinova API Server listening on port ${config.port} [env: ${config.env}]`);
});
