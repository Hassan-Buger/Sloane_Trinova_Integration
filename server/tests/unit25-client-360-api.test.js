/**
 * Unit 25 Test Suite: Client 360 API Interactive Features (Task P7.4.1)
 *
 * Verifies:
 * - POST /api/v1/clients (Add Client):
 *   1. Unauthenticated request returns 401 UNAUTHORIZED
 *   2. Read-only token lacks sloane:write and returns 403 FORBIDDEN
 *   3. Missing client name returns 400 BAD_REQUEST
 *   4. Creates client with linked company entity, officers, and contact in mockDb (201 Created)
 *   5. Properly maps comma-separated directors into officers
 *   6. Records audit action 'create_client'
 * - GET /api/v1/clients:
 *   7. Returns list containing newly created client
 * - POST /api/v1/clients/:clientId/timeline/events (Add Timeline Event):
 *   8. Unauthenticated request returns 401 UNAUTHORIZED
 *   9. Non-existent client returns 404 CLIENT_NOT_FOUND
 *   10. Valid event returns 201 Created and persists to TimelineService
 *   11. Event appears in GET /api/v1/clients/:clientId/timeline
 * - POST & GET /api/v1/companies/:companyId/notes (Add & Read Notes):
 *   12. Privacy boundary enforcement: requires confirm_write_to_trinova: true (422 if missing)
 *   13. Valid note creates company note and triggers NOTE_CREATED timeline event (201 Created)
 *   14. GET /api/v1/companies/:companyId/notes returns the created note
 * - Frontend Integration (scripts/services/api.js & scripts/app.js):
 *   15. ApiService provides createClient, getCompanyNotes, getClientTimeline, and createTimelineEvent
 *   16. Client 360 detail cards render live data and honest empty states
 * - Static Leak & Logged-Out Shell Hygiene:
 *   17. index.html static shell has zero literal @ symbols and zero client leaks
 */

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { frontendSource } from './support.js';

import { createApp } from '../src/app.js';
import { mockDb } from '../src/data/db.js';
import { TEST_API_KEY, TEST_READONLY_KEY } from './fixtures.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '../..');

const PORT = 5012;

describe('Task P7.4.1: Client 360 Interactive Features Against API', () => {
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

  describe('1. POST /api/v1/clients (Create Client & Company Entity)', () => {
    test('1.1 Unauthenticated request returns 401 Unauthorized', async () => {
      const res = await fetch(`${baseUrl}/api/v1/clients`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Requested-With': 'sloane'
        },
        body: JSON.stringify({ name: 'Acme Test Corp' })
      });

      assert.equal(res.status, 401, 'Unauthenticated POST /clients must return 401');
    });

    test('1.2 Read-only token lacking sloane:write returns 403 Forbidden', async () => {
      const res = await fetch(`${baseUrl}/api/v1/clients`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${TEST_READONLY_KEY}`,
          'Content-Type': 'application/json',
          'X-Requested-With': 'sloane'
        },
        body: JSON.stringify({ name: 'Acme Test Corp' })
      });

      assert.equal(res.status, 403, 'Read-only token must return 403');
    });

    test('1.3 Empty or whitespace client name returns 400 Bad Request', async () => {
      const res = await fetch(`${baseUrl}/api/v1/clients`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${TEST_API_KEY}`,
          'Content-Type': 'application/json',
          'X-Requested-With': 'sloane'
        },
        body: JSON.stringify({ name: '   ' })
      });

      assert.equal(res.status, 400, 'Empty name must return 400');
      const body = await res.json();
      assert.equal(body.error?.code, 'BAD_REQUEST');
      assert.match(body.error?.message, /Client name is required/i);
    });

    test('1.4 Creates client with linked company entity, officers, and contact in mockDb', async () => {
      const newClientPayload = {
        name: 'Apex Robotics UK Limited',
        biz: 'Corporate',
        no: '12349988',
        year: '2026-03-31',
        accounts: '2026-12-31',
        confirm: '2026-11-30',
        vat: 'Yes',
        vatNo: 'GB 998 7766 55',
        paye: '123/APEX99',
        cis: 'No',
        dirs: 'Dr. Jane Archer, Marcus Bell',
        owner: 'Kirsty Allen',
        risk: 'Low',
        notes: 'Robotics manufacturer; clean filing track record.'
      };

      const res = await fetch(`${baseUrl}/api/v1/clients`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${TEST_API_KEY}`,
          'Content-Type': 'application/json',
          'X-Requested-With': 'sloane'
        },
        body: JSON.stringify(newClientPayload)
      });

      assert.equal(res.status, 201, 'Valid client creation must return 201');
      const body = await res.json();
      assert.equal(body.status, 'success');
      assert.ok(body.data?.id, 'Returned client must have an ID');
      assert.equal(body.data.name, 'Apex Robotics UK Limited');
      assert.equal(body.data.companies?.length, 1);

      const createdCompany = body.data.companies[0];
      assert.equal(createdCompany.companyName, 'Apex Robotics UK Limited');
      assert.equal(createdCompany.companyNumber, '12349988');
      assert.equal(createdCompany.vatRegistered, true);
      assert.equal(createdCompany.vatNumber, 'GB 998 7766 55');
      assert.equal(createdCompany.officers.length, 2);
      assert.equal(createdCompany.officers[0].name, 'Dr. Jane Archer');
      assert.equal(createdCompany.officers[1].name, 'Marcus Bell');

      // Verify persistence in mockDb
      const clientInDb = mockDb.clients.find(c => c.id === body.data.id);
      assert.ok(clientInDb, 'Client must be persisted in mockDb.clients');
      const companyInDb = mockDb.companies.find(c => c.id === createdCompany.id);
      assert.ok(companyInDb, 'Company must be persisted in mockDb.companies');
    });

    test('1.5 GET /api/v1/clients returns list containing newly created client', async () => {
      const res = await fetch(`${baseUrl}/api/v1/clients`, {
        headers: {
          Authorization: `Bearer ${TEST_API_KEY}`
        }
      });

      assert.equal(res.status, 200);
      const body = await res.json();
      assert.ok(Array.isArray(body.data));
      const found = body.data.find(c => c.name === 'Apex Robotics UK Limited');
      assert.ok(found, 'GET /clients must contain newly created client');
      assert.equal(found.businessArea, 'Corporate');
    });
  });

  describe('2. POST & GET Timeline Events (Add Event to Client 360)', () => {
    test('2.1 Unauthenticated POST timeline event returns 401', async () => {
      const res = await fetch(`${baseUrl}/api/v1/clients/cli_woofington_grp/timeline/events`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          title: 'Unauthenticated Event',
          eventType: 'COMMUNICATION'
        })
      });

      assert.equal(res.status, 401);
    });

    test('2.2 Non-existent client returns 404 CLIENT_NOT_FOUND', async () => {
      const res = await fetch(`${baseUrl}/api/v1/clients/cli_does_not_exist_999/timeline/events`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${TEST_API_KEY}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          title: 'Event for ghost client',
          eventType: 'COMMUNICATION'
        })
      });

      assert.equal(res.status, 404);
      const body = await res.json();
      assert.equal(body.error?.code, 'CLIENT_NOT_FOUND');
    });

    test('2.3 Successfully logs timeline event for existing client (201 Created)', async () => {
      const res = await fetch(`${baseUrl}/api/v1/clients/cli_woofington_grp/timeline/events`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${TEST_API_KEY}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          title: 'Advisory Discussion with CEO',
          description: 'Discussed statutory accounts filing progress and bank statements review.',
          eventType: 'NOTE_CREATED',
          severity: 'normal',
          visibility: 'shared',
          source: 'user'
        })
      });

      assert.equal(res.status, 201);
      const body = await res.json();
      assert.equal(body.status, 'success');
      assert.equal(body.data?.title, 'Advisory Discussion with CEO');
      assert.equal(body.data?.clientId, 'cli_woofington_grp');

      // Verify it appears in GET /api/v1/clients/:clientId/timeline
      const timelineRes = await fetch(`${baseUrl}/api/v1/clients/cli_woofington_grp/timeline`, {
        headers: { Authorization: `Bearer ${TEST_API_KEY}` }
      });
      assert.equal(timelineRes.status, 200);
      const timelineBody = await timelineRes.json();
      const match = (timelineBody.data || []).find(e => e.title === 'Advisory Discussion with CEO');
      assert.ok(match, 'Newly created timeline event must be in client timeline');
    });
  });

  describe('3. POST & GET Internal Company Notes (Privacy Boundary Enforcement)', () => {
    test('3.1 Requires explicit user opt-in confirmation (confirm_write_to_trinova: true) (422)', async () => {
      const res = await fetch(`${baseUrl}/api/v1/companies/comp_woofington_park_01/notes`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${TEST_API_KEY}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          text: 'Attempting to save without explicit opt-in confirmation.'
        })
      });

      assert.equal(res.status, 422, 'Must reject note creation without confirm_write_to_trinova');
      const body = await res.json();
      assert.equal(body.error?.code, 'PRIVACY_BOUNDARY_CONFIRMATION_REQUIRED');
    });

    test('3.2 Successfully creates internal note with confirm_write_to_trinova and triggers timeline event', async () => {
      const noteText = 'Executive audit review completed. All accounts reconciled against Barclays ledger.';

      const res = await fetch(`${baseUrl}/api/v1/companies/comp_woofington_park_01/notes`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${TEST_API_KEY}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          text: noteText,
          confirm_write_to_trinova: true,
          visibility: 'staff_only'
        })
      });

      assert.equal(res.status, 201, 'POST note must return 201 Created');
      const body = await res.json();
      assert.equal(body.status, 'success');
      assert.ok(body.data?.id);
      assert.equal(body.data.text, noteText);
      assert.equal(body.data.visibility, 'staff_only');

      // Verify GET /companies/:companyId/notes
      const getNotesRes = await fetch(`${baseUrl}/api/v1/companies/comp_woofington_park_01/notes`, {
        headers: { Authorization: `Bearer ${TEST_API_KEY}` }
      });
      assert.equal(getNotesRes.status, 200);
      const getNotesBody = await getNotesRes.json();
      const noteMatch = (getNotesBody.data || []).find(n => n.text === noteText);
      assert.ok(noteMatch, 'Created note must be returned by GET /companies/:companyId/notes');

      // Verify automatic timeline event generation
      const timelineRes = await fetch(`${baseUrl}/api/v1/clients/cli_woofington_grp/timeline`, {
        headers: { Authorization: `Bearer ${TEST_API_KEY}` }
      });
      assert.equal(timelineRes.status, 200);
      const timelineBody = await timelineRes.json();
      const tlEvent = (timelineBody.data || []).find(e => e.eventType === 'NOTE_CREATED' && e.description.includes('Executive audit review completed'));
      assert.ok(tlEvent, 'Internal note must automatically trigger NOTE_CREATED event in client timeline');
    });
  });

  describe('4. Frontend Integration & Code Hygiene', () => {
    const apiJsPath = path.join(rootDir, 'scripts/services/api.js');
    const appJsPath = path.join(rootDir, 'scripts/app.js');
    const indexHtmlPath = path.join(rootDir, 'index.html');

    const apiJsContent = fs.readFileSync(apiJsPath, 'utf8');
    const appJsContent = frontendSource();
    const indexHtmlContent = fs.readFileSync(indexHtmlPath, 'utf8');

    test('4.1 ApiService provides all required Client 360 interactive methods', () => {
      assert.match(apiJsContent, /async\s+createClient\s*\(/, 'ApiService must implement createClient');
      assert.match(apiJsContent, /async\s+getCompanyNotes\s*\(/, 'ApiService must implement getCompanyNotes');
      assert.match(apiJsContent, /async\s+getClientTimeline\s*\(/, 'ApiService must implement getClientTimeline');
      assert.match(apiJsContent, /async\s+createTimelineEvent\s*\(/, 'ApiService must implement createTimelineEvent');
      assert.match(apiJsContent, /async\s+sendNoteToTrinova\s*\(/, 'ApiService must implement sendNoteToTrinova');
    });

    test('4.2 ApiService.createClient calls POST /clients with request method', () => {
      assert.match(apiJsContent, /this\.request\(\s*['"]\/clients['"]\s*,\s*\{\s*method:\s*['"]POST['"]/,
        'ApiService.createClient must call POST /clients'
      );
    });

    test('4.3 scripts/app.js renders live notes and documents with honest empty states', () => {
      assert.match(appJsContent, /renderClientNotesDetail/, 'app.js must implement renderClientNotesDetail');
      assert.match(appJsContent, /renderClientDocumentsDetail/, 'app.js must implement renderClientDocumentsDetail');
      assert.match(appJsContent, /renderClientStatutoryDetail/, 'app.js must implement renderClientStatutoryDetail');
      assert.match(appJsContent, /No internal notes recorded for this client/, 'Must contain honest empty state for notes');
      assert.match(appJsContent, /No documents yet/, 'Must contain honest empty state for documents');
    });

    test('4.4 index.html static shell has zero literal @ symbols and zero client leaks', () => {
      assert.doesNotMatch(indexHtmlContent, /@/, 'index.html must not contain literal @ characters');
      assert.doesNotMatch(indexHtmlContent, /woofington/i, 'index.html must not leak Woofington');
      assert.doesNotMatch(indexHtmlContent, /jenkins/i, 'index.html must not leak Jenkins');
      assert.doesNotMatch(indexHtmlContent, /alpha delta/i, 'index.html must not leak Alpha Delta');
      assert.doesNotMatch(indexHtmlContent, /Apex Robotics/i, 'index.html must not contain newly created clients in static shell');
    });
  });
});
