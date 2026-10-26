/**
 * Which business something belongs to (TriNova Accounting, CFI Awarding, Emerald Education,
 * MTDflow ...). Businesses are kept by name, as on the Clients page.
 *
 * - A client added in Sloane carries its business.
 * - A TriNova client is put under a business by the owner (the "clientBusiness" choice).
 * - A task, deadline or VAT return takes the business of its client unless one is chosen.
 */

import { mockDb } from '../data/db.js';
import { clientDirectory } from './clientDirectory.js';

/**
 * The business that clients read from the TriNova portal belong to unless the owner has put them
 * under another one: the portal is TriNova Accounting's own system.
 */
export function defaultTrinovaBusiness() {
  return canonicalBusiness('TriNova Accounting');
}

/** The business a client is under, or null. */
export function businessOfClient(clientId) {
  if (!clientId) return null;
  const id = String(clientId);
  const own = (mockDb.clients || []).find(c => c.id === id);
  if (own) return own.businessArea || null;
  const overlay = (mockDb.clientBusiness || []).find(r => r.id === id);
  if (overlay && overlay.businessArea) return overlay.businessArea;
  // A client read from TriNova, with no other business chosen
  return clientDirectory.trinova.has(id) ? defaultTrinovaBusiness() : null;
}

/** The names of the businesses, in order. */
export function businessNames() {
  return (mockDb.businesses || []).map(b => b.name);
}

/** The exact name of a business from any capitalisation, or null if there is no such business. */
export function canonicalBusiness(name) {
  const wanted = String(name || '').trim().toLowerCase();
  if (!wanted) return null;
  const found = (mockDb.businesses || []).find(b => b.name.toLowerCase() === wanted);
  return found ? found.name : null;
}

/** The business of a task: the one chosen, else its client's. */
export function businessOfTask(task) {
  if (task.businessArea) return task.businessArea;
  const viaClient = businessOfClient(task.clientId);
  if (viaClient) return viaClient;
  // Linked only to a company: use that company's client
  const company = (mockDb.companies || []).find(c => c.id === task.companyId);
  return businessOfClient(company ? company.clientId : task.companyId);
}

/** The name used for work that is not under any business yet. */
export const NO_BUSINESS = 'No business chosen yet';

/** Does this business filter match? An empty filter matches everything. */
export function inBusiness(name, filter) {
  const wanted = String(filter || '').trim().toLowerCase();
  if (!wanted || wanted === 'all') return true;
  if (wanted === NO_BUSINESS.toLowerCase()) return !name;
  return String(name || '').toLowerCase() === wanted;
}
