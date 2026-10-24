/**
 * "Download a copy of everything": one Excel file with a sheet for each kind of record Sloane
 * keeps, written in plain words so it can be opened and read without Sloane.
 *
 * Sheets: About this file, Clients, Deadlines, VAT returns, Tasks, Team, Businesses, Client notes,
 * Documents, History, Signing requests, Private notes, Bin.
 *
 * Uploaded document files are not inside the spreadsheet (a spreadsheet holds tables only); the
 * Documents sheet lists them. Clients from TriNova are included as Sloane last read them.
 */

import { mockDb } from '../data/db.js';
import { clientDirectory } from './clientDirectory.js';
import { buildDeadlineList } from '../routes/statutory.js';
import { listBin, BIN_DAYS } from './bin.js';
import { APP_VERSION, buildId } from '../version.js';

const TASK_STATUS = {
  Pending: 'Not started',
  In_Progress: 'In progress',
  Under_Review: 'Being reviewed',
  Completed: 'Done',
  Cancelled: 'Cancelled'
};

const URGENCY = { RED: 'Red (act now)', AMBER: 'Amber (keep an eye on it)', CLEAR: 'Clear (all fine)' };

const ORIGIN = {
  manual: 'Your own date',
  trinova: 'From TriNova',
  sloane_client: 'From the client you added',
  sample: 'Example'
};

const SIGNING_STATUS = {
  PENDING: 'Waiting for signatures',
  PARTIALLY_SIGNED: 'Partly signed',
  COMPLETED: 'Signed',
  CANCELLED: 'Cancelled',
  EXPIRED: 'Expired',
  DECLINED: 'Declined'
};

/** "NOTE_CREATED" -> "Note created" */
function words(code) {
  const t = String(code || '').replace(/_/g, ' ').trim().toLowerCase();
  return t ? t[0].toUpperCase() + t.slice(1) : '';
}

/** Only the date part of a date or date-time ("2027-03-31"), so Excel shows it as a date. */
function day(value) {
  if (!value) return null;
  const m = String(value).match(/^(\d{4}-\d{2}-\d{2})/);
  return m ? m[1] : null;
}

function list(value) {
  if (Array.isArray(value)) return value.filter(Boolean).join(', ');
  return value || '';
}

/** The client (name) a company or client id belongs to. */
function clientNameFor(id) {
  if (!id) return '';
  const comp = (mockDb.companies || []).find(c => c.id === id);
  const client = clientDirectory.find(comp ? comp.clientId : id) || clientDirectory.find(id);
  return (client && client.name) || (comp && comp.companyName) || '';
}

function businessFor(clientId) {
  const row = (mockDb.clientBusiness || []).find(r => r.id === String(clientId));
  return row ? row.businessArea : '';
}

function clientsSheet() {
  const rows = [];
  for (const c of mockDb.clients || []) {
    const comp = (mockDb.companies || []).find(x => (c.companyIds || []).includes(x.id)) || {};
    rows.push([
      c.name,
      c.addedInSloane ? 'Added in Sloane' : 'Example',
      c.businessArea || '',
      comp.companyNumber || '',
      day(comp.accountingReferenceDate),
      day(comp.accountsDueDate),
      day(comp.confirmationDueDate),
      comp.vatRegistered ? 'Yes' : 'No',
      comp.vatNumber || '',
      comp.payeReference || '',
      comp.cisStatus || '',
      comp.riskLevel || '',
      list((comp.officers || []).map(o => o.name)),
      c.assignedManagerName || '',
      comp.notes || ''
    ]);
  }
  for (const c of clientDirectory.trinovaClients()) {
    rows.push([
      c.name,
      'From TriNova',
      businessFor(c.id) || c.businessArea || '',
      c.companyNumber || '',
      day(c.yearEnd),
      day(c.accountsDueDate),
      day(c.confirmationDueDate),
      c.vatRegistered ? 'Yes' : 'No',
      c.vatNumber || '',
      c.payeReference || '',
      '',
      c.riskLevel || '',
      list(c.directors),
      c.manager || '',
      c.notes || ''
    ]);
  }
  return {
    name: 'Clients',
    columns: ['Client', 'Where it comes from', 'Business', 'Company number', 'Year end', 'Accounts due', 'Yearly update due',
      'VAT registered', 'VAT number', 'PAYE reference', 'CIS', 'Risk', 'Directors', 'Manager', 'Notes'],
    rows
  };
}

function deadlinesSheet() {
  const rows = buildDeadlineList().map(d => [
    d.name || d.companyName || '',
    d.companyNumber || '',
    d.source === 'companies_house_live' ? 'Checked with Companies House' : (ORIGIN[d.origin] || ''),
    day(d.yearEnd),
    day(d.accountsDueDate),
    day(d.confirmationDueDate),
    typeof d.daysRemaining === 'number' ? d.daysRemaining : null,
    URGENCY[d.urgency] || d.urgency || '',
    d.note || d.notes || ''
  ]);
  return {
    name: 'Deadlines',
    columns: ['Company', 'Company number', 'Where the date comes from', 'Year end', 'Accounts due', 'Yearly update due', 'Days left (minus means late)', 'How urgent', 'Note'],
    rows
  };
}

function vatSheet() {
  return {
    name: 'VAT returns',
    columns: ['Client', 'Period', 'Due date', 'Status', 'Notes'],
    rows: (mockDb.vatReturns || []).map(v => [v.clientName, v.period, day(v.dueDate), v.status, v.notes || ''])
  };
}

function tasksSheet() {
  return {
    name: 'Tasks',
    columns: ['Task', 'Client', 'Given to', 'Status', 'Importance', 'Due date', 'Held up by', 'Details', 'Added', 'Finished', 'How it was sorted out'],
    rows: (mockDb.tasks || []).map(t => [
      t.title,
      t.companyName || (t.clientId || t.companyId ? clientNameFor(t.clientId || t.companyId) : 'General task'),
      t.assigneeName || 'Nobody yet',
      TASK_STATUS[t.status] || t.status || '',
      t.priority || '',
      day(t.dueDate),
      t.isBlocked ? (t.blocker || 'Yes') : '',
      t.description || '',
      t.createdAt || null,
      t.completedAt || null,
      t.completionNotes || ''
    ])
  };
}

function teamSheet() {
  return {
    name: 'Team',
    columns: ['Name', 'What they do', 'Email', 'Added'],
    rows: (mockDb.teamMembers || []).map(m => [m.name, m.role || '', m.email || '', m.createdAt || null])
  };
}

function businessesSheet() {
  return {
    name: 'Businesses',
    columns: ['Business', 'Kind', 'Status'],
    rows: (mockDb.businesses || []).map(b => [b.name, b.type || '', b.status || ''])
  };
}

function notesSheet() {
  return {
    name: 'Client notes',
    columns: ['Client', 'Note', 'Written by', 'Written', 'Changed'],
    rows: (mockDb.notes || []).map(n => [
      clientNameFor(n.companyId) || n.companyName || '',
      n.text || '',
      n.authorName || '',
      n.createdAt || null,
      n.editedAt || n.updatedAt || null
    ])
  };
}

function documentsSheet() {
  return {
    name: 'Documents',
    columns: ['Client', 'File name', 'Type', 'Size (KB)', 'Added by', 'Added'],
    rows: (mockDb.documents || []).map(d => [
      clientNameFor(d.companyId) || d.companyName || '',
      d.filename,
      d.category || '',
      typeof d.sizeBytes === 'number' ? Math.max(1, Math.round(d.sizeBytes / 1024)) : null,
      d.uploadedBy || '',
      d.createdAt || null
    ])
  };
}

function historySheet() {
  return {
    name: 'History',
    columns: ['Client', 'When', 'What happened', 'Details', 'Kind', 'Importance', 'Written by'],
    rows: (mockDb.timeline_events || [])
      .slice()
      .sort((a, b) => String(b.occurredAt || '').localeCompare(String(a.occurredAt || '')))
      .map(e => [
        clientNameFor(e.clientId) || clientNameFor(e.companyId),
        e.occurredAt || null,
        e.title || '',
        e.description || '',
        words(e.eventType),
        words(e.severity),
        e.source === 'user' ? 'You' : 'Sloane'
      ])
  };
}

function signingSheet() {
  return {
    name: 'Signing requests',
    columns: ['Client', 'Document', 'Who was asked to sign', 'Status', 'Asked by', 'Asked on', 'Note'],
    rows: (mockDb.signingRequests || []).map(r => [
      clientNameFor(r.companyId) || r.companyName || '',
      r.title || r.originalFilename || '',
      list((r.signers || []).map(s => [s.name, s.email].filter(Boolean).join(' '))),
      SIGNING_STATUS[r.status] || words(r.status),
      r.requestedBy || '',
      r.createdAt || null,
      'Recorded in Sloane only: nothing was sent to the signers.'
    ])
  };
}

function privateNotesSheet(ownerId) {
  return {
    name: 'Private notes',
    columns: ['Note', 'Written', 'Changed'],
    rows: (mockDb.ceoNotes || [])
      .filter(n => !ownerId || !n.ownerId || n.ownerId === ownerId)
      .map(n => [n.text || '', n.createdAt || null, n.editedAt || null])
  };
}

function binSheet() {
  return {
    name: 'Bin',
    columns: ['What', 'Kind', 'From', 'Deleted', `Deleted for good on (after ${BIN_DAYS} days)`, 'Also in this item'],
    rows: listBin({ includeOwnerOnly: true }).map(i => [i.label, i.kindLabel, i.where || '', i.deletedAt, day(i.expiresAt), i.alsoIncludes || ''])
  };
}

/**
 * The sheets for the whole workbook.
 * @param {object} [opts]
 * @param {string} [opts.ownerId]  Only this owner's private notes
 * @param {Date}   [opts.now]
 */
export function buildExportSheets({ ownerId = null, now = new Date() } = {}) {
  const data = [
    clientsSheet(), deadlinesSheet(), vatSheet(), tasksSheet(), teamSheet(), businessesSheet(),
    notesSheet(), documentsSheet(), historySheet(), signingSheet(), privateNotesSheet(ownerId), binSheet()
  ];
  const about = {
    name: 'About this file',
    columns: ['About', 'Details'],
    rows: [
      ['What this is', 'A copy of everything kept in Sloane, made when you pressed "Download a copy of everything".'],
      ['Made on', now.toISOString()],
      ['Sloane version', `${APP_VERSION}${buildId() ? ` (${buildId()})` : ''}`],
      ['', ''],
      ['Sheet', 'Rows'],
      ...data.map(s => [s.name, s.rows.length]),
      ['', ''],
      ['Please note', 'Uploaded document files are not inside this spreadsheet. The Documents sheet lists them; download a file from the client\'s Documents tab in Sloane.'],
      ['', 'Clients marked "From TriNova" are copied as Sloane last read them from TriNova.'],
      ['', 'This file holds client information and your private notes. Keep it somewhere safe.']
    ]
  };
  return [about, ...data];
}
