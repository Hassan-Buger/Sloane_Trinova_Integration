/**
 * Deadlines page: official filing dates, with dates the owner can change or add, and VAT returns.
 */

import { ApiService } from '../services/api.js';
import { Toast } from '../components/toast.js';
import { FormModal, ConfirmDialog } from '../components/formModal.js';
import { ReconciliationEngine } from '../services/reconciliation.js';
import { escapeHtml, formatDateGB, describeDue } from '../utils/html.js';

export const DEADLINE_ACTIONS = [
  'openDeadlineForm', 'deleteDeadline', 'openVatForm', 'deleteVatReturn'
];

const ORIGIN_LABEL = {
  manual: 'Your own date',
  trinova: 'From TriNova',
  sloane_client: 'From the client you added',
  sample: 'Example'
};

const VAT_STATUSES = ['Not started', 'In progress', 'Filed'];

export const deadlineMethods = {
  async renderStatutory() {
    let records = [];
    let meta = {};
    let loadError = '';

    const res = await ApiService.getStatutory();
    records = res.data || [];
    meta = res.meta || {};
    loadError = res.error || '';
    this.deadlineRows = records;
    this.setSampleBanners(meta.dataSource === 'sample');

    const redCount = records.filter(r => r.urgency === 'RED').length;
    const amberCount = records.filter(r => r.urgency === 'AMBER').length;
    const clearCount = records.filter(r => r.urgency === 'CLEAR').length;

    // Say plainly where the list comes from when it is empty or incomplete.
    const noteEl = document.getElementById('deadlineSourceNote');
    if (noteEl) {
      let msg = '';
      if (loadError) msg = `Sloane could not load your deadlines just now: ${loadError}`;
      else if (meta.trinovaStatus === 'not_configured') msg = 'Sloane has not been given TriNova\'s access key, so it cannot read dates from your TriNova clients. You can still add your own dates below.';
      else if (meta.trinovaStatus === 'unreachable') msg = 'Sloane could not reach TriNova just now, so dates from TriNova clients may be missing.';
      else if (meta.trinovaDeadlinesStatus === 'unreachable') msg = 'Sloane could not read TriNova\'s list of deadlines just now, so some TriNova dates may be missing.';
      noteEl.style.display = msg ? 'flex' : 'none';
      const span = noteEl.querySelector('span:last-child');
      if (span) span.textContent = msg;
    }

    const tbody = document.getElementById('statutoryTableBody');
    if (tbody) {
      if (records.length > 0) {
        tbody.innerHTML = records.map((r, i) => {
          const chUrl = r.companyNumber ? `https://find-and-update.company-information.service.gov.uk/company/${encodeURIComponent(r.companyNumber)}` : '#';
          const urgencyClass = r.urgency === 'RED' ? 'status-red' : (r.urgency === 'AMBER' ? 'status-amber' : 'status-green');
          const urgencyLabel = r.urgency === 'RED' ? 'RED · ACT NOW' : (r.urgency === 'AMBER' ? 'AMBER · COMING UP' : 'CLEAR · ON TRACK');
          return `
            <tr>
              <td class="col-num">${i + 1}</td>
              <td>
                <div style="font-weight: 700; color: var(--text);">${escapeHtml(r.name || r.companyName)}</div>
                <div class="source">
                  <span class="source-badge ${r.source === 'companies_house_live' ? 'ch-live' : ''}">${r.source === 'companies_house_live' ? 'Checked with Companies House' : escapeHtml(ORIGIN_LABEL[r.origin] || 'From our own list')}</span>
                </div>
              </td>
              <td>${r.companyNumber ? `<a href="${chUrl}" target="_blank" rel="noopener" style="color: var(--accent); font-family: var(--font-mono); text-decoration: none; font-weight: 600;">${escapeHtml(r.companyNumber)} ↗</a>` : '—'}</td>
              <td>${escapeHtml(ReconciliationEngine.formatDate(r.yearEnd || '—'))}</td>
              <td>${escapeHtml(ReconciliationEngine.formatDate(r.accountsDueDate || '—'))}<div class="syncmeta">${escapeHtml(r.accountsDueDate ? describeDue(r.accountsDueDate) : '')}</div></td>
              <td>${escapeHtml(ReconciliationEngine.formatDate(r.confirmationDueDate || '—'))}<div class="syncmeta">${escapeHtml(r.confirmationDueDate ? describeDue(r.confirmationDueDate) : '')}</div></td>
              <td><span class="${urgencyClass}">${escapeHtml(urgencyLabel)}</span></td>
              <td style="max-width: 220px; font-size: 11px; color: ${r.urgency === 'RED' ? 'var(--red)' : 'var(--muted)'};">${escapeHtml(r.note || r.notes || '—')}</td>
              <td class="row-actions-cell">
                <button type="button" class="card-action-btn" data-action="openDeadlineForm" data-index="${i}" title="Change the dates for this company">✎︎ Edit dates</button>
                ${r.recordId ? `<button type="button" class="card-action-btn text-red" data-action="deleteDeadline" data-index="${i}" title="${r.origin === 'manual' && r.clientId ? 'Go back to the dates from the client record' : 'Remove this deadline'}">${r.origin === 'manual' && r.clientId ? 'Undo my dates' : 'Remove'}</button>` : ''}
              </td>
            </tr>`;
        }).join('');
      } else {
        tbody.innerHTML = `<tr><td colspan="9" class="table-empty" style="text-align: center; padding: 24px;">
          No deadlines yet. Deadlines appear here from your TriNova clients and from clients you add. You can also add a deadline yourself with "+ Add a deadline".
        </td></tr>`;
      }
    }

    this.updateNavBadges({ redCount });

    const statTracked = document.getElementById('statRadarTracked');
    const statAmber = document.getElementById('statRadarVat');
    const statRed = document.getElementById('statRadarRed');
    const statClear = document.getElementById('statRadarClear');
    if (statTracked) statTracked.textContent = records.length;
    if (statAmber) statAmber.textContent = amberCount;
    if (statRed) statRed.textContent = redCount;
    if (statClear) statClear.textContent = clearCount;

    const actionTbody = document.getElementById('actionTableBody');
    if (actionTbody) {
      const actionItems = records.filter(r => r.urgency === 'RED' || r.urgency === 'AMBER');
      if (actionItems.length > 0) {
        actionTbody.innerHTML = actionItems.map((a, idx) => `
          <tr>
            <td class="col-num">${idx + 1}</td>
            <td style="font-weight: 700; color: var(--text);">${escapeHtml(a.name || a.companyName)}</td>
            <td style="font-family: var(--font-mono); color: var(--accent);">${escapeHtml(a.companyNumber || '—')}</td>
            <td style="color: ${a.urgency === 'RED' ? 'var(--red)' : 'var(--text)'}; font-weight: 600;">${escapeHtml(a.hasStrikeOff ? 'Companies House plans to remove this company from the register' : (a.accountsOverdue ? 'Accounts are late, so penalties may apply' : 'Accounts are due soon'))}</td>
            <td style="font-size: 11px; color: var(--muted);">${escapeHtml(a.note || a.notes || 'Please deal with this soon')}</td>
            <td><span class="pill ${a.urgency === 'RED' ? 'red' : 'amber'}">${escapeHtml(a.urgency)}</span></td>
          </tr>
        `).join('');
      } else {
        actionTbody.innerHTML = `<tr><td colspan="6" class="table-empty" style="text-align: center; padding: 24px;">Nothing needs doing right now.</td></tr>`;
      }
    }

    await this.renderVatReturns();
  },

  async renderVatReturns() {
    const vatTbody = document.getElementById('vatTableBody');
    if (!vatTbody) return;
    const res = await ApiService.getVatReturns();
    this.vatRows = res.data || [];
    if (res.error) {
      vatTbody.innerHTML = `<tr><td colspan="6" class="table-empty" style="text-align: center; padding: 24px;">Sloane could not load your VAT returns just now: ${escapeHtml(res.error)}</td></tr>`;
      return;
    }
    if (this.vatRows.length === 0) {
      vatTbody.innerHTML = `<tr><td colspan="6" class="table-empty" style="text-align: center; padding: 24px;">No VAT returns saved yet. Click "+ Add a VAT return" to keep track of one.</td></tr>`;
      return;
    }
    vatTbody.innerHTML = this.vatRows.map((v, i) => `
      <tr>
        <td class="col-num">${i + 1}</td>
        <td style="font-weight: 700; color: var(--text);">${escapeHtml(v.clientName)}</td>
        <td>${escapeHtml(v.period)}</td>
        <td>${escapeHtml(formatDateGB(v.dueDate))}<div class="syncmeta">${escapeHtml(v.status === 'Filed' ? '' : describeDue(v.dueDate))}</div></td>
        <td>
          <select class="select-input" aria-label="Change VAT return status" data-change="changeVatStatus" data-id="${escapeHtml(v.id)}">
            ${VAT_STATUSES.map(s => `<option ${v.status === s ? 'selected' : ''}>${s}</option>`).join('')}
          </select>
        </td>
        <td class="row-actions-cell">
          <button type="button" class="card-action-btn" data-action="openVatForm" data-index="${i}">✎︎ Edit</button>
          <button type="button" class="card-action-btn text-red" data-action="deleteVatReturn" data-index="${i}">Remove</button>
        </td>
      </tr>`).join('');
  },

  /**
   * Add a deadline (no row) or change the dates of one. What happens depends on where the row
   * came from: our own saved deadline, a client added in Sloane, or a TriNova client.
   */
  async openDeadlineForm(_id, el, dataset = {}) {
    const row = dataset.index !== undefined ? (this.deadlineRows || [])[Number(dataset.index)] : null;
    const clients = await this.getClientChoices();

    const isNew = !row;
    const isClientRecord = row && row.origin === 'sloane_client';
    const isTrinova = row && row.origin === 'trinova';

    let intro = '';
    if (isTrinova) intro = 'These dates come from TriNova. Saving your own dates here changes them in Sloane only. TriNova is not changed, and you can go back to TriNova\'s dates at any time.';
    if (isClientRecord) intro = 'These dates are saved on the client you added, so changing them here changes that client too.';

    const fields = [
      { name: 'name', label: 'Company or client name', type: 'text', required: !row, maxlength: 200 },
      ...(isNew ? [{ name: 'clientId', label: 'Is this one of your clients? (optional)', type: 'select', options: [{ value: '', label: 'No, just a company I want to watch' }, ...clients] }] : []),
      { name: 'companyNumber', label: 'Company number', type: 'text', full: false, maxlength: 16 },
      { name: 'yearEnd', label: 'Year end date', type: 'date', full: false },
      { name: 'accountsDueDate', label: 'Accounts due', type: 'date', full: false },
      { name: 'confirmationDueDate', label: 'Yearly update due', type: 'date', full: false },
      { name: 'notes', label: 'Notes (optional)', type: 'textarea', maxlength: 2000 }
    ];

    FormModal.open({
      title: isNew ? 'Add a deadline' : `Dates for ${row.name}`,
      intro,
      submitLabel: isNew ? 'Add deadline' : 'Save dates',
      fields,
      values: row ? {
        name: row.name, companyNumber: row.companyNumber || '', yearEnd: row.yearEnd || '',
        accountsDueDate: row.accountsDueDate || '', confirmationDueDate: row.confirmationDueDate || '',
        notes: row.origin === 'manual' || row.origin === 'sample' ? (row.notes || row.note || '') : ''
      } : {},
      onSubmit: async v => {
        const dates = {
          yearEnd: v.yearEnd || null,
          accountsDueDate: v.accountsDueDate || null,
          confirmationDueDate: v.confirmationDueDate || null
        };
        if (isNew) {
          const client = clients.find(c => c.value === v.clientId);
          const name = v.name || (client ? client.label : '');
          if (!name) throw new Error('Please type the company or client name.');
          await ApiService.createDeadline({ name, companyNumber: v.companyNumber, clientId: v.clientId || undefined, notes: v.notes, ...dates });
          Toast.success('Deadline added.');
        } else if (row.recordId) {
          await ApiService.updateDeadline(row.recordId, { name: v.name, companyNumber: v.companyNumber, notes: v.notes, ...dates });
          Toast.success('Deadline saved.');
        } else if (isClientRecord) {
          await ApiService.updateClient(row.clientId, { year: dates.yearEnd, accounts: dates.accountsDueDate, confirm: dates.confirmationDueDate });
          Toast.success('Dates saved on the client.');
        } else {
          await ApiService.createDeadline({
            name: row.name, companyNumber: v.companyNumber || row.companyNumber, clientId: row.clientId || undefined, notes: v.notes, ...dates
          });
          Toast.success('Your dates are saved. They replace TriNova\'s dates in Sloane only.');
        }
        await this.renderStatutory();
        await this.renderCommandCentre();
        await this.renderIntelligence();
      }
    });
  },

  async deleteDeadline(_id, el, dataset = {}) {
    const row = (this.deadlineRows || [])[Number(dataset.index)];
    if (!row || !row.recordId) return;
    const undo = row.origin === 'manual' && row.clientId;
    const ok = await ConfirmDialog.ask({
      title: undo ? 'Go back to the original dates?' : 'Remove this deadline?',
      message: undo
        ? `Your own dates for "${row.name}" will be removed and the dates from the client record will show again. Your dates go to the Bin for 30 days.`
        : `"${row.name}" will be taken off your Deadlines list. It goes to the Bin, where you can put it back for 30 days.`,
      confirmLabel: undo ? 'Use original dates' : 'Remove deadline'
    });
    if (!ok) return;
    try {
      await ApiService.deleteDeadline(row.recordId);
      Toast.success(undo ? 'Back to the original dates.' : 'Deadline moved to the Bin.');
      await this.renderStatutory();
      await this.renderCommandCentre();
      await this.renderIntelligence();
    } catch (err) {
      Toast.error(err.message || 'Could not remove that deadline.');
    }
  },

  async openVatForm(_id, el, dataset = {}) {
    const row = dataset.index !== undefined ? (this.vatRows || [])[Number(dataset.index)] : null;
    const clients = await this.getClientChoices();
    FormModal.open({
      title: row ? 'Change this VAT return' : 'Add a VAT return',
      submitLabel: row ? 'Save changes' : 'Add VAT return',
      fields: [
        { name: 'clientId', label: 'Which client?', type: 'select', options: [{ value: '', label: 'Type a name below instead' }, ...clients] },
        { name: 'clientName', label: 'Client name', type: 'text', maxlength: 200, help: 'Fills in by itself if you choose a client above.' },
        { name: 'period', label: 'Which period does it cover?', type: 'text', required: true, maxlength: 100, placeholder: 'e.g. Jul to Sep 2026', full: false },
        { name: 'dueDate', label: 'Due date', type: 'date', required: true, full: false },
        { name: 'status', label: 'Where is it up to?', type: 'select', full: false, options: VAT_STATUSES.map(s => ({ value: s, label: s })) },
        { name: 'notes', label: 'Notes (optional)', type: 'textarea', maxlength: 2000 }
      ],
      values: row ? { clientId: row.clientId || '', clientName: row.clientName, period: row.period, dueDate: row.dueDate, status: row.status, notes: row.notes || '' } : { status: 'Not started' },
      onSubmit: async v => {
        const client = clients.find(c => c.value === v.clientId);
        const clientName = v.clientName || (client ? client.label : '');
        if (!clientName) throw new Error('Please choose a client or type the client\'s name.');
        const body = { clientId: v.clientId || null, clientName, period: v.period, dueDate: v.dueDate, status: v.status, notes: v.notes };
        if (row) await ApiService.updateVatReturn(row.id, body);
        else await ApiService.createVatReturn(body);
        Toast.success(row ? 'VAT return saved.' : 'VAT return added.');
        await this.renderVatReturns();
      }
    });
  },

  async changeVatStatus(id, status, selectEl) {
    if (selectEl) selectEl.disabled = true;
    try {
      await ApiService.updateVatReturn(id, { status });
      Toast.success('VAT return updated.');
    } catch (err) {
      Toast.error(err.message || 'Could not change that VAT return.');
    }
    await this.renderVatReturns();
  },

  async deleteVatReturn(_id, el, dataset = {}) {
    const row = (this.vatRows || [])[Number(dataset.index)];
    if (!row) return;
    const ok = await ConfirmDialog.ask({
      title: 'Remove this VAT return?',
      message: `${row.clientName}, ${row.period} will be taken off your list. It goes to the Bin, where you can put it back for 30 days.`,
      confirmLabel: 'Remove'
    });
    if (!ok) return;
    try {
      await ApiService.deleteVatReturn(row.id);
      Toast.success('VAT return moved to the Bin.');
      await this.renderVatReturns();
    } catch (err) {
      Toast.error(err.message || 'Could not remove that VAT return.');
    }
  }
};
