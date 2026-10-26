/**
 * Seeing one business at a time, or all of them together.
 *
 * The "Viewing" choice in the sidebar sets a scope that the Today, Team & Tasks, Deadlines,
 * Warnings, "This week" and suggestion pages all follow (the server filters by business).
 * The Today cards show every business at a glance, with what is late and what is due this week;
 * pressing one switches to it.
 */

import { ApiService } from '../services/api.js';
import { Toast } from '../components/toast.js';
import { escapeHtml } from '../utils/html.js';

export const BUSINESS_SCOPE_ACTIONS = ['selectBusinessScope', 'clearBusinessScope'];

const STORAGE_KEY = 'sloane_business_scope';

/** The scope this browser used last time (a convenience only). */
export function savedBusinessScope() {
  try { return localStorage.getItem(STORAGE_KEY) || ''; } catch (_) { return ''; }
}

function saveBusinessScope(name) {
  try { localStorage.setItem(STORAGE_KEY, name || ''); } catch (_) { /* a convenience only */ }
}

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

export const businessScopeMethods = {
  /** Fills the "Viewing" list in the sidebar from the businesses, and shows or hides the banner. */
  renderBusinessScope(businesses = this.lastBusinesses || []) {
    const select = document.getElementById('businessScope');
    const names = businesses.map(b => b.name);
    // A business that no longer exists cannot stay selected
    if (ApiService.scope.business && !names.includes(ApiService.scope.business)) {
      ApiService.setBusinessScope('');
      saveBusinessScope('');
    }
    if (select) {
      select.innerHTML = `<option value="">All businesses</option>${names.map(n => `<option value="${escapeHtml(n)}">${escapeHtml(n)}</option>`).join('')}`;
      select.value = ApiService.scope.business || '';
      select.closest('.scope-pick')?.classList.toggle('scoped', Boolean(ApiService.scope.business));
    }
    const banner = document.getElementById('scopeBanner');
    if (banner) {
      banner.hidden = !ApiService.scope.business;
      const name = document.getElementById('scopeBannerName');
      if (name) name.textContent = ApiService.scope.business || '';
    }
  },

  /** The select in the sidebar changed (data-change passes the new value). */
  async changeBusinessScope(_id, value) {
    await this.applyBusinessScope(value || '');
  },

  async selectBusinessScope(name) {
    await this.applyBusinessScope(name || '');
  },

  async clearBusinessScope() {
    await this.applyBusinessScope('');
  },

  async applyBusinessScope(name) {
    ApiService.setBusinessScope(name);
    saveBusinessScope(name);
    // The Clients page follows the same choice
    this.selectedBizFilter = name || 'All';
    this.cachedStatutory = null;
    this.cachedTasks = null;
    this.renderBusinessScope();
    await this.renderAll();
    // The pages that are built when opened follow the choice too
    if (this.currentView === 'briefing') await this.renderMorningBriefing();
    if (this.currentView === 'reports') await this.renderWeeklyReport();
    this.renderBusinessScope();
    Toast.info(name ? `Showing ${name} only.` : 'Showing all your businesses.');
  },

  /** The Today cards: every business at a glance (never filtered by the scope itself). */
  async renderBusinessCards() {
    const grid = document.getElementById('cmdBizCards');
    if (!grid) return;
    let list = [];
    try {
      list = (await ApiService.getBusinessOverview()).data || [];
    } catch (_) {
      grid.innerHTML = '';
      return;
    }
    const current = ApiService.scope.business;
    grid.innerHTML = list.map(b => {
      const noBusiness = !(this.lastBusinesses || []).some(x => x.name === b.name);
      const numbers = [
        b.late ? `<span class="biz-num red">${plural(b.late, 'late item', 'late items')}</span>` : '',
        b.dueThisWeek ? `<span class="biz-num amber">${b.dueThisWeek} due this week</span>` : '',
        b.stuckTasks ? `<span class="biz-num red">${plural(b.stuckTasks, 'stuck task', 'stuck tasks')}</span>` : '',
        !b.late && !b.dueThisWeek && !b.stuckTasks ? '<span class="biz-num green">Nothing urgent</span>' : ''
      ].join('');
      return `
        <div class="card biz-glance ${b.health} ${current === b.name ? 'selected' : ''}" ${noBusiness ? '' : `data-action="selectBusinessScope" data-id="${escapeHtml(b.name)}" role="button" tabindex="0" title="Show ${escapeHtml(b.name)} only"`}>
          <div class="biz-glance-head">
            <span class="biz-dot ${b.health}" aria-hidden="true"></span>
            <span class="biz-glance-name">${escapeHtml(b.name)}</span>
          </div>
          <div class="biz-glance-type">${escapeHtml(b.type || 'Work not yet put under a business')}</div>
          <div class="biz-glance-numbers">${numbers}</div>
          <div class="biz-glance-foot">${plural(b.clients, 'client', 'clients')} · ${plural(b.openTasks, 'open task', 'open tasks')}</div>
        </div>`;
    }).join('');
  }
};
