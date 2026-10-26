/**
 * Today → "Sloane suggests these tasks": work Sloane has found from deadlines and VAT returns.
 * Nothing is made until the owner presses "Create task" (or "Create all").
 */

import { ApiService } from '../services/api.js';
import { Toast } from '../components/toast.js';
import { ConfirmDialog } from '../components/formModal.js';
import { escapeHtml, formatDateGB } from '../utils/html.js';

export const SUGGESTION_ACTIONS = ['acceptSuggestion', 'dismissSuggestion', 'acceptAllSuggestions', 'resetSuggestionDismissals', 'toggleAllSuggestions'];

const SHOW_FIRST = 5;

function whenWords(days) {
  if (days < 0) return days === -1 ? '1 day late' : `${-days} days late`;
  if (days === 0) return 'due today';
  if (days === 1) return 'due tomorrow';
  return `due in ${days} days`;
}

export const suggestionMethods = {
  async renderSuggestions() {
    const card = document.getElementById('suggestionsCard');
    if (!card) return;

    let res;
    try {
      res = await ApiService.getSuggestions();
    } catch (_) {
      card.hidden = true; // The rest of Today works without it
      return;
    }
    const list = res.data || [];
    const dismissed = (res.meta && res.meta.dismissedCount) || 0;
    this.suggestions = list;

    if (list.length === 0 && dismissed === 0) {
      card.hidden = true;
      return;
    }
    card.hidden = false;

    const showAll = this.showAllSuggestions === true;
    const shown = showAll ? list : list.slice(0, SHOW_FIRST);

    if (list.length === 0) {
      card.innerHTML = `
        <div class="card-header"><h2>Sloane suggests these tasks</h2></div>
        <p class="card-help">Nothing to suggest right now. You said "Not needed" to ${dismissed} suggestion${dismissed === 1 ? '' : 's'}.
          <button type="button" class="card-action-btn" data-action="resetSuggestionDismissals">Show ${dismissed === 1 ? 'it' : 'them'} again</button></p>`;
      return;
    }

    card.innerHTML = `
      <div class="card-header">
        <h2>Sloane suggests these tasks <span class="pill amber">${list.length}</span></h2>
        <button type="button" class="btn btn-primary suggest-all" data-action="acceptAllSuggestions">Create all ${list.length} task${list.length === 1 ? '' : 's'}</button>
      </div>
      <p class="card-help">Sloane looked at your deadlines and VAT returns and found work that nobody has a task for yet. Nothing is made until you press <strong>Create task</strong>.</p>
      <div class="suggest-list">
        ${shown.map(s => `
          <div class="suggest-row">
            <div class="suggest-main">
              <div class="suggest-title">${escapeHtml(s.title)}</div>
              <div class="suggest-reason">${escapeHtml(s.reason)}</div>
              <div class="suggest-meta">
                <span class="pill ${s.priority === 'Urgent' ? 'red' : s.priority === 'High' ? 'amber' : 'blue'}">${escapeHtml(s.priority)}</span>
                <span>Task due ${escapeHtml(formatDateGB(s.dueDate))}</span>
                <span>${s.assigneeName ? `Given to ${escapeHtml(s.assigneeName)}` : (s.managerName ? `${escapeHtml(s.managerName)} looks after this client (not on your team yet)` : 'Not given to anyone yet')}</span>
              </div>
            </div>
            <div class="suggest-actions">
              <button type="button" class="btn btn-primary suggest-btn" data-action="acceptSuggestion" data-id="${escapeHtml(s.key)}">Create task</button>
              <button type="button" class="card-action-btn" data-action="dismissSuggestion" data-id="${escapeHtml(s.key)}">Not needed</button>
            </div>
          </div>`).join('')}
      </div>
      <div class="suggest-foot">
        ${list.length > SHOW_FIRST ? `<button type="button" class="card-action-btn" data-action="toggleAllSuggestions">${showAll ? 'Show fewer' : `Show all ${list.length}`}</button>` : ''}
        ${dismissed ? `<button type="button" class="card-action-btn" data-action="resetSuggestionDismissals">Show the ${dismissed} I said were not needed</button>` : ''}
      </div>`;
  },

  /** After a suggestion becomes a task, tasks and counts change on other pages too. */
  async refreshAfterSuggestion() {
    await this.renderAll();
  },

  async acceptSuggestion(key) {
    const res = await ApiService.acceptSuggestion(key);
    Toast.success(res.message || 'Task made.');
    await this.refreshAfterSuggestion();
  },

  async acceptAllSuggestions() {
    const n = (this.suggestions || []).length;
    if (n > 1) {
      const ok = await ConfirmDialog.ask({
        title: `Create all ${n} tasks?`,
        message: `Sloane will make ${n} tasks from the suggestions. You can change or delete any of them afterwards (deleted tasks wait in the Bin for 30 days).`,
        confirmLabel: `Create ${n} tasks`,
        danger: false
      });
      if (!ok) return;
    }
    const res = await ApiService.acceptAllSuggestions();
    Toast.success(res.message || 'Tasks made.');
    await this.refreshAfterSuggestion();
  },

  async dismissSuggestion(key) {
    const res = await ApiService.dismissSuggestion(key);
    Toast.info(res.message || 'Done.');
    await this.renderSuggestions();
  },

  async resetSuggestionDismissals() {
    const res = await ApiService.resetSuggestionDismissals();
    Toast.info(res.message || 'Done.');
    await this.renderSuggestions();
  },

  async toggleAllSuggestions() {
    this.showAllSuggestions = !this.showAllSuggestions;
    await this.renderSuggestions();
  }
};

export { whenWords };
