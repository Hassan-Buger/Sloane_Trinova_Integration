/**
 * Team & Tasks page.
 *
 * Tasks are grouped by the person they are given to. Everything can be changed from here:
 * add, edit, reassign, tick off and delete a task; add, edit and remove a team member.
 */

import { ApiService } from '../services/api.js';
import { Toast } from '../components/toast.js';
import { FormModal, ConfirmDialog } from '../components/formModal.js';
import { escapeHtml, formatDateGB, describeDue, todayIso } from '../utils/html.js';

const STATUS_LABELS = {
  Pending: 'Not started',
  In_Progress: 'In progress',
  Under_Review: 'Being reviewed',
  Completed: 'Done',
  Cancelled: 'Cancelled'
};
const CLOSED = ['Completed', 'Cancelled'];
const PRIORITIES = ['Low', 'Normal', 'Medium', 'High', 'Urgent'];

function initials(name) {
  return (name || '').split(/\s+/).filter(Boolean).map(n => n[0]).join('').substring(0, 2).toUpperCase() || '?';
}

export const TEAM_TASK_ACTIONS = [
  'openTaskForm', 'deleteTask', 'openTeamMemberForm', 'deleteTeamMember', 'toggleFinishedTasks'
];

export const teamTaskMethods = {
  /** Client choices for pickers (id + name), from the Clients page's last load. */
  async getClientChoices() {
    if (!this.lastClients || this.lastClients.length === 0) {
      try {
        const res = await ApiService.getClients();
        this.lastClients = res.data || [];
      } catch (_) {
        this.lastClients = [];
      }
    }
    return this.lastClients.map(c => ({ value: String(c.id || c.clientId), label: c.name }));
  },

  teamOptions(includeNobody = true) {
    const people = (this.teamMembers || []).map(m => ({ value: m.id, label: m.name }));
    return includeNobody ? [{ value: '', label: 'Nobody yet' }, ...people] : people;
  },

  async renderPeopleWork() {
    const container = document.getElementById('peopleGridContainer');
    if (!container) return;

    const [tasksRes, teamRes] = await Promise.all([ApiService.getTasks(), ApiService.getTeam()]);
    const tasks = tasksRes.data || [];
    this.teamMembers = teamRes.data || [];
    this.allTasks = tasks;
    this.setSampleBanners(tasksRes.meta?.dataSource === 'sample');

    const problem = tasksRes.error || teamRes.error;
    const summary = document.getElementById('teamSummary');
    const open = tasks.filter(t => !CLOSED.includes(t.status));
    const stuck = open.filter(t => t.isBlocked);
    const late = open.filter(t => t.dueDate && t.dueDate < todayIso());
    if (summary) {
      summary.innerHTML = problem
        ? `<span class="pill red">Sloane could not load your tasks just now.</span> <span class="syncmeta">${escapeHtml(problem)}</span>`
        : `<span class="pill blue">${open.length} open</span> <span class="pill ${stuck.length ? 'red' : 'neutral'}">${stuck.length} stuck</span> <span class="pill ${late.length ? 'amber' : 'neutral'}">${late.length} late</span> <span class="pill neutral">${this.teamMembers.length} on your team</span>`;
    }

    if (tasks.length === 0 && this.teamMembers.length === 0 && !problem) {
      container.innerHTML = `<div class="card" style="grid-column: 1 / -1; padding: 32px; text-align: center;"><div class="table-empty">No tasks yet. Click "+ Add a team member" to add the people who do the work, then "+ Add a task" to give them something to do.</div></div>`;
      return;
    }

    const showFinished = Boolean(this.showFinishedTasks);
    const visible = tasks.filter(t => showFinished || !CLOSED.includes(t.status));
    const finishedCount = tasks.length - open.length;

    // Group by person: everyone on the team (even with no tasks), then "Nobody yet".
    const groups = new Map();
    for (const m of this.teamMembers) groups.set(m.id, { member: m, tasks: [] });
    const unassigned = { member: null, tasks: [] };
    for (const t of visible) {
      const g = t.assigneeId && groups.get(t.assigneeId);
      if (g) g.tasks.push(t);
      else if (t.assigneeName && !t.assigneeId) {
        const key = `name:${t.assigneeName}`;
        if (!groups.has(key)) groups.set(key, { member: { id: null, name: t.assigneeName, role: 'Not on the team list' }, tasks: [] });
        groups.get(key).tasks.push(t);
      } else unassigned.tasks.push(t);
    }

    const taskRow = t => {
      const done = CLOSED.includes(t.status);
      const dueClass = !done && t.dueDate && t.dueDate < todayIso() ? 'due-late' : '';
      return `
        <div class="work-item ${done ? 'work-item-done' : ''}">
          <div class="work-main">
            <div class="work-client">${escapeHtml(t.companyName || 'General task')}</div>
            <div class="work-title">${escapeHtml(t.title)}${t.blocker ? ` — <span class="text-red">stuck: ${escapeHtml(t.blocker)}</span>` : ''}</div>
            ${t.description ? `<div class="work-desc">${escapeHtml(t.description)}</div>` : ''}
          </div>
          <div class="work-side">
            ${t.isBlocked && !done ? '<span class="pill red">STUCK</span>' : ''}
            ${t.priority === 'Urgent' || t.priority === 'High' ? `<span class="pill ${t.priority === 'Urgent' ? 'red' : 'amber'}">${escapeHtml(t.priority)}</span>` : ''}
            <div class="work-due ${dueClass}" title="${escapeHtml(formatDateGB(t.dueDate))}">${escapeHtml(done ? STATUS_LABELS[t.status] : describeDue(t.dueDate))}</div>
            <div class="task-controls">
              <select class="select-input" aria-label="Change status" data-change="changeTaskStatusFromList" data-id="${escapeHtml(t.id)}">
                ${Object.entries(STATUS_LABELS).map(([val, label]) => `<option value="${val}" ${t.status === val ? 'selected' : ''}>${label}</option>`).join('')}
              </select>
              <select class="select-input" aria-label="Give to" data-change="reassignTask" data-id="${escapeHtml(t.id)}">
                ${this.teamOptions().map(o => `<option value="${escapeHtml(o.value)}" ${(t.assigneeId || '') === o.value ? 'selected' : ''}>${o.value ? 'Give to ' : ''}${escapeHtml(o.label)}</option>`).join('')}
              </select>
              ${done ? '' : `<button type="button" class="btn-done" data-action="markTaskDone" data-id="${escapeHtml(t.id)}" title="Tick this off as finished">✓ Done</button>`}
              <button type="button" class="card-action-btn" data-action="openTaskForm" data-id="${escapeHtml(t.id)}" title="Change this task">✎ Edit</button>
              <button type="button" class="card-action-btn text-red" data-action="deleteTask" data-id="${escapeHtml(t.id)}" title="Delete this task for good">🗑 Delete</button>
            </div>
          </div>
        </div>`;
    };

    const card = ({ member, tasks: list }) => `
      <div class="card person-card">
        <div class="person-header">
          <div class="person-info">
            <div class="person-avatar">${escapeHtml(member ? initials(member.name) : '–')}</div>
            <div>
              <div class="person-name">${escapeHtml(member ? member.name : 'Nobody yet')}</div>
              <div class="person-role">${escapeHtml(member ? (member.role || '') : 'Tasks that have not been given to anyone')}</div>
            </div>
          </div>
          <div class="row-actions">
            <span class="pill blue">${list.filter(t => !CLOSED.includes(t.status)).length} open</span>
            ${member && member.id ? `
              <button type="button" class="card-action-btn" data-action="openTeamMemberForm" data-id="${escapeHtml(member.id)}" title="Change this person's details">✎ Edit</button>
              <button type="button" class="card-action-btn text-red" data-action="deleteTeamMember" data-id="${escapeHtml(member.id)}" title="Remove this person from your team">Remove</button>` : ''}
          </div>
        </div>
        <div class="work-list">
          ${list.length ? list.map(taskRow).join('') : '<div class="table-empty" style="padding: 14px;">No tasks.</div>'}
        </div>
        <div class="person-footer">
          <button type="button" class="card-action-btn" data-action="openTaskForm" data-assignee="${escapeHtml(member && member.id ? member.id : '')}">${member ? `+ Add a task for ${escapeHtml(member.name.split(' ')[0])}` : '+ Add a task'}</button>
        </div>
      </div>`;

    const cards = [...groups.values()].map(card);
    if (unassigned.tasks.length > 0 || cards.length === 0) cards.push(card(unassigned));

    container.innerHTML = cards.join('') + (finishedCount > 0 ? `
      <div style="grid-column: 1 / -1; text-align: center;">
        <button type="button" class="btn btn-secondary" data-action="toggleFinishedTasks">${showFinished ? 'Hide' : 'Show'} ${finishedCount} finished task${finishedCount === 1 ? '' : 's'}</button>
      </div>` : '');
  },

  async toggleFinishedTasks() {
    this.showFinishedTasks = !this.showFinishedTasks;
    await this.renderPeopleWork();
  },

  /** Add a task (no id) or change one (task id). `presetClient` pre-selects a client. */
  async openTaskForm(taskId, el, dataset = {}) {
    const existing = taskId ? (this.allTasks || []).find(t => t.id === taskId) : null;
    if (taskId && !existing) { Toast.error('Could not find that task. Please refresh the page.'); return; }

    if (!this.teamMembers) this.teamMembers = (await ApiService.getTeam()).data || [];
    const clients = await this.getClientChoices();
    const presetClient = dataset.client || '';
    const presetAssignee = dataset.assignee || '';

    FormModal.open({
      title: existing ? 'Change this task' : 'Add a task',
      submitLabel: existing ? 'Save changes' : 'Add task',
      fields: [
        { name: 'title', label: 'What needs doing?', type: 'text', required: true, maxlength: 255, placeholder: 'e.g. Chase the bank statements' },
        { name: 'clientId', label: 'Which client is it for?', type: 'select', options: [{ value: '', label: 'No client (a general task)' }, ...clients] },
        { name: 'assigneeId', label: 'Who is doing it?', type: 'select', options: this.teamOptions(), full: false },
        { name: 'dueDate', label: 'Due date', type: 'date', full: false },
        { name: 'priority', label: 'How important is it?', type: 'select', full: false, options: PRIORITIES.map(p => ({ value: p, label: p })) },
        { name: 'blocker', label: 'Is something holding it up?', type: 'text', full: false, maxlength: 200, placeholder: 'Leave empty if nothing is' },
        { name: 'description', label: 'More detail (optional)', type: 'textarea', maxlength: 4000 }
      ],
      values: existing ? {
        title: existing.title,
        clientId: existing.clientId || '',
        assigneeId: existing.assigneeId || '',
        dueDate: existing.dueDate || '',
        priority: existing.priority || 'Normal',
        blocker: existing.isBlocked ? (existing.blocker || '') : '',
        description: existing.description || ''
      } : { priority: 'Normal', clientId: presetClient, assigneeId: presetAssignee },
      onSubmit: async v => {
        if (existing) {
          const changes = {
            title: v.title,
            dueDate: v.dueDate || null,
            priority: v.priority,
            assigneeId: v.assigneeId || null,
            description: v.description,
            isBlocked: Boolean(v.blocker),
            blocker: v.blocker || null,
            version: existing.version
          };
          if ((existing.clientId || '') !== v.clientId) {
            if (v.clientId) changes.clientId = v.clientId; else changes.general = true;
          }
          await ApiService.updateTask(existing.id, changes);
          Toast.success('Task updated.');
        } else {
          const payload = {
            title: v.title,
            dueDate: v.dueDate || undefined,
            priority: v.priority,
            description: v.description,
            isBlocked: Boolean(v.blocker),
            blocker: v.blocker || undefined
          };
          if (v.assigneeId) payload.assigneeId = v.assigneeId;
          if (v.clientId) payload.clientId = v.clientId; else payload.general = true;
          await ApiService.createTask(payload);
          Toast.success(`Task "${v.title}" added.`);
        }
        await this.refreshTaskViews();
      }
    });
  },

  async refreshTaskViews() {
    this.cachedStatutory = null;
    this.cachedTasks = null;
    await this.renderPeopleWork();
    await this.renderCommandCentre();
    await this.renderIntelligence();
    if (this.activeClientTab === 'tasks') await this.renderClientTasksDetail?.(this.activeClient360Id);
  },

  async deleteTask(taskId) {
    const t = (this.allTasks || []).find(x => x.id === taskId);
    const ok = await ConfirmDialog.ask({
      title: 'Delete this task?',
      message: `"${t ? t.title : 'This task'}" will be deleted for good. If you only want to stop working on it, set its status to Cancelled instead.`,
      confirmLabel: 'Delete task'
    });
    if (!ok) return;
    try {
      await ApiService.deleteTask(taskId);
      Toast.success('Task deleted.');
      await this.refreshTaskViews();
    } catch (err) {
      Toast.error(err.message || 'Could not delete that task.');
      await this.renderPeopleWork();
    }
  },

  async reassignTask(taskId, assigneeId, selectEl) {
    if (selectEl) selectEl.disabled = true;
    try {
      await ApiService.updateTask(taskId, { assigneeId: assigneeId || null });
      const member = (this.teamMembers || []).find(m => m.id === assigneeId);
      Toast.success(assigneeId ? `Given to ${member ? member.name : 'them'}.` : 'Task is not given to anyone now.');
      await this.refreshTaskViews();
    } catch (err) {
      Toast.error(err.message || 'Could not give the task to them.');
      await this.renderPeopleWork();
    }
  },

  async changeTaskStatusFromList(taskId, status, selectEl) {
    return this.changeTaskStatus(taskId, status, selectEl);
  },

  /** Add a team member (no id) or change one. */
  async openTeamMemberForm(memberId) {
    const existing = memberId ? (this.teamMembers || []).find(m => m.id === memberId) : null;
    FormModal.open({
      title: existing ? `Change ${existing.name}` : 'Add someone to your team',
      submitLabel: existing ? 'Save changes' : 'Add to team',
      fields: [
        { name: 'name', label: 'Name', type: 'text', required: true, maxlength: 100 },
        { name: 'role', label: 'What do they do?', type: 'text', maxlength: 100, placeholder: 'e.g. Accountant', full: false },
        { name: 'email', label: 'Email (optional)', type: 'email', full: false }
      ],
      values: existing ? { name: existing.name, role: existing.role || '', email: existing.email || '' } : {},
      onSubmit: async v => {
        if (existing) {
          await ApiService.updateTeamMember(existing.id, v);
          Toast.success('Saved.');
        } else {
          await ApiService.createTeamMember(v);
          Toast.success(`${v.name} added to your team.`);
        }
        await this.renderPeopleWork();
      }
    });
  },

  async deleteTeamMember(memberId) {
    const m = (this.teamMembers || []).find(x => x.id === memberId);
    const ok = await ConfirmDialog.ask({
      title: `Remove ${m ? m.name : 'this person'}?`,
      message: 'They will be taken off your team list. Tasks they have already finished stay as a record.',
      confirmLabel: 'Remove'
    });
    if (!ok) return;
    try {
      await ApiService.deleteTeamMember(memberId);
      Toast.success(`${m ? m.name : 'They'} removed from your team.`);
      await this.renderPeopleWork();
    } catch (err) {
      Toast.error(err.message || 'Could not remove that person.');
    }
  }
};
