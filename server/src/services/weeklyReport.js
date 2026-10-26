/**
 * "This week": a one-page summary of what needs Kirsty this week, built from what Sloane knows.
 *
 * - Late: filings (accounts, yearly update), VAT returns and tasks whose date has passed
 * - Due in the next 7 days (today included): filings, VAT returns and tasks
 * - Stuck tasks, with the reason
 * - Finished in the last 7 days
 * - Coming next: how much is due in the 8 to 30 days after that
 *
 * Dates are UK dates (Europe/London), so "today" matches Kirsty's calendar.
 */

import { mockDb } from '../data/db.js';
import { buildDeadlineList } from '../routes/statutory.js';
import { clientDirectory } from './clientDirectory.js';
import { businessOfClient, businessOfTask, inBusiness } from './businessOf.js';

const DAY_MS = 24 * 60 * 60 * 1000;
const CLOSED = ['Completed', 'Cancelled'];

/** Today's date in the UK, as YYYY-MM-DD. */
export function ukToday(now = new Date()) {
  return now.toLocaleDateString('en-CA', { timeZone: 'Europe/London' });
}

function addDays(isoDay, n) {
  const t = Date.parse(`${isoDay}T00:00:00Z`) + n * DAY_MS;
  return new Date(t).toISOString().slice(0, 10);
}

/** Whole days from `from` to `to` (both YYYY-MM-DD); negative when `to` is earlier. */
export function daysBetween(from, to) {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS);
}

function day(value) {
  const m = value ? String(value).match(/^(\d{4}-\d{2}-\d{2})/) : null;
  return m ? m[1] : null;
}

function clientNameFor(t) {
  if (t.companyName) return t.companyName;
  const id = t.clientId || t.companyId;
  if (!id) return '';
  const comp = (mockDb.companies || []).find(c => c.id === id);
  const client = clientDirectory.find(comp ? comp.clientId : id) || clientDirectory.find(id);
  return (client && client.name) || (comp && comp.companyName) || '';
}

const byDate = (a, b) => (a.date || '').localeCompare(b.date || '') || (a.name || '').localeCompare(b.name || '');

/**
 * Builds the report.
 * @param {Date} [now]
 */
export function buildWeeklyReport(now = new Date(), { business = '' } = {}) {
  const today = ukToday(now);
  const weekEnd = addDays(today, 6);
  const monthEnd = addDays(today, 30);

  // ---- Filings (accounts and yearly update), one line per filing ----
  const filings = [];
  for (const d of buildDeadlineList()) {
    if (d.isDissolved || !inBusiness(d.businessArea, business)) continue;
    const name = d.name || d.companyName || d.companyNumber || 'Unnamed company';
    for (const [what, date] of [['Accounts', day(d.accountsDueDate)], ['Yearly update', day(d.confirmationDueDate)]]) {
      if (!date) continue;
      filings.push({ kind: 'filing', what, name, companyNumber: d.companyNumber || '', date, days: daysBetween(today, date), clientId: d.clientId || null, business: d.businessArea || null });
    }
  }

  // ---- VAT returns not yet filed ----
  const vat = (mockDb.vatReturns || [])
    .filter(v => v.status !== 'Filed' && day(v.dueDate) && inBusiness(v.businessArea || businessOfClient(v.clientId), business))
    .map(v => ({ kind: 'vat', what: `VAT return${v.period ? ` (${v.period})` : ''}`, name: v.clientName, date: day(v.dueDate), days: daysBetween(today, day(v.dueDate)), status: v.status, business: v.businessArea || businessOfClient(v.clientId) || null }));

  // ---- Tasks ----
  const open = (mockDb.tasks || []).filter(t => !CLOSED.includes(t.status) && inBusiness(businessOfTask(t), business));
  const taskLine = t => ({
    kind: 'task',
    what: t.title,
    name: clientNameFor(t) || 'General task',
    who: t.assigneeName || 'Nobody yet',
    date: day(t.dueDate),
    days: day(t.dueDate) ? daysBetween(today, day(t.dueDate)) : null,
    priority: t.priority || '',
    business: businessOfTask(t),
    waiting: (t.dependsOn || []).map(id => (mockDb.tasks || []).find(x => x.id === id)).filter(x => x && !CLOSED.includes(x.status)).map(x => x.title),
    stuck: t.isBlocked ? (t.blocker || 'Held up') : ''
  });
  const tasks = open.map(taskLine);

  const late = [
    ...filings.filter(f => f.days < 0),
    ...vat.filter(v => v.days < 0),
    ...tasks.filter(t => t.days !== null && t.days < 0)
  ].sort(byDate);

  const dueThisWeek = [
    ...filings.filter(f => f.days >= 0 && f.date <= weekEnd),
    ...vat.filter(v => v.days >= 0 && v.date <= weekEnd),
    ...tasks.filter(t => t.days !== null && t.days >= 0 && t.date <= weekEnd)
  ].sort(byDate);

  const stuck = tasks.filter(t => t.stuck).sort(byDate);

  const weekAgo = Date.parse(`${addDays(today, -6)}T00:00:00Z`);
  const done = (mockDb.tasks || [])
    .filter(t => t.status === 'Completed' && t.completedAt && Date.parse(t.completedAt) >= weekAgo && inBusiness(businessOfTask(t), business))
    .map(t => ({ ...taskLine(t), date: day(t.completedAt), how: t.completionNotes || '' }))
    .sort((a, b) => (b.date || '').localeCompare(a.date || ''));

  const comingNext = {
    filings: filings.filter(f => f.date > weekEnd && f.date <= monthEnd).length,
    vat: vat.filter(v => v.date > weekEnd && v.date <= monthEnd).length,
    tasks: tasks.filter(t => t.date && t.date > weekEnd && t.date <= monthEnd).length
  };

  // ---- Workload per person (open tasks) ----
  const people = new Map();
  for (const t of tasks) {
    const p = people.get(t.who) || { who: t.who, open: 0, late: 0, stuck: 0 };
    p.open++;
    if (t.days !== null && t.days < 0) p.late++;
    if (t.stuck) p.stuck++;
    people.set(t.who, p);
  }

  return {
    business: business && business.toLowerCase() !== 'all' ? business : null,
    period: { from: today, to: weekEnd },
    generatedAt: now.toISOString(),
    counts: {
      late: late.length,
      lateFilings: late.filter(i => i.kind === 'filing').length,
      dueThisWeek: dueThisWeek.length,
      vatThisWeek: dueThisWeek.filter(i => i.kind === 'vat').length,
      openTasks: tasks.length,
      stuckTasks: stuck.length,
      doneThisWeek: done.length
    },
    late,
    dueThisWeek,
    stuck,
    done,
    comingNext,
    workload: [...people.values()].sort((a, b) => b.open - a.open || a.who.localeCompare(b.who))
  };
}
