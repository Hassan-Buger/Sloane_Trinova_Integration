/**
 * Server Entry Point
 * Enforces startup validation for required environment variables per Hard Rule 1.
 */

import { createApp } from './app.js';
import { config } from './config.js';
import { logger } from './middleware/sanitizer.js';
import { persistence } from './data/persistence.js';

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
    throw new Error(`Fatal startup error: Required environment variable(s) missing: ${missing.join(', ')}`);
  }
}

import { fileURLToPath } from 'node:url';

function isDirectExecution() {
  if (!process.argv[1]) return false;
  try {
    return fileURLToPath(import.meta.url).toLowerCase() === process.argv[1].toLowerCase();
  } catch (_) {
    return false;
  }
}

// In non-test direct execution, validate required startup environment variables and start server
if (isDirectExecution() && process.env.NODE_ENV !== 'test') {
  validateStartup();

  (async () => {
    // Load everything Sloane saved last time (or create the database on the first run).
    try {
      const saved = await persistence.start();
      if (saved.persistent) {
        logger.info(`Saving data to ${saved.kind}.`);
      } else {
        logger.warn('No database is available, so data is kept in memory only and will be lost on restart. Set DATABASE_URL, or run on Node 22.13 or newer so the built-in SQLite database can be used.');
      }
    } catch (err) {
      logger.error(`Could not open the database: ${err.message}. Sloane will start, but nothing will be saved.`);
    }

    if (!config.trinova.apiKey) {
      logger.warn('TRINOVA_API_KEY is not set. Sloane cannot read clients from TriNova until it is.');
    }

    const app = createApp();
    const host = process.env.HOST || '0.0.0.0';
    const server = app.listen(config.port, host, () => {
      logger.info(`Trinova API Server listening on ${host}:${config.port} [env: ${config.env}]`);
    });

    // Railway / Docker send SIGTERM on a redeploy: finish saving first.
    const shutdown = async () => {
      try { await persistence.stop(); } catch (_) { /* nothing more to do */ }
      server.close(() => process.exit(0));
      setTimeout(() => process.exit(0), 3000).unref();
    };
    process.on('SIGTERM', shutdown);
    process.on('SIGINT', shutdown);
  })();
}
