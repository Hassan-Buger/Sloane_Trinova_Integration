/**
 * Tasks: create, read, change, tick off, reassign and delete.
 *
 * Tasks are Sloane's own. They can be attached to any client (one added in Sloane or a live
 * TriNova client) or be general ("Ring the accountant") with no client at all.
 *
 * Adheres to:
 * - context/04_backend_integration_context.md §4–5, §7
 * - context/05_data_security_context.md §3, §6
 * - context/specs/04-tasks-workflow-read-write.md
 */

import { mockDb, sampleDataEnabled } from '../data/db.js';
import { requireIdempotency } from '../middleware/idempotency.js';
import { WorkflowEngine } from '../services/workflow.js';
import { TimelineService } from '../services/timelineService.js';
import { clientDirectory } from '../services/clientDirectory.js';
import { sendError, newId, isIsoDate, cleanText } from './helpers.js';
import { businessOfClient, businessOfTask, canonicalBusiness, inBusiness } from '../services/businessOf.js';
import { ukToday } from '../services/weeklyReport.js';
import { takeOut, putInBin } from '../services/bin.js';

export const TASK_PRIORITIES = ['Low', 'Normal', 'Medium', 'High', 'Urgent'];
const MAX_TITLE = 255;
const MAX_DESCRIPTION = 4000;

const TASK_NOT_FOUND = 'We could not find that task. It may already have been deleted.';

/** Work out which client (if any) a new task belongs to. */
function resolveTarget(companyIdFromPath, body) {
  const wanted = companyIdFromPath || body.companyId || null;
  if (wanted) {
    const ref = clientDirectory.findCompany(wanted);
    if (!ref) {
      return { error: ['COMPANY_NOT_FOUND', 'We could not find that client. Refresh the Clients page and try again.'] };
    }
    return { ref: { companyId: ref.id, clientId: ref.clientId, clientName: ref.companyName } };
  }
  if (body.clientId) {
    const client = clientDirectory.find(body.clientId);
    if (!client) {
      return { error: ['CLIENT_NOT_FOUND', 'We could not find that client. Refresh the Clients page and try again.'] };
    }
    return { ref: { companyId: client.companyId || client.id, clientId: client.id, clientName: client.name } };
  }
  if (body.general === true) return { ref: null };
  return { error: ['VALIDATION_ERROR', 'Choose which client this task is for, or mark it as a general task.'] };
}

/** Work out the assignee from an id and/or a name. */
function resolveAssignee(body) {
  const hasId = Object.prototype.hasOwnProperty.call(body, 'assigneeId');
  const hasName = Object.prototype.hasOwnProperty.call(body, 'assigneeName');
  if (!hasId && !hasName) return { unchanged: true };

  const id = body.assigneeId;
  if (hasId && (id === null || id === '')) return { assigneeId: null, assigneeName: null };

  if (id) {
    const member = (mockDb.teamMembers || []).find(m => m.id === id);
    if (member) return { assigneeId: member.id, assigneeName: member.name };
    const name = cleanText(body.assigneeName);
    if (name) return { assigneeId: String(id), assigneeName: name };
    return { error: ['ASSIGNEE_NOT_FOUND', 'We could not find that team member. Add them on the Team & Tasks page first.'] };
  }

  const name = cleanText(body.assigneeName);
  return { assigneeId: null, assigneeName: name || null };
}

export const REPEATS = ['none', 'weekly', 'monthly', 'quarterly', 'yearly'];
export const LINK_KINDS = ['email', 'document', 'teams', 'other'];
const MAX_NOTE = 2000;

/**
 * The extra things a task can carry: business, department, next action, what it is waiting for,
 * related emails / documents / Teams chats (links), and how often it repeats.
 * Returns { error: [code, message] } or { values } holding only the fields that were sent.
 */
export function readTaskExtras(body, taskId = null) {
  const values = {};

  if (body.businessArea !== undefined) {
    if (body.businessArea === null || body.businessArea === '') {
      values.businessArea = null;
    } else {
      const name = canonicalBusiness(body.businessArea);
      if (!name) return { error: ['VALIDATION_ERROR', 'That business is not on your list. Choose one from My Businesses.'] };
      values.businessArea = name;
    }
  }
  if (body.department !== undefined) {
    const v = cleanText(body.department);
    if (v.length > 80) return { error: ['VALIDATION_ERROR', 'The department can be up to 80 characters.'] };
    values.department = v;
  }
  if (body.nextAction !== undefined) {
    const v = cleanText(body.nextAction);
    if (v.length > 300) return { error: ['VALIDATION_ERROR', 'The next action can be up to 300 characters.'] };
    values.nextAction = v;
  }
  if (body.repeat !== undefined) {
    const v = body.repeat === null || body.repeat === '' ? 'none' : String(body.repeat);
    if (!REPEATS.includes(v)) return { error: ['VALIDATION_ERROR', `How often it repeats must be one of: ${REPEATS.join(', ')}.`] };
    values.repeat = v;
  }
  if (body.dependsOn !== undefined) {
    const raw = body.dependsOn === null || body.dependsOn === '' ? [] : (Array.isArray(body.dependsOn) ? body.dependsOn : [body.dependsOn]);
    const ids = [...new Set(raw.map(String))];
    if (ids.length > 10) return { error: ['VALIDATION_ERROR', 'A task can wait for up to 10 other tasks.'] };
    for (const id of ids) {
      if (taskId && id === taskId) return { error: ['VALIDATION_ERROR', 'A task cannot wait for itself.'] };
      const other = (mockDb.tasks || []).find(t => t.id === id);
      if (!other) return { error: ['VALIDATION_ERROR', 'One of the tasks it is waiting for no longer exists.'] };
      if (taskId && waitsFor(other, taskId, new Set())) {
        return { error: ['VALIDATION_ERROR', `"${other.title}" is already waiting for this task, so they would wait for each other.`] };
      }
    }
    values.dependsOn = ids;
  }
  if (body.links !== undefined) {
    const raw = body.links === null ? [] : body.links;
    if (!Array.isArray(raw) || raw.length > 20) return { error: ['VALIDATION_ERROR', 'A task can have up to 20 related links.'] };
    const links = [];
    for (const item of raw) {
      const url = cleanText(item && item.url);
      let parsed;
      try { parsed = new URL(url); } catch (_) { parsed = null; }
      if (!parsed || !['http:', 'https:'].includes(parsed.protocol) || url.length > 500) {
        return { error: ['VALIDATION_ERROR', `"${url.slice(0, 40)}" is not a web address that starts with http:// or https://.`] };
      }
      const label = cleanText(item.label).slice(0, 120) || parsed.hostname;
      const kind = LINK_KINDS.includes(item.kind) ? item.kind : guessLinkKind(parsed);
      links.push({ label, url, kind });
    }
    values.links = links;
  }
  return { values };
}

/** email / document / teams / other, from the web address. */
export function guessLinkKind(parsed) {
  const host = parsed.hostname.toLowerCase();
  if (/teams\.microsoft\.com|teams\.live\.com/.test(host)) return 'teams';
  if (/outlook\.(office|live|office365)\.com/.test(host) || /^mail\./.test(host)) return 'email';
  if (/sharepoint\.com|onedrive|docs\.google|drive\.google|dropbox/.test(host)) return 'document';
  return 'other';
}

/** Does `task` wait for `targetId`, directly or through other tasks? */
function waitsFor(task, targetId, seen) {
  if (seen.has(task.id)) return false;
  seen.add(task.id);
  for (const id of task.dependsOn || []) {
    if (id === targetId) return true;
    const next = (mockDb.tasks || []).find(t => t.id === id);
    if (next && waitsFor(next, targetId, seen)) return true;
  }
  return false;
}

/** Adds months to a YYYY-MM-DD date, keeping the day (or the end of a shorter month). */
export function addMonthsIso(iso, months) {
  const [y, m, d] = iso.split('-').map(Number);
  const total = (y * 12 + (m - 1)) + months;
  const ny = Math.floor(total / 12);
  const nm = total % 12;
  const last = new Date(Date.UTC(ny, nm + 1, 0)).getUTCDate();
  return `${ny}-${String(nm + 1).padStart(2, '0')}-${String(Math.min(d, last)).padStart(2, '0')}`;
}

/** The next due date of a repeating task: one step on from the old date, and never in the past. */
export function nextRepeatDate(dueDate, repeat, today = ukToday()) {
  const step = date => {
    if (repeat === 'weekly') return new Date(Date.parse(`${date}T00:00:00Z`) + 7 * 86400000).toISOString().slice(0, 10);
    if (repeat === 'monthly') return addMonthsIso(date, 1);
    if (repeat === 'quarterly') return addMonthsIso(date, 3);
    return addMonthsIso(date, 12);
  };
  let next = step(dueDate || today);
  for (let i = 0; i < 400 && next < today; i++) next = step(next);
  return next;
}

function niceDate(iso) {
  return new Date(`${iso}T12:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
}

/**
 * When a repeating task is finished, make the next one (same details, new due date).
 * Returns the new task, or null if it does not repeat or the next one was already made.
 */
export function spawnNextRepeat(task, actor) {
  if (!task || !REPEATS.includes(task.repeat) || task.repeat === 'none' || task.nextTaskId) return null;
  const next = createTaskRecord({
    ref: task.clientId ? { companyId: task.companyId || task.clientId, clientId: task.clientId, clientName: task.companyName } : null,
    title: task.title,
    description: task.description || '',
    priority: task.priority || 'Normal',
    dueDate: nextRepeatDate(task.dueDate, task.repeat),
    assigneeId: task.assigneeId || null,
    assigneeName: task.assigneeName || null,
    actor,
    extra: {
      businessArea: task.businessArea || null,
      department: task.department || '',
      nextAction: '',
      repeat: task.repeat,
      links: (task.links || []).map(l => ({ ...l })),
      repeatOf: task.repeatOf || task.id,
      origin: 'repeat',
      creatorName: 'Sloane (repeating task)'
    }
  });
  task.nextTaskId = next.id;
  return next;
}

/** A task as the browser sees it: the business is filled in from the client when none was chosen. */
function present(task) {
  return { ...task, businessArea: businessOfTask(task) };
}

function validateDueDate(value) {
  if (value === undefined || value === null || value === '') return null;
  return isIsoDate(value) ? null : 'Please enter the due date as a real date (day, month and year).';
}

function recordTimeline(task, eventType, title, description, actor, extra = {}) {
  if (!task.clientId) return;
  try {
    TimelineService.createEvent({
      clientId: task.clientId,
      companyId: task.companyId || null,
      eventType,
      title,
      description,
      occurredAt: new Date().toISOString(),
      actorType: 'user',
      actorId: actor?.actorId || 'actor_staff',
      source: 'task',
      severity: task.priority === 'Urgent' ? 'urgent' : 'normal',
      visibility: 'shared',
      externalId: extra.externalId || `${eventType.toLowerCase()}_${task.id}_${task.version}`,
      metadata: { taskId: task.id, ...(extra.metadata || {}) }
    });
  } catch (e) {
    // The history entry is a nice-to-have and must never block the task change.
  }
}

/**
 * Makes a task and records it in the client's history. Used by "Sloane suggests" when the owner
 * approves a suggested task (the Add a task form goes through the checks in handleCreateTask).
 * `ref` is { companyId, clientId, clientName } or null for a general task.
 */
export function createTaskRecord({ ref = null, title, description = '', status = 'Pending', priority = 'Normal', dueDate = null,
  assigneeId = null, assigneeName = null, actor = null, extra = {} }) {
  const now = new Date().toISOString();
  const task = {
    id: newId('tsk'),
    companyId: ref ? ref.companyId : null,
    clientId: ref ? ref.clientId : null,
    companyName: ref ? ref.clientName : null,
    title,
    description,
    status,
    priority,
    dueDate: dueDate || null,
    isBlocked: false,
    blocker: null,
    assigneeId,
    assigneeName,
    businessArea: businessOfClient(ref ? ref.clientId : null),
    department: '',
    nextAction: '',
    repeat: 'none',
    dependsOn: [],
    links: [],
    progressNotes: [],
    creatorId: actor?.actorId || 'unknown_actor',
    creatorName: actor?.actorName || 'Authorized Staff',
    idempotencyKey: null,
    version: 1,
    createdAt: now,
    updatedAt: now,
    ...extra
  };
  mockDb.tasks.unshift(task);
  recordTimeline(task, 'TASK_CREATED', `Task Created: ${task.title}`,
    task.description || `Task created${task.companyName ? ` for ${task.companyName}` : ''}`,
    actor, { externalId: task.id, metadata: { dueDate: task.dueDate, assignee: task.assigneeName, source: extra.origin || null } });
  return task;
}

export function registerTaskRoutes(app, { authenticate, requireScope }) {
  /**
   * GET /api/v1/tasks
   * Reads tasks with filtering by client, assignee and status.
   */
  app.get('/api/v1/tasks', authenticate, requireScope('sloane:read'), (req, res) => {
    req.auditAction = 'read_tasks_list';
    req.resourceType = 'task';

    let tasks = [...(mockDb.tasks || [])];

    if (req.query.companyId) {
      tasks = tasks.filter(t => t.companyId === req.query.companyId);
    }
    if (req.query.clientId) {
      tasks = tasks.filter(t => t.clientId === req.query.clientId || t.companyId === req.query.clientId);
    }
    if (req.query.status) {
      tasks = tasks.filter(t => t.status.toLowerCase() === req.query.status.toLowerCase());
    }
    if (req.query.assigneeId) {
      tasks = tasks.filter(t => t.assigneeId === req.query.assigneeId);
    }
    if (req.query.isBlocked !== undefined) {
      const isBlockedBool = req.query.isBlocked === 'true';
      tasks = tasks.filter(t => Boolean(t.isBlocked) === isBlockedBool);
    }
    if (req.query.business) {
      tasks = tasks.filter(t => inBusiness(businessOfTask(t), req.query.business));
    }
    if (req.query.search) {
      const q = req.query.search.toLowerCase();
      tasks = tasks.filter(t => {
        return (t.title && t.title.toLowerCase().includes(q)) ||
               (t.description && t.description.toLowerCase().includes(q)) ||
               (t.companyName && t.companyName.toLowerCase().includes(q));
      });
    }

    // Sort by due date ascending (soonest first, no date last)
    tasks.sort((a, b) => {
      if (!a.dueDate && !b.dueDate) return 0;
      if (!a.dueDate) return 1;
      if (!b.dueDate) return -1;
      return a.dueDate.localeCompare(b.dueDate);
    });

    res.status(200).json({
      status: 'success',
      data: tasks.map(present),
      meta: {
        total: tasks.length,
        unfilteredTotal: (mockDb.tasks || []).length,
        // 'sample' only while the built-in example records are switched on
        dataSource: sampleDataEnabled() ? 'sample' : 'sloane'
      }
    });
  });

  /**
   * GET /api/v1/companies/:companyId/tasks
   * Reads tasks linked specifically to a client / company id.
   */
  app.get('/api/v1/companies/:companyId/tasks', authenticate, requireScope('sloane:read'), (req, res) => {
    const { companyId } = req.params;
    req.auditAction = 'read_company_tasks';
    req.resourceType = 'task';
    req.resourceId = companyId;

    const company = clientDirectory.findCompany(companyId);
    if (!company) {
      return sendError(res, 404, 'COMPANY_NOT_FOUND', 'We could not find that client. Refresh the Clients page and try again.');
    }

    const tasks = (mockDb.tasks || []).filter(t => t.companyId === companyId || t.clientId === company.clientId);

    res.status(200).json({
      status: 'success',
      data: tasks,
      meta: { companyId, companyName: company.companyName, total: tasks.length }
    });
  });

  /**
   * GET /api/v1/tasks/:id
   */
  app.get('/api/v1/tasks/:id', authenticate, requireScope('sloane:read'), (req, res) => {
    const { id } = req.params;
    req.auditAction = 'read_task_detail';
    req.resourceType = 'task';
    req.resourceId = id;

    const task = (mockDb.tasks || []).find(t => t.id === id);
    if (!task) return sendError(res, 404, 'TASK_NOT_FOUND', TASK_NOT_FOUND);

    res.status(200).json({ status: 'success', data: present(task) });
  });

  /**
   * Shared by POST /tasks and POST /companies/:id/tasks
   */
  function handleCreateTask(req, res, companyIdFromPath) {
    const body = req.body || {};

    const target = resolveTarget(companyIdFromPath, body);
    if (target.error) {
      const [code, message] = target.error;
      return sendError(res, 422, code, message);
    }

    const title = cleanText(body.title);
    if (!title) return sendError(res, 422, 'VALIDATION_ERROR', 'Please give the task a title.');
    if (title.length > MAX_TITLE) {
      return sendError(res, 422, 'VALIDATION_ERROR', `The task title can be up to ${MAX_TITLE} characters.`);
    }

    const dueProblem = validateDueDate(body.dueDate);
    if (dueProblem) return sendError(res, 422, 'VALIDATION_ERROR', dueProblem);

    const description = typeof body.description === 'string' ? body.description.trim() : '';
    if (description.length > MAX_DESCRIPTION) {
      return sendError(res, 422, 'VALIDATION_ERROR', `The description can be up to ${MAX_DESCRIPTION} characters.`);
    }

    const status = body.status || 'Pending';
    if (!WorkflowEngine.PERMITTED_TASK_STATUSES.includes(status)) {
      return sendError(res, 422, 'INVALID_TASK_STATUS', 'That is not a status a task can have.');
    }
    const priority = body.priority || 'Normal';
    if (!TASK_PRIORITIES.includes(priority)) {
      return sendError(res, 422, 'VALIDATION_ERROR', `Priority must be one of: ${TASK_PRIORITIES.join(', ')}.`);
    }

    const assignee = resolveAssignee(body);
    if (assignee.error) return sendError(res, 422, assignee.error[0], assignee.error[1]);

    const extras = readTaskExtras(body);
    if (extras.error) return sendError(res, 422, extras.error[0], extras.error[1]);

    const now = new Date().toISOString();
    const ref = target.ref;
    const newTask = {
      id: newId('tsk'),
      companyId: ref ? ref.companyId : null,
      clientId: ref ? ref.clientId : null,
      companyName: ref ? ref.clientName : null,
      title,
      description,
      status,
      priority,
      dueDate: body.dueDate || null,
      isBlocked: Boolean(body.isBlocked),
      blocker: body.isBlocked ? (cleanText(body.blocker) || 'Blocked') : null,
      assigneeId: assignee.unchanged ? null : assignee.assigneeId,
      assigneeName: assignee.unchanged ? null : assignee.assigneeName,
      businessArea: businessOfClient(ref ? ref.clientId : null),
      department: '',
      nextAction: '',
      repeat: 'none',
      dependsOn: [],
      links: [],
      progressNotes: [],
      ...extras.values,
      creatorId: req.actor?.actorId || 'unknown_actor',
      creatorName: req.actor?.actorName || 'Authorized Staff',
      idempotencyKey: req.idempotencyKey,
      version: 1,
      createdAt: now,
      updatedAt: now
    };

    mockDb.tasks.unshift(newTask);

    req.auditAction = 'task_created';
    req.resourceType = 'task';
    req.resourceId = newTask.id;

    recordTimeline(newTask, 'TASK_CREATED', `Task Created: ${newTask.title}`,
      newTask.description || `Task created${newTask.companyName ? ` for ${newTask.companyName}` : ''}`,
      req.actor, { externalId: newTask.id, metadata: { dueDate: newTask.dueDate, assignee: newTask.assigneeName } });

    res.status(201).json({ status: 'success', message: 'Task created successfully.', data: present(newTask) });
  }

  app.post('/api/v1/companies/:companyId/tasks', authenticate, requireScope('sloane:write'), requireIdempotency, (req, res) => {
    handleCreateTask(req, res, req.params.companyId);
  });

  app.post('/api/v1/tasks', authenticate, requireScope('sloane:write'), requireIdempotency, (req, res) => {
    handleCreateTask(req, res, req.body?.companyId);
  });

  /**
   * PATCH /api/v1/tasks/:id
   * Change the title, description, due date, priority, status, assignee or "stuck" flag.
   * Optimistic concurrency: send the task's `version` to be told if someone else changed it.
   */
  app.patch('/api/v1/tasks/:id', authenticate, requireScope('sloane:write'), (req, res) => {
    const { id } = req.params;
    req.auditAction = 'task_updated';
    req.resourceType = 'task';
    req.resourceId = id;

    const task = (mockDb.tasks || []).find(t => t.id === id);
    if (!task) return sendError(res, 404, 'TASK_NOT_FOUND', TASK_NOT_FOUND);

    const body = req.body || {};

    if (body.version !== undefined) {
      const versionCheck = WorkflowEngine.validateVersion(task.version, body.version);
      if (!versionCheck.valid) {
        return sendError(res, 409, versionCheck.code, 'This task was changed somewhere else a moment ago. Refresh the page and try again.');
      }
    }

    // Validate everything first so a bad field never leaves the task half-changed.
    let title;
    if (body.title !== undefined) {
      title = cleanText(body.title);
      if (!title) return sendError(res, 422, 'VALIDATION_ERROR', 'The task title cannot be empty.');
      if (title.length > MAX_TITLE) {
        return sendError(res, 422, 'VALIDATION_ERROR', `The task title can be up to ${MAX_TITLE} characters.`);
      }
    }
    if (body.dueDate !== undefined) {
      const problem = validateDueDate(body.dueDate);
      if (problem) return sendError(res, 422, 'VALIDATION_ERROR', problem);
    }
    if (body.description !== undefined && String(body.description).length > MAX_DESCRIPTION) {
      return sendError(res, 422, 'VALIDATION_ERROR', `The description can be up to ${MAX_DESCRIPTION} characters.`);
    }
    if (body.status !== undefined && !WorkflowEngine.PERMITTED_TASK_STATUSES.includes(body.status)) {
      return sendError(res, 422, 'INVALID_TASK_STATUS',
        `Task status '${body.status}' is not permitted. Permitted statuses: [${WorkflowEngine.PERMITTED_TASK_STATUSES.join(', ')}].`);
    }
    if (body.priority !== undefined && !TASK_PRIORITIES.includes(body.priority)) {
      return sendError(res, 422, 'VALIDATION_ERROR', `Priority must be one of: ${TASK_PRIORITIES.join(', ')}.`);
    }
    const assignee = resolveAssignee(body);
    if (assignee.error) return sendError(res, 422, assignee.error[0], assignee.error[1]);
    const extras = readTaskExtras(body, task.id);
    if (extras.error) return sendError(res, 422, extras.error[0], extras.error[1]);

    // Moving the task to a different client
    let newTarget = null;
    if (body.clientId !== undefined || body.general === true) {
      if (body.general === true || body.clientId === null || body.clientId === '') {
        newTarget = { ref: null };
      } else {
        newTarget = resolveTarget(null, { clientId: body.clientId });
        if (newTarget.error) return sendError(res, 422, newTarget.error[0], newTarget.error[1]);
      }
    }

    const previousAssignee = task.assigneeName;

    if (title !== undefined) task.title = title;
    if (body.description !== undefined) task.description = String(body.description);
    if (body.dueDate !== undefined) task.dueDate = body.dueDate || null;
    if (body.status !== undefined) {
      task.status = body.status;
      if (body.status === 'Completed' && !task.completedAt) task.completedAt = new Date().toISOString();
    }
    if (body.priority !== undefined) task.priority = body.priority;
    if (!assignee.unchanged) {
      task.assigneeId = assignee.assigneeId;
      task.assigneeName = assignee.assigneeName;
    }
    if (body.isBlocked !== undefined) {
      task.isBlocked = Boolean(body.isBlocked);
      task.blocker = task.isBlocked ? (cleanText(body.blocker) || 'Blocked') : null;
    }
    if (newTarget) {
      const ref = newTarget.ref;
      task.companyId = ref ? ref.companyId : null;
      task.clientId = ref ? ref.clientId : null;
      task.companyName = ref ? ref.clientName : null;
      // Moving to another client: the business follows the client unless one was chosen
      if (extras.values.businessArea === undefined) task.businessArea = businessOfClient(task.clientId);
    }
    Object.assign(task, extras.values);

    task.version = (task.version || 1) + 1;
    task.updatedAt = new Date().toISOString();

    // Finished a repeating task: the next one is made
    let nextTask = null;
    if (body.status === 'Completed') nextTask = spawnNextRepeat(task, req.actor);

    if (!assignee.unchanged && previousAssignee !== task.assigneeName) {
      recordTimeline(task, 'TASK_REASSIGNED', `Task Reassigned: ${task.title}`,
        task.assigneeName ? `Now with ${task.assigneeName}.` : 'Now unassigned.', req.actor,
        { metadata: { from: previousAssignee || null, to: task.assigneeName || null } });
    }

    res.status(200).json({
      status: 'success',
      message: nextTask ? `Task updated successfully. The next one is set for ${niceDate(nextTask.dueDate)}.` : 'Task updated successfully.',
      data: present(task),
      meta: nextTask ? { nextTask: { id: nextTask.id, dueDate: nextTask.dueDate } } : undefined
    });
  });

  /**
   * DELETE /api/v1/tasks/:id
   * Moves a task to the Bin, where it can be put back for 30 days. (To keep it in the list as a
   * record instead, set its status to Cancelled.)
   */
  app.delete('/api/v1/tasks/:id', authenticate, requireScope('sloane:write'), (req, res) => {
    const { id } = req.params;
    req.auditAction = 'task_deleted';
    req.resourceType = 'task';
    req.resourceId = id;

    const idx = (mockDb.tasks || []).findIndex(t => t.id === id);
    if (idx === -1) return sendError(res, 404, 'TASK_NOT_FOUND', TASK_NOT_FOUND);

    const item = takeOut('tasks', idx);
    const removed = item.record;
    const entry = putInBin({ kind: 'task', label: removed.title || 'Task', where: removed.clientName || removed.companyName || 'Team & Tasks', removed: [item] });
    res.status(200).json({ status: 'success', message: 'Task moved to the Bin. You can put it back from the Bin within 30 days.', data: { id: removed.id, binId: entry.id } });
  });

  /**
   * POST /api/v1/tasks/:id/notes   { text }
   * Adds a progress note to a task: who wrote it and when. Notes are a record, so they are only added.
   */
  app.post('/api/v1/tasks/:id/notes', authenticate, requireScope('sloane:write'), (req, res) => {
    const { id } = req.params;
    req.auditAction = 'task_progress_note_added';
    req.resourceType = 'task';
    req.resourceId = id;

    const task = (mockDb.tasks || []).find(t => t.id === id);
    if (!task) return sendError(res, 404, 'TASK_NOT_FOUND', TASK_NOT_FOUND);
    const text = cleanText(req.body?.text);
    if (!text) return sendError(res, 422, 'VALIDATION_ERROR', 'Please write the progress note first.');
    if (text.length > MAX_NOTE) return sendError(res, 422, 'VALIDATION_ERROR', `A progress note can be up to ${MAX_NOTE} characters.`);

    const note = { id: newId('pn'), text, by: req.actor?.actorName || 'Authorized Staff', at: new Date().toISOString() };
    task.progressNotes = [...(task.progressNotes || []), note];
    task.version = (task.version || 1) + 1;
    task.updatedAt = note.at;

    recordTimeline(task, 'NOTE_CREATED', `Progress: ${task.title}`, text.slice(0, 300), req.actor,
      { externalId: note.id, metadata: { taskId: task.id, progressNote: true } });

    res.status(201).json({ status: 'success', message: 'Progress note added.', data: present(task) });
  });

  /**
   * POST /api/v1/tasks/:id/complete
   */
  app.post('/api/v1/tasks/:id/complete', authenticate, requireScope('sloane:write'), (req, res) => {
    const { id } = req.params;
    req.auditAction = 'task_completed';
    req.resourceType = 'task';
    req.resourceId = id;

    const task = (mockDb.tasks || []).find(t => t.id === id);
    if (!task) return sendError(res, 404, 'TASK_NOT_FOUND', TASK_NOT_FOUND);

    const completionCheck = WorkflowEngine.validateTaskCompletion(task, req.body || {});
    if (!completionCheck.valid) {
      return sendError(res, 422, completionCheck.code, completionCheck.message);
    }

    task.status = 'Completed';
    task.isBlocked = false;
    task.blocker = null;
    task.completedAt = new Date().toISOString();
    task.completedBy = req.actor?.actorName || 'Authorized Staff';
    task.completionNotes = req.body?.completionNotes || req.body?.resolution || 'Task completed via portal.';
    task.version = (task.version || 1) + 1;
    task.updatedAt = new Date().toISOString();

    recordTimeline(task, 'TASK_COMPLETED', `Task Completed: ${task.title}`,
      `Resolved by ${task.completedBy}: ${task.completionNotes}`, req.actor,
      { externalId: `comp_${task.id}_${task.version}`, metadata: { completedBy: task.completedBy } });

    // Finished a repeating task: the next one is made
    const nextTask = spawnNextRepeat(task, req.actor);

    res.status(200).json({
      status: 'success',
      message: nextTask ? `Task successfully completed. The next one is set for ${niceDate(nextTask.dueDate)}.` : 'Task successfully completed.',
      data: present(task),
      meta: nextTask ? { nextTask: { id: nextTask.id, dueDate: nextTask.dueDate } } : undefined
    });
  });

  /**
   * POST /api/v1/companies/:companyId/workflow
   * Transitions company statutory/operational workflow stage via permitted state transitions.
   */
  app.post('/api/v1/companies/:companyId/workflow', authenticate, requireScope('sloane:write'), (req, res) => {
    const { companyId } = req.params;
    req.auditAction = 'workflow_transition_updated';
    req.resourceType = 'company';
    req.resourceId = companyId;

    const company = (mockDb.companies || []).find(c => c.id === companyId);
    if (!company) {
      return sendError(res, 404, 'COMPANY_NOT_FOUND', 'We could not find that company.');
    }

    const currentStage = company.workflowStage || 'Onboarding';
    const targetStage = req.body?.targetStatus;

    const transitionResult = WorkflowEngine.validateWorkflowTransition(currentStage, targetStage);
    if (!transitionResult.valid) {
      return sendError(res, 422, 'INVALID_WORKFLOW_TRANSITION', transitionResult.message);
    }

    const previousStage = currentStage;
    company.workflowStage = targetStage;
    company.workflowUpdatedAt = new Date().toISOString();
    company.workflowUpdatedBy = req.actor?.actorName || 'Authorized Staff';

    res.status(200).json({
      status: 'success',
      message: `Workflow status for '${company.companyName}' transitioned from '${previousStage}' to '${targetStage}'.`,
      data: {
        companyId: company.id,
        companyName: company.companyName,
        previousStatus: previousStage,
        currentStatus: company.workflowStage,
        updatedAt: company.workflowUpdatedAt,
        updatedBy: company.workflowUpdatedBy
      }
    });
  });
}
