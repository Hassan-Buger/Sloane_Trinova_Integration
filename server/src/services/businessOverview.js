/**
 * All the owner's businesses at a glance: for each one, what is late, what is due this week and
 * how the work is going. Built from the same records as the Deadlines, Team & Tasks and report
 * pages, so the numbers always agree.
 */

import { mockDb } from '../data/db.js';
import { buildDeadlineList } from '../routes/statutory.js';
import { businessOfClient, businessOfTask, defaultTrinovaBusiness, NO_BUSINESS } from './businessOf.js';
import { clientDirectory } from './clientDirectory.js';
import { ukToday, daysBetween } from './weeklyReport.js';

const CLOSED = ['Completed', 'Cancelled'];
export { NO_BUSINESS };

function day(value) {
  const m = value ? String(value).match(/^(\d{4}-\d{2}-\d{2})/) : null;
  return m ? m[1] : null;
}

function blank(name, type = '', status = 'Active') {
  return { name, type, status, clients: 0, filingsLate: 0, filingsDueThisWeek: 0, vatLate: 0, vatDueThisWeek: 0,
    deadlines: 0, vatOpen: 0, tasksDueThisWeek: 0, openTasks: 0, lateTasks: 0, stuckTasks: 0, waitingTasks: 0, doneThisWeek: 0, late: 0, dueThisWeek: 0, health: 'green' };
}

/**
 * @returns {{ businesses: object[], total: object }}
 */
export function buildBusinessOverview(now = new Date()) {
  const today = ukToday(now);
  const weekAgo = Date.parse(`${new Date(Date.parse(`${today}T00:00:00Z`) - 6 * 86400000).toISOString().slice(0, 10)}T00:00:00Z`);

  const rows = new Map();
  for (const b of mockDb.businesses || []) rows.set(b.name, blank(b.name, b.type, b.status));
  const bucket = name => {
    const key = name && rows.has(name) ? name : NO_BUSINESS;
    if (!rows.has(key)) rows.set(key, blank(key));
    return rows.get(key);
  };

  // Clients: the ones in Sloane, those put under a business, and those read from TriNova (which
  // belong to TriNova Accounting unless put elsewhere)
  for (const c of mockDb.clients || []) bucket(c.businessArea).clients++;
  const placed = new Set((mockDb.clientBusiness || []).map(r => r.id));
  for (const r of mockDb.clientBusiness || []) bucket(r.businessArea).clients++;
  for (const c of clientDirectory.trinovaClients()) if (!placed.has(c.id)) bucket(defaultTrinovaBusiness()).clients++;

  // Filings (accounts, yearly update)
  for (const d of buildDeadlineList()) {
    if (d.isDissolved) continue;
    const row = bucket(d.businessArea);
    row.deadlines++;
    for (const date of [day(d.accountsDueDate), day(d.confirmationDueDate)]) {
      if (!date) continue;
      const days = daysBetween(today, date);
      if (days < 0) row.filingsLate++;
      else if (days <= 6) row.filingsDueThisWeek++;
    }
  }

  // VAT returns
  for (const v of mockDb.vatReturns || []) {
    const date = day(v.dueDate);
    if (v.status === 'Filed' || !date) continue;
    const row = bucket(v.businessArea || businessOfClient(v.clientId));
    row.vatOpen++;
    const days = daysBetween(today, date);
    if (days < 0) row.vatLate++;
    else if (days <= 6) row.vatDueThisWeek++;
  }

  // Tasks
  const byId = new Map((mockDb.tasks || []).map(t => [t.id, t]));
  for (const t of mockDb.tasks || []) {
    const row = bucket(businessOfTask(t));
    if (t.status === 'Completed' && t.completedAt && Date.parse(t.completedAt) >= weekAgo) row.doneThisWeek++;
    if (CLOSED.includes(t.status)) continue;
    row.openTasks++;
    const due = day(t.dueDate);
    if (due && daysBetween(today, due) < 0) row.lateTasks++;
    else if (due && daysBetween(today, due) <= 6) row.tasksDueThisWeek++;
    if (t.isBlocked) row.stuckTasks++;
    if ((t.dependsOn || []).some(id => byId.get(id) && !CLOSED.includes(byId.get(id).status))) row.waitingTasks++;
  }

  const list = [...rows.values()].filter(r => r.name !== NO_BUSINESS || r.openTasks || r.filingsLate || r.vatLate || r.filingsDueThisWeek || r.vatDueThisWeek || r.clients);
  for (const r of list) {
    r.late = r.filingsLate + r.vatLate + r.lateTasks;
    r.dueThisWeek = r.filingsDueThisWeek + r.vatDueThisWeek + r.tasksDueThisWeek;
    r.health = r.late > 0 || r.stuckTasks > 0 ? 'red' : (r.dueThisWeek > 0 || r.waitingTasks > 0 ? 'amber' : 'green');
  }

  const total = blank('All businesses');
  for (const r of list) {
    for (const k of ['clients', 'deadlines', 'vatOpen', 'tasksDueThisWeek', 'filingsLate', 'filingsDueThisWeek', 'vatLate', 'vatDueThisWeek', 'openTasks', 'lateTasks', 'stuckTasks', 'waitingTasks', 'doneThisWeek', 'late', 'dueThisWeek']) total[k] += r[k];
  }
  total.health = total.late > 0 || total.stuckTasks > 0 ? 'red' : (total.dueThisWeek > 0 ? 'amber' : 'green');
  return { businesses: list, total };
}
