/**
 * My Private Notes: the owner's own notebook, saved on the Sloane server.
 * Notes that were saved only in this web browser are moved to the server automatically, once.
 */

import { ApiService } from '../services/api.js';
import { StorageService } from '../services/storage.js';
import { Toast } from '../components/toast.js';
import { ConfirmDialog } from '../components/formModal.js';
import { visibleNotes, moreNotesButton, noteTextHtml } from '../utils/compactNotes.js';
import { escapeHtml } from '../utils/html.js';

export const PRIVATE_NOTE_ACTIONS = [
  'startBrainEdit', 'cancelBrainEdit', 'saveBrainEdit', 'deleteBrainEntry', 'openTrinovaNoteModalFor'
];

function stamp(value) {
  if (!value) return '';
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

/** The browser saved dates as "24/10/2026, 12:42:10" (day first). Turns that, or a real date, into an ISO date. */
export function parseBrowserDate(value) {
  if (!value || typeof value !== 'string') return null;
  if (/^\d{4}-\d{2}-\d{2}/.test(value)) {
    const t = Date.parse(value);
    return Number.isNaN(t) ? null : new Date(t).toISOString();
  }
  const m = value.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:,?\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?/);
  if (!m) return null;
  const [, d, mo, y, h = '0', mi = '0', s = '0'] = m;
  const date = new Date(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi), Number(s));
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

export const privateNoteMethods = {
  /** Moves notes saved only in this browser to the server (once), then clears the browser copy. */
  async migrateBrowserNotes() {
    let local = [];
    try { local = StorageService.getBrainEntries() || []; } catch (_) { local = []; }
    if (!local.length) return;
    try {
      const notes = local.map(e => ({ id: e.id, text: e.text, createdAt: e.createdAt || parseBrowserDate(e.at), editedAt: parseBrowserDate(e.editedAt) }));
      const res = await ApiService.importPrivateNotes(notes);
      StorageService.saveBrainEntries([]);
      if (res.data.imported > 0) {
        Toast.success(`${res.data.imported} private note${res.data.imported === 1 ? ' was' : 's were'} moved from this browser to your Sloane server.`);
      }
    } catch (err) {
      // Leave the browser copy alone: nothing is lost if the move did not work.
      console.warn('Could not move browser notes to the server yet:', err.message);
    }
  },

  async renderBrain() {
    const container = document.getElementById('brainFeedContainer');
    if (!container) return;

    if (!this._brainMigrated) {
      this._brainMigrated = true;
      await this.migrateBrowserNotes();
    }

    let entries = [];
    try {
      entries = (await ApiService.getPrivateNotes()).data || [];
    } catch (err) {
      container.innerHTML = `<div class="card" style="text-align: center; color: var(--muted); padding: var(--space-8) var(--card-pad);">Sloane could not open your private notes just now: ${escapeHtml(err.message)}</div>`;
      return;
    }
    this.privateNotes = entries;

    if (entries.length === 0) {
      container.innerHTML = `<div class="card" style="text-align: center; color: var(--muted); padding: var(--space-8) var(--card-pad);">No private notes yet. Write one in the box above.</div>`;
      return;
    }

    const info = visibleNotes(this, 'private', entries);
    container.innerHTML = info.shown.map(entry => {
      const isEditing = this.editingBrainId === entry.id;
      return `
      <div class="brain-entry">
        <div class="brain-entry-header">
          <span class="source-badge" style="color: var(--accent); border-color: rgba(212, 175, 55, 0.4);">
            🔒︎ Private
          </span>
          <span>${escapeHtml(stamp(entry.createdAt))}${entry.editedAt ? ` · changed ${escapeHtml(stamp(entry.editedAt))}` : ''}</span>
        </div>
        ${isEditing ? `
          <textarea class="brain-textarea" id="brainEditInput" style="min-height: 80px; margin: 8px 0;">${escapeHtml(entry.text)}</textarea>
          <div class="row-actions">
            <button type="button" class="btn btn-primary" data-action="saveBrainEdit" data-id="${escapeHtml(entry.id)}">Save</button>
            <button type="button" class="btn btn-secondary" data-action="cancelBrainEdit">Cancel</button>
          </div>
        ` : `
          ${noteTextHtml(this, entry.id, entry.text, 'brain-entry-text')}
          <div class="brain-entry-footer">
            <div class="row-actions">
              <button type="button" class="card-action-btn" data-action="startBrainEdit" data-id="${escapeHtml(entry.id)}">Edit</button>
              <button type="button" class="card-action-btn text-red" data-action="deleteBrainEntry" data-id="${escapeHtml(entry.id)}">Delete</button>
            </div>
            <button type="button" class="card-action-btn" data-action="openTrinovaNoteModalFor" data-id="${escapeHtml(entry.id)}" title="Copy this note into a client's Notes tab. Your private note stays here.">
              Copy to a client's notes ↗
            </button>
          </div>
        `}
      </div>
    `;
    }).join('') + moreNotesButton('private', info, entries.length);
  },

  async handleSaveBrain() {
    const textarea = document.getElementById('brainInput');
    if (!textarea) return;
    const text = textarea.value.trim();
    if (!text) {
      Toast.show('Please write something before saving.', 'warning');
      return;
    }
    try {
      await ApiService.createPrivateNote(text);
      textarea.value = '';
      Toast.success('Note saved.');
      await this.renderBrain();
    } catch (err) {
      Toast.error(err.message || 'Could not save that note.');
    }
  },

  async startBrainEdit(entryId) {
    this.editingBrainId = entryId;
    await this.renderBrain();
    const box = document.getElementById('brainEditInput');
    if (box) box.focus();
  },

  async cancelBrainEdit() {
    this.editingBrainId = null;
    await this.renderBrain();
  },

  async saveBrainEdit(entryId) {
    const box = document.getElementById('brainEditInput');
    const text = box ? box.value.trim() : '';
    if (!text) {
      Toast.show('A note cannot be empty. Use Delete to remove it.', 'warning');
      return;
    }
    try {
      await ApiService.updatePrivateNote(entryId, text);
      Toast.success('Note updated.');
      this.editingBrainId = null;
      await this.renderBrain();
    } catch (err) {
      Toast.error(err.message || 'Could not save that change.');
    }
  },

  async deleteBrainEntry(entryId) {
    const ok = await ConfirmDialog.ask({
      title: 'Delete this note?',
      message: 'Your private note will be deleted. It goes to the Bin, where you can put it back for 30 days.',
      confirmLabel: 'Delete note'
    });
    if (!ok) return;
    try {
      await ApiService.deletePrivateNote(entryId);
      Toast.success('Note moved to the Bin.');
      await this.renderBrain();
    } catch (err) {
      Toast.error(err.message || 'Could not delete that note.');
    }
  },

  async openTrinovaNoteModalFor(entryId) {
    const idx = (this.privateNotes || []).findIndex(n => n.id === entryId);
    if (idx === -1) return;
    return this.openTrinovaNoteModal(idx);
  }
};
