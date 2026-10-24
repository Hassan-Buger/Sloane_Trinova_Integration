/**
 * Central Audit Logging Middleware
 * Records actor, action, record, and timestamp for all API requests
 * per context/05_data_security_context.md §6.
 */

import { logger } from './sanitizer.js';

const MAX_AUDIT_ENTRIES = 2000;

class AuditStore {
  constructor() {
    this.logs = [];
  }

  record(entry) {
    const record = {
      id: `audit_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`,
      timestamp: new Date().toISOString(),
      ...entry
    };
    this.logs.unshift(record);
    // Keep the most recent entries only, so the log cannot grow without limit.
    if (this.logs.length > MAX_AUDIT_ENTRIES) this.logs.length = MAX_AUDIT_ENTRIES;
    // Log with sanitized metadata
    logger.info(`Audit Log: [${record.action}] by ${record.actorId} on ${record.resourceType || 'API'}:${record.resourceId || 'root'} (${record.statusCode})`);
    return record;
  }

  getLogs(filter = {}) {
    let results = [...this.logs];
    if (filter.actorId) {
      results = results.filter(l => l.actorId === filter.actorId);
    }
    if (filter.action) {
      results = results.filter(l => l.action === filter.action);
    }
    if (filter.limit) {
      results = results.slice(0, filter.limit);
    }
    return results;
  }

  clear() {
    this.logs = [];
  }
}

export const auditStore = new AuditStore();

export function auditMiddleware(req, res, next) {
  const startTime = Date.now();

  // Capture response finish
  const originalEnd = res.end;
  res.end = function(...args) {
    const durationMs = Date.now() - startTime;
    const actor = req.actor || { actorId: 'anonymous', actorName: 'Unauthenticated Request' };

    // Determine action descriptor from method and path
    const action = req.auditAction || `${req.method.toLowerCase()}_${req.baseUrl || req.path.replace(/\//g, '_')}`;

    auditStore.record({
      actorId: actor.actorId,
      actorName: actor.actorName,
      action,
      method: req.method,
      path: req.path,
      resourceType: req.resourceType || req.path.split('/')[3] || 'endpoint',
      resourceId: req.params?.id || req.query?.id || req.body?.id || null,
      statusCode: res.statusCode,
      ip: req.ip || req.connection?.remoteAddress || '127.0.0.1',
      durationMs
    });

    originalEnd.apply(res, args);
  };

  if (typeof next === 'function') next();
}
