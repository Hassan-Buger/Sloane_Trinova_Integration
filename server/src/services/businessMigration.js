/**
 * One-time fix-up of the list of businesses on an existing install, so it matches the owner's
 * four businesses: TriNova Accounting, CFI Awarding, Emerald Education and MTDflow.
 *
 * It only ever does something safe, and only once (it remembers in the "appMeta" records):
 *  - If the list is still exactly the original six and nothing uses the three extra ones, it is
 *    replaced by the four.
 *  - Otherwise (the owner has already changed things) it changes nothing except adding
 *    "Emerald Education" if it is missing. The owner can remove any business on My Businesses
 *    (removed things wait in the Bin for 30 days).
 */

import { mockDb } from '../data/db.js';

const MIGRATION_ID = 'businesses-four-2026-10';

const OLD_DEFAULTS = [
  ['biz-1', 'Trinova Accounting'],
  ['biz-2', 'CFI Awarding'],
  ['biz-3', 'The Thinking Tent / Yellow Brick'],
  ['biz-4', 'MTDflow'],
  ['biz-5', 'Meta Digital Accounting'],
  ['biz-6', 'Other ventures & property']
];

const FOUR = [
  { id: 'biz-1', name: 'TriNova Accounting', type: 'Accountancy & Tax', status: 'Active' },
  { id: 'biz-2', name: 'CFI Awarding', type: 'Awarding Organisation', status: 'Active' },
  { id: 'biz-3', name: 'Emerald Education', type: 'Education & Training', status: 'Active' },
  { id: 'biz-4', name: 'MTDflow', type: 'Fintech / SaaS', status: 'Active' }
];

function usesBusiness(name) {
  const same = v => String(v || '').toLowerCase() === name.toLowerCase();
  return (mockDb.clients || []).some(c => same(c.businessArea) || same(c.clientType))
    || (mockDb.clientBusiness || []).some(r => same(r.businessArea))
    || (mockDb.tasks || []).some(t => same(t.businessArea));
}

function renameEverywhere(from, to) {
  for (const c of mockDb.clients || []) if (c.businessArea === from) c.businessArea = to;
  for (const r of mockDb.clientBusiness || []) if (r.businessArea === from) r.businessArea = to;
  for (const t of mockDb.tasks || []) if (t.businessArea === from) t.businessArea = to;
}

/**
 * @returns {'already-done'|'replaced'|'added'|'unchanged'} what it did
 */
export function migrateBusinesses() {
  if (!Array.isArray(mockDb.appMeta)) mockDb.appMeta = [];
  if (mockDb.appMeta.some(m => m.id === MIGRATION_ID)) return 'already-done';

  const list = mockDb.businesses || [];
  const isOriginalSix = list.length === OLD_DEFAULTS.length
    && OLD_DEFAULTS.every(([id, name], i) => list[i] && list[i].id === id && list[i].name === name);
  const extras = ['The Thinking Tent / Yellow Brick', 'Meta Digital Accounting', 'Other ventures & property'];

  let result = 'unchanged';
  if (isOriginalSix && !extras.some(usesBusiness)) {
    renameEverywhere('Trinova Accounting', 'TriNova Accounting');
    list.length = 0;
    list.push(...FOUR.map(b => ({ ...b })));
    result = 'replaced';
  } else if (!list.some(b => b.name.toLowerCase() === 'emerald education')) {
    list.push({ id: 'biz-emerald', name: 'Emerald Education', type: 'Education & Training', status: 'Active', createdAt: new Date().toISOString() });
    result = 'added';
  }

  mockDb.appMeta.push({ id: MIGRATION_ID, doneAt: new Date().toISOString(), result });
  return result;
}
