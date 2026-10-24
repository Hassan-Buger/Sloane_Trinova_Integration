/**
 * TriNova deadlines feed (GET /statutory on the TriNova portal).
 *
 * The exact layout of this feed has not been confirmed yet, so the reader accepts the usual ways a
 * deadline list is written:
 *  - one row per company, with accounts / yearly update (confirmation statement) dates as fields;
 *  - one row per deadline, with a type ("Annual accounts", "Confirmation statement" ...) and a due
 *    date, grouped here by company;
 *  - a company row that carries its own list of deadlines.
 * Field names are matched in snake_case or camelCase. Rows that cannot be understood are counted
 * (the "Check TriNova data" button reports them) and never guessed at.
 *
 * The result is read-only: Sloane never writes to TriNova.
 */

import { trinovaGet } from './trinovaApi.js';
import { hasMorePages } from './clientDirectory.js';
import { config } from '../config.js';

const CACHE_TTL_MS = 60 * 1000;
const PAGE_SIZE = 100;
const MAX_PAGES = 20;

const LIST_KEYS = ['data', 'items', 'deadlines', 'statutory', 'results', 'records'];
const NESTED_KEYS = ['company', 'entity', 'business', 'client'];

const FIELDS = {
  companyNumber: ['company_number', 'companyNumber', 'crn', 'registration_number', 'registrationNumber', 'company_no', 'companyNo'],
  name: ['company_name', 'companyName', 'entity_name', 'entityName', 'client_name', 'clientName', 'business_name', 'businessName'],
  clientId: ['client_id', 'clientId'],
  yearEnd: ['year_end', 'yearEnd', 'financial_year_end', 'financialYearEnd', 'accounting_reference_date', 'accountingReferenceDate'],
  accountsDueDate: ['accounts_due', 'accountsDue', 'accounts_due_date', 'accountsDueDate', 'next_accounts_due', 'nextAccountsDue', 'accounts_deadline', 'accountsDeadline'],
  confirmationDueDate: [
    'confirmation_statement_due', 'confirmationStatementDue', 'confirmation_due', 'confirmationDue',
    'confirmation_due_date', 'confirmationDueDate', 'cs_due', 'csDue', 'next_confirmation_statement_due', 'nextConfirmationStatementDue'
  ],
  dueDate: ['due_date', 'dueDate', 'due_on', 'dueOn', 'deadline', 'deadline_date', 'deadlineDate', 'due', 'date'],
  kind: ['deadline_type', 'deadlineType', 'type', 'kind', 'category', 'title', 'label', 'description', 'name']
};

const DONE = /\b(filed|complete|completed|done|submitted|cancelled|canceled)\b/i;

function isObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

function text(v) {
  return v === null || v === undefined ? '' : String(v).trim();
}

/** "2027-03-31", "2027-03-31T00:00:00Z" or "31/03/2027" -> "2027-03-31"; anything else -> null. */
export function toIsoDate(value) {
  const t = text(value);
  let m = t.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = t.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  return null;
}

/** First non-empty value for any of the names, on the row itself or a nested company object. */
function pick(row, names) {
  for (const n of names) {
    const v = row[n];
    if (v !== undefined && v !== null && text(v) !== '' && !isObject(v) && !Array.isArray(v)) return v;
  }
  for (const k of NESTED_KEYS) {
    if (isObject(row[k])) {
      for (const n of names) {
        const v = row[k][n];
        if (v !== undefined && v !== null && text(v) !== '' && !isObject(v) && !Array.isArray(v)) return v;
      }
    }
  }
  return null;
}

/** The list of rows inside TriNova's answer, wherever it sits. */
export function findList(json, depth = 0) {
  if (Array.isArray(json)) return json;
  if (!isObject(json) || depth > 3) return null;
  for (const k of LIST_KEYS) {
    if (Array.isArray(json[k])) return json[k];
  }
  for (const k of LIST_KEYS) {
    if (isObject(json[k])) {
      const inner = findList(json[k], depth + 1);
      if (inner) return inner;
    }
  }
  return null;
}

/** Which deadline a per-deadline row is about. */
function classify(row) {
  for (const n of FIELDS.kind) {
    const t = text(row[n]).toLowerCase();
    if (!t) continue;
    if (/confirm|cs01|annual return/.test(t)) return 'confirmationDueDate';
    if (/account/.test(t)) return 'accountsDueDate';
    if (/year.?end|reference date/.test(t)) return 'yearEnd';
  }
  return null;
}

/**
 * Which company a row is about. A plain "name" field is the company's name only on a company row;
 * on a deadline row it is usually the deadline's name ("Annual accounts").
 */
function identity(row, parent = null, { companyRow = false } = {}) {
  const companyNumber = text(pick(row, FIELDS.companyNumber) ?? parent?.companyNumber).toUpperCase();
  const clientId = text(pick(row, FIELDS.clientId) ?? parent?.clientId);
  let name = text(pick(row, FIELDS.name) ?? parent?.name);
  if (!name) {
    for (const k of NESTED_KEYS) if (isObject(row[k]) && text(row[k].name)) { name = text(row[k].name); break; }
  }
  if (!name && companyRow) name = text(row.name);
  return { companyNumber, clientId, name };
}

/**
 * Turns TriNova's deadlines answer into one row per company:
 * { companyNumber, clientId, name, yearEnd, accountsDueDate, confirmationDueDate }.
 * Also says how many of TriNova's rows could be read.
 */
export function normaliseTrinovaDeadlines(json) {
  const list = findList(json);
  if (!list) return { listFound: false, total: 0, understood: 0, rows: [] };

  const groups = new Map();
  let understood = 0;

  const addDate = (id, field, value, done = false) => {
    const date = toIsoDate(value);
    if (!date || done) return false;
    const key = id.companyNumber ? `co:${id.companyNumber}` : id.clientId ? `client:${id.clientId}` : id.name ? `name:${id.name.toLowerCase()}` : null;
    if (!key) return false;
    if (!groups.has(key)) {
      groups.set(key, { companyNumber: id.companyNumber || '', clientId: id.clientId || null, name: id.name || '', yearEnd: null, accountsDueDate: null, confirmationDueDate: null });
    }
    const g = groups.get(key);
    if (!g.name && id.name) g.name = id.name;
    if (!g.clientId && id.clientId) g.clientId = id.clientId;
    // Several dates of one kind (for example a history of deadlines): keep the earliest open one
    if (!g[field] || date < g[field]) g[field] = date;
    return true;
  };

  const readDeadlineRow = (row, parentId) => {
    const field = classify(row);
    const due = pick(row, FIELDS.dueDate);
    if (!field || !due) return false;
    const id = identity(row, parentId);
    const done = DONE.test(text(row.status)) || DONE.test(text(row.state)) || row.completed === true || row.filed === true;
    return addDate(id, field, due, done) || done;
  };

  for (const row of list) {
    if (!isObject(row)) continue;
    let used = false;
    const id = identity(row, null, { companyRow: true });

    // A company row with its dates as fields
    for (const field of ['yearEnd', 'accountsDueDate', 'confirmationDueDate']) {
      const v = pick(row, FIELDS[field]);
      if (v !== null && addDate(id, field, v)) used = true;
    }

    // A company row that carries its own list of deadlines
    if (Array.isArray(row.deadlines)) {
      for (const d of row.deadlines) if (isObject(d) && readDeadlineRow(d, id)) used = true;
    }

    // One row per deadline
    if (!used && readDeadlineRow(row, null)) used = true;

    if (used) understood++;
  }

  const rows = [...groups.values()].filter(g => g.accountsDueDate || g.confirmationDueDate);
  return { listFound: true, total: list.length, understood, rows };
}

class TrinovaDeadlines {
  constructor() {
    this.list = [];
    this.fetchedAt = 0;
    this.lastError = null;
    this.lastHttpStatus = null;
    this.lastSummary = null;
    this.inflight = null;
  }

  isConfigured() {
    return Boolean(config.trinova.apiKey);
  }

  /** One row per company, as read from TriNova's deadlines feed. */
  rows() {
    return this.list;
  }

  /** not_configured | ok | not_available (TriNova has no such feed) | unreachable | not_checked */
  status() {
    if (!this.isConfigured()) return 'not_configured';
    if (this.lastHttpStatus === 404 || this.lastHttpStatus === 405) return 'not_available';
    if (this.lastError) return 'unreachable';
    return this.fetchedAt ? 'ok' : 'not_checked';
  }

  /** Used by tests, and after a fetch: replaces what is remembered with this answer from TriNova. */
  setFeed(json) {
    const result = normaliseTrinovaDeadlines(json);
    this.list = result.rows;
    this.lastSummary = { total: result.total, understood: result.understood, companies: result.rows.length, listFound: result.listFound };
    this.fetchedAt = Date.now();
    this.lastError = null;
    this.lastHttpStatus = 200;
    return result;
  }

  clear() {
    this.list = [];
    this.fetchedAt = 0;
    this.lastError = null;
    this.lastHttpStatus = null;
    this.lastSummary = null;
  }

  /**
   * Reads TriNova's deadlines (all pages) and remembers them for a minute.
   * Never throws: on a failure it keeps what it had and records why.
   */
  async refresh({ force = false } = {}) {
    if (process.env.NODE_ENV === 'test') return this.rows();
    if (!this.isConfigured()) return this.rows();
    if (!force && Date.now() - this.fetchedAt < CACHE_TTL_MS) return this.rows();
    if (this.inflight) return this.inflight;

    this.inflight = (async () => {
      try {
        const all = [];
        let previousFirst = null;
        let lastJson = null;
        for (let page = 1; page <= MAX_PAGES; page++) {
          const r = await trinovaGet(`/statutory?page=${page}&per_page=${PAGE_SIZE}`);
          this.lastHttpStatus = r.status;
          if (!r.ok) throw new Error(r.error || `TriNova answered ${r.status}`);
          lastJson = r.json;
          const rows = findList(r.json) || [];
          // Stop if TriNova ignores paging and sends the same page again
          const first = rows.length ? JSON.stringify(rows[0]) : null;
          if (page > 1 && first !== null && first === previousFirst) break;
          previousFirst = first;
          all.push(...rows);
          if (rows.length === 0 || !hasMorePages(r.json, page, rows.length, PAGE_SIZE)) break;
        }
        this.setFeed(Array.isArray(lastJson) || !lastJson ? all : { data: all });
      } catch (err) {
        this.lastError = err.message;
        console.warn('[TrinovaDeadlines] Could not read deadlines from TriNova:', err.message);
      } finally {
        this.inflight = null;
      }
      return this.rows();
    })();
    return this.inflight;
  }
}

export const trinovaDeadlines = new TrinovaDeadlines();
