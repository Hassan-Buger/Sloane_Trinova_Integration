/**
 * Server Entry Point
 * Enforces startup validation for required environment variables per Hard Rule 1.
 */

import { createApp } from './app.js';
import { config } from './config.js';
import { logger } from './middleware/sanitizer.js';
import { persistence } from './data/persistence.js';
import { clearExpired, BIN_DAYS } from './services/bin.js';
import { resetAll as resetTwoFactor } from './services/twoFactor.js';
import { migrateBusinesses } from './services/businessMigration.js';
import { runAutomation, getRules } from './services/automation.js';
import { tick as taskSyncTick, setAfterChange } from './services/trinovaTaskSync.js';
import { scanAndPush, subscriptionCount } from './services/webPush.js';
import { clientDirectory } from './services/clientDirectory.js';
import { trinovaDeadlines } from './services/trinovaDeadlines.js';

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

    // One-time: make the list of businesses match the owner's four (safe: see businessMigration.js)
    const businessChange = migrateBusinesses();
    if (businessChange === 'replaced' || businessChange === 'added') {
      logger.info(`Businesses updated (${businessChange}).`);
      persistence.scheduleFlush();
    }

    // Emergency switch for the developer: TWO_FACTOR_RESET=true turns two-step sign-in off
    // (for when the owner has lost both the phone and the recovery codes). Remove it afterwards.
    if (String(process.env.TWO_FACTOR_RESET || '').toLowerCase() === 'true') {
      const n = resetTwoFactor();
      persistence.scheduleFlush();
      logger.warn(`TWO_FACTOR_RESET is set: two-step sign-in was turned off for ${n} account(s). Remove TWO_FACTOR_RESET now.`);
    }

    if (!config.trinova.apiKey) {
      logger.warn('TRINOVA_API_KEY is not set. Sloane cannot read clients from TriNova until it is.');
    }

    // The Bin keeps deleted items for 30 days: clear out older ones now and every 6 hours.
    const clearBin = () => {
      const n = clearExpired();
      if (n > 0) {
        logger.info(`Bin: ${n} item${n === 1 ? '' : 's'} older than ${BIN_DAYS} days deleted for good.`);
        persistence.scheduleFlush();
      }
    };
    clearBin();
    const binTimer = setInterval(clearBin, 6 * 60 * 60 * 1000);
    if (binTimer.unref) binTimer.unref();

    // If the owner has allowed it, Sloane makes the tasks that the deadline rules find: every hour.
    const automate = async () => {
      try {
        if (getRules().deadlineTasks.mode !== 'auto') return;
        await Promise.all([clientDirectory.refresh(), trinovaDeadlines.refresh()]);
        const out = runAutomation();
        if (out.created > 0) {
          logger.info(`Automation: ${out.created} task${out.created === 1 ? '' : 's'} made from the deadline rules.`);
          persistence.scheduleFlush();
        }
      } catch (err) {
        logger.warn(`Automation could not run: ${err.message}`);
      }
    };
    const automationTimer = setInterval(automate, 60 * 60 * 1000);
    if (automationTimer.unref) automationTimer.unref();

    // Task syncing with the TriNova portal (only when it is switched on): every 4 minutes
    setAfterChange(() => persistence.scheduleFlush());
    const taskSyncTimer = setInterval(() => {
      taskSyncTick().catch(err => logger.warn(`Task sync could not run: ${err.message}`));
    }, 4 * 60 * 1000);
    if (taskSyncTimer.unref) taskSyncTimer.unref();

    // Alerts that reach a device when Sloane is closed: look for new ones every 5 minutes
    const pushTimer = setInterval(async () => {
      try {
        if (!subscriptionCount()) return;
        const out = await scanAndPush();
        if (out.alerts || out.briefing) persistence.scheduleFlush();
      } catch (err) {
        logger.warn(`Push alerts could not run: ${err.message}`);
      }
    }, 5 * 60 * 1000);
    if (pushTimer.unref) pushTimer.unref();

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
