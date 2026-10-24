/**
 * Client pages: Deadlines, Documents, Notes, History edits, Tasks, and signing records.
 * Every list here can be added to, changed and deleted by the owner.
 */

import { ApiService } from '../services/api.js';
import { Toast } from '../components/toast.js';
import { FormModal, ConfirmDialog } from '../components/formModal.js';
import { ReconciliationEngine } from '../services/reconciliation.js';
import { escapeHtml, formatDateGB, describeDue, todayIso } from '../utils/html.js';

export const CLIENT_DETAIL_ACTIONS = [
  'openDocumentUpload', 'openDocumentEdit', 'deleteDocument', 'downloadDocument',
  'openSigningForm', 'cancelSigningRequest',
  'openNoteForm', 'deleteNote',
  'openHistoryForm', 'deleteHistoryEntry',
  'editClientFromBar', 'removeClientFromBar', 'openClientBusinessForm',
  'editClientDeadlines'
];

const DOCUMENT_CATEGORIES = ['General', 'Accounts', 'Tax', 'Contracts', 'Correspondence', 'Identity', 'Payroll', 'Other'];

function formatBytes(n) {
  if (!n && n !== 0) return '';
  if (n < 1024) return `${n} bytes`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

function shortDateTime(value) {
  if (!value) return '';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

const SIGNING_LABEL = {
  PENDING: ['Waiting for signatures', 'amber'],
  COMPLETED: ['Signed by everyone', 'green'],
  CANCELLED: ['Cancelled', 'neutral'],
  EXPIRED: ['Ran out of time', 'red']
};

export const clientDetailMethods = {
  /** The client currently chosen on the Clients page, or null. */
  getActiveClient() {
    const id = this.activeClient360Id;
    return (this.lastClients || []).find(c => String(c.id || c.clientId) === String(id)) || null;
  },

  /** The id that notes, documents, signing and tasks use for a client. */
  companyRef(client) {
    if (!client) return null;
    return client.addedInSloane ? (client.companyId || client.id) : String(client.rawId || client.id);
  },

  /** The "Client: [name ▾]  actions" bar at the top of each client tab. */
  clientBarHtml(client, withSelect = true) {
    const options = (this.lastClients || []).map(c => {
      const id = String(c.id || c.clientId);
      return `<option value="${escapeHtml(id)}" ${client && id === String(client.id || client.clientId) ? 'selected' : ''}>${escapeHtml(c.name)}</option>`;
    }).join('');
    const id = client ? escapeHtml(String(client.id || client.clientId)) : '';
    const actions = !client ? '' : (client.addedInSloane
      ? `<button type="button" class="card-action-btn" data-action="editClientFromBar" data-id="${id}">✎ Edit client</button>
         <button type="button" class="card-action-btn text-red" data-action="removeClientFromBar" data-id="${id}">Remove client</button>`
      : `<button type="button" class="card-action-btn" data-action="openClientBusinessForm" data-id="${id}" title="Choose which of your businesses this client belongs to">🏢 Choose business</button>
         <span class="source-badge" title="Name, numbers and dates are managed in TriNova.">Managed in TriNova</span>`);
    return `
      <div class="client-bar">
        ${withSelect ? `
        <label style="font-size: 11px; color: var(--muted); font-weight: 600;">Client:
          <select class="select-input" data-change="selectClientInTab" style="min-width: 220px;">
            ${options || '<option value="">No clients yet</option>'}
          </select>
        </label>` : ''}
        <div class="row-actions">${actions}</div>
      </div>`;
  },

  async ensureClients() {
    if (!this.lastClients || this.lastClients.length === 0) {
      try { this.lastClients = (await ApiService.getClients()).data || []; } catch (_) { this.lastClients = []; }
    }
    if (!this.activeClient360Id && this.lastClients.length > 0) {
      this.activeClient360Id = String(this.lastClients[0].id || this.lastClients[0].clientId);
    }
  },

  noClientCard(card, title) {
    card.innerHTML = `
      <div class="card-header"><h3>${escapeHtml(title)}</h3></div>
      ${this.clientBarHtml(null)}
      <div class="table-empty" style="padding: 24px;">Add a client first (the "+ Add a client" button), then you can use this page.</div>`;
  },

  async selectClientInTab(_id, value) {
    if (!value) return;
    this.activeClient360Id = value;
    await this.switchClientTab(this.activeClientTab);
  },

  editClientFromBar(clientId) {
    return this.openEditClient(clientId);
  },

  removeClientFromBar(clientId) {
    const c = (this.lastClients || []).find(x => String(x.id || x.clientId) === clientId);
    return this.deleteClient(clientId, c ? c.name : 'this client');
  },

  /** TriNova clients cannot be edited here, but they can be put under one of the owner's businesses. */
  async openClientBusinessForm(clientId) {
    const client = (this.lastClients || []).find(c => String(c.id || c.clientId) === clientId);
    if (!client) { Toast.error('Could not find that client. Please refresh the page.'); return; }
    const biz = (await ApiService.getBusinesses()).data || [];
    FormModal.open({
      title: `Which business is ${client.name} part of?`,
      intro: 'This is only for organising clients inside Sloane. It does not change anything in TriNova.',
      submitLabel: 'Save',
      fields: [{
        name: 'businessArea', label: 'Business', type: 'select',
        options: [{ value: '', label: 'None of them' }, ...biz.map(b => ({ value: b.name, label: b.name }))]
      }],
      values: { businessArea: client.assignedBusiness || '' },
      onSubmit: async v => {
        await ApiService.setClientBusiness(clientId, v.businessArea || null);
        Toast.success(v.businessArea ? `${client.name} is now part of ${v.businessArea}.` : `${client.name} is not under any business now.`);
        await this.renderClients();
        await this.renderBusinesses();
        await this.renderCommandCentre();
      }
    });
  },

  /* ------------------------------------------------------------------ Deadlines tab */

  async renderClientStatutoryDetail() {
    const card = document.getElementById('clientStatutoryDetailCard');
    if (!card) return;
    await this.ensureClients();
    const client = this.getActiveClient();
    if (!client) return this.noClientCard(card, 'Deadlines');

    const res = await ApiService.getStatutory();
    this.deadlineRows = res.data || [];
    const index = this.deadlineRows.findIndex(r =>
      String(r.clientId) === String(client.id) || (client.no && r.companyNumber === client.no));
    const row = index >= 0 ? this.deadlineRows[index] : null;

    const box = (label, value, sub = '') => `
      <div class="detail-box">
        <span class="detail-label">${escapeHtml(label)}</span>
        <strong>${escapeHtml(value)}</strong>${sub ? `<div class="syncmeta">${escapeHtml(sub)}</div>` : ''}
      </div>`;

    card.innerHTML = `
      <div class="card-header">
        <h3>Deadlines for ${escapeHtml(client.name)}</h3>
        ${row ? `<span class="pill ${row.urgency === 'RED' ? 'red' : row.urgency === 'AMBER' ? 'amber' : 'green'}">${row.urgency === 'RED' ? 'Needs action' : row.urgency === 'AMBER' ? 'Coming up' : 'On track'}</span>` : ''}
      </div>
      ${this.clientBarHtml(client)}
      ${row ? `
        <div class="detail-grid">
          ${box('Year end', ReconciliationEngine.formatDate(row.yearEnd || '—'))}
          ${box('Accounts due', ReconciliationEngine.formatDate(row.accountsDueDate || '—'), row.accountsDueDate ? describeDue(row.accountsDueDate) : '')}
          ${box('Yearly update due', ReconciliationEngine.formatDate(row.confirmationDueDate || '—'), row.confirmationDueDate ? describeDue(row.confirmationDueDate) : '')}
          ${box('VAT', client.vat === 'Yes' ? `Registered${client.vatNo ? ` (${client.vatNo})` : ''}` : 'Not registered')}
          ${box('Company number', client.no || '—')}
          ${box('Directors', client.dirs || '—')}
        </div>
        <div class="row-actions" style="margin-top: 14px;">
          <button type="button" class="btn btn-secondary" data-action="editClientDeadlines" data-index="${index}">✎ Edit these dates</button>
        </div>`
      : `
        <div class="table-empty" style="padding: 24px;">
          No dates are saved for this client yet.
          <div style="margin-top: 10px;"><button type="button" class="btn btn-secondary" data-action="openDeadlineForm">+ Add a deadline</button></div>
        </div>`}
    `;
  },

  editClientDeadlines(_id, el, dataset) {
    return this.openDeadlineForm(null, el, dataset);
  },

  /* ------------------------------------------------------------------ Documents tab */

  async renderClientDocumentsDetail() {
    const card = document.getElementById('clientDocumentsDetailCard');
    if (!card) return;
    await this.ensureClients();
    const client = this.getActiveClient();
    if (!client) return this.noClientCard(card, 'Documents');
    const companyId = this.companyRef(client);

    const [docsRes, signRes] = await Promise.all([
      ApiService.getCompanyDocuments(companyId).catch(err => ({ data: [], error: err.message })),
      ApiService.getSigningRequests(companyId)
    ]);
    const docs = docsRes.data || [];
    const requests = signRes.data || [];
    this.clientDocs = docs;
    this.clientSigning = requests;

    const signedByDoc = new Map();
    for (const r of requests) if (!signedByDoc.has(r.documentId)) signedByDoc.set(r.documentId, r);

    const docRows = docs.map(d => {
      const sign = signedByDoc.get(d.id);
      const [signText, signClass] = sign ? (SIGNING_LABEL[sign.status] || [sign.status, 'neutral']) : [];
      return `
        <div class="doc-row">
          <div class="doc-main">
            <div class="doc-name">📄 ${escapeHtml(d.filename)}</div>
            <div class="doc-meta">
              <span class="pill neutral">${escapeHtml(d.category || 'General')}</span>
              ${escapeHtml(formatBytes(d.sizeBytes))}${d.uploadedBy ? ` · added by ${escapeHtml(d.uploadedBy)}` : ''} · ${escapeHtml(shortDateTime(d.createdAt))}
              ${sign ? `<span class="pill ${signClass}">${escapeHtml(signText)}</span>` : ''}
            </div>
          </div>
          <div class="row-actions">
            ${d.storagePathMissing ? '' : `<button type="button" class="card-action-btn" data-action="downloadDocument" data-id="${escapeHtml(d.id)}">⬇ Download</button>`}
            <button type="button" class="card-action-btn" data-action="openDocumentEdit" data-id="${escapeHtml(d.id)}">✎ Rename</button>
            ${d.isOriginal === false ? '' : `<button type="button" class="card-action-btn" data-action="openSigningForm" data-id="${escapeHtml(d.id)}">✍ Ask to sign</button>`}
            <button type="button" class="card-action-btn text-red" data-action="deleteDocument" data-id="${escapeHtml(d.id)}">🗑 Delete</button>
          </div>
        </div>`;
    }).join('');

    const signRows = requests.map(r => {
      const [text, cls] = SIGNING_LABEL[r.status] || [r.status, 'neutral'];
      return `
        <div class="doc-row">
          <div class="doc-main">
            <div class="doc-name">✍ ${escapeHtml(r.title || r.originalFilename)}</div>
            <div class="doc-meta">
              <span class="pill ${cls}">${escapeHtml(text)}</span>
              ${escapeHtml((r.signers || []).map(s => `${s.name} (${s.status === 'SIGNED' ? 'signed' : 'not signed yet'})`).join(', '))}
              · asked on ${escapeHtml(shortDateTime(r.createdAt))}
            </div>
          </div>
          <div class="row-actions">
            ${r.status === 'PENDING' ? `<button type="button" class="card-action-btn text-red" data-action="cancelSigningRequest" data-id="${escapeHtml(r.id)}">Cancel request</button>` : ''}
          </div>
        </div>`;
    }).join('');

    card.innerHTML = `
      <div class="card-header">
        <h3>Documents for ${escapeHtml(client.name)}</h3>
        <button type="button" class="btn btn-primary" style="font-size: 11px;" data-action="openDocumentUpload">+ Add a document</button>
      </div>
      ${this.clientBarHtml(client)}
      ${docsRes.error ? `<div class="sourcebanner"><span>⚠️</span><span>Sloane could not load the documents just now: ${escapeHtml(docsRes.error)}</span></div>` : ''}
      <p class="card-help">Files you keep for this client. PDF, Word, Excel, pictures, text and CSV files up to 15 MB.</p>
      <div class="doc-list">
        ${docRows || '<div class="table-empty" style="padding: 24px;">No documents yet. Click "+ Add a document" to keep one here.</div>'}
      </div>

      <div class="card-header" style="margin-top: 26px;">
        <h3>Signing requests</h3>
      </div>
      <div class="sourcebanner">
        <span>ℹ️</span>
        <span><strong>Please note:</strong> Sloane keeps a record of who you have asked to sign a document, but it does not send anything to the signers yet. Use this list to keep track, and send the document to them yourself.</span>
      </div>
      <div class="doc-list">
        ${signRows || '<div class="table-empty" style="padding: 18px;">No signing requests yet. Use "Ask to sign" on a document above.</div>'}
      </div>
    `;
  },

  openDocumentUpload() {
    const client = this.getActiveClient();
    if (!client) return;
    const companyId = this.companyRef(client);
    FormModal.open({
      title: `Add a document for ${client.name}`,
      submitLabel: 'Add document',
      fields: [
        { name: 'file', label: 'Choose a file', type: 'file', required: true, accept: '.pdf,.doc,.docx,.xls,.xlsx,.png,.jpg,.jpeg,.txt,.csv', help: 'PDF, Word, Excel, picture, text or CSV. Up to 15 MB.' },
        { name: 'category', label: 'What kind of document is it?', type: 'select', options: DOCUMENT_CATEGORIES.map(c => ({ value: c, label: c })) }
      ],
      values: { category: 'General' },
      onSubmit: async v => {
        if (v.file && v.file.size > 15 * 1024 * 1024) throw new Error('That file is bigger than 15 MB. Please choose a smaller one.');
        await ApiService.uploadDocument(companyId, v.file, v.category);
        Toast.success(`"${v.file.name}" added.`);
        await this.renderClientDocumentsDetail();
      }
    });
  },

  openDocumentEdit(docId) {
    const d = (this.clientDocs || []).find(x => x.id === docId);
    if (!d) { Toast.error('Could not find that document. Please refresh the page.'); return; }
    FormModal.open({
      title: 'Rename this document',
      submitLabel: 'Save',
      fields: [
        { name: 'filename', label: 'Name', type: 'text', required: true, maxlength: 200 },
        { name: 'category', label: 'What kind of document is it?', type: 'select', options: DOCUMENT_CATEGORIES.map(c => ({ value: c, label: c })) }
      ],
      values: { filename: d.filename, category: DOCUMENT_CATEGORIES.includes(d.category) ? d.category : 'General' },
      onSubmit: async v => {
        await ApiService.updateDocument(docId, { filename: v.filename, category: v.category });
        Toast.success('Document updated.');
        await this.renderClientDocumentsDetail();
      }
    });
  },

  async deleteDocument(docId) {
    const d = (this.clientDocs || []).find(x => x.id === docId);
    const ok = await ConfirmDialog.ask({
      title: 'Delete this document?',
      message: `"${d ? d.filename : 'This document'}" and its file will be deleted for good.`,
      confirmLabel: 'Delete document'
    });
    if (!ok) return;
    try {
      await ApiService.deleteDocument(docId);
      Toast.success('Document deleted.');
      await this.renderClientDocumentsDetail();
    } catch (err) {
      Toast.error(err.message || 'Could not delete that document.');
    }
  },

  async downloadDocument(docId) {
    const d = (this.clientDocs || []).find(x => x.id === docId);
    try {
      const res = await ApiService.getDocumentAccessToken(docId);
      const a = document.createElement('a');
      a.href = res.data.downloadUrl;
      a.download = d ? d.filename : 'document';
      document.body.appendChild(a);
      a.click();
      a.remove();
    } catch (err) {
      Toast.error(err.message || 'Could not download that document.');
    }
  },

  openSigningForm(docId) {
    const d = (this.clientDocs || []).find(x => x.id === docId);
    const client = this.getActiveClient();
    if (!d || !client) return;
    const companyId = this.companyRef(client);
    FormModal.open({
      title: `Ask someone to sign "${d.filename}"`,
      intro: 'Sloane will keep a record of this request. It does not send anything to the signers yet.',
      submitLabel: 'Record request',
      fields: [
        { name: 'title', label: 'What is it for?', type: 'text', maxlength: 200, placeholder: d.filename },
        { name: 'name1', label: 'Who needs to sign? (name)', type: 'text', required: true, full: false },
        { name: 'email1', label: 'Their email', type: 'email', required: true, full: false },
        { name: 'name2', label: 'Second person (optional)', type: 'text', full: false },
        { name: 'email2', label: 'Their email', type: 'email', full: false }
      ],
      onSubmit: async v => {
        const signers = [[v.name1, v.email1], [v.name2, v.email2]]
          .filter(([n, e]) => n || e)
          .map(([name, email]) => ({ name, email }));
        if (signers.some(s => !s.name || !s.email)) throw new Error('Please give both a name and an email for each person.');
        await ApiService.createSigningRequest(companyId, { documentId: docId, title: v.title || d.filename, signers });
        Toast.success('Recorded. Remember to send the document to them yourself.');
        await this.renderClientDocumentsDetail();
      }
    });
  },

  async cancelSigningRequest(requestId) {
    const r = (this.clientSigning || []).find(x => x.id === requestId);
    const ok = await ConfirmDialog.ask({
      title: 'Cancel this signing request?',
      message: `"${r ? (r.title || r.originalFilename) : 'This request'}" will be marked as cancelled. The document stays in the list.`,
      confirmLabel: 'Cancel request'
    });
    if (!ok) return;
    try {
      await ApiService.cancelSigningRequest(requestId);
      Toast.success('Signing request cancelled.');
      await this.renderClientDocumentsDetail();
    } catch (err) {
      Toast.error(err.message || 'Could not cancel that request.');
    }
  },

  /* ------------------------------------------------------------------ Notes tab */

  async renderClientNotesDetail() {
    const card = document.getElementById('clientNotesDetailCard');
    if (!card) return;
    await this.ensureClients();
    const client = this.getActiveClient();
    if (!client) return this.noClientCard(card, 'Notes');
    const companyId = this.companyRef(client);

    let notes = [];
    let error = '';
    try {
      notes = (await ApiService.getCompanyNotes(companyId)).data || [];
    } catch (err) {
      error = err.message;
    }
    this.clientNotes = notes;

    const list = notes.map(n => `
      <div class="note-row">
        <div class="note-head">
          <strong>${escapeHtml(n.authorName || n.author || 'Staff')}</strong>
          <span class="syncmeta">${escapeHtml(shortDateTime(n.createdAt))}${n.editedAt ? ` · changed ${escapeHtml(shortDateTime(n.editedAt))}` : ''}</span>
        </div>
        <p class="note-text">${escapeHtml(n.text || n.content || '')}</p>
        <div class="row-actions">
          <button type="button" class="card-action-btn" data-action="openNoteForm" data-id="${escapeHtml(n.id)}">✎ Edit</button>
          <button type="button" class="card-action-btn text-red" data-action="deleteNote" data-id="${escapeHtml(n.id)}">🗑 Delete</button>
        </div>
      </div>`).join('');

    card.innerHTML = `
      <div class="card-header">
        <h3>Notes about ${escapeHtml(client.name)}</h3>
        <button type="button" class="btn btn-primary" style="font-size: 11px;" data-action="openNoteForm">+ Add a note</button>
      </div>
      ${this.clientBarHtml(client)}
      ${error ? `<div class="sourcebanner"><span>⚠️</span><span>Sloane could not load the notes just now: ${escapeHtml(error)}</span></div>` : ''}
      <p class="card-help">Notes for you and your team. They are kept in Sloane and are not sent to TriNova or to the client.</p>
      <div id="clientNotesListContainer">
        ${list || '<div class="table-empty" style="padding: 24px;">No internal notes recorded for this client.</div>'}
      </div>
    `;
  },

  openNoteForm(noteId) {
    const client = this.getActiveClient();
    if (!client) return;
    const companyId = this.companyRef(client);
    const existing = noteId ? (this.clientNotes || []).find(n => n.id === noteId) : null;
    FormModal.open({
      title: existing ? 'Change this note' : `Add a note about ${client.name}`,
      submitLabel: existing ? 'Save changes' : 'Save note',
      fields: [{ name: 'text', label: 'Note', type: 'textarea', required: true, maxlength: 4000, placeholder: 'e.g. Agreed to send the bank statements by Friday.' }],
      values: existing ? { text: existing.text } : {},
      onSubmit: async v => {
        if (existing) {
          await ApiService.updateCompanyNote(companyId, existing.id, { text: v.text });
          Toast.success('Note updated.');
        } else {
          await ApiService.sendNoteToTrinova({ companyId, text: v.text, visibility: 'staff_only' });
          Toast.success('Note saved.');
        }
        await this.renderClientNotesDetail();
      }
    });
  },

  async deleteNote(noteId) {
    const client = this.getActiveClient();
    if (!client) return;
    const ok = await ConfirmDialog.ask({
      title: 'Delete this note?',
      message: 'The note will be deleted for good.',
      confirmLabel: 'Delete note'
    });
    if (!ok) return;
    try {
      await ApiService.deleteCompanyNote(this.companyRef(client), noteId);
      Toast.success('Note deleted.');
      await this.renderClientNotesDetail();
    } catch (err) {
      Toast.error(err.message || 'Could not delete that note.');
    }
  },

  /* ------------------------------------------------------------------ History entries */

  openHistoryForm(eventId) {
    const ev = (this.timelineEvents || []).find(e => e.id === eventId);
    if (!ev) { Toast.error('Could not find that entry. Please refresh the page.'); return; }
    FormModal.open({
      title: 'Change this history entry',
      submitLabel: 'Save changes',
      fields: [
        { name: 'title', label: 'Short title', type: 'text', required: true, maxlength: 200 },
        { name: 'description', label: 'What happened?', type: 'textarea', maxlength: 4000 },
        { name: 'severity', label: 'How important is it?', type: 'select', full: false, options: [
          { value: 'normal', label: 'Normal' }, { value: 'info', label: 'Just for information' },
          { value: 'warning', label: 'Worth watching' }, { value: 'urgent', label: 'Urgent' }, { value: 'critical', label: 'Very important' }
        ] }
      ],
      values: { title: ev.title, description: ev.description || '', severity: ev.severity || 'normal' },
      onSubmit: async v => {
        await ApiService.updateTimelineEvent(this.activeClient360Id, eventId, v);
        Toast.success('History entry updated.');
        await this.renderTimeline(this.activeClient360Id);
      }
    });
  },

  async deleteHistoryEntry(eventId) {
    const ev = (this.timelineEvents || []).find(e => e.id === eventId);
    const ok = await ConfirmDialog.ask({
      title: 'Delete this history entry?',
      message: `"${ev ? ev.title : 'This entry'}" will be taken off this client's history.`,
      confirmLabel: 'Delete entry'
    });
    if (!ok) return;
    try {
      await ApiService.deleteTimelineEvent(this.activeClient360Id, eventId);
      Toast.success('History entry deleted.');
      await this.renderTimeline(this.activeClient360Id);
    } catch (err) {
      Toast.error(err.message || 'Could not delete that entry.');
    }
  },

  /* ------------------------------------------------------------------ Tasks tab */

  async renderClientTasksDetail() {
    const card = document.getElementById('clientTasksDetailCard');
    if (!card) return;
    await this.ensureClients();
    const client = this.getActiveClient();
    if (!client) return this.noClientCard(card, 'Tasks');

    const res = await ApiService.getTasks({ clientId: client.addedInSloane ? client.id : String(client.rawId || client.id) });
    const tasks = res.data || [];
    // Make these tasks available to the edit / delete buttons.
    this.allTasks = [...(this.allTasks || []).filter(t => !tasks.some(x => x.id === t.id)), ...tasks];
    if (!this.teamMembers) this.teamMembers = (await ApiService.getTeam()).data || [];

    const rows = tasks.map(t => {
      const done = ['Completed', 'Cancelled'].includes(t.status);
      return `
        <div class="doc-row ${done ? 'work-item-done' : ''}">
          <div class="doc-main">
            <div class="doc-name">${escapeHtml(t.title)}</div>
            <div class="doc-meta">
              ${escapeHtml(done ? (t.status === 'Completed' ? 'Done' : 'Cancelled') : describeDue(t.dueDate))}
              · ${escapeHtml(t.assigneeName ? `with ${t.assigneeName}` : 'not given to anyone yet')}
              ${t.isBlocked && !done ? `<span class="pill red">STUCK</span>` : ''}
            </div>
          </div>
          <div class="row-actions">
            ${done ? '' : `<button type="button" class="btn-done" data-action="markTaskDone" data-id="${escapeHtml(t.id)}">✓ Done</button>`}
            <button type="button" class="card-action-btn" data-action="openTaskForm" data-id="${escapeHtml(t.id)}">✎ Edit</button>
            <button type="button" class="card-action-btn text-red" data-action="deleteTask" data-id="${escapeHtml(t.id)}">🗑 Delete</button>
          </div>
        </div>`;
    }).join('');

    card.innerHTML = `
      <div class="card-header">
        <h3>Tasks for ${escapeHtml(client.name)}</h3>
        <button type="button" class="btn btn-primary" style="font-size: 11px;" data-action="openTaskForm" data-client="${escapeHtml(String(client.id || client.clientId))}">+ Add a task</button>
      </div>
      ${this.clientBarHtml(client)}
      ${res.error ? `<div class="sourcebanner"><span>⚠️</span><span>Sloane could not load the tasks just now: ${escapeHtml(res.error)}</span></div>` : ''}
      <div class="doc-list">
        ${rows || '<div class="table-empty" style="padding: 24px;">No tasks for this client yet.</div>'}
      </div>
    `;
  }
};
