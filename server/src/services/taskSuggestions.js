/**
 * "Sloane suggests": work that needs doing, found from what Sloane already knows, so the owner
 * does not have to create these tasks by hand.
 *
 * The agreed rules (the defaults below can be changed once the owner has agreed them):
 *  - Accounts due within 30 days, or late        -> "Prepare and file accounts"
 *  - Yearly update due within 30 days, or late   -> "File the yearly update (confirmation statement)"
 *  - VAT return not filed, due within 21 days    -> "Prepare the VAT return"
 *
 * A suggestion is NOT made when:
 *  - a task already carries the same suggestion key (even a finished or cancelled one), or
 *  - an open task for the same client already covers that kind of work, or
 *  - the owner has said "Not needed" for it.
 *
 * Because the key includes the due date, next year's deadline is a new suggestion by itself:
 * that is how recurring work is recognised.
 *
 * Suggestions only ever become tasks inside Sloane, and only when the owner approves them.
 */

import { mockDb } from '../data/db.js';
import { buildDeadlineList } from '../routes/statutory.js';
import { clientDirectory } from './clientDirectory.js';
import { ukToday, daysBetween } from './weeklyReport.js';
import { businessOfClient, inBusiness } from './businessOf.js';

export const RULES = {
  accounts: { daysAhead: 30, leadDays: 7, cover: /account/i, label: 'Accounts' },
  yearly_update: { daysAhead: 30, leadDays: 3, cover: /yearly update|confirmation|cs01/i, label: 'Yearly update' },
  vat: { daysAhead: 21, leadDays: 3, cover: /\bvat\b/i, label: 'VAT return' }
};

const CLOSED = ['Completed', 'Cancelled'];

function addDays(isoDay, n) {
  return new Date(Date.parse(`${isoDay}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10);
}

function day(value) {
  const m = value ? String(value).match(/^(\d{4}-\d{2}-\d{2})/) : null;
  return m ? m[1] : null;
}

function niceDate(iso) {
  return new Date(`${iso}T12:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
}

function whenWords(days) {
  if (days < 0) return days === -1 ? '1 day late' : `${-days} days late`;
  if (days === 0) return 'due today';
  if (days === 1) return 'due tomorrow';
  return `due in ${days} days`;
}

function priorityFor(days) {
  if (days < 0) return 'Urgent';
  if (days <= 14) return 'High';
  return 'Normal';
}

/** The person looking after a client, if TriNova or Sloane says so. */
function managerOf(clientId) {
  if (!clientId) return '';
  const own = (mockDb.clients || []).find(c => c.id === clientId);
  if (own && own.assignedManagerName) return own.assignedManagerName;
  const live = clientDirectory.trinova.get(String(clientId));
  return live && live.manager ? live.manager : '';
}

function teamMemberNamed(name) {
  const wanted = String(name || '').trim().toLowerCase();
  if (!wanted) return null;
  return (mockDb.teamMembers || []).find(m => String(m.name || '').trim().toLowerCase() === wanted) || null;
}

function reference(clientId) {
  if (!clientId) return null;
  const client = clientDirectory.find(clientId);
  if (!client) return null;
  return { companyId: client.companyId || client.id, clientId: client.id, clientName: client.name };
}

/** Is there an open task for this client that already covers this kind of work? */
function coveredBy(kind, clientId, name) {
  const rule = RULES[kind];
  const lower = String(name || '').toLowerCase();
  return (mockDb.tasks || []).find(t => {
    if (CLOSED.includes(t.status) || !rule.cover.test(t.title || '')) return false;
    if (clientId) return t.clientId === clientId || t.companyId === clientId;
    return lower && (String(t.companyName || '').toLowerCase() === lower || String(t.title || '').toLowerCase().includes(lower));
  }) || null;
}

function dismissedKeys() {
  return new Set((mockDb.suggestionDismissals || []).map(d => d.id));
}

function usedKeys() {
  return new Set((mockDb.tasks || []).map(t => t.sourceKey).filter(Boolean));
}

/**
 * Builds the suggestions for now.
 * @returns {{ suggestions: object[], dismissedCount: number }}
 */
export function buildSuggestions(now = new Date(), { business = '' } = {}) {
  const today = ukToday(now);
  const dismissed = dismissedKeys();
  const used = usedKeys();
  const out = [];
  let dismissedCount = 0;

  const consider = ({ kind, id, name, date, clientId, businessArea = null, extraTitle = '' }) => {
    const rule = RULES[kind];
    const days = daysBetween(today, date);
    if (days > rule.daysAhead) return;
    const key = `deadline:${kind}:${id}:${date}`;
    const businessName = businessArea || businessOfClient(clientId);
    if (!inBusiness(businessName, business)) return;
    if (used.has(key)) return;
    if (dismissed.has(key)) { dismissedCount++; return; }
    if (coveredBy(kind, clientId, name)) return;

    const ref = reference(clientId);
    const manager = managerOf(clientId);
    const member = teamMemberNamed(manager);
    const dueDate = days < 0 ? today : (addDays(date, -rule.leadDays) < today ? today : addDays(date, -rule.leadDays));
    const what = kind === 'accounts' ? 'Prepare and file accounts'
      : kind === 'yearly_update' ? 'File the yearly update (confirmation statement)'
      : `Prepare the VAT return${extraTitle ? ` (${extraTitle})` : ''}`;
    const filing = kind === 'vat' ? 'The VAT return' : kind === 'accounts' ? 'The accounts' : 'The yearly update';

    out.push({
      key,
      kind,
      title: ref ? `${what}: ${name}` : `${what}: ${name}`,
      description: `${filing} for ${name} ${whenWords(days)} (${niceDate(date)}). Suggested by Sloane from your deadlines.`,
      reason: `${filing} ${whenWords(days)} (${niceDate(date)}), and nobody has a task for it yet.`,
      clientId: ref ? ref.clientId : null,
      companyId: ref ? ref.companyId : null,
      clientName: name,
      businessArea: businessName,
      filingDate: date,
      daysToFiling: days,
      dueDate,
      priority: priorityFor(days),
      assigneeId: member ? member.id : null,
      assigneeName: member ? member.name : null,
      managerName: manager || null
    });
  };

  for (const d of buildDeadlineList()) {
    if (d.isDissolved) continue;
    const name = d.name || d.companyName || d.companyNumber;
    if (!name) continue;
    const id = d.companyNumber || d.clientId || name;
    const accounts = day(d.accountsDueDate);
    const yearly = day(d.confirmationDueDate);
    if (accounts) consider({ kind: 'accounts', id, name, date: accounts, clientId: d.clientId || null, businessArea: d.businessArea });
    if (yearly) consider({ kind: 'yearly_update', id, name, date: yearly, clientId: d.clientId || null, businessArea: d.businessArea });
  }

  for (const v of mockDb.vatReturns || []) {
    const date = day(v.dueDate);
    if (v.status === 'Filed' || !date || !v.clientName) continue;
    consider({ kind: 'vat', id: v.id, name: v.clientName, date, clientId: v.clientId || null, businessArea: v.businessArea || null, extraTitle: v.period || '' });
  }

  // Late first, then the soonest
  out.sort((a, b) => a.daysToFiling - b.daysToFiling || a.title.localeCompare(b.title));
  return { suggestions: out, dismissedCount };
}

/** Says "Not needed" for a suggestion, so it does not come back. */
export function dismissSuggestion(key) {
  if (!Array.isArray(mockDb.suggestionDismissals)) mockDb.suggestionDismissals = [];
  if (!mockDb.suggestionDismissals.some(d => d.id === key)) {
    mockDb.suggestionDismissals.push({ id: key, dismissedAt: new Date().toISOString() });
  }
}

/** Brings back every suggestion that was dismissed. Returns how many. */
export function resetDismissals() {
  const n = (mockDb.suggestionDismissals || []).length;
  mockDb.suggestionDismissals = mockDb.suggestionDismissals || [];
  mockDb.suggestionDismissals.length = 0;
  return n;
}
