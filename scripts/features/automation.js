/**
 * Settings → "What Sloane may do on her own": the one rule that can be automatic (make the
 * tasks that the deadline rules find), and the things Sloane will always ask about.
 * Also shows what Sloane did on her own, so nothing happens out of sight.
 */

import { ApiService } from '../services/api.js';
import { Toast } from '../components/toast.js';
import { ConfirmDialog } from '../components/formModal.js';
import { escapeHtml } from '../utils/html.js';

export const AUTOMATION_ACTIONS = ['runAutomationNow'];

function when(value) {
  return new Date(value).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/London' });
}

export const automationMethods = {
  async renderAutomation(data = null) {
    const card = document.getElementById('automationCard');
    if (!card) return;
    let a = data;
    if (!a) {
      try {
        a = (await ApiService.getAutomation()).data;
      } catch (err) {
        card.innerHTML = `<div class="card-header"><h2>What Sloane may do on her own</h2></div><p class="card-help">Sloane could not load this just now: ${escapeHtml(err.message)}</p>`;
        return;
      }
    }
    this.automationState = a;
    const rule = a.deadlineTasks;
    const auto = rule.mode === 'auto';
    const businesses = (this.lastBusinesses || []).map(b => b.name);
    card.innerHTML = `
      <div class="card-header">
        <h2>What Sloane may do on her own</h2>
        <span class="pill ${auto ? 'amber' : 'green'}">${auto ? 'Makes tasks on her own' : 'Asks you first'}</span>
      </div>
      <p class="card-help">Sloane checks your deadlines and VAT returns and works out which tasks are needed. You decide whether she makes them for you, or asks first.</p>
      <div class="automation-row">
        <div class="automation-what"><strong>Make tasks for filing and VAT deadlines</strong>
          <span class="automation-sub">Accounts and yearly updates due within 30 days, and VAT returns due within 21 days. Nothing is made twice.</span></div>
        <div class="automation-controls">
          <select class="form-control" data-change="changeAutomationMode" aria-label="Make tasks for deadlines">
            <option value="ask" ${auto ? '' : 'selected'}>Ask me first</option>
            <option value="auto" ${auto ? 'selected' : ''}>Do it automatically</option>
          </select>
          <select class="form-control" data-change="changeAutomationBusiness" aria-label="For which business">
            <option value="">All businesses</option>
            ${businesses.map(n => `<option value="${escapeHtml(n)}" ${rule.business === n ? 'selected' : ''}>${escapeHtml(n)}</option>`).join('')}
          </select>
        </div>
      </div>
      ${auto ? `<div class="automation-run"><button type="button" class="btn btn-secondary btn-sm" data-action="runAutomationNow">Check now and make any tasks that are needed</button>
        <span class="automation-sub">Otherwise Sloane checks once an hour.</span></div>` : ''}
      <div class="automation-locked">
        <div class="automation-locked-title">Always asks you first (cannot be switched to automatic)</div>
        ${a.locked.map(l => `<div class="automation-lock"><span>🔒︎ ${escapeHtml(l.label)}</span><span class="automation-sub">${escapeHtml(l.note)}</span></div>`).join('')}
      </div>
      <div class="automation-log">
        <div class="automation-locked-title">What Sloane did on her own</div>
        ${a.log && a.log.length
          ? a.log.map(l => `<div class="automation-lock"><span>Made the task “${escapeHtml(l.title)}”${l.client ? ` for ${escapeHtml(l.client)}` : ''}</span><span class="automation-sub">${escapeHtml(when(l.at))}</span></div>`).join('')
          : '<p class="card-help">Nothing yet.</p>'}
      </div>`;
  },

  async changeAutomationMode(_id, value) {
    if (value === 'auto') {
      const scope = this.automationState && this.automationState.deadlineTasks.business;
      const ok = await ConfirmDialog.ask({
        title: 'Let Sloane make these tasks on her own?',
        message: `Sloane will make the tasks that the deadline rules find${scope ? ` for ${scope}` : ' for every business'}, without asking you each time. They are given to the client's manager when there is one. Anything she makes appears in the list below, and you can delete a task you do not want. She will still always ask before anything goes outside, costs money or is sensitive.`,
        confirmLabel: 'Yes, make them automatically'
      });
      if (!ok) { await this.renderAutomation(); return; }
    }
    try {
      const res = await ApiService.saveAutomationRules({ mode: value });
      Toast.success(value === 'auto' ? 'Saved. Sloane will make these tasks on her own.' : 'Saved. Sloane will ask you first.');
      await this.renderAutomation(res.data);
    } catch (err) {
      Toast.error(`Could not save: ${err.message}`);
      await this.renderAutomation();
    }
  },

  async changeAutomationBusiness(_id, value) {
    try {
      const res = await ApiService.saveAutomationRules({ business: value });
      Toast.success('Saved.');
      await this.renderAutomation(res.data);
    } catch (err) {
      Toast.error(`Could not save: ${err.message}`);
      await this.renderAutomation();
    }
  },

  async runAutomationNow() {
    try {
      const res = await ApiService.runAutomation();
      Toast.success(res.message || 'Done.');
      await this.renderAutomation(res.data && res.data.log ? { ...this.automationState, log: res.data.log } : null);
      await this.refreshTaskViews();
    } catch (err) {
      Toast.error(`Could not check now: ${err.message}`);
    }
  }
};
