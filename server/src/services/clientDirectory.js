/**
 * Client directory
 *
 * One place that answers "who is this client?" for every part of Sloane.
 *
 * Clients come from two places:
 *  - TriNova (read-only here): fetched live from the TriNova portal and remembered for a minute.
 *  - Sloane: clients the owner added by hand, saved in Sloane's own database.
 *
 * Tasks, notes, documents, history and signing requests can be attached to either kind. This
 * module lets the routes look a client (or its company) up by id without caring where it lives.
 */

import { mockDb } from '../data/db.js';
import { config } from '../config.js';

const CACHE_TTL_MS = 60 * 1000;
const PAGE_SIZE = 100;
const MAX_PAGES = 20;

function text(value) {
  return value === null || value === undefined ? '' : String(value).trim();
}

/** Turns one raw TriNova client into the small, steady shape the rest of Sloane uses. */
export function normaliseTrinovaClient(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const primary = (Array.isArray(raw.companies) && raw.companies[0]) || {};
  const id = text(raw.id ?? raw.client_id ?? raw.company_id);
  if (!id) return null;
  const directors = Array.isArray(raw.directors)
    ? raw.directors.map(text).filter(Boolean)
    : text(raw.directors).split(',').map(s => s.trim()).filter(Boolean);

  return {
    id,
    source: 'trinova',
    name: text(raw.name || raw.company_name || primary.companyName) || 'Unnamed client',
    companyNumber: text(raw.company_number || primary.companyNumber),
    yearEnd: text(raw.financial_year_end || primary.accountingReferenceDate) || null,
    accountsDueDate: text(raw.accounts_due || primary.accountsDueDate) || null,
    confirmationDueDate: text(raw.confirmation_statement_due || primary.confirmationDueDate) || null,
    vatRegistered: Boolean(raw.vat_registered),
    vatNumber: text(raw.vat_number || raw.tax_reference),
    payeReference: text(raw.paye_reference),
    riskLevel: text(primary.riskLevel || raw.risk_tier) || 'Low',
    directors,
    manager: text(raw.assignedManagerName || raw.account_manager),
    businessArea: text(raw.businessArea || raw.entity_type),
    notes: text(raw.notes),
    raw
  };
}

/** Does this page of results say there is another page after it? */
export function hasMorePages(json, page, rowCount, pageSize) {
  const p = json?.pagination || json?.meta?.pagination || {};
  if (typeof p.hasMore === 'boolean') return p.hasMore;
  if (typeof json?.meta?.hasMore === 'boolean') return json.meta.hasMore;
  const totalPages = Number(p.totalPages ?? p.total_pages ?? json?.meta?.total_pages ?? json?.meta?.last_page);
  if (Number.isFinite(totalPages) && totalPages > 0) return page < totalPages;
  if (json?.links?.next) return true;
  // No sign either way: assume there is more when the page came back full.
  return rowCount >= pageSize;
}

class ClientDirectory {
  constructor() {
    this.trinova = new Map();
    this.fetchedAt = 0;
    this.lastError = null;
    this.inflight = null;
  }

  /** True when a TriNova key has been set, so live clients can be read at all. */
  isConfigured() {
    return Boolean(config.trinova.apiKey);
  }

  /** Replaces everything remembered from TriNova (used after a full fetch, and by tests). */
  setTrinovaClients(list) {
    this.trinova = new Map();
    for (const raw of list || []) {
      const c = normaliseTrinovaClient(raw);
      if (c) this.trinova.set(c.id, c);
    }
    this.fetchedAt = Date.now();
    this.lastError = null;
  }

  /** Adds clients from one page of results without forgetting the others. */
  mergeTrinovaPage(list) {
    for (const raw of list || []) {
      const c = normaliseTrinovaClient(raw);
      if (c) this.trinova.set(c.id, c);
    }
  }

  clearTrinova() {
    this.trinova = new Map();
    this.fetchedAt = 0;
  }

  trinovaClients() {
    return [...this.trinova.values()];
  }

  /**
   * Reads every client from TriNova (all pages) and remembers them for a minute.
   * Never throws: on a failure it keeps what it had and records the reason.
   */
  async refresh({ force = false } = {}) {
    if (process.env.NODE_ENV === 'test') return this.trinovaClients();
    if (!this.isConfigured()) return this.trinovaClients();
    if (!force && Date.now() - this.fetchedAt < CACHE_TTL_MS) return this.trinovaClients();
    if (this.inflight) return this.inflight;

    this.inflight = (async () => {
      try {
        const all = [];
        for (let page = 1; page <= MAX_PAGES; page++) {
          const url = new URL(`${config.trinova.baseUrl}/clients`);
          url.searchParams.set('page', String(page));
          url.searchParams.set('per_page', String(PAGE_SIZE));
          const controller = new AbortController();
          const timer = setTimeout(() => controller.abort(), config.trinova.timeoutMs || 8000);
          let res;
          try {
            res = await fetch(url.toString(), {
              headers: {
                Accept: 'application/json',
                Authorization: `Bearer ${config.trinova.apiKey}`,
                'X-Requested-With': 'sloane'
              },
              signal: controller.signal
            });
          } finally {
            clearTimeout(timer);
          }
          if (!res.ok) throw new Error(`TriNova answered ${res.status}`);
          const json = await res.json();
          const rows = Array.isArray(json?.data) ? json.data : [];
          all.push(...rows);
          if (rows.length === 0 || !hasMorePages(json, page, rows.length, PAGE_SIZE)) break;
        }
        this.setTrinovaClients(all);
      } catch (err) {
        this.lastError = err.message;
        console.warn('[ClientDirectory] Could not refresh clients from TriNova:', err.message);
      } finally {
        this.inflight = null;
      }
      return this.trinovaClients();
    })();
    return this.inflight;
  }

  /**
   * Looks a client up by its id.
   * @returns {{id, name, source, companyId, companyNumber}|null}
   */
  find(clientId) {
    const id = text(clientId);
    if (!id) return null;

    const own = (mockDb.clients || []).find(c => c.id === id);
    if (own) {
      const company = (mockDb.companies || []).find(comp => (own.companyIds || []).includes(comp.id));
      return {
        id: own.id,
        name: own.name,
        source: own.addedInSloane ? 'sloane' : 'sample',
        clientType: own.clientType,
        status: own.status,
        companyId: company ? company.id : null,
        companyNumber: company ? company.companyNumber : ''
      };
    }

    const live = this.trinova.get(id);
    if (live) {
      return {
        id: live.id,
        name: live.name,
        source: 'trinova',
        clientType: live.businessArea,
        status: 'Active',
        companyId: null,
        companyNumber: live.companyNumber
      };
    }
    return null;
  }

  /**
   * Looks a "company" up by id. For a TriNova client the id the browser sends is the client's
   * own id, so the client stands in as its own company.
   * @returns {{id, companyName, clientId, source}|null}
   */
  findCompany(companyId) {
    const id = text(companyId);
    if (!id) return null;

    const company = (mockDb.companies || []).find(c => c.id === id);
    if (company) {
      return { id: company.id, companyName: company.companyName, clientId: company.clientId, source: 'sloane' };
    }
    const live = this.trinova.get(id);
    if (live) {
      return { id: live.id, companyName: live.name, clientId: live.id, source: 'trinova' };
    }
    return null;
  }

  /** Every client Sloane knows about, from both places, for pickers and lists. */
  all() {
    const own = (mockDb.clients || []).map(c => ({ id: c.id, name: c.name, source: c.addedInSloane ? 'sloane' : 'sample' }));
    const live = this.trinovaClients().map(c => ({ id: c.id, name: c.name, source: 'trinova' }));
    return [...own, ...live];
  }
}

export const clientDirectory = new ClientDirectory();
