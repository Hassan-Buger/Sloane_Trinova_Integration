/**
 * The Bin: things the owner deletes are kept here for 30 days and can be put back.
 *
 * One delete = one Bin item, holding everything that delete removed. Removing a client, for
 * example, also removes its tasks, notes, documents and history; they all go into the same item
 * and come back together.
 *
 * - Restore puts each record back where it was (or at the end), unless a record with the same id
 *   is already there.
 * - "Delete for good" (and the 30-day clear-out) removes the item for good, and only then deletes
 *   any uploaded files it held.
 * - The Bin is saved with everything else (it is a normal data collection), so it survives restarts.
 */

import { mockDb, COLLECTIONS } from '../data/db.js';
import { documentStorage } from './storageDriver.js';
import { newId } from '../routes/helpers.js';

export const BIN_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;

/** What each kind of item is called on the Bin page. */
export const BIN_KIND_LABEL = {
  business: 'Business',
  client: 'Client',
  task: 'Task',
  team_member: 'Team member',
  deadline: 'Deadline',
  vat_return: 'VAT return',
  note: 'Client note',
  document: 'Document',
  history: 'History entry',
  private_note: 'Private note'
};

const COUNT_LABEL = {
  tasks: ['task', 'tasks'],
  notes: ['note', 'notes'],
  documents: ['document', 'documents'],
  timeline_events: ['history entry', 'history entries'],
  signingRequests: ['signing request', 'signing requests'],
  vatReturns: ['VAT return', 'VAT returns'],
  statutoryTracker: ['deadline', 'deadlines'],
  companies: ['company record', 'company records'],
  conversations: ['conversation', 'conversations'],
  messages: ['message', 'messages']
};

function bin() {
  if (!Array.isArray(mockDb.bin)) mockDb.bin = [];
  return mockDb.bin;
}

function idOf(collection, record) {
  const def = COLLECTIONS[collection];
  return def ? String(def.id(record) ?? '') : String(record?.id ?? '');
}

/**
 * Removes one record from a collection and returns what the Bin needs to put it back.
 * Returns null if it was not there.
 */
export function takeOut(collection, predicateOrIndex) {
  const list = mockDb[collection] || [];
  const index = typeof predicateOrIndex === 'number' ? predicateOrIndex : list.findIndex(predicateOrIndex);
  if (index < 0 || index >= list.length) return null;
  const [record] = list.splice(index, 1);
  return { collection, index, record };
}

/** Removes every matching record from a collection; returns them for the Bin (in removal order). */
export function takeOutAll(collection, test) {
  const list = mockDb[collection] || [];
  const removed = [];
  for (let i = list.length - 1; i >= 0; i--) {
    if (test(list[i])) removed.push(takeOut(collection, i));
  }
  return removed;
}

/**
 * Puts what a delete removed into the Bin.
 * @param {object} p
 * @param {string} p.kind     business | client | task | team_member | deadline | vat_return | note | document | history | private_note
 * @param {string} p.label    What it was ("TEST Bakery Ltd", "Prepare accounts" ...)
 * @param {string} [p.where]  Where it came from ("TEST Bakery Ltd", "My Private Notes" ...)
 * @param {Array}  p.removed  [{ collection, index, record }] from takeOut / takeOutAll
 * @param {Array}  [p.changes] [{ collection, id, field, value }]: fields the delete cleared on other records
 * @param {boolean} [p.ownerOnly] Only shown to the signed-in owner (private notes)
 */
export function putInBin({ kind, label, where = '', removed, changes = [], ownerOnly = false }, now = Date.now()) {
  const items = (removed || []).filter(Boolean);
  const entry = {
    id: newId('bin'),
    kind,
    label: String(label || BIN_KIND_LABEL[kind] || 'Item').slice(0, 200),
    where: String(where || '').slice(0, 200),
    ownerOnly: Boolean(ownerOnly),
    deletedAt: new Date(now).toISOString(),
    expiresAt: new Date(now + BIN_DAYS * DAY_MS).toISOString(),
    removed: items.map(i => ({ collection: i.collection, index: i.index, record: i.record })),
    changes
  };
  bin().unshift(entry);
  return entry;
}

/** "3 tasks, 1 note and 2 history entries" for what came with the main item. */
function describeExtras(entry) {
  const counts = {};
  const main = entry.removed[0];
  for (const r of entry.removed) {
    if (r === main) continue;
    counts[r.collection] = (counts[r.collection] || 0) + 1;
  }
  const parts = Object.entries(counts)
    .filter(([c]) => COUNT_LABEL[c])
    .map(([c, n]) => `${n} ${COUNT_LABEL[c][n === 1 ? 0 : 1]}`);
  if (parts.length <= 1) return parts.join('');
  return `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`;
}

/** What the Bin page shows for one item (no record contents). */
export function presentBinEntry(entry, now = Date.now()) {
  const msLeft = Date.parse(entry.expiresAt) - now;
  return {
    id: entry.id,
    kind: entry.kind,
    kindLabel: BIN_KIND_LABEL[entry.kind] || 'Item',
    label: entry.label,
    where: entry.where,
    deletedAt: entry.deletedAt,
    expiresAt: entry.expiresAt,
    daysLeft: Math.max(0, Math.ceil(msLeft / DAY_MS)),
    alsoIncludes: describeExtras(entry)
  };
}

/** Items in the Bin, newest first. Private notes only for the signed-in owner. */
export function listBin({ includeOwnerOnly = false } = {}, now = Date.now()) {
  return bin()
    .filter(e => includeOwnerOnly || !e.ownerOnly)
    .map(e => presentBinEntry(e, now));
}

export function findBinEntry(id) {
  return bin().find(e => e.id === id) || null;
}

/**
 * Puts a Bin item back. Returns { entry, restored, skipped } or { error: [status, code, message] }.
 */
export function restoreFromBin(id) {
  const list = bin();
  const at = list.findIndex(e => e.id === id);
  if (at === -1) return { error: [404, 'NOT_FOUND', 'That item is no longer in the Bin. It may already have been put back or deleted for good.'] };
  const entry = list[at];

  // A business is matched to its clients by name: refuse if a new business now has the same name
  if (entry.kind === 'business') {
    const name = entry.removed[0]?.record?.name;
    if (name && (mockDb.businesses || []).some(b => b.name.toLowerCase() === String(name).toLowerCase())) {
      return { error: [409, 'NAME_TAKEN', `There is already a business called "${name}". Rename that one first, then put this one back.`] };
    }
  }

  let restored = 0;
  let skipped = 0;
  // Put records back in the opposite order to how they were taken out, so positions line up
  for (const item of [...entry.removed].reverse()) {
    const target = mockDb[item.collection];
    if (!Array.isArray(target)) { skipped++; continue; }
    const rid = idOf(item.collection, item.record);
    if (rid && target.some(r => idOf(item.collection, r) === rid)) { skipped++; continue; }
    const index = Math.min(Math.max(0, item.index ?? target.length), target.length);
    target.splice(index, 0, item.record);
    restored++;
  }

  // Fields the delete cleared on other records (a removed person's name on their finished tasks)
  for (const ch of entry.changes || []) {
    const rec = (mockDb[ch.collection] || []).find(r => idOf(ch.collection, r) === String(ch.id));
    if (rec && (rec[ch.field] === null || rec[ch.field] === undefined)) rec[ch.field] = ch.value;
  }

  list.splice(at, 1);
  return { entry, restored, skipped };
}

/** Deletes the uploaded files a Bin item still holds. */
function deleteFilesOf(entry) {
  for (const item of entry.removed || []) {
    if (item.collection === 'documents' && item.record) documentStorage.deleteDocument(item.record);
  }
}

/** Removes a Bin item for good (and its files). Returns the entry, or null if it was not there. */
export function deleteForGood(id) {
  const list = bin();
  const at = list.findIndex(e => e.id === id);
  if (at === -1) return null;
  const [entry] = list.splice(at, 1);
  deleteFilesOf(entry);
  return entry;
}

/** Empties the Bin (the owner's view: includes private notes). Returns how many items went. */
export function emptyBin() {
  const list = bin();
  const all = list.splice(0, list.length);
  for (const entry of all) deleteFilesOf(entry);
  return all.length;
}

/** Deletes for good everything that has been in the Bin for 30 days. Returns how many went. */
export function clearExpired(now = Date.now()) {
  const list = bin();
  let n = 0;
  for (let i = list.length - 1; i >= 0; i--) {
    if (Date.parse(list[i].expiresAt) <= now) {
      const [entry] = list.splice(i, 1);
      deleteFilesOf(entry);
      n++;
    }
  }
  return n;
}
