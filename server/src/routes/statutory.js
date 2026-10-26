/**
 * Deadlines (statutory filings), Companies House checks and VAT returns.
 *
 * Where the deadline list comes from, in this order (the first one found for a company wins):
 *  1. Dates the owner typed in (or changed) on the Deadlines page.
 *  2. The company details of clients added in Sloane.
 *  3. TriNova's deadlines feed (GET /statutory on the TriNova portal).
 *  4. The live TriNova client records (accounts due, yearly update due).
 * Companies House can then confirm or correct each date (POST /statutory/sync).
 *
 * Adheres to:
 * - context/04_backend_integration_context.md §9
 * - context/specs/03-companies-house-backend.md
 */

import { mockDb, sampleDataEnabled } from '../data/db.js';
import { companiesHouseService } from '../services/companiesHouse.js';
import { StatutoryReconciliationEngine } from '../services/reconciliation.js';
import { clientDirectory } from '../services/clientDirectory.js';
import { trinovaDeadlines } from '../services/trinovaDeadlines.js';
import { sendError, newId, isIsoDate, cleanText } from './helpers.js';
import { businessOfClient, canonicalBusiness, defaultTrinovaBusiness, inBusiness } from '../services/businessOf.js';
import { takeOut, putInBin } from '../services/bin.js';

const VAT_STATUSES = ['Not started', 'In progress', 'Filed'];
const DEADLINE_NOT_FOUND = 'We could not find that deadline. It may already have been removed.';
const VAT_NOT_FOUND = 'We could not find that VAT return. It may already have been removed.';

function numberKey(companyNumber) {
  const n = cleanText(companyNumber).toUpperCase();
  return n ? `co:${n}` : null;
}

/**
 * All the rows the Deadlines page shows, before Companies House is consulted.
 * Each row: { key, record, origin, recordId, clientId }.
 */
function collectRows() {
  const rows = new Map();

  // 1. Dates typed in on the Deadlines page (and the built-in examples in demo mode)
  for (const r of (mockDb.statutoryTracker || [])) {
    const key = numberKey(r.companyNumber) || (r.clientId ? `client:${r.clientId}` : `dl:${r.id}`);
    rows.set(key, { key, record: { ...r }, origin: r.origin || 'manual', recordId: r.id || null, clientId: r.clientId || null });
  }

  // 2. Clients added in Sloane (and the example clients in demo mode)
  for (const comp of (mockDb.companies || [])) {
    const client = (mockDb.clients || []).find(c => c.id === comp.clientId);
    const key = numberKey(comp.companyNumber) || `client:${comp.clientId}`;
    if (rows.has(key)) continue;
    const hasDate = comp.accountsDueDate || comp.confirmationDueDate;
    if (!hasDate && !comp.companyNumber) continue;
    rows.set(key, {
      key,
      origin: client && client.addedInSloane ? 'sloane_client' : 'sample',
      recordId: null,
      clientId: comp.clientId,
      record: {
        companyNumber: comp.companyNumber,
        name: comp.companyName,
        yearEnd: comp.accountingReferenceDate || null,
        accountsDueDate: comp.accountsDueDate,
        confirmationDueDate: comp.confirmationDueDate,
        status: comp.status || 'Active',
        notes: comp.notes || ''
      }
    });
  }

  // 3. TriNova's deadlines feed. A date missing there is filled in from the TriNova client record.
  const trinovaClients = clientDirectory.trinovaClients();
  for (const d of trinovaDeadlines.rows()) {
    const client = (d.clientId && clientDirectory.find(d.clientId)) ||
      (d.companyNumber && trinovaClients.find(c => cleanText(c.companyNumber).toUpperCase() === d.companyNumber)) || null;
    const key = numberKey(d.companyNumber) || (client ? `client:${client.id}` : `trinova:${(d.name || '').toLowerCase()}`);
    if (rows.has(key)) continue;
    rows.set(key, {
      key,
      origin: 'trinova',
      recordId: null,
      clientId: client ? client.id : null,
      record: {
        companyNumber: d.companyNumber || (client && client.companyNumber) || '',
        name: d.name || (client && client.name) || d.companyNumber || 'Unnamed company',
        yearEnd: d.yearEnd || (client && client.yearEnd) || null,
        accountsDueDate: d.accountsDueDate || (client && client.accountsDueDate) || null,
        confirmationDueDate: d.confirmationDueDate || (client && client.confirmationDueDate) || null,
        status: 'Active',
        notes: ''
      }
    });
  }

  // 4. Live TriNova clients, only when they carry at least one date
  for (const c of trinovaClients) {
    const key = numberKey(c.companyNumber) || `client:${c.id}`;
    if (rows.has(key)) continue;
    if (!c.accountsDueDate && !c.confirmationDueDate) continue;
    rows.set(key, {
      key,
      origin: 'trinova',
      recordId: null,
      clientId: c.id,
      record: {
        companyNumber: c.companyNumber,
        name: c.name,
        yearEnd: c.yearEnd,
        accountsDueDate: c.accountsDueDate,
        confirmationDueDate: c.confirmationDueDate,
        status: 'Active',
        notes: c.notes || ''
      }
    });
  }

  return [...rows.values()];
}

/**
 * The deadline rows the Deadlines page shows, each checked against Companies House data if it is
 * cached. Shared with "Ask Sloane" and the morning briefing so they all agree.
 */
export function buildDeadlineList(chService = companiesHouseService) {
  const reconciledList = [];
  for (const row of collectRows()) {
    const liveCh = row.record.companyNumber ? chService.getCachedProfile(row.record.companyNumber) : null;
    const reconciled = StatutoryReconciliationEngine.reconcileRecord(row.record, liveCh);
    reconciledList.push({
      ...reconciled,
      id: row.recordId || `derived:${row.key}`,
      recordId: row.recordId,
      clientId: row.clientId,
      origin: row.origin,
      // The names the Deadlines table reads
      yearEnd: row.record.yearEnd || null,
      accountsDueDate: reconciled.accountsDue || null,
      confirmationDueDate: reconciled.confirmDue || null,
      status: row.record.status || 'Active',
      // The business: the one chosen for a deadline typed in by hand, else the client's
      businessArea: row.record.businessArea || businessOfClient(row.clientId) || (row.origin === 'trinova' ? defaultTrinovaBusiness() : null)
    });
  }
  return reconciledList;
}

/** Checks the fields of a deadline. Returns a plain-English problem, or null. */
function validateDeadline(body, { creating }) {
  if (creating || body.name !== undefined) {
    const name = cleanText(body.name);
    if (!name) return 'Please type the company or client name.';
    if (name.length > 200) return 'The name can be up to 200 characters.';
  }
  if (body.companyNumber !== undefined && cleanText(body.companyNumber)) {
    if (!/^[A-Za-z0-9]{1,16}$/.test(cleanText(body.companyNumber))) {
      return 'A company number uses only letters and numbers (for example 12345678).';
    }
  }
  for (const [field, label] of [['yearEnd', 'year end'], ['accountsDueDate', 'accounts due date'], ['confirmationDueDate', 'yearly update due date']]) {
    if (body[field] !== undefined && body[field] !== null && body[field] !== '' && !isIsoDate(body[field])) {
      return `Please enter the ${label} as a real date.`;
    }
  }
  if (body.notes !== undefined && String(body.notes).length > 2000) return 'Notes can be up to 2,000 characters.';
  if (body.businessArea && !canonicalBusiness(body.businessArea)) return 'That business is not on your list. Choose one from My Businesses.';
  return null;
}

function validateVat(body, { creating }) {
  if (creating || body.clientName !== undefined) {
    const name = cleanText(body.clientName);
    if (!name) return 'Please choose or type the client this VAT return is for.';
    if (name.length > 200) return 'The client name can be up to 200 characters.';
  }
  if (creating || body.period !== undefined) {
    const period = cleanText(body.period);
    if (!period) return 'Please say which period the VAT return covers (for example Jul to Sep 2026).';
    if (period.length > 100) return 'The period can be up to 100 characters.';
  }
  if (creating || body.dueDate !== undefined) {
    if (!isIsoDate(body.dueDate)) return 'Please enter the due date as a real date.';
  }
  if (body.status !== undefined && !VAT_STATUSES.includes(body.status)) {
    return `Status must be one of: ${VAT_STATUSES.join(', ')}.`;
  }
  if (body.notes !== undefined && String(body.notes).length > 2000) return 'Notes can be up to 2,000 characters.';
  if (body.businessArea && !canonicalBusiness(body.businessArea)) return 'That business is not on your list. Choose one from My Businesses.';
  return null;
}

export function registerStatutoryRoutes(app, { authenticate, requireScope }, customChService = null) {
  const chService = customChService || companiesHouseService;

  function trinovaStatus() {
    if (!clientDirectory.isConfigured()) return 'not_configured';
    return clientDirectory.lastError ? 'unreachable' : 'ok';
  }

  /**
   * GET /api/v1/statutory
   * The unified deadline list with live Companies House overrides, urgency and where each date came from.
   */
  app.get('/api/v1/statutory', authenticate, requireScope('sloane:read'), async (req, res) => {
    req.auditAction = 'statutory_list_read';
    req.resourceType = 'statutory';

    const force = req.query.refresh === '1' || req.query.refresh === 'true';
    await Promise.all([clientDirectory.refresh({ force }), trinovaDeadlines.refresh({ force })]);

    // One business at a time (?business=MTDflow), or all of them
    const reconciledList = buildDeadlineList(chService).filter(i => inBusiness(i.businessArea, req.query.business));

    let filtered = reconciledList;

    if (req.query.urgency) {
      const urgencyFilter = req.query.urgency.toUpperCase();
      filtered = filtered.filter(item => item.urgency === urgencyFilter);
    }
    if (req.query.source) {
      filtered = filtered.filter(item => item.source === req.query.source);
    }
    if (req.query.search) {
      const q = req.query.search.toLowerCase();
      filtered = filtered.filter(item => {
        return (item.name && item.name.toLowerCase().includes(q)) ||
               (item.companyNumber && item.companyNumber.toLowerCase().includes(q)) ||
               (item.note && item.note.toLowerCase().includes(q));
      });
    }

    // RED first, then AMBER, then CLEAR, then by days remaining
    const urgencyOrder = { 'RED': 1, 'AMBER': 2, 'CLEAR': 3 };
    filtered.sort((a, b) => {
      const diff = (urgencyOrder[a.urgency] || 99) - (urgencyOrder[b.urgency] || 99);
      if (diff !== 0) return diff;
      if (a.daysRemaining === null) return 1;
      if (b.daysRemaining === null) return -1;
      return a.daysRemaining - b.daysRemaining;
    });

    res.status(200).json({
      status: 'success',
      data: filtered,
      meta: {
        total: filtered.length,
        unfilteredTotal: reconciledList.length,
        redCount: reconciledList.filter(i => i.urgency === 'RED').length,
        amberCount: reconciledList.filter(i => i.urgency === 'AMBER').length,
        clearCount: reconciledList.filter(i => i.urgency === 'CLEAR').length,
        liveVerifiedCount: reconciledList.filter(i => i.source === 'companies_house_live').length,
        trackerDerivedCount: reconciledList.filter(i => i.source === 'tracker_derived').length,
        // 'sample' only while the built-in example records are switched on
        dataSource: sampleDataEnabled() ? 'sample' : 'live',
        trinovaStatus: trinovaStatus(),
        // TriNova's own deadlines feed: ok | not_available | unreachable | not_configured | not_checked
        trinovaDeadlinesStatus: trinovaDeadlines.status(),
        trinovaDeadlineCount: reconciledList.filter(i => i.origin === 'trinova').length,
        asOf: new Date().toISOString()
      }
    });
  });

  /**
   * POST /api/v1/statutory/deadlines
   * Adds a deadline by hand, or saves the owner's own dates for a company that comes from TriNova.
   */
  app.post('/api/v1/statutory/deadlines', authenticate, requireScope('sloane:write'), (req, res) => {
    req.auditAction = 'deadline_created';
    req.resourceType = 'deadline';
    const body = req.body || {};

    const problem = validateDeadline(body, { creating: true });
    if (problem) return sendError(res, 400, 'BAD_REQUEST', problem);

    if (body.clientId && !clientDirectory.find(body.clientId)) {
      return sendError(res, 422, 'CLIENT_NOT_FOUND', 'We could not find that client. Refresh the Clients page and try again.');
    }

    const companyNumber = cleanText(body.companyNumber).toUpperCase();
    const clash = (mockDb.statutoryTracker || []).find(r =>
      (companyNumber && cleanText(r.companyNumber).toUpperCase() === companyNumber) ||
      (!companyNumber && body.clientId && r.clientId === body.clientId));
    if (clash) {
      return sendError(res, 409, 'DEADLINE_EXISTS', `There is already a saved deadline for "${clash.name}". Change that one instead.`);
    }

    const record = {
      id: newId('dl'),
      origin: 'manual',
      companyNumber,
      clientId: body.clientId || null,
      name: cleanText(body.name),
      yearEnd: body.yearEnd || null,
      accountsDueDate: body.accountsDueDate || null,
      confirmationDueDate: body.confirmationDueDate || null,
      status: cleanText(body.status) || 'Active',
      notes: typeof body.notes === 'string' ? body.notes.trim() : '',
      businessArea: body.businessArea ? canonicalBusiness(body.businessArea) : null,
      createdAt: new Date().toISOString()
    };
    mockDb.statutoryTracker.unshift(record);
    req.resourceId = record.id;
    res.status(201).json({ status: 'success', data: record });
  });

  /** PATCH /api/v1/statutory/deadlines/:id */
  app.patch('/api/v1/statutory/deadlines/:id', authenticate, requireScope('sloane:write'), (req, res) => {
    req.auditAction = 'deadline_updated';
    req.resourceType = 'deadline';
    req.resourceId = req.params.id;
    const body = req.body || {};

    const record = (mockDb.statutoryTracker || []).find(r => r.id === req.params.id);
    if (!record) return sendError(res, 404, 'NOT_FOUND', DEADLINE_NOT_FOUND);

    const problem = validateDeadline(body, { creating: false });
    if (problem) return sendError(res, 400, 'BAD_REQUEST', problem);

    if (body.companyNumber !== undefined) {
      const wanted = cleanText(body.companyNumber).toUpperCase();
      const clash = wanted && mockDb.statutoryTracker.find(r => r.id !== record.id && cleanText(r.companyNumber).toUpperCase() === wanted);
      if (clash) return sendError(res, 409, 'DEADLINE_EXISTS', `There is already a saved deadline for "${clash.name}".`);
      record.companyNumber = wanted;
    }
    if (body.name !== undefined) record.name = cleanText(body.name);
    for (const f of ['yearEnd', 'accountsDueDate', 'confirmationDueDate']) {
      if (body[f] !== undefined) record[f] = body[f] || null;
    }
    if (body.status !== undefined) record.status = cleanText(body.status) || 'Active';
    if (body.notes !== undefined) record.notes = String(body.notes).trim();
    if (body.businessArea !== undefined) record.businessArea = body.businessArea ? canonicalBusiness(body.businessArea) : null;
    record.updatedAt = new Date().toISOString();

    res.status(200).json({ status: 'success', data: record });
  });

  /**
   * DELETE /api/v1/statutory/deadlines/:id
   * Removes a saved deadline. If the company also comes from TriNova or a client, the date from
   * that record shows again.
   */
  app.delete('/api/v1/statutory/deadlines/:id', authenticate, requireScope('sloane:write'), (req, res) => {
    req.auditAction = 'deadline_deleted';
    req.resourceType = 'deadline';
    req.resourceId = req.params.id;

    const idx = (mockDb.statutoryTracker || []).findIndex(r => r.id === req.params.id);
    if (idx === -1) return sendError(res, 404, 'NOT_FOUND', DEADLINE_NOT_FOUND);
    const item = takeOut('statutoryTracker', idx);
    const removed = item.record;
    const entry = putInBin({ kind: 'deadline', label: removed.name || removed.companyNumber || 'Deadline', where: 'Deadlines', removed: [item] });
    res.status(200).json({ status: 'success', message: `The saved deadline for "${removed.name}" has been moved to the Bin. You can put it back from the Bin within 30 days.`, data: { binId: entry.id } });
  });

  /**
   * GET /api/v1/statutory/:companyNumber
   * Retrieves single company statutory details with live reconciliation.
   */
  app.get('/api/v1/statutory/:companyNumber', authenticate, requireScope('sloane:read'), async (req, res) => {
    const coNo = chService.formatCompanyNumber(req.params.companyNumber);
    req.auditAction = 'statutory_company_read';
    req.resourceType = 'statutory';
    req.resourceId = coNo;

    let trackerRec = (mockDb.statutoryTracker || []).find(i => chService.formatCompanyNumber(i.companyNumber) === coNo);
    if (!trackerRec) {
      const comp = (mockDb.companies || []).find(c => chService.formatCompanyNumber(c.companyNumber) === coNo);
      if (comp) {
        trackerRec = {
          companyNumber: comp.companyNumber,
          name: comp.companyName,
          accountsDueDate: comp.accountsDueDate,
          confirmationDueDate: comp.confirmationDueDate,
          status: comp.status || 'Active',
          notes: comp.notes || ''
        };
      }
    }

    let liveCh = chService.getCachedProfile(coNo);

    if (!trackerRec && !liveCh) {
      // Not saved anywhere: ask Companies House directly
      try {
        liveCh = await chService.fetchCompanyProfile(coNo);
        trackerRec = {
          companyNumber: coNo,
          name: liveCh.name,
          accountsDueDate: liveCh.accountsDue,
          confirmationDueDate: liveCh.confirmDue,
          status: liveCh.companyStatus,
          notes: ''
        };
      } catch (err) {
        return res.status(err.status || 404).json({
          error: {
            code: err.code || 'COMPANY_NOT_FOUND',
            message: err.message || `Company ${coNo} not found in database or Companies House register.`
          }
        });
      }
    }

    const reconciled = StatutoryReconciliationEngine.reconcileRecord(trackerRec || { companyNumber: coNo }, liveCh);
    res.status(200).json({ status: 'success', data: reconciled });
  });

  /**
   * POST /api/v1/statutory/sync
   * Asks Companies House about specified or all known companies.
   */
  app.post('/api/v1/statutory/sync', authenticate, requireScope('sloane:read'), async (req, res) => {
    req.auditAction = 'statutory_sync_triggered';
    req.resourceType = 'statutory';

    let targets = [];
    if (Array.isArray(req.body?.companyNumbers) && req.body.companyNumbers.length > 0) {
      targets = req.body.companyNumbers;
    } else {
      await Promise.all([clientDirectory.refresh(), trinovaDeadlines.refresh()]);
      targets = Array.from(new Set(collectRows().map(r => r.record.companyNumber).filter(Boolean)));
    }

    const results = [];
    let syncedCount = 0;
    let failedCount = 0;
    const forceRefresh = Boolean(req.body?.forceRefresh);

    for (const rawCoNo of targets) {
      const coNo = chService.formatCompanyNumber(rawCoNo);
      try {
        const liveProfile = await chService.fetchCompanyProfile(coNo, { forceRefresh });
        syncedCount++;
        results.push({
          companyNumber: coNo,
          status: 'synced',
          fromCache: Boolean(liveProfile.fromCache),
          name: liveProfile.name,
          companyStatus: liveProfile.companyStatus,
          accountsDue: liveProfile.accountsDue,
          accountsOverdue: liveProfile.accountsOverdue,
          confirmDue: liveProfile.confirmDue,
          confirmOverdue: liveProfile.confirmOverdue,
          lastChecked: liveProfile.lastChecked
        });
      } catch (err) {
        failedCount++;
        results.push({
          companyNumber: coNo,
          status: 'failed',
          errorCode: err.code || 'SYNC_FAILED',
          message: err.message
        });
      }
    }

    res.status(200).json({
      status: 'success',
      message: `Statutory reconciliation sync completed. ${syncedCount} synced, ${failedCount} failed.`,
      data: {
        totalRequested: targets.length,
        syncedCount,
        failedCount,
        syncedAt: new Date().toISOString(),
        results
      }
    });
  });

  // ---------------------------------------------------------------------------
  // VAT returns: a list of VAT return dates the owner keeps track of by hand
  // ---------------------------------------------------------------------------

  /** GET /api/v1/vat-returns */
  app.get('/api/v1/vat-returns', authenticate, requireScope('sloane:read'), (req, res) => {
    req.auditAction = 'read_vat_returns';
    req.resourceType = 'vat_return';
    const data = (mockDb.vatReturns || [])
      .map(v => ({ ...v, businessArea: v.businessArea || businessOfClient(v.clientId) }))
      .filter(v => inBusiness(v.businessArea, req.query.business))
      .sort((a, b) => a.dueDate.localeCompare(b.dueDate));
    res.status(200).json({ status: 'success', data, meta: { total: data.length } });
  });

  /** POST /api/v1/vat-returns */
  app.post('/api/v1/vat-returns', authenticate, requireScope('sloane:write'), (req, res) => {
    req.auditAction = 'vat_return_created';
    req.resourceType = 'vat_return';
    const body = req.body || {};

    const problem = validateVat(body, { creating: true });
    if (problem) return sendError(res, 400, 'BAD_REQUEST', problem);
    if (body.clientId && !clientDirectory.find(body.clientId)) {
      return sendError(res, 422, 'CLIENT_NOT_FOUND', 'We could not find that client. Refresh the Clients page and try again.');
    }

    const vat = {
      id: newId('vat'),
      clientId: body.clientId || null,
      clientName: cleanText(body.clientName),
      period: cleanText(body.period),
      dueDate: body.dueDate,
      status: body.status || 'Not started',
      notes: typeof body.notes === 'string' ? body.notes.trim() : '',
      businessArea: body.businessArea ? canonicalBusiness(body.businessArea) : null,
      createdAt: new Date().toISOString()
    };
    mockDb.vatReturns.push(vat);
    req.resourceId = vat.id;
    res.status(201).json({ status: 'success', data: vat });
  });

  /** PATCH /api/v1/vat-returns/:id */
  app.patch('/api/v1/vat-returns/:id', authenticate, requireScope('sloane:write'), (req, res) => {
    req.auditAction = 'vat_return_updated';
    req.resourceType = 'vat_return';
    req.resourceId = req.params.id;
    const body = req.body || {};

    const vat = (mockDb.vatReturns || []).find(v => v.id === req.params.id);
    if (!vat) return sendError(res, 404, 'NOT_FOUND', VAT_NOT_FOUND);

    const problem = validateVat(body, { creating: false });
    if (problem) return sendError(res, 400, 'BAD_REQUEST', problem);

    if (body.clientName !== undefined) vat.clientName = cleanText(body.clientName);
    if (body.clientId !== undefined) vat.clientId = body.clientId || null;
    if (body.period !== undefined) vat.period = cleanText(body.period);
    if (body.dueDate !== undefined) vat.dueDate = body.dueDate;
    if (body.status !== undefined) vat.status = body.status;
    if (body.notes !== undefined) vat.notes = String(body.notes).trim();
    if (body.businessArea !== undefined) vat.businessArea = body.businessArea ? canonicalBusiness(body.businessArea) : null;
    vat.updatedAt = new Date().toISOString();

    res.status(200).json({ status: 'success', data: vat });
  });

  /** DELETE /api/v1/vat-returns/:id */
  app.delete('/api/v1/vat-returns/:id', authenticate, requireScope('sloane:write'), (req, res) => {
    req.auditAction = 'vat_return_deleted';
    req.resourceType = 'vat_return';
    req.resourceId = req.params.id;

    const idx = (mockDb.vatReturns || []).findIndex(v => v.id === req.params.id);
    if (idx === -1) return sendError(res, 404, 'NOT_FOUND', VAT_NOT_FOUND);
    const item = takeOut('vatReturns', idx);
    const v = item.record;
    const entry = putInBin({ kind: 'vat_return', label: `${v.clientName}${v.period ? ` (${v.period})` : ''}`, where: 'Deadlines', removed: [item] });
    res.status(200).json({ status: 'success', message: 'VAT return moved to the Bin. You can put it back from the Bin within 30 days.', data: { binId: entry.id } });
  });
}
