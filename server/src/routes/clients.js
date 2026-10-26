/**
 * Client and Company Read Routes
 * Implements context/specs/02-client-company-read.md and
 * context/04_backend_integration_context.md §4.
 */

import { mockDb } from '../data/db.js';
import { config } from '../config.js';
import { clientDirectory } from '../services/clientDirectory.js';
import { takeOut, takeOutAll, putInBin } from '../services/bin.js';
import { sendError } from './helpers.js';
import { defaultTrinovaBusiness } from '../services/businessOf.js';

/**
 * Takes out everything Sloane stored for a client that is being deleted: its company, tasks,
 * notes, documents, signing requests, conversations and history. They go to the Bin together
 * with the client (uploaded files are only deleted when the Bin item is deleted for good).
 * Returns how many of each were removed, so the screen can say so, and the removed records.
 */
function removeClientAndRelatedData(client) {
  const companyIds = new Set(client.companyIds || []);
  const ids = new Set([client.id, ...companyIds]);
  const counts = { tasks: 0, notes: 0, documents: 0, history: 0, signing: 0 };
  const removed = [];

  const prune = (name, test) => {
    for (const item of takeOutAll(name, test)) { removed.push(item); onRemoved(name); }
  };
  const onRemoved = (name) => {
    if (name === 'documents') counts.documents++;
    if (name === 'tasks') counts.tasks++;
    if (name === 'notes') counts.notes++;
    if (name === 'timeline_events') counts.history++;
    if (name === 'signingRequests') counts.signing++;
  };

  prune('tasks', t => ids.has(t.companyId) || ids.has(t.clientId));
  prune('notes', n => ids.has(n.companyId));
  prune('documents', d => ids.has(d.companyId));
  prune('signingRequests', r => ids.has(r.companyId));
  prune('timeline_events', e => e.clientId === client.id || ids.has(e.companyId));
  // VAT returns and own-date deadlines kept for this client go with it
  prune('vatReturns', v => v.clientId === client.id);
  prune('statutoryTracker', d => d.clientId === client.id);
  const convIds = new Set((mockDb.conversations || []).filter(c => ids.has(c.companyId)).map(c => c.id));
  prune('messages', m => convIds.has(m.conversationId));
  prune('conversations', c => ids.has(c.companyId));
  prune('companies', c => companyIds.has(c.id) || c.clientId === client.id);
  return { counts, removed };
}

function serveMockClients(req, res) {
  let results = [...mockDb.clients];

  // Filter by business area
  if (req.query.biz && req.query.biz !== 'All') {
    results = results.filter(c => c.businessArea === req.query.biz);
  }

  // Filter by search query across name, contacts, and linked company CRNs
  if (req.query.search) {
    const q = req.query.search.toLowerCase();
    results = results.filter(c => {
      const matchesClientName = c.name.toLowerCase().includes(q);
      const matchesContact = c.contacts.some(cnt => cnt.name.toLowerCase().includes(q) || cnt.email.toLowerCase().includes(q));
      const matchesCompany = mockDb.companies.some(comp => c.companyIds.includes(comp.id) && (comp.companyName.toLowerCase().includes(q) || comp.companyNumber.includes(q)));
      return matchesClientName || matchesContact || matchesCompany;
    });
  }

  // Pagination
  const page = Math.max(1, parseInt(req.query.page || '1', 10));
  const pageSize = Math.max(1, Math.min(100, parseInt(req.query.pageSize || '10', 10)));
  const total = results.length;
  const totalPages = Math.ceil(total / pageSize);
  const offset = (page - 1) * pageSize;
  const paginatedItems = results.slice(offset, offset + pageSize);

  // Enrich client records with company summaries
  const data = paginatedItems.map(c => {
    const companies = mockDb.companies
      .filter(comp => c.companyIds.includes(comp.id))
      .map(comp => ({
        id: comp.id,
        companyName: comp.companyName,
        companyNumber: comp.companyNumber,
        accountsDueDate: comp.accountsDueDate,
        confirmationDueDate: comp.confirmationDueDate,
        riskLevel: comp.riskLevel
      }));

    return {
      ...c,
      companies
    };
  });

  return res.status(200).json({
    status: 'success',
    data,
    pagination: {
      page,
      pageSize,
      total,
      totalPages,
      hasMore: page < totalPages
    }
  });
}


/**
 * Clients added by hand inside Sloane (flagged addedInSloane) live in Sloane's own store.
 * This flattens one of them into the same shape the TriNova portal returns, so the
 * browser can show it in the list next to the live TriNova clients.
 */
function toPortalShape(client) {
  const company = (mockDb.companies || []).find(comp => (client.companyIds || []).includes(comp.id)) || {};
  const directors = (company.officers || []).map(o => o.name).filter(Boolean);
  return {
    id: client.id,
    client_id: client.id,
    name: client.name,
    businessArea: client.businessArea,
    company_number: company.companyNumber || '',
    financial_year_end: company.accountingReferenceDate || null,
    accounts_due: company.accountsDueDate || null,
    confirmation_statement_due: company.confirmationDueDate || null,
    vat_registered: Boolean(company.vatRegistered),
    vat_number: company.vatNumber || '',
    paye_reference: company.payeReference || '',
    cis_registered: Boolean(company.cisStatus && company.cisStatus !== 'No'),
    directors,
    assignedManagerName: client.assignedManagerName,
    risk_tier: company.riskLevel || 'Low',
    notes: company.notes || '',
    addedInSloane: true,
    companies: company.id ? [{
      id: company.id,
      companyName: company.companyName,
      companyNumber: company.companyNumber,
      accountsDueDate: company.accountsDueDate,
      confirmationDueDate: company.confirmationDueDate,
      accountingReferenceDate: company.accountingReferenceDate,
      riskLevel: company.riskLevel
    }] : []
  };
}

function sloaneAddedClients(req) {
  let added = (mockDb.clients || []).filter(c => c.addedInSloane);
  const biz = req.query.biz || req.query.type;
  if (biz && biz !== 'All') {
    added = added.filter(c => c.businessArea === biz);
  }
  const search = req.query.search || req.query.q;
  if (search) {
    const q = String(search).toLowerCase();
    added = added.filter(c => {
      const company = (mockDb.companies || []).find(comp => (c.companyIds || []).includes(comp.id)) || {};
      return c.name.toLowerCase().includes(q) || (company.companyNumber || '').includes(q);
    });
  }
  return added.map(toPortalShape);
}

/** The business the owner has put a TriNova client under, or null. */
function businessFor(clientId) {
  const row = (mockDb.clientBusiness || []).find(r => r.id === String(clientId));
  // A TriNova client belongs to TriNova Accounting unless the owner has put it under another business
  return row && row.businessArea ? row.businessArea : defaultTrinovaBusiness();
}

function respondWithSloaneClientsOnly(req, res, trinovaStatus) {
  const addedOnly = sloaneAddedClients(req);
  return res.status(200).json({
    status: 'success',
    data: addedOnly,
    meta: { trinovaStatus, total: addedOnly.length },
    pagination: {
      page: 1,
      pageSize: 10,
      total: addedOnly.length,
      totalPages: addedOnly.length ? 1 : 0,
      hasMore: false
    }
  });
}

export function registerClientRoutes(app, { authenticate, requireScope }) {
  /**
   * GET /api/v1/clients
   * Returns paginated client records with linked company summaries.
   * In production, proxies to live TriNova portal. In test mode, returns mockDb.
   */
  app.get('/api/v1/clients', authenticate, requireScope('sloane:read'), async (req, res) => {
    req.auditAction = 'read_clients_list';
    req.resourceType = 'client';

    if (process.env.NODE_ENV === 'test') {
      return serveMockClients(req, res);
    }

    // No TriNova key set: do not call TriNova at all, and say so plainly.
    if (!clientDirectory.isConfigured()) {
      return respondWithSloaneClientsOnly(req, res, 'not_configured');
    }

    // Read every client from TriNova (remembered for a minute), then search, filter and
    // page them here, so the Clients page and the pickers always see the whole list.
    // "Refresh from TriNova" asks for a fresh copy instead of the one remembered for a minute
    await clientDirectory.refresh({ force: req.query.refresh === '1' });
    const live = clientDirectory.trinovaClients();
    if (live.length === 0 && clientDirectory.lastError) {
      return respondWithSloaneClientsOnly(req, res, 'unreachable');
    }

    const biz = req.query.biz || req.query.type;
    const query = String(req.query.search || req.query.q || '').trim().toLowerCase();
    let liveRows = live.map(c => {
      const assigned = businessFor(c.id);
      return { ...c.raw, id: c.raw.id ?? c.id, businessArea: assigned || c.raw.businessArea || null, assignedBusiness: assigned };
    });
    if (biz && biz !== 'All') liveRows = liveRows.filter(r => r.assignedBusiness === biz);
    if (query) {
      liveRows = liveRows.filter(r => [r.name, r.company_name, r.company_number, r.notes,
        Array.isArray(r.directors) ? r.directors.join(' ') : r.directors]
        .some(v => String(v || '').toLowerCase().includes(query)));
    }

    const combined = [...sloaneAddedClients(req), ...liveRows];
    const pageSize = Math.max(1, Math.min(500, parseInt(req.query.pageSize || req.query.per_page || '500', 10) || 500));
    const page = Math.max(1, parseInt(req.query.page || '1', 10) || 1);
    const totalPages = Math.max(1, Math.ceil(combined.length / pageSize));
    return res.status(200).json({
      status: 'success',
      data: combined.slice((page - 1) * pageSize, page * pageSize),
      meta: { trinovaStatus: clientDirectory.lastError ? 'unreachable' : 'ok', total: combined.length },
      pagination: { page, pageSize, total: combined.length, totalPages, hasMore: page < totalPages }
    });
  });

  /**
   * DELETE /api/v1/clients/:id
   * Removes a client record from the practice database.
   */
  app.delete('/api/v1/clients/:id', authenticate, requireScope('sloane:write'), (req, res) => {
    const clientId = req.params?.id;
    req.auditAction = 'delete_client';
    req.resourceType = 'client';
    req.resourceId = clientId;

    const idx = mockDb.clients.findIndex(c => c.id === clientId || c.clientId === clientId);
    if (idx === -1) {
      // Live TriNova clients are not stored in Sloane, so Sloane cannot remove them.
      return res.status(409).json({
        error: {
          code: 'MANAGED_IN_TRINOVA',
          message: 'This client comes from TriNova, so it can only be removed there.'
        }
      });
    }
    const clientItem = takeOut('clients', idx);
    const { counts, removed } = removeClientAndRelatedData(clientItem.record);
    const entry = putInBin({ kind: 'client', label: clientItem.record.name, where: 'Clients', removed: [clientItem, ...removed] });

    return res.status(200).json({
      status: 'success',
      message: 'The client has been moved to the Bin, with its tasks, notes, documents and history. You can put it back from the Bin within 30 days.',
      data: { removed: counts, binId: entry.id }
    });
  });

  /**
   * GET /api/v1/clients/:id
   * Returns a single client profile with fully expanded company details.
   */
  app.get('/api/v1/clients/:id', authenticate, requireScope('sloane:read'), (req, res) => {
    const clientId = req.params?.id || req.query?.id;
    req.auditAction = 'read_client_detail';
    req.resourceType = 'client';
    req.resourceId = clientId;

    const client = mockDb.clients.find(c => c.id === clientId);

    if (!client) {
      return res.status(404).json({
        error: {
          code: 'CLIENT_NOT_FOUND',
          message: 'We could not find that client. Refresh the Clients page and try again.'
        }
      });
    }

    // Expand associated companies
    const companies = mockDb.companies.filter(comp => client.companyIds.includes(comp.id));

    res.status(200).json({
      status: 'success',
      data: {
        ...client,
        companies
      }
    });
  });

  /**
   * GET /api/v1/companies/:id
   * Returns full statutory, officer, contact, and service details for a company.
   * Differentiates empty (null), unavailable (wrapper), and unsupported fields.
   */
  app.get('/api/v1/companies/:id', authenticate, requireScope('sloane:read'), (req, res) => {
    const companyId = req.params?.id || req.query?.id;
    req.auditAction = 'read_company_detail';
    req.resourceType = 'company';
    req.resourceId = companyId;

    const company = mockDb.companies.find(c => c.id === companyId);

    if (!company) {
      return res.status(404).json({
        error: {
          code: 'COMPANY_NOT_FOUND',
          message: 'We could not find that company. Refresh the Clients page and try again.'
        }
      });
    }

    // Attach primary contact from parent client
    const parentClient = mockDb.clients.find(c => c.id === company.clientId);
    const contacts = parentClient ? parentClient.contacts : [];

    res.status(200).json({
      status: 'success',
      data: {
        id: company.id,
        clientId: company.clientId,
        clientName: parentClient?.name || null,
        companyName: company.companyName,
        companyNumber: company.companyNumber,
        accountingReferenceDate: company.accountingReferenceDate,
        accountsDueDate: company.accountsDueDate,
        confirmationDueDate: company.confirmationDueDate,
        vatRegistered: company.vatRegistered,
        vatNumber: company.vatNumber, // Explicit null if not registered
        secondaryVatNumber: company.secondaryVatNumber, // Demonstrates empty null
        payeRegistered: company.payeRegistered,
        payeReference: company.payeReference,
        cisStatus: company.cisStatus,
        riskLevel: company.riskLevel,
        officers: company.officers, // Structured multi-officer array
        contacts, // Structured contacts array
        services: company.services, // Structured services array
        financials: company.financials, // Demonstrates unavailable indicator
        notes: company.notes
      }
    });
  });


  /**
   * PATCH /api/v1/clients/:id
   * Edits a client that was added by hand inside Sloane.
   * Clients that come from the TriNova portal are managed in TriNova, so they are refused here.
   */
  app.patch('/api/v1/clients/:id', authenticate, requireScope('sloane:write'), (req, res) => {
    const clientId = req.params?.id;
    req.auditAction = 'update_client';
    req.resourceType = 'client';
    req.resourceId = clientId;

    const client = (mockDb.clients || []).find(c => c.id === clientId);
    if (!client) {
      return res.status(404).json({
        error: { code: 'CLIENT_NOT_FOUND', message: 'That client could not be found.' }
      });
    }
    if (!client.addedInSloane) {
      return res.status(409).json({
        error: {
          code: 'MANAGED_IN_TRINOVA',
          message: 'This client comes from TriNova, so it can only be changed there.'
        }
      });
    }

    const b = req.body || {};
    if (b.name !== undefined) {
      if (!String(b.name).trim()) {
        return res.status(400).json({ error: { code: 'BAD_REQUEST', message: 'Client name is required.' } });
      }
      client.name = String(b.name).trim();
    }
    if (b.biz !== undefined) {
      client.businessArea = b.biz;
      client.clientType = b.biz;
    }
    if (b.owner !== undefined) {
      client.assignedManagerName = String(b.owner).trim() || client.assignedManagerName;
    }

    const company = (mockDb.companies || []).find(comp => (client.companyIds || []).includes(comp.id));
    if (company) {
      if (b.name !== undefined) company.companyName = client.name;
      if (b.no !== undefined) company.companyNumber = String(b.no).trim();
      if (b.year !== undefined) company.accountingReferenceDate = b.year || null;
      if (b.accounts !== undefined) company.accountsDueDate = b.accounts || null;
      if (b.confirm !== undefined) company.confirmationDueDate = b.confirm || null;
      if (b.vat !== undefined) company.vatRegistered = b.vat === 'Yes';
      if (b.vatNo !== undefined) company.vatNumber = b.vatNo || null;
      if (b.paye !== undefined) { company.payeReference = b.paye || null; company.payeRegistered = Boolean(b.paye); }
      if (b.cis !== undefined) company.cisStatus = b.cis;
      if (b.risk !== undefined) company.riskLevel = b.risk;
      if (b.notes !== undefined) company.notes = b.notes;
      if (b.dirs !== undefined) {
        company.officers = String(b.dirs).split(',').map(d => d.trim()).filter(Boolean).map((dName, idx) => ({
          id: `off_${Date.now()}_${idx}`, name: dName, role: 'Director', isActive: true
        }));
      }
    }

    res.status(200).json({ status: 'success', data: toPortalShape(client) });
  });

  /**
   * PUT /api/v1/clients/:id/business
   * Puts a client under one of the owner's businesses (or takes it out). For a TriNova client
   * this is the one thing Sloane can change, because everything else is managed in TriNova.
   */
  app.put('/api/v1/clients/:id/business', authenticate, requireScope('sloane:write'), (req, res) => {
    const clientId = req.params.id;
    req.auditAction = 'client_business_set';
    req.resourceType = 'client';
    req.resourceId = clientId;

    const client = clientDirectory.find(clientId);
    if (!client) return sendError(res, 404, 'CLIENT_NOT_FOUND', 'We could not find that client. Refresh the Clients page and try again.');

    const wanted = req.body && req.body.businessArea;
    let businessArea = null;
    if (wanted !== null && wanted !== undefined && String(wanted).trim() !== '') {
      const biz = (mockDb.businesses || []).find(b => b.name === String(wanted).trim());
      if (!biz) return sendError(res, 422, 'BUSINESS_NOT_FOUND', 'That business does not exist. Add it on the My Businesses page first.');
      businessArea = biz.name;
    }

    if (client.source === 'trinova') {
      const rows = mockDb.clientBusiness;
      const idx = rows.findIndex(r => r.id === String(clientId));
      if (businessArea === null) {
        if (idx !== -1) rows.splice(idx, 1);
      } else if (idx === -1) {
        rows.push({ id: String(clientId), businessArea, updatedAt: new Date().toISOString() });
      } else {
        rows[idx] = { ...rows[idx], businessArea, updatedAt: new Date().toISOString() };
      }
    } else {
      const own = mockDb.clients.find(c => c.id === clientId);
      own.businessArea = businessArea || own.businessArea;
      if (businessArea) own.clientType = businessArea;
    }
    res.status(200).json({ status: 'success', data: { id: String(clientId), businessArea } });
  });

  /**
   * POST /api/v1/clients
   * Creates a new client with a linked company entity in TriNova.
   */
  app.post('/api/v1/clients', authenticate, requireScope('sloane:write'), (req, res) => {
    req.auditAction = 'create_client';
    req.resourceType = 'client';

    const { name, biz, no, year, accounts, confirm, vat, vatNo, paye, cis, dirs, owner, risk, notes } = req.body || {};

    if (!name || typeof name !== 'string' || !name.trim()) {
      return res.status(400).json({
        error: {
          code: 'BAD_REQUEST',
          message: 'Client name is required.'
        }
      });
    }

    const clientId = `cli_${Date.now()}`;
    const companyId = `comp_${Date.now()}`;

    // Split directors string into structured officers array
    const directorNames = (dirs || '').split(',').map(d => d.trim()).filter(Boolean);
    const officers = directorNames.map((dName, idx) => ({
      id: `off_${Date.now()}_${idx}`,
      name: dName,
      role: 'Director',
      isActive: true
    }));

    // Create linked company
    const newCompany = {
      id: companyId,
      clientId,
      companyName: name.trim(),
      companyNumber: (no || '').trim(),
      accountingReferenceDate: year || null,
      accountsDueDate: accounts || null,
      confirmationDueDate: confirm || null,
      vatRegistered: vat === 'Yes',
      vatNumber: vatNo || null,
      payeRegistered: Boolean(paye),
      payeReference: paye || null,
      cisStatus: cis || 'No',
      riskLevel: risk || 'Low',
      officers,
      contacts: [],
      services: [],
      notes: notes || ''
    };

    const newClient = {
      id: clientId,
      name: name.trim(),
      clientType: biz || 'Corporate',
      businessArea: biz || 'Trinova Accounting',
      status: 'Active',
      assignedManagerId: owner ? `usr_${owner.toLowerCase().replace(/[^a-z0-9]/g, '_')}` : 'usr_kirsty_allen',
      assignedManagerName: owner || 'Kirsty Allen',
      companyIds: [companyId],
      contacts: directorNames.length > 0 ? [{
        id: `cnt_${Date.now()}`,
        name: directorNames[0],
        email: null,
        isPrimary: true
      }] : [],
      addedInSloane: true,
      createdAt: new Date().toISOString()
    };

    mockDb.companies.unshift(newCompany);
    mockDb.clients.unshift(newClient);

    res.status(201).json({
      status: 'success',
      data: {
        ...newClient,
        companies: [newCompany]
      }
    });
  });
}

