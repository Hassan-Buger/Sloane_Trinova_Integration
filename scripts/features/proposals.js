/**
 * Ask Sloane → "Tasks to create": when the owner types "Ask Priya to chase the bank statements
 * by Friday", or pastes an email or meeting notes, Sloane offers tasks back. Nothing is made
 * until the owner presses "Create task" (or "Create all").
 */

import { ApiService } from '../services/api.js';
import { Toast } from '../components/toast.js';
import { escapeHtml, formatDateGB } from '../utils/html.js';

export const PROPOSAL_ACTIONS = ['createProposedTask', 'createAllProposedTasks'];

let groupCounter = 0;

/** The "Tasks to create" block for an answer (an empty string when there are none). */
export function proposalsHtml(app, proposals) {
  if (!Array.isArray(proposals) || !proposals.length) return '';
  app.proposalStore = app.proposalStore || {};
  const group = `pg${++groupCounter}`;
  const rows = proposals.map((p, i) => {
    const key = `${group}_${i}`;
    app.proposalStore[key] = { ...p, group, done: false };
    const meta = [
      p.assigneeName ? `👤︎ ${escapeHtml(p.assigneeName)}` : '👤︎ Nobody yet',
      p.dueDate ? `📅︎ ${escapeHtml(formatDateGB(p.dueDate))}` : '📅︎ No date',
      p.clientName ? `🏢︎ ${escapeHtml(p.clientName)}` : '',
      p.businessArea ? escapeHtml(p.businessArea) : ''
    ].filter(Boolean).join(' · ');
    return `
      <div class="proposal" id="proposal-${key}">
        <div class="proposal-main">
          <div class="proposal-title">${escapeHtml(p.title)}</div>
          <div class="proposal-meta">${meta}</div>
          ${p.note ? `<div class="proposal-note">${escapeHtml(p.note)}</div>` : ''}
          ${p.kind === 'text' && p.source ? `<div class="proposal-source">From: “${escapeHtml(p.source)}”</div>` : ''}
        </div>
        <button type="button" class="btn btn-primary btn-sm" data-action="createProposedTask" data-id="${key}">Create task</button>
      </div>`;
  }).join('');
  return `
    <div class="ai-subheading">Tasks to create</div>
    <div class="proposal-list">${rows}</div>
    ${proposals.length > 1 ? `<button type="button" class="btn btn-secondary btn-sm proposal-all" data-action="createAllProposedTasks" data-id="${group}">Create all ${proposals.length} tasks</button>` : ''}`;
}

function payloadFor(p) {
  const payload = {
    title: p.title,
    priority: p.priority || 'Normal',
    description: p.source ? `Made from Ask Sloane. Your words: “${p.source}”` : ''
  };
  if (p.dueDate) payload.dueDate = p.dueDate;
  if (p.assigneeId) payload.assigneeId = p.assigneeId;
  if (p.businessArea) payload.businessArea = p.businessArea;
  if (p.clientId) payload.clientId = p.clientId; else payload.general = true;
  return payload;
}

export const proposalMethods = {
  async createProposedTask(key) {
    const p = (this.proposalStore || {})[key];
    if (!p || p.done) return;
    const row = document.getElementById(`proposal-${key}`);
    const btn = row ? row.querySelector('[data-action="createProposedTask"]') : null;
    if (btn) { btn.disabled = true; btn.textContent = 'Creating…'; }
    try {
      await ApiService.createTask(payloadFor(p));
      p.done = true;
      if (btn) btn.textContent = '✓ Created';
      if (row) row.classList.add('done');
      Toast.success(`Task "${p.title}" created.`);
      await this.refreshTaskViews();
    } catch (err) {
      if (btn) { btn.disabled = false; btn.textContent = 'Create task'; }
      Toast.error(`The task could not be created: ${err.message}`);
    }
  },

  async createAllProposedTasks(group) {
    const keys = Object.keys(this.proposalStore || {}).filter(k => this.proposalStore[k].group === group && !this.proposalStore[k].done);
    for (const key of keys) await this.createProposedTask(key);
  }
};
