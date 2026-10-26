/**
 * What Sloane may do on her own, and what she must always ask about.
 *
 * Today there is one thing she can be allowed to do alone: make the tasks that the agreed
 * deadline rules find (see taskSuggestions.js), for one business or all of them. It starts as
 * "Ask me first". Everything else that reaches outside Sloane, or spends money, or is sensitive,
 * is locked to "Always ask" and cannot be switched on here.
 *
 * Every task made this way is marked as made by Sloane's automatic rule, and is written to a
 * short log so the owner can see exactly what was done while she was away.
 */

import { mockDb } from '../data/db.js';
import { newId } from '../routes/helpers.js';
import { buildSuggestions } from './taskSuggestions.js';
import { canonicalBusiness } from './businessOf.js';
import { createTaskRecord } from '../routes/tasks.js';

export const RULE_ID = 'deadlineTasks';
const LOG_LIMIT = 200;
const PER_RUN_LIMIT = 25;

/** Things Sloane never does without asking. They are shown, but cannot be switched to automatic. */
export const LOCKED_RULES = [
  { id: 'externalMessages', label: 'Send an email or message to anyone outside', note: 'Sloane drafts it; you read it and send it.' },
  { id: 'spending', label: 'Spend money or agree to a cost', note: 'Always your decision.' },
  { id: 'sensitive', label: 'Sensitive decisions, such as deleting records or changing who can see what', note: 'Always your decision.' }
];

function stored() {
  if (!Array.isArray(mockDb.automationRules)) mockDb.automationRules = [];
  return mockDb.automationRules.find(r => r.id === 'rules') || null;
}

/** The rules as they stand now (defaults filled in). */
export function getRules() {
  const r = stored() || {};
  const d = r.deadlineTasks || {};
  return {
    deadlineTasks: {
      mode: d.mode === 'auto' ? 'auto' : 'ask',
      // '' means every business; a name that no longer exists falls back to every business
      business: d.business && canonicalBusiness(d.business) ? canonicalBusiness(d.business) : ''
    },
    locked: LOCKED_RULES.map(l => ({ ...l, mode: 'ask' })),
    updatedAt: r.updatedAt || null,
    updatedBy: r.updatedBy || null
  };
}

/** Changes the deadline-task rule. Returns { error } for a bad choice. */
export function updateRules(patch = {}, actor = null) {
  const p = patch.deadlineTasks || patch;
  const next = {};
  if (p.mode !== undefined) {
    if (!['ask', 'auto'].includes(p.mode)) return { error: 'Choose "Ask me first" or "Do it automatically".' };
    next.mode = p.mode;
  }
  if (p.business !== undefined) {
    const wanted = String(p.business || '').trim();
    if (wanted && wanted.toLowerCase() !== 'all') {
      const name = canonicalBusiness(wanted);
      if (!name) return { error: `Sloane has no business called "${wanted}".` };
      next.business = name;
    } else {
      next.business = '';
    }
  }
  const current = getRules().deadlineTasks;
  let row = stored();
  if (!row) { row = { id: 'rules' }; mockDb.automationRules.push(row); }
  row.deadlineTasks = { ...current, ...next };
  row.updatedAt = new Date().toISOString();
  row.updatedBy = actor?.actorName || 'You';
  return { rules: getRules() };
}

/** The most recent things Sloane did on her own, newest first. */
export function recentLog(limit = 10) {
  return [...(mockDb.automationLog || [])].sort((a, b) => b.at.localeCompare(a.at)).slice(0, limit);
}

function writeLog(entry) {
  if (!Array.isArray(mockDb.automationLog)) mockDb.automationLog = [];
  mockDb.automationLog.push({ id: newId('aut'), at: new Date().toISOString(), ...entry });
  if (mockDb.automationLog.length > LOG_LIMIT) mockDb.automationLog.splice(0, mockDb.automationLog.length - LOG_LIMIT);
}

/**
 * Makes the tasks the rule allows. Does nothing unless the rule is on "Do it automatically",
 * even when the owner presses "Run it now".
 */
export function runAutomation(now = new Date()) {
  const rule = getRules().deadlineTasks;
  if (rule.mode !== 'auto') return { ran: false, created: 0, reason: 'The rule is set to "Ask me first".' };
  const found = buildSuggestions(now, { business: rule.business }).suggestions;
  const chosen = found.slice(0, PER_RUN_LIMIT);
  const made = [];
  for (const s of chosen) {
    const ref = s.clientId ? { companyId: s.companyId || s.clientId, clientId: s.clientId, clientName: s.clientName } : null;
    const task = createTaskRecord({
      ref,
      title: s.title,
      description: s.description,
      priority: s.priority,
      dueDate: s.dueDate,
      assigneeId: s.assigneeId,
      assigneeName: s.assigneeName,
      actor: { actorId: 'sloane_automation', actorName: 'Sloane' },
      extra: {
        sourceKey: s.key,
        businessArea: s.businessArea || null,
        origin: 'automation',
        creatorName: 'Sloane (automatic, from your rule)'
      }
    });
    made.push(task);
    writeLog({ kind: 'task_created', title: task.title, client: task.companyName || null, business: task.businessArea || null, taskId: task.id, rule: RULE_ID });
  }
  return { ran: true, created: made.length, left: Math.max(0, found.length - chosen.length), taskIds: made.map(t => t.id) };
}
