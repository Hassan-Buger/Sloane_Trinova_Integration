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
}
