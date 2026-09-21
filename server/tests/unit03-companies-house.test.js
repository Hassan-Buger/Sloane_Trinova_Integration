/**
 * Automated Test Suite for Unit 03: Server-Side Companies House Integration & Reconciliation
 * Validates compliance with:
 * - context/specs/03-companies-house-backend.md
 * - context/04_backend_integration_context.md §9
 * - context/05_data_security_context.md §4
 * - context/06_testing_deployment_context.md §3 & §6
 */

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createApp } from '../src/app.js';
import { CompaniesHouseService } from '../src/services/companiesHouse.js';
import { StatutoryReconciliationEngine } from '../src/services/reconciliation.js';
import { auditStore } from '../src/middleware/audit.js';

describe('Unit 03: Companies House Service & Statutory Reconciliation Engine', () => {
  const TEST_PORT = 4997;
  let server;
  let baseUrl;
  let mockChService;

  // Mocked CH profiles
  const mockChData = {
    "12345678": {
      company_number: "12345678",
      company_name: "Woofington Park Limited",
      company_status: "active",
      company_status_detail: "active-proposal-to-strike-off",
      accounts: {
        next_accounts: {
          due_on: "2026-08-31",
          overdue: true
        }
      },
      confirmation_statement: {
        next_due: "2026-09-15",
        overdue: true
      }
    },
    "08923412": {
      company_number: "08923412",
      company_name: "R GB Elevations Ltd",
      company_status: "active",
      company_status_detail: null,
      accounts: {
        next_accounts: {
          due_on: "2026-07-31",
          overdue: true
        }
      },
      confirmation_statement: {
        next_due: "2026-11-12",
        overdue: false
      }
    },
    "11223344": {
      company_number: "11223344",
      company_name: "Alpha Delta Creative Ltd",
      company_status: "active",
      company_status_detail: null,
      accounts: {
        next_accounts: {
          due_on: "2026-09-30",
          overdue: false
        }
      },
      confirmation_statement: {
        next_due: "2026-10-15",
        overdue: false
      }
    },
    "88776655": {
      company_number: "88776655",
      company_name: "Old Docklands Logistics Ltd",
      company_status: "dissolved",
      company_status_detail: null,
      accounts: {
        next_accounts: {
          due_on: "2026-09-30",
          overdue: false
        }
      },
      confirmation_statement: {
        next_due: "2026-10-15",
        overdue: false
      }
    }
  };

  // Mock fetch handler
  const mockFetch = async (url, options) => {
    const urlObj = new URL(url);
    const coNo = urlObj.pathname.split('/').pop();

    if (coNo === '99999999') {
      return {
        status: 404,
        json: async () => ({ error: 'Company not found' }),
        text: async () => 'Not found'
      };
    }

    if (coNo === '50000000') {
      return {
        status: 500,
        text: async () => 'Internal Server Error'
      };
    }

    if (mockChData[coNo]) {
      return {
        status: 200,
        json: async () => mockChData[coNo]
      };
    }

    return {
      status: 404,
      json: async () => ({ error: 'Not found' }),
      text: async () => 'Not found'
    };
  };

  const AUTH_HEADER = {
    'Authorization': 'Bearer tn_sec_live_sloane_readwrite_2026',
    'Content-Type': 'application/json'
  };

  before(async () => {
    mockChService = new CompaniesHouseService({
      apiKey: 'test_secret_ch_key_123',
      baseUrl: 'https://api.company-information.service.gov.uk',
      fetchFn: mockFetch,
      cacheTtlMs: 3600000,
      timeoutMs: 1000
    });

    const app = createApp({ chService: mockChService });
    await new Promise(resolve => {
      server = app.listen(TEST_PORT, () => {
        baseUrl = `http://localhost:${TEST_PORT}`;
        resolve();
      });
    });
  });

  after(async () => {
    await new Promise(resolve => server.close(resolve));
  });

  function request(path, options = {}) {
    return new Promise((resolve, reject) => {
      const url = new URL(path, baseUrl);
      const req = http.request(url, options, res => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          let parsed;
          try {
            parsed = JSON.parse(data);
          } catch {
            parsed = data;
          }
          resolve({ status: res.statusCode, headers: res.headers, body: parsed });
        });
      });
      req.on('error', reject);
      if (options.body) {
        req.write(typeof options.body === 'string' ? options.body : JSON.stringify(options.body));
      }
      req.end();
    });
  }

  // --- 1. Service Layer Tests ---

  test('Security: CompaniesHouseService does not expose API key in normalized profile', async () => {
    const profile = await mockChService.fetchCompanyProfile('11223344');
    assert.ok(profile);
    assert.strictEqual(profile.name, 'Alpha Delta Creative Ltd');
    assert.strictEqual(profile.companyNumber, '11223344');
    assert.strictEqual(profile.apiKey, undefined, 'API key must never be present in profile');
    const profileJson = JSON.stringify(profile);
    assert.ok(!profileJson.includes('test_secret_ch_key_123'), 'Secret API key must not appear in stringified profile');
  });

  test('Service: Number formatting pads numeric string with leading zeros', () => {
    assert.strictEqual(mockChService.formatCompanyNumber('12345'), '00012345');
    assert.strictEqual(mockChService.formatCompanyNumber('8923412'), '08923412');
    assert.strictEqual(mockChService.formatCompanyNumber('SC123456'), 'SC123456');
  });

  test('Service: Caches successful profile and returns fromCache flag', async () => {
    mockChService.clearCache();
    const first = await mockChService.fetchCompanyProfile('11223344');
    assert.strictEqual(first.fromCache, false);

    const second = await mockChService.fetchCompanyProfile('11223344');
    assert.strictEqual(second.fromCache, true);
    assert.strictEqual(second.name, 'Alpha Delta Creative Ltd');
  });

  test('Service: Rate limiter throws 429 when max requests threshold is exceeded', () => {
    const limitedService = new CompaniesHouseService({
      apiKey: 'test_key',
      rateLimitMaxRequests: 2,
      rateLimitWindowMs: 60000,
      fetchFn: mockFetch
    });

    limitedService.checkRateLimit();
    limitedService.checkRateLimit();

    assert.throws(() => {
      limitedService.checkRateLimit();
    }, (err) => {
      return err.status === 429 && err.code === 'RATE_LIMIT_EXCEEDED';
    });
  });

  test('Service: Network timeout is handled cleanly with 504 error', async () => {
    const hangingFetch = () => new Promise((_, reject) => {
      const err = new Error('Timeout');
      err.name = 'TimeoutError';
      setTimeout(() => reject(err), 50);
    });

    const timeoutService = new CompaniesHouseService({
      apiKey: 'test_key',
      timeoutMs: 20,
      maxRetries: 0,
      fetchFn: hangingFetch
    });

    await assert.rejects(async () => {
      await timeoutService.fetchCompanyProfile('12345678');
    }, (err) => {
      return err.status === 504 && err.code === 'UPSTREAM_TIMEOUT';
    });
  });

  // --- 2. Reconciliation Engine Business Logic Tests ---

  test('Reconciliation: Dissolved company suppresses filing alerts and returns CLEAR status', () => {
    const trackerRecord = {
      companyNumber: '88776655',
      name: 'Old Docklands Logistics Ltd',
      accountsDueDate: '2026-09-30',
      confirmationDueDate: '2026-10-15',
      status: 'Dissolved'
    };
    const liveCh = {
      companyNumber: '88776655',
      name: 'Old Docklands Logistics Ltd',
      companyStatus: 'dissolved',
      statusDetail: null,
      accountsDue: '2026-09-30',
      accountsOverdue: false,
      confirmDue: '2026-10-15',
      confirmOverdue: false,
      source: 'companies_house_live',
      lastChecked: '2026-09-19T12:00:00.000Z'
    };

    const reconciled = StatutoryReconciliationEngine.reconcileRecord(trackerRecord, liveCh);
    assert.strictEqual(reconciled.isDissolved, true);
    assert.strictEqual(reconciled.urgency, 'CLEAR');
    assert.strictEqual(reconciled.urgencyLabel, 'Dissolved');
    assert.ok(reconciled.urgencyReason.includes('routine filing obligations removed'));
  });

  test('Reconciliation: Active strike-off proposal promotes urgency immediately to RED', () => {
    const trackerRecord = {
      companyNumber: '12345678',
      name: 'Woofington Park Limited',
      accountsDueDate: '2027-01-30', // Far in future
      confirmationDueDate: '2027-02-15'
    };
    const liveCh = {
      companyNumber: '12345678',
      name: 'Woofington Park Limited',
      companyStatus: 'active',
      statusDetail: 'active-proposal-to-strike-off',
      accountsDue: '2027-01-30',
      accountsOverdue: false,
      confirmDue: '2027-02-15',
      confirmOverdue: false,
      source: 'companies_house_live'
    };

    const reconciled = StatutoryReconciliationEngine.reconcileRecord(trackerRecord, liveCh);
    assert.strictEqual(reconciled.urgency, 'RED');
    assert.strictEqual(reconciled.hasStrikeOff, true);
    assert.ok(reconciled.urgencyLabel.includes('Strike-off proposal'));
    assert.ok(reconciled.note.includes('[STRIKE-OFF PROPOSAL ACTIVE]'));
  });

  test('Reconciliation: Accounts overdue flag promotes urgency immediately to RED', () => {
    const trackerRecord = {
      companyNumber: '08923412',
      name: 'R GB Elevations Ltd',
      accountsDueDate: '2026-07-31',
      confirmationDueDate: '2026-11-12'
    };
    const liveCh = {
      companyNumber: '08923412',
      name: 'R GB Elevations Ltd',
      companyStatus: 'active',
      statusDetail: null,
      accountsDue: '2026-07-31',
      accountsOverdue: true,
      confirmDue: '2026-11-12',
      confirmOverdue: false,
      source: 'companies_house_live'
    };

    const reconciled = StatutoryReconciliationEngine.reconcileRecord(trackerRecord, liveCh);
    assert.strictEqual(reconciled.urgency, 'RED');
    assert.strictEqual(reconciled.accountsOverdue, true);
    assert.ok(reconciled.urgencyLabel.includes('Accounts overdue'));
    assert.ok(reconciled.note.includes('[CH: Accounts OVERDUE]'));
  });

  test('Reconciliation: Evaluates deadline urgency windows against anchor date', () => {
    const anchor = new Date('2026-09-19T12:00:00Z');

    // 1. Past date -> PAST DATE · verify (RED)
    const past = StatutoryReconciliationEngine.evaluateDeadlineUrgency('2026-09-10', anchor);
    assert.strictEqual(past.urgency, 'RED');
    assert.strictEqual(past.label, 'PAST DATE · verify');

    // 2. 0 to 14 days away -> RED
    const within14 = StatutoryReconciliationEngine.evaluateDeadlineUrgency('2026-09-25', anchor); // 6 days away
    assert.strictEqual(within14.urgency, 'RED');
    assert.strictEqual(within14.label, 'RED · 6d');

    // 3. 15 to 30 days away -> AMBER
    const within30 = StatutoryReconciliationEngine.evaluateDeadlineUrgency('2026-10-10', anchor); // 21 days away
    assert.strictEqual(within30.urgency, 'AMBER');
    assert.strictEqual(within30.label, 'AMBER · 21d');

    // 4. 31+ days away -> CLEAR
    const beyond30 = StatutoryReconciliationEngine.evaluateDeadlineUrgency('2026-11-30', anchor); // 72 days away
    assert.strictEqual(beyond30.urgency, 'CLEAR');
    assert.strictEqual(beyond30.label, 'CLEAR · 72d');
  });

  test('Reconciliation: Preserves tracker provenance when no live CH profile exists', () => {
    const trackerRecord = {
      companyNumber: '09876543',
      name: 'Apex Pinnacle Logistics Ltd',
      accountsDueDate: '2026-09-30',
      confirmationDueDate: '2026-10-20'
    };

    const reconciled = StatutoryReconciliationEngine.reconcileRecord(trackerRecord, null);
    assert.strictEqual(reconciled.source, 'tracker_derived');
    assert.strictEqual(reconciled.lastChecked, null);
  });

  // --- 3. HTTP Endpoints Tests ---

  test('API: GET /api/v1/statutory requires authentication', async () => {
    const res = await request('/api/v1/statutory');
    assert.strictEqual(res.status, 401);
    assert.strictEqual(res.body.error.code, 'UNAUTHORIZED');
  });

  test('API: GET /api/v1/statutory returns reconciled list with metadata and urgency sorting', async () => {
    const res = await request('/api/v1/statutory', { headers: AUTH_HEADER });
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.status, 'success');
    assert.ok(Array.isArray(res.body.data));
    assert.ok(res.body.data.length > 0);
    assert.ok(res.body.meta.total > 0);
    assert.ok(res.body.meta.redCount !== undefined);
    assert.ok(res.body.meta.amberCount !== undefined);
    assert.ok(res.body.meta.clearCount !== undefined);

    // Verify RED items are sorted first
    const firstItem = res.body.data[0];
    assert.strictEqual(firstItem.urgency, 'RED', 'First item in default sort should be RED');
  });

  test('API: GET /api/v1/statutory supports urgency filter', async () => {
    const res = await request('/api/v1/statutory?urgency=RED', { headers: AUTH_HEADER });
    assert.strictEqual(res.status, 200);
    for (const item of res.body.data) {
      assert.strictEqual(item.urgency, 'RED');
    }
  });

  test('API: POST /api/v1/statutory/sync triggers live CH sync and updates cache', async () => {
    const syncPayload = {
      companyNumbers: ['12345678', '08923412', '11223344'],
      forceRefresh: true
    };

    const res = await request('/api/v1/statutory/sync', {
      method: 'POST',
      headers: AUTH_HEADER,
      body: syncPayload
    });

    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.status, 'success');
    assert.strictEqual(res.body.data.totalRequested, 3);
    assert.strictEqual(res.body.data.syncedCount, 3);
    assert.strictEqual(res.body.data.failedCount, 0);

    // Verify subsequent GET /api/v1/statutory reflects live provenance for synced companies
    const listRes = await request('/api/v1/statutory', { headers: AUTH_HEADER });
    const woofington = listRes.body.data.find(c => c.companyNumber === '12345678');
    assert.ok(woofington);
    assert.strictEqual(woofington.source, 'companies_house_live');
    assert.strictEqual(woofington.hasStrikeOff, true);
    assert.strictEqual(woofington.urgency, 'RED');
  });

  test('API: GET /api/v1/statutory/:companyNumber returns single reconciled company', async () => {
    const res = await request('/api/v1/statutory/12345678', { headers: AUTH_HEADER });
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.status, 'success');
    assert.strictEqual(res.body.data.companyNumber, '12345678');
    assert.strictEqual(res.body.data.name, 'Woofington Park Limited');
    assert.strictEqual(res.body.data.urgency, 'RED');
  });

  test('Audit: Statutory read and sync record audit logs', () => {
    const logs = auditStore.getLogs();
    const readLog = logs.find(l => l.action === 'statutory_list_read');
    const syncLog = logs.find(l => l.action === 'statutory_sync_triggered');

    assert.ok(readLog, 'statutory_list_read audit event must be recorded');
    assert.strictEqual(readLog.resourceType, 'statutory');
    assert.ok(syncLog, 'statutory_sync_triggered audit event must be recorded');
    assert.strictEqual(syncLog.resourceType, 'statutory');
  });
});
