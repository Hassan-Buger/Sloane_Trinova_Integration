/**
 * Team: the people tasks can be given to.
 *
 * A simple list: add someone, change their name / role / email, remove them.
 * A person who still has open tasks cannot be removed until those are given to someone else.
 */

import { mockDb } from '../data/db.js';
import { sendError, newId, cleanText } from './helpers.js';
import { takeOut, putInBin } from '../services/bin.js';

const CLOSED = ['Completed', 'Cancelled'];
const NOT_FOUND = 'We could not find that team member. They may already have been removed.';

function openTasksFor(member) {
  return (mockDb.tasks || []).filter(t => t.assigneeId === member.id && !CLOSED.includes(t.status));
}

function present(member) {
  const mine = (mockDb.tasks || []).filter(t => t.assigneeId === member.id);
  return {
    ...member,
    openTasks: mine.filter(t => !CLOSED.includes(t.status)).length,
    doneTasks: mine.filter(t => t.status === 'Completed').length
  };
}

/** Returns a plain-English problem with the fields, or null when they are fine. */
function validate(body, { requireName }) {
  if (body.name !== undefined || requireName) {
    const name = cleanText(body.name);
    if (!name) return 'Please type the person\'s name.';
    if (name.length > 100) return 'A name can be up to 100 characters.';
  }
  if (body.role !== undefined && cleanText(body.role).length > 100) return 'A role can be up to 100 characters.';
  if (body.email !== undefined && cleanText(body.email)) {
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanText(body.email))) return 'That email address does not look right.';
  }
  return null;
}

export function registerTeamRoutes(app, { authenticate, requireScope }) {
  /** GET /api/v1/team */
  app.get('/api/v1/team', authenticate, requireScope('sloane:read'), (req, res) => {
    req.auditAction = 'read_team';
    req.resourceType = 'team_member';
    const data = (mockDb.teamMembers || []).map(present);
    res.status(200).json({ status: 'success', data, meta: { total: data.length } });
  });

  /** POST /api/v1/team */
  app.post('/api/v1/team', authenticate, requireScope('sloane:write'), (req, res) => {
    req.auditAction = 'team_member_created';
    req.resourceType = 'team_member';
    const body = req.body || {};

    const problem = validate(body, { requireName: true });
    if (problem) return sendError(res, 400, 'BAD_REQUEST', problem);

    const name = cleanText(body.name);
    if (mockDb.teamMembers.some(m => m.name.toLowerCase() === name.toLowerCase())) {
      return sendError(res, 409, 'CONFLICT', `"${name}" is already on your team.`);
    }

    const member = {
      id: newId('usr'),
      name,
      role: cleanText(body.role),
      email: cleanText(body.email),
      createdAt: new Date().toISOString()
    };
    mockDb.teamMembers.push(member);
    req.resourceId = member.id;
    res.status(201).json({ status: 'success', data: present(member) });
  });

  /** PATCH /api/v1/team/:id */
  app.patch('/api/v1/team/:id', authenticate, requireScope('sloane:write'), (req, res) => {
    req.auditAction = 'team_member_updated';
    req.resourceType = 'team_member';
    req.resourceId = req.params.id;
    const body = req.body || {};

    const member = mockDb.teamMembers.find(m => m.id === req.params.id);
    if (!member) return sendError(res, 404, 'NOT_FOUND', NOT_FOUND);

    const problem = validate(body, { requireName: false });
    if (problem) return sendError(res, 400, 'BAD_REQUEST', problem);

    if (body.name !== undefined) {
      const name = cleanText(body.name);
      if (mockDb.teamMembers.some(m => m.id !== member.id && m.name.toLowerCase() === name.toLowerCase())) {
        return sendError(res, 409, 'CONFLICT', `"${name}" is already on your team.`);
      }
      member.name = name;
      // Keep the name shown on their tasks in step with the new name.
      for (const t of mockDb.tasks) {
        if (t.assigneeId === member.id) t.assigneeName = name;
      }
    }
    if (body.role !== undefined) member.role = cleanText(body.role);
    if (body.email !== undefined) member.email = cleanText(body.email);
    member.updatedAt = new Date().toISOString();

    res.status(200).json({ status: 'success', data: present(member) });
  });

  /** DELETE /api/v1/team/:id */
  app.delete('/api/v1/team/:id', authenticate, requireScope('sloane:write'), (req, res) => {
    req.auditAction = 'team_member_deleted';
    req.resourceType = 'team_member';
    req.resourceId = req.params.id;

    const idx = mockDb.teamMembers.findIndex(m => m.id === req.params.id);
    if (idx === -1) return sendError(res, 404, 'NOT_FOUND', NOT_FOUND);

    const member = mockDb.teamMembers[idx];
    const open = openTasksFor(member);
    if (open.length > 0) {
      return sendError(res, 409, 'TEAM_MEMBER_HAS_TASKS',
        `${member.name} still has ${open.length} open task${open.length === 1 ? '' : 's'}. Give ${open.length === 1 ? 'it' : 'them'} to someone else first.`);
    }

    const item = takeOut('teamMembers', idx);
    // Finished tasks keep the person's name as history, but no longer point at a person who is gone.
    // The Bin remembers the link so putting the person back restores it.
    const changes = [];
    for (const t of mockDb.tasks) {
      if (t.assigneeId === member.id) {
        changes.push({ collection: 'tasks', id: t.id, field: 'assigneeId', value: member.id });
        t.assigneeId = null;
      }
    }
    const entry = putInBin({ kind: 'team_member', label: member.name, where: 'Team & Tasks', removed: [item], changes });
    res.status(200).json({ status: 'success', message: `${member.name} has been moved to the Bin. You can put it back from the Bin within 30 days.`, data: { binId: entry.id } });
  });
}
