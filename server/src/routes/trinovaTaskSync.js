/**
 * Task syncing with the TriNova portal (see services/trinovaTaskSync.js).
 *
 * GET  /api/v1/integrations/trinova/task-sync          status, and what is waiting to be sent
 * PUT  /api/v1/integrations/trinova/task-sync          { enabled: true | false }  (signed-in owner only)
 * POST /api/v1/integrations/trinova/task-sync/run      sync now (signed-in owner only)
 * POST /api/v1/integrations/trinova/webhooks/tasks     TriNova tells Sloane something changed
 *                                                      (public; checked by HMAC signature)
 */

import { getStatus, setEnabled, runSync, verifyWebhook } from '../services/trinovaTaskSync.js';
import { sendError, requireSession } from './helpers.js';

export function registerTrinovaTaskSyncRoutes(app, { authenticate, requireScope }) {
  app.get('/api/v1/integrations/trinova/task-sync', authenticate, requireScope('sloane:read'), requireSession, (req, res) => {
    req.auditAction = 'trinova_task_sync_read';
    req.resourceType = 'trinova_task_sync';
    res.status(200).json({ status: 'success', data: getStatus() });
  });

  app.put('/api/v1/integrations/trinova/task-sync', authenticate, requireScope('sloane:write'), requireSession, (req, res) => {
    req.auditAction = 'trinova_task_sync_switched';
    req.resourceType = 'trinova_task_sync';
    if (typeof req.body?.enabled !== 'boolean') return sendError(res, 422, 'INVALID_CHOICE', 'Choose On or Off.');
    const out = setEnabled(req.body.enabled);
    if (out.error) return sendError(res, 409, 'TASK_KEY_MISSING', out.error);
    res.status(200).json({ status: 'success', message: out.enabled ? 'Task syncing is on.' : 'Task syncing is off.', data: getStatus() });
  });

  app.post('/api/v1/integrations/trinova/task-sync/run', authenticate, requireScope('sloane:write'), requireSession, async (req, res) => {
    req.auditAction = 'trinova_task_sync_run';
    req.resourceType = 'trinova_task_sync';
    const out = await runSync({ reason: 'owner' });
    if (!out.ran) {
      const why = { not_configured: 'TriNova has not given Sloane a task key yet.', off: 'Task syncing is switched off.', busy: 'A sync is already running. Try again in a moment.' }[out.reason] || 'Nothing was synced.';
      return sendError(res, 409, 'SYNC_NOT_RUN', why);
    }
    res.status(200).json({ status: 'success', message: out.ok ? 'Synced.' : out.error, data: getStatus() });
  });

  // TriNova -> Sloane. The body is only used to check the signature and the time; what changed is
  // always fetched again from the portal, so a forged or partial message can never write a task.
  app.post('/api/v1/integrations/trinova/webhooks/tasks', (req, res) => {
    req.auditAction = 'trinova_task_webhook';
    req.resourceType = 'trinova_task_sync';
    const check = verifyWebhook(req.rawBody || '', req.headers['x-trinova-signature']);
    if (!check.ok) {
      if (check.code === 'NOT_CONFIGURED') return sendError(res, 503, 'WEBHOOK_NOT_CONFIGURED', 'Task messages from TriNova are not switched on.');
      return sendError(res, 401, 'INVALID_SIGNATURE', 'The message could not be checked.');
    }
    runSync({ reason: 'webhook' }).catch(() => { /* the next timer run retries */ });
    res.status(202).json({ status: 'accepted' });
  });
}
