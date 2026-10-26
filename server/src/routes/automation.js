/**
 * "What Sloane may do on her own" (see services/automation.js).
 *
 * GET  /api/v1/automation            the rules, what is always locked, and what Sloane did on her own
 * PUT  /api/v1/automation/rules      change the deadline-task rule { mode: ask | auto, business }
 * POST /api/v1/automation/run        run the rule now (only does anything when it is automatic)
 *
 * Only the signed-in owner can use these (not an API key).
 */

import { clientDirectory } from '../services/clientDirectory.js';
import { trinovaDeadlines } from '../services/trinovaDeadlines.js';
import { getRules, updateRules, recentLog, runAutomation } from '../services/automation.js';
import { sendError, requireSession } from './helpers.js';

export function registerAutomationRoutes(app, { authenticate, requireScope }) {
  app.get('/api/v1/automation', authenticate, requireScope('sloane:read'), requireSession, (req, res) => {
    req.auditAction = 'automation_read';
    req.resourceType = 'automation';
    res.status(200).json({ status: 'success', data: { ...getRules(), log: recentLog(10) } });
  });

  app.put('/api/v1/automation/rules', authenticate, requireScope('sloane:write'), requireSession, (req, res) => {
    req.auditAction = 'automation_rules_changed';
    req.resourceType = 'automation';
    const out = updateRules(req.body || {}, req.actor);
    if (out.error) return sendError(res, 422, 'INVALID_RULE', out.error);
    res.status(200).json({ status: 'success', message: 'Saved.', data: { ...out.rules, log: recentLog(10) } });
  });

  app.post('/api/v1/automation/run', authenticate, requireScope('sloane:write'), requireSession, async (req, res) => {
    req.auditAction = 'automation_run';
    req.resourceType = 'automation';
    await Promise.all([clientDirectory.refresh(), trinovaDeadlines.refresh()]);
    const out = runAutomation();
    const message = !out.ran
      ? 'Nothing was made: the rule is set to "Ask me first".'
      : out.created ? `${out.created} task${out.created === 1 ? '' : 's'} made.` : 'Nothing to make: every deadline already has its task.';
    res.status(200).json({ status: 'success', message, data: { ...out, log: recentLog(10) } });
  });
}
