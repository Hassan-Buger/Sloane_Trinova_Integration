/**
 * The Bin: everything deleted in the last 30 days. Put it back, or delete it for good.
 */

import { ApiService } from '../services/api.js';
import { Toast } from '../components/toast.js';
import { ConfirmDialog } from '../components/formModal.js';
import { escapeHtml } from '../utils/html.js';

export const BIN_ACTIONS = ['restoreBinItem', 'deleteBinItemForGood', 'emptyTheBin'];

const KIND_ICON = {
  business: '🏢︎',
  client: '📁︎',
  task: '✅︎',
  team_member: '👤︎',
  deadline: '⚖︎',
  vat_return: '🧾︎',
  note: '📝︎',
  document: '📄︎',
  history: '🕘︎',
  private_note: '🔒︎'
};

function when(value) {
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function daysLeftText(n) {
  if (n <= 0) return 'Deleted for good today';
  if (n === 1) return 'Deleted for good tomorrow';
  return `Deleted for good in ${n} days`;
}

export const binMethods = {
  /** Shows how many items are in the Bin on the menu. */
  updateBinBadge(count) {
    const badge = document.getElementById('binNavBadge');
    if (!badge) return;
    badge.textContent = String(count);
    badge.style.display = count > 0 ? 'inline-block' : 'none';
  },

  /** Re-reads how many items are in the Bin (after something is deleted anywhere). */
  async refreshBinBadge() {
    try {
      const res = await ApiService.getBin();
      this.updateBinBadge((res.data || []).length);
    } catch (_) {
      // The count is a nicety; the Bin page shows the truth.
    }
  },

  async renderBin() {
    const container = document.getElementById('binListContainer');
    const emptyBtn = document.getElementById('emptyBinBtn');
    if (!container) return;

    let items = [];
    try {
      items = (await ApiService.getBin()).data || [];
    } catch (err) {
      container.innerHTML = `<div class="card bin-empty">Sloane could not open the Bin just now: ${escapeHtml(err.message)}</div>`;
      return;
    }
    this.binItems = items;
    this.updateBinBadge(items.length);
    if (emptyBtn) emptyBtn.style.display = items.length ? '' : 'none';

    if (items.length === 0) {
      container.innerHTML = `<div class="card bin-empty">The Bin is empty. Anything you delete stays here for 30 days, so you can put it back.</div>`;
      return;
    }

    container.innerHTML = `
      <div class="card bin-card">
        ${items.map((item, idx) => `
          <div class="bin-row">
            <span class="row-num" style="width: 24px; flex-shrink: 0; align-self: center;">#${idx + 1}</span>
            <div class="bin-icon" aria-hidden="true">${KIND_ICON[item.kind] || '🗑︎'}</div>
            <div class="bin-main">
              <div class="bin-title">${escapeHtml(item.label)}</div>
              <div class="bin-meta">
                <span class="bin-kind">${escapeHtml(item.kindLabel)}</span>
                ${item.where ? `<span>from ${escapeHtml(item.where)}</span>` : ''}
                <span>deleted ${escapeHtml(when(item.deletedAt))}</span>
              </div>
              ${item.alsoIncludes ? `<div class="bin-extra">Also brings back: ${escapeHtml(item.alsoIncludes)}</div>` : ''}
            </div>
            <div class="bin-side">
              <span class="bin-days ${item.daysLeft <= 3 ? 'soon' : ''}">${escapeHtml(daysLeftText(item.daysLeft))}</span>
              <div class="bin-actions">
                <button type="button" class="btn btn-primary bin-btn" data-action="restoreBinItem" data-id="${escapeHtml(item.id)}">↩ Put back</button>
                <button type="button" class="card-action-btn text-red" data-action="deleteBinItemForGood" data-id="${escapeHtml(item.id)}">Delete for good</button>
              </div>
            </div>
          </div>`).join('')}
      </div>`;
  },

  async restoreBinItem(id) {
    const res = await ApiService.restoreBinItem(id);
    Toast.success(res.message || 'Put back.');
    // What came back can show on other pages: refresh them, then the Bin
    await this.renderAll();
    await this.renderBin();
  },

  async deleteBinItemForGood(id) {
    const item = (this.binItems || []).find(i => i.id === id);
    const ok = await ConfirmDialog.ask({
      title: 'Delete for good?',
      message: `"${item ? item.label : 'This item'}" will be deleted for good${item && item.alsoIncludes ? `, together with ${item.alsoIncludes}` : ''}. This cannot be undone.`,
      confirmLabel: 'Delete for good'
    });
    if (!ok) return;
    const res = await ApiService.deleteBinItem(id);
    Toast.success(res.message || 'Deleted for good.');
    await this.renderBin();
  },

  async emptyTheBin() {
    const n = (this.binItems || []).length;
    if (!n) return;
    const ok = await ConfirmDialog.ask({
      title: 'Empty the Bin?',
      message: `All ${n} item${n === 1 ? '' : 's'} in the Bin will be deleted for good. This cannot be undone.`,
      confirmLabel: 'Empty the Bin'
    });
    if (!ok) return;
    const res = await ApiService.emptyBin();
    Toast.success(res.message || 'The Bin has been emptied.');
    await this.renderBin();
  }
};
