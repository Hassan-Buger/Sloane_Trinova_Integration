/**
 * Automated Test Suite for Unit 02: Client, Company & Entity Read Endpoints
 * Verifies compliance with context/specs/02-client-company-read.md and
 * context/06_testing_deployment_context.md §3 (Read Testing).
 */

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createApp } from '../src/app.js';
import { auditStore } from '../src/middleware/audit.js';
import { TEST_API_KEY } from './fixtures.js';

describe('Unit 02: Client, Company & Entity Read Endpoints', () => {
  let server;
  let baseUrl;
  const TEST_PORT = 4998;
  const AUTH_HEADER = {
    'Authorization': `Bearer ${TEST_API_KEY}`
  };

  before(async () => {
    const app = createApp();
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

  test('Read contract: GET /api/v1/clients requires authentication', async () => {
    const res = await request('/api/v1/clients');
    assert.equal(res.status, 401);
  });

  test('Read contract: GET /api/v1/clients returns paginated client records with metadata', async () => {
    const res = await request('/api/v1/clients?page=1&pageSize=2', { headers: AUTH_HEADER });
    assert.equal(res.status, 200);
    assert.equal(res.body.status, 'success');
    assert.ok(Array.isArray(res.body.data));
    assert.equal(res.body.data.length, 2);
    assert.equal(res.body.pagination.page, 1);
    assert.equal(res.body.pagination.pageSize, 2);
    assert.ok(res.body.pagination.total >= 4);
    assert.equal(res.body.pagination.hasMore, true);
  });

  test('Read contract: Multiple companies per client returned as nested collection', async () => {
    const res = await request('/api/v1/clients/cli_woofington_grp', { headers: AUTH_HEADER });
    assert.equal(res.status, 200);
    assert.equal(res.body.data.id, 'cli_woofington_grp');
    assert.ok(Array.isArray(res.body.data.companies));
    assert.equal(res.body.data.companies.length, 2, 'Woofington Group must have 2 companies');
    assert.ok(res.body.data.companies.some(c => c.companyName === 'Woofington Park Limited'));
    assert.ok(res.body.data.companies.some(c => c.companyName === 'Jenkins Pet Supplies Ltd'));
  });

  test('Read contract: Multiple contacts per client returned with primary flag indicated', async () => {
    const res = await request('/api/v1/clients/cli_woofington_grp', { headers: AUTH_HEADER });
    assert.equal(res.status, 200);
    const contacts = res.body.data.contacts;
    assert.ok(Array.isArray(contacts));
    assert.equal(contacts.length, 2);
    const primary = contacts.find(c => c.isPrimary);
    assert.ok(primary, 'Must have a primary contact');
    assert.equal(primary.name, 'Sarah Jenkins');
  });

  test('Read contract: Search filter matches across company name and CRN', async () => {
    const res = await request('/api/v1/clients?search=08923412', { headers: AUTH_HEADER });
    assert.equal(res.status, 200);
    assert.equal(res.body.data.length, 1);
    assert.equal(res.body.data[0].name, 'R GB Elevations');
  });

  test('Read contract: GET /api/v1/companies/:id returns structured directors and services', async () => {
    const res = await request('/api/v1/companies/comp_woofington_park_01', { headers: AUTH_HEADER });
    assert.equal(res.status, 200);
    const company = res.body.data;
    assert.equal(company.companyName, 'Woofington Park Limited');
    assert.equal(company.companyNumber, '12345678');

    // Structured multi-officer array check
    assert.ok(Array.isArray(company.officers), 'Officers must be structured array');
    assert.equal(company.officers.length, 2);
    assert.equal(company.officers[0].name, 'Sarah Jenkins');
    assert.equal(company.officers[0].role, 'Director');
    assert.equal(company.officers[0].shares, '60%');

    // Structured services array check
    assert.ok(Array.isArray(company.services));
    assert.ok(company.services.some(s => s.name === 'Emergency Strike-Off Defense'));
  });

  test('Three-state data contract: Genuinely empty fields return null', async () => {
    const res = await request('/api/v1/companies/comp_jenkins_pet_02', { headers: AUTH_HEADER });
    assert.equal(res.status, 200);
    const comp = res.body.data;
    assert.equal(comp.vatRegistered, false);
    assert.equal(comp.vatNumber, null, 'Unregistered VAT number must be explicit null, not empty string');
    assert.equal(comp.payeReference, null, 'Unregistered PAYE must be explicit null');
  });

  test('Three-state data contract: Unavailable fields return structured indicator', async () => {
    const res = await request('/api/v1/companies/comp_woofington_park_01', { headers: AUTH_HEADER });
    assert.equal(res.status, 200);
    const comp = res.body.data;
    assert.deepEqual(comp.financials, {
      status: 'unavailable',
      reason: 'permission_denied'
    }, 'Unavailable field must return explicit unavailable indicator wrapper');
  });

  test('Error handling: Non-existent client ID returns 404 with standard code', async () => {
    const res = await request('/api/v1/clients/cli_non_existent_999', { headers: AUTH_HEADER });
    assert.equal(res.status, 404);
    assert.equal(res.body.error.code, 'CLIENT_NOT_FOUND');
  });

  test('Error handling: Non-existent company ID returns 404 with standard code', async () => {
    const res = await request('/api/v1/companies/comp_non_existent_999', { headers: AUTH_HEADER });
    assert.equal(res.status, 404);
    assert.equal(res.body.error.code, 'COMPANY_NOT_FOUND');
  });

  test('Audit logging: Read operations are recorded in audit logs with actor attribution', async () => {
    auditStore.clear();

    await request('/api/v1/clients/cli_rgb_elevations', { headers: AUTH_HEADER });

    const logs = auditStore.getLogs();
    assert.ok(logs.length > 0);
    const latest = logs[0];
    assert.equal(latest.actorId, 'actor_kirsty_allen');
    assert.equal(latest.action, 'read_client_detail');
    assert.equal(latest.resourceType, 'client');
    assert.equal(latest.resourceId, 'cli_rgb_elevations');
    assert.equal(latest.statusCode, 200);
  });
});
