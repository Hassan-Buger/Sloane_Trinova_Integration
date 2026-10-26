/**
 * "Sloane suggests": tasks that Sloane has worked out need doing (see services/taskSuggestions.js).
 * The owner approves them; nothing is created without that.
 *
 * GET  /api/v1/suggestions                 what Sloane suggests now
 * POST /api/v1/suggestions/accept {key}    make the task
 * POST /api/v1/suggestions/accept-all      make every suggested task (optionally only {keys: [...]})
 * POST /api/v1/suggestions/dismiss {key}   "Not needed": it will not come back
 * POST /api/v1/suggestions/reset           bring back everything that was dismissed
 */

import { clientDirectory } from '../services/clientDirectory.js';
import { trinovaDeadlines } from '../services/trinovaDeadlines.js';
import { buildSuggestions, dismissSuggestion, resetDismissals } from '../services/taskSuggestions.js';
import { createTaskRecord } from './tasks.js';
import { sendError } from './helpers.js';

const GONE = 'Sloane is no longer suggesting that task. It may already have been made or dismissed.';

function makeFrom(s, actor) {
  const ref = s.clientId ? { companyId: s.companyId || s.clientId, clientId: s.clientId, clientName: s.clientName } : null;
  return createTaskRecord({
    ref,
    title: s.title,
    description: s.description,
    priority: s.priority,
    dueDate: s.dueDate,
    assigneeId: s.assigneeId,
    assigneeName: s.assigneeName,
    actor,
    extra: {
      sourceKey: s.key,
      origin: 'suggested',
      creatorName: `Sloane (approved by ${actor?.actorName || 'you'})`
    }
  });
}

export function registerSuggestionRoutes(app, { authenticate, requireScope }) {
  app.get('/api/v1/suggestions', authenticate, requireScope('sloane:read'), async (req, res) => {
    req.auditAction = 'suggestions_read';
    req.resourceType = 'suggestion';
    // Work from the latest TriNova clients and deadlines (remembered for a minute)
    await Promise.all([clientDirectory.refresh(), trinovaDeadlines.refresh()]);
    const { suggestions, dismissedCount } = buildSuggestions();
    res.status(200).json({ status: 'success', data: suggestions, meta: { total: suggestions.length, dismissedCount } });
  });

  app.post('/api/v1/suggestions/accept', authenticate, requireScope('sloane:write'), (req, res) => {
    req.auditAction = 'suggestion_accepted';
    req.resourceType = 'suggestion';
    const key = String(req.body?.key || '');
    req.resourceId = key;
    // Only a suggestion Sloane is making right now can be accepted: no task can be made from made-up text
    const s = buildSuggestions().suggestions.find(x => x.key === key);
    if (!s) return sendError(res, 409, 'SUGGESTION_GONE', GONE);
    const task = makeFrom(s, req.actor);
    res.status(201).json({ status: 'success', message: `Task made: ${task.title}`, data: task });
  });

  app.post('/api/v1/suggestions/accept-all', authenticate, requireScope('sloane:write'), (req, res) => {
    req.auditAction = 'suggestions_accepted_all';
    req.resourceType = 'suggestion';
    const only = Array.isArray(req.body?.keys) ? new Set(req.body.keys.map(String)) : null;
    const chosen = buildSuggestions().suggestions.filter(s => !only || only.has(s.key));
    const tasks = chosen.map(s => makeFrom(s, req.actor));
    res.status(201).json({
      status: 'success',
      message: tasks.length ? `${tasks.length} task${tasks.length === 1 ? '' : 's'} made.` : 'There was nothing to make.',
      data: { created: tasks.length, taskIds: tasks.map(t => t.id) }
    });
  });

  app.post('/api/v1/suggestions/dismiss', authenticate, requireScope('sloane:write'), (req, res) => {
    req.auditAction = 'suggestion_dismissed';
    req.resourceType = 'suggestion';
    const key = String(req.body?.key || '');
    req.resourceId = key;
    if (!key || !buildSuggestions().suggestions.some(x => x.key === key)) return sendError(res, 409, 'SUGGESTION_GONE', GONE);
    dismissSuggestion(key);
    res.status(200).json({ status: 'success', message: 'Sloane will not suggest that again.' });
  });

  app.post('/api/v1/suggestions/reset', authenticate, requireScope('sloane:write'), (req, res) => {
    req.auditAction = 'suggestions_reset';
    req.resourceType = 'suggestion';
    const n = resetDismissals();
    res.status(200).json({ status: 'success', message: n ? `${n} suggestion${n === 1 ? ' is' : 's are'} back.` : 'Nothing had been dismissed.', data: { restored: n } });
  });
}
