/**
 * Statutory Reconciliation & Companies House API Routes
 * Exposes /api/v1/statutory endpoints adhering to:
 * - context/04_backend_integration_context.md §9
 * - context/specs/03-companies-house-backend.md
 */

import { mockDb } from '../data/db.js';
import { companiesHouseService } from '../services/companiesHouse.js';
import { StatutoryReconciliationEngine } from '../services/reconciliation.js';

export function registerStatutoryRoutes(app, { authenticate, requireScope }, customChService = null) {
  const chService = customChService || companiesHouseService;

  /**
   * GET /api/v1/statutory
   * Retrieves unified statutory list with live CH overrides, calculated urgency, and provenance.
   */
  app.get('/api/v1/statutory', authenticate, requireScope('sloane:read'), (req, res) => {
    req.auditAction = 'statutory_list_read';
    req.resourceType = 'statutory';

    // Combine statutoryTracker with companies from DB
    const trackerMap = new Map();

    // 1. Add records from statutoryTracker
    for (const item of (mockDb.statutoryTracker || [])) {
      trackerMap.set(item.companyNumber, { ...item });
    }

    // 2. Add or enrich from companies table
    for (const comp of (mockDb.companies || [])) {
      if (comp.companyNumber) {
        if (!trackerMap.has(comp.companyNumber)) {
          trackerMap.set(comp.companyNumber, {
            companyNumber: comp.companyNumber,
            name: comp.companyName,
            accountsDueDate: comp.accountsDueDate,
            confirmationDueDate: comp.confirmationDueDate,
            status: comp.status || 'Active',
            notes: comp.notes || ''
          });
        }
      }
    }

    // Reconcile each company record against live CH cache if available
    const reconciledList = [];
    for (const [coNo, trackerRec] of trackerMap.entries()) {
      const liveCh = chService.getCachedProfile(coNo);
      const reconciled = StatutoryReconciliationEngine.reconcileRecord(trackerRec, liveCh);
      reconciledList.push(reconciled);
    }

    // Apply filtering
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
               (item.companyNumber && item.companyNumber.includes(q)) ||
               (item.note && item.note.toLowerCase().includes(q));
      });
    }

    // Sort order: RED first, then AMBER, then CLEAR, then by daysRemaining
    const urgencyOrder = { 'RED': 1, 'AMBER': 2, 'CLEAR': 3 };
    filtered.sort((a, b) => {
      const diff = (urgencyOrder[a.urgency] || 99) - (urgencyOrder[b.urgency] || 99);
      if (diff !== 0) return diff;
      if (a.daysRemaining === null) return 1;
      if (b.daysRemaining === null) return -1;
      return a.daysRemaining - b.daysRemaining;
    });

    // Compute summary metrics
    const redCount = reconciledList.filter(i => i.urgency === 'RED').length;
    const amberCount = reconciledList.filter(i => i.urgency === 'AMBER').length;
    const clearCount = reconciledList.filter(i => i.urgency === 'CLEAR').length;
    const liveVerifiedCount = reconciledList.filter(i => i.source === 'companies_house_live').length;
    const trackerDerivedCount = reconciledList.filter(i => i.source === 'tracker_derived').length;

    res.status(200).json({
      status: 'success',
      data: filtered,
      meta: {
        total: filtered.length,
        unfilteredTotal: reconciledList.length,
        redCount,
        amberCount,
        clearCount,
        liveVerifiedCount,
        trackerDerivedCount,
        asOf: new Date().toISOString()
      }
    });
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

    // Find in tracker or companies
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

    // Check live cache or attempt fetch if requested
    let liveCh = chService.getCachedProfile(coNo);

    if (!trackerRec && !liveCh) {
      // If not in database, attempt live fetch from CH directly
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

    res.status(200).json({
      status: 'success',
      data: reconciled
    });
  });

  /**
   * POST /api/v1/statutory/sync
   * Triggers server-side synchronization against Companies House for specified or all companies.
   */
  app.post('/api/v1/statutory/sync', authenticate, requireScope('sloane:read'), async (req, res) => {
    req.auditAction = 'statutory_sync_triggered';
    req.resourceType = 'statutory';

    let targets = [];
    if (Array.isArray(req.body?.companyNumbers) && req.body.companyNumbers.length > 0) {
      targets = req.body.companyNumbers;
    } else {
      // Default to all known companies in tracker
      const coNos = new Set();
      for (const item of (mockDb.statutoryTracker || [])) {
        if (item.companyNumber) coNos.add(item.companyNumber);
      }
      for (const comp of (mockDb.companies || [])) {
        if (comp.companyNumber) coNos.add(comp.companyNumber);
      }
      targets = Array.from(coNos);
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
}
