/**
 * Two-way task sync between Sloane and the TriNova portal.
 *
 * What goes where
 *  - Only tasks that belong to TriNova Accounting are sent to the portal. CFI Awarding, Emerald
 *    Education and MTDflow work never leaves Sloane.
 *  - Sloane-only details (progress notes, repeat rule, dependencies, links, next action, business)
 *    are never sent and never overwritten by the portal.
 *
 * How it stays in step
 *  - Each linked task remembers the portal's last known values (`task.portal.snapshot`).
 *  - Pull: tasks the portal changed since the last pull. A field the portal changed (and Sloane did
 *    not) is taken. If both changed, the later change wins, except that "completed" always wins.
 *  - Push: any field that now differs from the remembered portal values is sent (PATCH); a new task
 *    is sent once (POST), with Sloane's own id as `external_ref` so it can never be duplicated.
 *  - A task deleted in Sloane is marked cancelled on the portal (never deleted there). A task the
 *    portal deletes goes to Sloane's Bin.
 *  - Nothing is queued separately: whatever still differs is retried on the next run, with a
 *    longer wait after each failure.
 *
 * Off by default. It runs only when TRINOVA_TASKS_API_KEY is set AND the owner switches it on.
 */

import crypto from 'node:crypto';
import { mockDb } from '../data/db.js';
import { config } from '../config.js';
import { clientDirectory } from './clientDirectory.js';
import { businessOfTask, canonicalBusiness, defaultTrinovaBusiness } from './businessOf.js';
import { takeOut, putInBin } from './bin.js';
import { createTaskRecord, spawnNextRepeat } from '../routes/tasks.js';

const META_ID = 'trinova-task-sync';
const CLOSED = ['Completed', 'Cancelled'];
const PAGE_SIZE = 50;
const MAX_PAGES = 40;
const MAX_PUSH_PER_RUN = 60;
const OVERLAP_MS = 60 * 1000;

/* ------------------------------------------------------------------ mapping */

const STATUS_TO_PORTAL = { Pending: 'pending', In_Progress: 'in_progress', Under_Review: 'under_review', Completed: 'completed', Cancelled: 'cancelled' };
const STATUS_FROM_PORTAL = {
  pending: 'Pending', not_started: 'Pending', queued: 'Pending',
  in_progress: 'In_Progress',
  under_review: 'Under_Review', approval: 'Under_Review',
  completed: 'Completed', done: 'Completed',
  cancelled: 'Cancelled', canceled: 'Cancelled'
};
const PRIORITY_TO_PORTAL = { Low: 'low', Normal: 'normal', Medium: 'normal', High: 'high', Urgent: 'urgent' };
const PRIORITY_FROM_PORTAL = { low: 'Low', normal: 'Normal', standard: 'Normal', high: 'High', urgent: 'Urgent', immediate: 'Urgent' };

const FIELDS = ['title', 'description', 'status', 'priority', 'due_date', 'assignee_id', 'department', 'is_blocked', 'blocked_reason'];

const day = v => { const m = v ? String(v).match(/^(\d{4}-\d{2}-\d{2})/) : null; return m ? m[1] : null; };
const str = v => (v === null || v === undefined ? '' : String(v));

/** Does this staff list entry match a Sloane team member? Email first, then the full name. */
function staffMatches(member, staff) {
  const e = str(member.email).trim().toLowerCase();
  if (e && str(staff.email).trim().toLowerCase() === e) return true;
  return !e && str(member.name).trim().toLowerCase() === str(staff.name).trim().toLowerCase();
}

/** The portal's id for a Sloane person, or null when they are not matched yet. */
function portalPersonId(task) {
  if (!task.assigneeId) return null;
  const member = (mockDb.teamMembers || []).find(m => m.id === task.assigneeId);
  if (!member) return null;
  if (member.portalId) return member.portalId;
  const hit = (runtime.staff || []).find(s => staffMatches(member, s));
  return hit ? hit.id : null;
}

/** Sloane's person for a portal staff id (or null). */
function sloanePerson(portalId, name) {
  if (!portalId) return null;
  const members = mockDb.teamMembers || [];
  const direct = members.find(m => m.portalId === portalId);
  if (direct) return direct;
  const staff = (runtime.staff || []).find(s => s.id === portalId);
  if (staff) {
    const hit = members.find(m => staffMatches(m, staff));
    if (hit) return hit;
  }
  if (name) return members.find(m => str(m.name).trim().toLowerCase() === str(name).trim().toLowerCase()) || null;
  return null;
}

/** A Sloane task as the portal would hold it (only fields that can be worked out). */
export function toPortalFields(task) {
  const out = {
    title: str(task.title),
    description: str(task.description),
    status: STATUS_TO_PORTAL[task.status] || 'pending',
    priority: PRIORITY_TO_PORTAL[task.priority] || 'normal',
    due_date: day(task.dueDate),
    department: str(task.department) || null,
    is_blocked: Boolean(task.isBlocked),
    blocked_reason: task.isBlocked ? (str(task.blocker) || null) : null
  };
  const person = portalPersonId(task);
  // Someone not matched to a portal user is left out, so the portal's assignee is never wiped
  if (person) out.assignee_id = person;
  return out;
}

/** The same fields from a portal task. */
function snapshotOf(p) {
  return {
    title: str(p.title),
    description: str(p.description),
    status: STATUS_FROM_PORTAL[str(p.status).toLowerCase()] ? STATUS_TO_PORTAL[STATUS_FROM_PORTAL[str(p.status).toLowerCase()]] : str(p.status).toLowerCase(),
    priority: PRIORITY_FROM_PORTAL[str(p.priority).toLowerCase()] ? PRIORITY_TO_PORTAL[PRIORITY_FROM_PORTAL[str(p.priority).toLowerCase()]] : str(p.priority).toLowerCase(),
    due_date: day(p.due_date),
    assignee_id: p.assignee_id || null,
    department: str(p.department) || null,
    is_blocked: Boolean(p.is_blocked),
    blocked_reason: p.is_blocked ? (str(p.blocked_reason) || null) : null
  };
}

/** Fields (portal names) that Sloane has changed since the portal's last known values. */
export function changedFields(task) {
  const now = toPortalFields(task);
  const snap = (task.portal && task.portal.snapshot) || {};
  const out = {};
  const norm = v => (v === undefined || v === '' ? null : v);
  for (const f of FIELDS) {
    if (!(f in now)) continue;
    if (norm(now[f]) !== norm(snap[f])) out[f] = now[f];
  }
  return out;
}

/* ------------------------------------------------------------------ state */

const runtime = { staff: [], running: false, afterChange: null };

/** Lets the server save the data after a background run. */
export function setAfterChange(fn) { runtime.afterChange = typeof fn === 'function' ? fn : null; }

function meta() {
  if (!Array.isArray(mockDb.appMeta)) mockDb.appMeta = [];
  let row = mockDb.appMeta.find(m => m.id === META_ID);
  if (!row) {
    row = { id: META_ID, enabled: false, cursor: null, lastRunAt: null, lastSuccessAt: null, lastError: null, failures: 0, nextAttemptAt: null, lastResult: null, staffCount: 0, staffUnmatched: [] };
    mockDb.appMeta.push(row);
  }
  return row;
}

export function isConfigured() { return Boolean(config.trinova.tasksApiKey); }

/* ------------------------------------------------------------------ portal calls */

/** One call to the portal with the task key. Never throws. */
export async function portalRequest(method, pathAndQuery, { body, idempotencyKey, timeoutMs } = {}) {
  const { baseUrl, tasksApiKey, timeoutMs: defaultTimeout } = config.trinova;
  const limit = timeoutMs || defaultTimeout || 8000;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), limit);
  try {
    const res = await fetch(`${baseUrl}${pathAndQuery}`, {
      method,
      headers: {
        Accept: 'application/json',
        'X-Requested-With': 'sloane',
        Authorization: `Bearer ${tasksApiKey}`,
        ...(body ? { 'Content-Type': 'application/json' } : {}),
        ...(idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {})
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: controller.signal
    });
    let json = null;
    try { json = await res.json(); } catch (_) { /* not JSON */ }
    return { status: res.status, ok: res.ok, json, retryAfter: Number(res.headers.get('retry-after')) || null };
  } catch (err) {
    return { status: 0, ok: false, json: null, error: err.name === 'AbortError' ? `no answer within ${Math.round(limit / 1000)} seconds` : err.message };
  } finally {
    clearTimeout(timer);
  }
}

/** A stable UUID-shaped key for one task, so a retried create can never make two. */
function idempotencyKeyFor(taskId) {
  const h = crypto.createHash('sha256').update(`sloane-task:${taskId}`).digest('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

/** Turns a failed call into one plain sentence. */
function problemFrom(res) {
  const code = res.json && res.json.error && res.json.error.code;
  if (res.status === 0) return `TriNova could not be reached (${res.error || 'no answer'}).`;
  if (res.status === 401 || res.status === 403) return 'TriNova did not accept Sloane’s task key.';
  if (res.status === 404 && code === 'TASK_NOT_FOUND') return 'TriNova said it could not find that task.';
  if (res.status === 404) return 'TriNova has not switched on tasks yet.';
  if (res.status === 429) return 'TriNova asked Sloane to slow down. It will try again shortly.';
  if (res.status === 422) return `TriNova refused a task: ${(res.json && res.json.error && res.json.error.message) || 'it did not look right'}.`;
  if (res.status >= 500) return 'TriNova had a problem on its side. Sloane will try again.';
  return `TriNova answered with an unexpected error (${res.status}).`;
}

/* ------------------------------------------------------------------ staff */

async function syncStaff(m) {
  const res = await portalRequest('GET', '/staff');
  if (!res.ok) return res;
  const list = Array.isArray(res.json && res.json.data) ? res.json.data : [];
  runtime.staff = list.filter(s => s && s.id).map(s => ({ id: String(s.id), name: str(s.name), email: str(s.email) }));
  // Remember the match on the Team page so it survives a change of name
  for (const member of mockDb.teamMembers || []) {
    const hit = runtime.staff.find(s => staffMatches(member, s));
    if (hit) member.portalId = hit.id;
  }
  m.staffCount = runtime.staff.length;
  m.staffUnmatched = runtime.staff.filter(s => !(mockDb.teamMembers || []).some(mem => mem.portalId === s.id)).map(s => s.name || s.email || s.id);
  return res;
}

/* ------------------------------------------------------------------ pull */

function localTaskFor(p) {
  const tasks = mockDb.tasks || [];
  return tasks.find(t => t.portal && String(t.portal.id) === String(p.id))
    || (p.external_ref ? tasks.find(t => t.id === p.external_ref) : null)
    || null;
}

/** Was this portal task deleted in Sloane (it sits in the Bin)? */
function inBin(p) {
  return (mockDb.bin || []).some(b => b.kind === 'task' && (b.removed || []).some(r => r.record && ((r.record.portal && String(r.record.portal.id) === String(p.id)) || (p.external_ref && r.record.id === p.external_ref))));
}

function clientRef(p) {
  if (p.client_id === null || p.client_id === undefined) return null;
  const client = clientDirectory.find(String(p.client_id));
  return client ? { companyId: client.companyId || client.id, clientId: client.id, clientName: client.name } : null;
}

/** Applies the portal values to a Sloane task, field by field (see the rules at the top). */
function applyPortal(task, p, stats) {
  const snap = (task.portal && task.portal.snapshot) || {};
  const mine = toPortalFields(task);
  const theirs = snapshotOf(p);
  const localTime = Date.parse(task.updatedAt || 0) || 0;
  const portalTime = Date.parse(p.updated_at || 0) || 0;
  let changed = false;
  const before = task.status;

  const take = field => {
    changed = true;
    if (field === 'title') task.title = theirs.title || task.title;
    else if (field === 'description') task.description = theirs.description;
    else if (field === 'status') {
      const s = STATUS_FROM_PORTAL[theirs.status];
      if (s) { task.status = s; if (s === 'Completed') task.completedAt = task.completedAt || p.updated_at || new Date().toISOString(); }
    } else if (field === 'priority') {
      const pr = PRIORITY_FROM_PORTAL[theirs.priority];
      if (pr) task.priority = pr;
    } else if (field === 'due_date') task.dueDate = theirs.due_date;
    else if (field === 'department') task.department = theirs.department || '';
    else if (field === 'is_blocked') task.isBlocked = theirs.is_blocked;
    else if (field === 'blocked_reason') task.blocker = theirs.blocked_reason;
    else if (field === 'assignee_id') {
      const person = sloanePerson(theirs.assignee_id, p.assignee_name);
      task.assigneeId = person ? person.id : null;
      task.assigneeName = person ? person.name : (str(p.assignee_name) || null);
    }
  };

  for (const f of FIELDS) {
    const same = (a, b) => (a === undefined || a === '' ? null : a) === (b === undefined || b === '' ? null : b);
    if (same(theirs[f], snap[f])) continue;
    const mineChanged = f in mine && !same(mine[f], snap[f]);
    if (!mineChanged || same(mine[f], theirs[f])) { take(f); continue; }
    // Both changed, to different values
    if (f === 'status') {
      if (theirs.status === 'completed') take(f);       // finished on either side always wins
      else if (mine.status === 'completed') { /* keep ours; it will be sent */ }
      else if (portalTime > localTime) take(f);
    } else if (portalTime > localTime) take(f);
    stats.conflicts++;
  }

  const wasOpen = !CLOSED.includes(task.status);
  task.portal = { id: p.id, syncedAt: new Date().toISOString(), updatedAt: p.updated_at || null, snapshot: theirs };
  if (changed) {
    task.updatedAt = new Date().toISOString();
    task.version = (task.version || 1) + 1;
    stats.updated++;
    if (before !== 'Completed' && task.status === 'Completed') spawnNextRepeat(task, { actorId: 'trinova_sync', actorName: 'TriNova portal' });
  }
}

function createFromPortal(p, stats) {
  const theirs = snapshotOf(p);
  const ref = clientRef(p);
  const person = sloanePerson(theirs.assignee_id, p.assignee_name);
  const task = createTaskRecord({
    ref,
    title: str(p.title) || 'Task from TriNova',
    description: str(p.description),
    status: STATUS_FROM_PORTAL[theirs.status] || 'Pending',
    priority: PRIORITY_FROM_PORTAL[theirs.priority] || 'Normal',
    dueDate: theirs.due_date,
    assigneeId: person ? person.id : null,
    assigneeName: person ? person.name : (str(p.assignee_name) || null),
    actor: { actorId: 'trinova_sync', actorName: 'TriNova portal' },
    extra: {
      businessArea: defaultTrinovaBusiness() || canonicalBusiness('TriNova Accounting'),
      department: theirs.department || '',
      isBlocked: theirs.is_blocked,
      blocker: theirs.blocked_reason,
      origin: 'trinova',
      creatorName: 'TriNova portal',
      portal: { id: p.id, syncedAt: new Date().toISOString(), updatedAt: p.updated_at || null, snapshot: theirs }
    }
  });
  stats.created++;
  return task;
}

function removeFromSloane(task, stats) {
  const idx = (mockDb.tasks || []).findIndex(t => t.id === task.id);
  if (idx < 0) return;
  const item = takeOut('tasks', idx);
  const entry = putInBin({ kind: 'task', label: item.record.title || 'Task', where: 'Deleted in the TriNova portal', removed: [item] });
  entry.portalNotified = true; // TriNova already knows: do not send "cancelled" back
  stats.removed++;
}

async function pull(m, stats) {
  const since = m.cursor ? `&updated_since=${encodeURIComponent(m.cursor)}` : '';
  const startedAt = new Date(Date.now() - OVERLAP_MS).toISOString();
  for (let page = 1; page <= MAX_PAGES; page++) {
    const res = await portalRequest('GET', `/tasks?page=${page}&per_page=${PAGE_SIZE}${since}`, { timeoutMs: 20000 });
    if (!res.ok) return { error: res };
    const rows = Array.isArray(res.json && res.json.data) ? res.json.data : [];
    for (const p of rows) {
      if (!p || p.id === undefined || p.id === null) continue;
      stats.pulled++;
      if (inBin(p)) continue;
      const local = localTaskFor(p);
      if (!local) {
        if (!p.is_deleted) createFromPortal(p, stats);
        continue;
      }
      if (p.is_deleted) { removeFromSloane(local, stats); continue; }
      applyPortal(local, p, stats);
    }
    const pg = res.json && res.json.pagination;
    if (!(pg && pg.has_more) || rows.length === 0) break;
  }
  m.cursor = startedAt;
  return { ok: true };
}

/* ------------------------------------------------------------------ push */

/** Can this task go to the portal? Only TriNova Accounting work for a client the portal knows (or none). */
export function isSendable(task) {
  if (businessOfTask(task) !== canonicalBusiness('TriNova Accounting')) return false;
  if (task.clientId) return clientDirectory.trinova.has(String(task.clientId)) && /^\d+$/.test(String(task.clientId));
  return true;
}

function pushPlan() {
  const toCreate = [];
  const toUpdate = [];
  let skipped = 0;
  for (const t of mockDb.tasks || []) {
    if (!isSendable(t)) { if (businessOfTask(t) === canonicalBusiness('TriNova Accounting')) skipped++; continue; }
    if (!t.portal || !t.portal.id) { toCreate.push(t); continue; }
    if (Object.keys(changedFields(t)).length) toUpdate.push(t);
  }
  const toCancel = (mockDb.bin || []).filter(b => b.kind === 'task' && !b.portalNotified
    && (b.removed || []).some(r => r.record && r.record.portal && r.record.portal.id && r.record.status !== 'Cancelled'));
  return { toCreate, toUpdate, toCancel, skipped };
}

async function push(m, stats) {
  const plan = pushPlan();
  stats.skipped = plan.skipped;
  let budget = MAX_PUSH_PER_RUN;

  for (const t of plan.toCreate) {
    if (budget-- <= 0) break;
    const fields = toPortalFields(t);
    const body = { external_ref: t.id, client_id: t.clientId ? Number(t.clientId) : null, ...fields };
    const res = await portalRequest('POST', '/tasks', { body, idempotencyKey: idempotencyKeyFor(t.id) });
    if (!res.ok) return { error: res };
    const made = (res.json && res.json.data) || {};
    if (made.id === undefined || made.id === null) { stats.problems.push(`"${t.title}": TriNova did not return an id.`); continue; }
    t.portal = { id: made.id, syncedAt: new Date().toISOString(), updatedAt: made.updated_at || null, snapshot: { ...snapshotOf(made), ...fieldsToSnapshot(fields) } };
    stats.pushed++;
  }

  for (const t of plan.toUpdate) {
    if (budget-- <= 0) break;
    const diff = changedFields(t);
    const res = await portalRequest('PATCH', `/tasks/${encodeURIComponent(t.portal.id)}`, { body: diff });
    if (res.status === 404) { stats.problems.push(`"${t.title}" no longer exists on TriNova.`); t.portal = null; continue; }
    if (!res.ok) return { error: res };
    const back = (res.json && res.json.data) || {};
    t.portal = { id: t.portal.id, syncedAt: new Date().toISOString(), updatedAt: back.updated_at || t.portal.updatedAt, snapshot: { ...t.portal.snapshot, ...fieldsToSnapshot(diff) } };
    stats.pushed++;
  }

  for (const entry of plan.toCancel) {
    if (budget-- <= 0) break;
    const rec = entry.removed.find(r => r.record && r.record.portal && r.record.portal.id).record;
    const res = await portalRequest('PATCH', `/tasks/${encodeURIComponent(rec.portal.id)}`, { body: { status: 'cancelled' } });
    if (res.ok || res.status === 404) { entry.portalNotified = true; stats.cancelled++; continue; }
    return { error: res };
  }
  return { ok: true };
}

function fieldsToSnapshot(fields) {
  const out = {};
  for (const f of FIELDS) if (f in fields) out[f] = fields[f];
  return out;
}

/* ------------------------------------------------------------------ run */

/** How long to wait after this many failures in a row, in minutes. */
export function backoffMinutes(failures) {
  return Math.min(60, Math.pow(2, Math.max(0, failures - 1)));
}

/** What would be sent, without calling TriNova. */
export function preview() {
  const plan = pushPlan();
  return { wouldSend: plan.toCreate.length, wouldUpdate: plan.toUpdate.length, wouldCancel: plan.toCancel.length, notSent: plan.skipped };
}

/**
 * One sync: staff, pull, push. Safe to call at any time; only one runs at once.
 * @param {object} [options]
 * @param {string} [options.reason]
 */
export async function runSync({ reason = 'timer' } = {}) {
  const m = meta();
  if (!isConfigured()) return { ran: false, reason: 'not_configured' };
  if (!m.enabled) return { ran: false, reason: 'off' };
  if (runtime.running) return { ran: false, reason: 'busy' };
  runtime.running = true;
  const stats = { pulled: 0, created: 0, updated: 0, removed: 0, conflicts: 0, pushed: 0, cancelled: 0, skipped: 0, problems: [] };
  m.lastRunAt = new Date().toISOString();
  try {
    await clientDirectory.refresh();
    let failure = null;
    const staff = await syncStaff(m);
    if (!staff.ok) failure = staff;
    if (!failure) { const r = await pull(m, stats); if (r.error) failure = r.error; }
    if (!failure) { const r = await push(m, stats); if (r.error) failure = r.error; }

    if (failure) {
      m.failures += 1;
      m.lastError = problemFrom(failure);
      const wait = failure.retryAfter ? Math.ceil(failure.retryAfter / 60) : backoffMinutes(m.failures);
      m.nextAttemptAt = new Date(Date.now() + wait * 60 * 1000).toISOString();
    } else {
      m.failures = 0;
      m.lastError = stats.problems.length ? stats.problems[0] : null;
      m.lastSuccessAt = new Date().toISOString();
      m.nextAttemptAt = null;
    }
    m.lastResult = { ...stats, problems: stats.problems.slice(0, 5), reason };
    if (runtime.afterChange) runtime.afterChange();
    return { ran: true, ok: !failure, error: failure ? m.lastError : null, ...m.lastResult };
  } finally {
    runtime.running = false;
  }
}

/** Called by the timer: runs only when it is switched on and any waiting time is over. */
export async function tick(now = Date.now()) {
  const m = meta();
  if (!isConfigured() || !m.enabled) return null;
  if (m.nextAttemptAt && Date.parse(m.nextAttemptAt) > now) return null;
  return runSync({ reason: 'timer' });
}

/** Switches syncing on or off. Turning it on needs the key. */
export function setEnabled(enabled) {
  const m = meta();
  if (enabled && !isConfigured()) return { error: 'TriNova has not given Sloane a task key yet, so task syncing cannot be switched on.' };
  m.enabled = Boolean(enabled);
  if (m.enabled) { m.failures = 0; m.nextAttemptAt = null; }
  return { enabled: m.enabled };
}

/** What the Settings page shows. */
export function getStatus() {
  const m = meta();
  const pv = preview();
  return {
    configured: isConfigured(),
    webhookConfigured: Boolean(config.trinova.webhookSecret),
    enabled: Boolean(m.enabled),
    running: runtime.running,
    lastRunAt: m.lastRunAt,
    lastSuccessAt: m.lastSuccessAt,
    lastError: m.lastError,
    failures: m.failures,
    nextAttemptAt: m.nextAttemptAt,
    lastResult: m.lastResult,
    waiting: pv.wouldSend + pv.wouldUpdate + pv.wouldCancel,
    preview: pv,
    staff: { count: m.staffCount || 0, notMatched: m.staffUnmatched || [] }
  };
}

/* ------------------------------------------------------------------ webhook */

/** Checks the portal's signature (HMAC-SHA256 of the raw body) and that the message is recent. */
export function verifyWebhook(rawBody, signatureHeader, secret = config.trinova.webhookSecret, now = Date.now()) {
  if (!secret) return { ok: false, code: 'NOT_CONFIGURED' };
  const given = str(signatureHeader).replace(/^sha256=/i, '').trim().toLowerCase();
  const expected = crypto.createHmac('sha256', secret).update(rawBody || '').digest('hex');
  const a = Buffer.from(given.padEnd(expected.length, '0').slice(0, expected.length));
  const b = Buffer.from(expected);
  if (given.length !== expected.length || !crypto.timingSafeEqual(a, b)) return { ok: false, code: 'BAD_SIGNATURE' };
  let payload = null;
  try { payload = JSON.parse(rawBody); } catch (_) { return { ok: false, code: 'BAD_BODY' }; }
  const sent = Date.parse(payload && payload.timestamp);
  if (!Number.isFinite(sent) || Math.abs(now - sent) > 15 * 60 * 1000) return { ok: false, code: 'STALE' };
  return { ok: true, payload };
}

// For tests
export const _internals = { snapshotOf, idempotencyKeyFor, pushPlan, meta, runtime };
