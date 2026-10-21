/**
 * Client and Company Read Routes
 * Implements context/specs/02-client-company-read.md and
 * context/04_backend_integration_context.md §4.
 */

import { mockDb } from '../data/db.js';

export function registerClientRoutes(app, { authenticate, requireScope }) {
  /**
   * GET /api/v1/clients
   * Returns paginated client records with linked company summaries.
   */
  app.get('/api/v1/clients', authenticate, requireScope('sloane:read'), (req, res) => {
    req.auditAction = 'read_clients_list';
    req.resourceType = 'client';

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

    res.status(200).json({
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
          message: `Client with ID '${clientId}' does not exist.`
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
          message: `Company with ID '${companyId}' does not exist.`
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
      accountingReferenceDate: year || '2026-03-31',
      accountsDueDate: accounts || '2026-12-31',
      confirmationDueDate: confirm || '2026-11-30',
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
        email: `${directorNames[0].toLowerCase().replace(/\s+/g, '.')}@example.com`,
        isPrimary: true
      }] : [],
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

