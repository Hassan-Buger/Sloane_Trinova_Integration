/**
 * Settings → "Tasks and the TriNova portal": switch task syncing on or off, see when it last
 * worked, how many tasks are waiting to be sent, and any problem in plain words.
 */

import { ApiService } from '../services/api.js';
import { Toast } from '../components/toast.js';
import { ConfirmDialog } from '../components/formModal.js';
import { escapeHtml } from '../utils/html.js';

export const TRINOVA_SYNC_ACTIONS = ['runTaskSyncNow'];

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

function when(value) {
  if (!value) return 'not yet';
  return new Date(value).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/London' });
}

export const trinovaSyncMethods = {
  async renderTaskSync(data = null) {
    const card = document.getElementById('trinovaSyncCard');
    if (!card) return;
    let s = data;
    if (!s) {
      try {
        s = (await ApiService.getTaskSync()).data;
      } catch (err) {
        card.innerHTML = `<div class="card-header"><h2>Tasks and the TriNova portal</h2></div><p class="card-help">Sloane could not load this just now: ${escapeHtml(err.message)}</p>`;
        return;
      }
    }
    this.taskSyncState = s;

    let pill;
    if (!s.configured) pill = '<span class="pill neutral">Waiting for TriNova</span>';
    else if (!s.enabled) pill = '<span class="pill amber">Off</span>';
    else if (s.lastError) pill = '<span class="pill red">Needs a look</span>';
    else pill = '<span class="pill green">On</span>';

    const pv = s.preview || {};
    const waiting = s.waiting || 0;
    const result = s.lastResult;

    let body;
    if (!s.configured) {
      body = `<p class="card-help">When TriNova has switched on tasks on their side, Sloane can keep your TriNova Accounting tasks in step with the portal in both directions. TriNova has not given Sloane access to tasks yet, so nothing is sent or received.</p>
        ${pv.wouldSend ? `<p class="card-help">${plural(pv.wouldSend, 'TriNova Accounting task is', 'TriNova Accounting tasks are')} ready to be sent once it is switched on.</p>` : ''}`;
    } else {
      body = `<p class="card-help">Your <strong>TriNova Accounting</strong> tasks are kept in step with the TriNova portal, in both directions. Tasks for CFI Awarding, Emerald Education and MTDflow, and your private notes, progress notes and repeat settings, are never sent.</p>
        <div class="automation-row">
          <div class="automation-what"><strong>Keep tasks in step with TriNova</strong>
            <span class="automation-sub">${s.enabled ? `Last worked: ${escapeHtml(when(s.lastSuccessAt))}. ${waiting ? `${plural(waiting, 'change is', 'changes are')} waiting to be sent.` : 'Nothing is waiting.'}` : `${plural(pv.wouldSend || 0, 'task', 'tasks')} would be sent when you switch it on.`}</span></div>
          <div class="automation-controls">
            <select class="form-control" data-change="changeTaskSync" aria-label="Keep tasks in step with TriNova">
              <option value="off" ${s.enabled ? '' : 'selected'}>Off</option>
              <option value="on" ${s.enabled ? 'selected' : ''}>On</option>
            </select>
          </div>
        </div>
        ${s.enabled ? `<div class="automation-run"><button type="button" class="btn btn-secondary btn-sm" data-action="runTaskSyncNow">Sync now</button>
          ${result ? `<span class="automation-sub">Last time: ${plural(result.pulled || 0, 'task checked', 'tasks checked')}, ${result.created || 0} new from TriNova, ${result.pushed || 0} sent.</span>` : ''}</div>` : ''}
        ${s.lastError ? `<p class="card-help text-amber">⚠︎ ${escapeHtml(s.lastError)}${s.nextAttemptAt ? ` Sloane will try again at ${escapeHtml(when(s.nextAttemptAt))}.` : ''}</p>` : ''}
        ${s.staff && s.staff.notMatched && s.staff.notMatched.length ? `<p class="card-help">These TriNova people are not on your Team page yet, so their tasks show their name but are not linked: ${escapeHtml(s.staff.notMatched.join(', '))}. Add them under Team &amp; Tasks with the same email.</p>` : ''}`;
    }
    card.innerHTML = `<div class="card-header"><h2>Tasks and the TriNova portal</h2>${pill}</div>${body}`;
  },

  async changeTaskSync(_id, value) {
    const on = value === 'on';
    if (on) {
      const pv = (this.taskSyncState && this.taskSyncState.preview) || {};
      const ok = await ConfirmDialog.ask({
        title: 'Keep tasks in step with TriNova?',
        message: `Sloane will send your TriNova Accounting tasks to the TriNova portal (${plural(pv.wouldSend || 0, 'task', 'tasks')} to start with), and bring in tasks that are made there. Deleting a task here marks it cancelled in TriNova; it is never deleted there. Tasks for your other businesses are never sent. You can switch this off at any time.`,
        confirmLabel: 'Yes, switch it on'
      });
      if (!ok) { await this.renderTaskSync(); return; }
    }
    try {
      const res = await ApiService.setTaskSync(on);
      Toast.success(on ? 'Task syncing is on.' : 'Task syncing is off.');
      await this.renderTaskSync(res.data);
      if (on) await this.runTaskSyncNow();
    } catch (err) {
      Toast.error(err.message);
      await this.renderTaskSync();
    }
  },

  async runTaskSyncNow() {
    try {
      const res = await ApiService.runTaskSync();
      Toast.success(res.message || 'Synced.');
      await this.renderTaskSync(res.data);
      await this.refreshTaskViews();
    } catch (err) {
      Toast.error(err.message);
      await this.renderTaskSync();
    }
  }
};
