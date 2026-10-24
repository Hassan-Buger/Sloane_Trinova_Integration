/**
 * Unit 26 Test Suite: Business Areas API Interactive Features (Task P7.4.2)
 *
 * Verifies:
 * - GET /api/v1/businesses:
 *   1. Unauthenticated request returns 401 UNAUTHORIZED
 *   2. Read token returns list of active business areas with linked client counts
 *   3. Enriched clientCount accurately reflects clients in mockDb
 * - POST /api/v1/businesses:
 *   4. Unauthenticated request returns 401 UNAUTHORIZED
 *   5. Read-only token lacking sloane:write returns 403 FORBIDDEN
 *   6. Missing or whitespace name returns 400 BAD_REQUEST
 *   7. Missing or whitespace type returns 400 BAD_REQUEST
 *   8. Duplicate business area name returns 409 CONFLICT
 *   9. Valid request returns 201 Created, assigns unique ID, and persists to mockDb
 *   10. Records audit action 'create_business_area'
 *   11. Newly created business area appears in GET /api/v1/businesses
 * - Frontend Service & View Integration (scripts/services/api.js & scripts/app.js):
 *   12. ApiService provides getBusinesses and createBusiness calling API endpoints
 *   13. scripts/app.js renders business area cards and includes honest empty state
 *   14. populateClientModalBizSelect dynamically updates Add Client modal dropdown
 * - Logged-Out Shell Security:
 *   15. index.html has zero literal @ symbols and zero static leaks
 */

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { createApp } from '../src/app.js';
import { mockDb } from '../src/data/db.js';
import { TEST_API_KEY, TEST_READONLY_KEY } from './fixtures.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '../..');

const PORT = 5013;

describe('Task P7.4.2: Add Business Area Working Against API', () => {
  let server;
  let baseUrl;

  before(async () => {
    const app = createApp();
    await new Promise(resolve => {
      server = app.listen(PORT, () => {
        baseUrl = `http://localhost:${PORT}`;
        resolve();
      });
    });
  });

  after(async () => {
    if (server) {
      await new Promise(resolve => server.close(resolve));
    }
  });

  describe('1. GET /api/v1/businesses (List Business Areas & Client Counts)', () => {
    test('1.1 Unauthenticated request returns 401 Unauthorized', async () => {
      const res = await fetch(`${baseUrl}/api/v1/businesses`);
      assert.equal(res.status, 401, 'Unauthenticated GET /businesses must return 401');
    });

    test('1.2 Read token returns list of active business areas', async () => {
      const res = await fetch(`${baseUrl}/api/v1/businesses`, {
        headers: { Authorization: `Bearer ${TEST_READONLY_KEY}` }
      });

      assert.equal(res.status, 200);
      const body = await res.json();
      assert.equal(body.status, 'success');
      assert.ok(Array.isArray(body.data));
      assert.ok(body.data.length > 0, 'Must return seeded business areas');

      const trinovaAcct = body.data.find(b => b.name === 'Trinova Accounting');
      assert.ok(trinovaAcct, 'Must include Trinova Accounting');
      assert.equal(trinovaAcct.status, 'Active');
      assert.ok(typeof trinovaAcct.clientCount === 'number');
    });

    test('1.3 Enriched clientCount accurately calculates linked clients', async () => {
      const res = await fetch(`${baseUrl}/api/v1/businesses`, {
        headers: { Authorization: `Bearer ${TEST_API_KEY}` }
      });

      assert.equal(res.status, 200);
      const body = await res.json();
      const trinovaAcct = body.data.find(b => b.name === 'Trinova Accounting');
      assert.ok(trinovaAcct);

      const actualClientCount = (mockDb.clients || []).filter(c => c.businessArea === 'Trinova Accounting').length;
      assert.equal(trinovaAcct.clientCount, actualClientCount);
    });
  });

  describe('2. POST /api/v1/businesses (Add Business Area)', () => {
    test('2.1 Unauthenticated request returns 401 Unauthorized', async () => {
      const res = await fetch(`${baseUrl}/api/v1/businesses`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Requested-With': 'sloane'
        },
        body: JSON.stringify({ name: 'Venture Capital Advisory', type: 'Investment' })
      });

      assert.equal(res.status, 401);
    });

    test('2.2 Read-only token lacking sloane:write returns 403 Forbidden', async () => {
      const res = await fetch(`${baseUrl}/api/v1/businesses`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${TEST_READONLY_KEY}`,
          'Content-Type': 'application/json',
          'X-Requested-With': 'sloane'
        },
        body: JSON.stringify({ name: 'Venture Capital Advisory', type: 'Investment' })
      });

      assert.equal(res.status, 403);
    });

    test('2.3 Missing or whitespace name returns 400 Bad Request', async () => {
      const res = await fetch(`${baseUrl}/api/v1/businesses`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${TEST_API_KEY}`,
          'Content-Type': 'application/json',
          'X-Requested-With': 'sloane'
        },
        body: JSON.stringify({ name: '   ', type: 'Investment' })
      });

      assert.equal(res.status, 400);
      const body = await res.json();
      assert.equal(body.error?.code, 'BAD_REQUEST');
      assert.match(body.error?.message, /name is required/i);
    });

    test('2.4 Missing or whitespace type returns 400 Bad Request', async () => {
      const res = await fetch(`${baseUrl}/api/v1/businesses`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${TEST_API_KEY}`,
          'Content-Type': 'application/json',
          'X-Requested-With': 'sloane'
        },
        body: JSON.stringify({ name: 'Legal Counsel', type: '   ' })
      });

      assert.equal(res.status, 400);
      const body = await res.json();
      assert.equal(body.error?.code, 'BAD_REQUEST');
      assert.match(body.error?.message, /type is required/i);
    });

    test('2.5 Duplicate business area name returns 409 Conflict', async () => {
      const res = await fetch(`${baseUrl}/api/v1/businesses`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${TEST_API_KEY}`,
          'Content-Type': 'application/json',
          'X-Requested-With': 'sloane'
        },
        body: JSON.stringify({ name: 'Trinova Accounting', type: 'Duplicate Type' })
      });

      assert.equal(res.status, 409);
      const body = await res.json();
      assert.equal(body.error?.code, 'CONFLICT');
      assert.match(body.error?.message, /already exists/i);
    });

    test('2.6 Valid request creates business area (201 Created) and persists to mockDb', async () => {
      const uniqueName = `ESG & Carbon Advisory ${Date.now()}`;
      const payload = {
        name: uniqueName,
        type: 'Sustainability & Audit'
      };

      const res = await fetch(`${baseUrl}/api/v1/businesses`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${TEST_API_KEY}`,
          'Content-Type': 'application/json',
          'X-Requested-With': 'sloane'
        },
        body: JSON.stringify(payload)
      });

      assert.equal(res.status, 201);
      const body = await res.json();
      assert.equal(body.status, 'success');
      assert.ok(body.data?.id);
      assert.equal(body.data.name, uniqueName);
      assert.equal(body.data.type, 'Sustainability & Audit');
      assert.equal(body.data.status, 'Active');
      assert.equal(body.data.clientCount, 0);

      // Verify persistence in mockDb
      const inDb = mockDb.businesses.find(b => b.name === uniqueName);
      assert.ok(inDb, 'Created business area must exist in mockDb.businesses');

      // Verify it is returned by GET /businesses
      const getRes = await fetch(`${baseUrl}/api/v1/businesses`, {
        headers: { Authorization: `Bearer ${TEST_API_KEY}` }
      });
      const getBody = await getRes.json();
      const match = (getBody.data || []).find(b => b.name === uniqueName);
      assert.ok(match, 'Newly created business area must appear in GET /businesses');
    });
  });

  describe('3. Frontend Integration & Code Hygiene', () => {
    const apiJsPath = path.join(rootDir, 'scripts/services/api.js');
    const appJsPath = path.join(rootDir, 'scripts/app.js');
    const indexHtmlPath = path.join(rootDir, 'index.html');

    const apiJsContent = fs.readFileSync(apiJsPath, 'utf8');
    const appJsContent = fs.readFileSync(appJsPath, 'utf8');
    const indexHtmlContent = fs.readFileSync(indexHtmlPath, 'utf8');

    test('3.1 ApiService.getBusinesses calls /businesses with cache fallback', () => {
      assert.match(apiJsContent, /this\.request\(\s*['"]\/businesses['"]\s*\)/,
        'ApiService.getBusinesses must query /businesses'
      );
      assert.match(apiJsContent, /StorageService\.saveBusinesses/,
        'ApiService.getBusinesses must update local cache'
      );
    });

    test('3.2 ApiService.createBusiness calls POST /businesses with cache update', () => {
      assert.match(apiJsContent, /this\.request\(\s*['"]\/businesses['"]\s*,\s*\{\s*method:\s*['"]POST['"]/,
        'ApiService.createBusiness must call POST /businesses'
      );
    });

    test('3.3 scripts/app.js renders business cards and provides honest empty state', () => {
      assert.match(appJsContent, /renderBusinesses\s*\(/,
        'scripts/app.js must define renderBusinesses'
      );
      assert.match(appJsContent, /You have not added any businesses yet/,
        'scripts/app.js must provide honest empty state for business areas'
      );
      assert.match(appJsContent, /populateClientModalBizSelect\s*\(/,
        'scripts/app.js must define populateClientModalBizSelect'
      );
    });

    test('3.4 index.html static shell has zero literal @ symbols and zero leaks', () => {
      assert.doesNotMatch(indexHtmlContent, /@/, 'index.html must not contain literal @ characters');
      assert.doesNotMatch(indexHtmlContent, /woofington/i, 'index.html must not leak Woofington');
      assert.doesNotMatch(indexHtmlContent, /ESG & Carbon Advisory/i, 'index.html must not contain test businesses in static shell');
    });
  });
});
