/**
 * Unit 27 Test Suite: CEO Brain Notes & Strict Privacy Boundary (Task P7.4.3)
 *
 * Verifies:
 * - CEO Brain Local Isolation & Storage Boundary:
 *   1. CEO Brain entries are tagged with isPrivate: true and stored locally
 *   2. Empty note submissions are rejected with a warning
 * - AI Privacy Boundary:
 *   3. ContextBuilder strictly enforces PRIVATE_CEO_BRAIN = DENY across all query intents
 *   4. Client context compilation never leaks private CEO Brain notes
 * - Opt-in "Send to Trinova" Export Workflow:
 *   5. API rejects note creation without confirm_write_to_trinova: true with 422
 *   6. Modal requires explicit confirmation checkbox before dispatching to API
 *   7. Valid export creates internal note and generates NOTE_CREATED timeline event (201 Created)
 * - DOM Sanitization & View Hygiene:
 *   8. renderBrain provides honest empty state when no notes exist
 *   9. renderBrain and openTrinovaNoteModal apply escapeHtml to prevent XSS
 * - Static Shell Leak Hygiene:
 *   10. index.html static shell has zero literal @ symbols and zero CEO Brain note leaks
 */

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { frontendSource } from './support.js';

import { createApp } from '../src/app.js';
import { ContextBuilder } from '../src/services/ai/contextBuilder.js';
import { mockDb } from '../src/data/db.js';
import { TEST_API_KEY } from './fixtures.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '../..');

const PORT = 5014;

describe('Task P7.4.3: CEO Brain Notes & Strict Privacy Boundary', () => {
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

  describe('1. AI Context Privacy Boundary (PRIVATE_CEO_BRAIN = DENY)', () => {
    test('1.1 ContextBuilder unconditionally asserts privateCeoBrainDenied: true for client queries', () => {
      const { allowedContext, privacyAudit } = ContextBuilder.buildContext({
        clientId: 'cli_woofington_grp',
        query: 'What is the filing status of Woofington Park?',
        actor: { actorId: 'actor_kirsty_allen', actorName: 'Kirsty Allen' }
      });

      assert.equal(privacyAudit.privateCeoBrainDenied, true, 'CRITICAL: PRIVATE_CEO_BRAIN must be strictly DENIED');
      assert.equal(allowedContext.ceoBrain, undefined, 'allowedContext must not contain ceoBrain entries');
      assert.equal(allowedContext.privateNotes, undefined, 'allowedContext must not contain private notes');
    });

    test('1.2 ContextBuilder unconditionally asserts privateCeoBrainDenied: true for executive briefings', () => {
      const { allowedContext, privacyAudit } = ContextBuilder.buildContext({
        query: 'Give me a practice overview and high-risk entities',
        actor: { actorId: 'actor_kirsty_allen', actorName: 'Kirsty Allen' }
      });

      assert.equal(privacyAudit.privateCeoBrainDenied, true, 'CRITICAL: PRIVATE_CEO_BRAIN must be strictly DENIED');
      assert.equal(allowedContext.ceoBrain, undefined);
    });

    test('1.3 ContextBuilder strips private timeline events and notes from context', () => {
      const { allowedContext } = ContextBuilder.buildContext({
        clientId: 'cli_woofington_grp',
        query: 'Timeline review',
        actor: { actorId: 'actor_kirsty_allen', actorName: 'Kirsty Allen' }
      });

      if (allowedContext.timeline) {
        const hasPrivateEvents = allowedContext.timeline.some(e => e.visibility === 'private');
        assert.equal(hasPrivateEvents, false, 'Context must never include events with visibility === private');
      }
    });
  });

  describe('2. Opt-in "Send to Trinova" Export Privacy Boundary', () => {
    test('2.1 POST /api/v1/companies/:companyId/notes rejects export without confirm_write_to_trinova (422)', async () => {
      const res = await fetch(`${baseUrl}/api/v1/companies/comp_woofington_park_01/notes`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${TEST_API_KEY}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          text: 'Private CEO thought about restructuring fees.'
        })
      });

      assert.equal(res.status, 422, 'Must reject note creation without explicit opt-in confirmation');
      const body = await res.json();
      assert.equal(body.error?.code, 'PRIVACY_BOUNDARY_CONFIRMATION_REQUIRED');
      assert.match(body.error?.message, /confirm_write_to_trinova/i);
    });

    test('2.2 POST /api/v1/companies/:companyId/notes creates note and timeline event when confirmed (201)', async () => {
      const noteContent = `Confirmed corporate tax discussion note ${Date.now()}`;
      const res = await fetch(`${baseUrl}/api/v1/companies/comp_woofington_park_01/notes`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${TEST_API_KEY}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          text: noteContent,
          confirm_write_to_trinova: true,
          visibility: 'staff_only'
        })
      });

      assert.equal(res.status, 201);
      const body = await res.json();
      assert.equal(body.status, 'success');
      assert.equal(body.data?.text, noteContent);
      assert.equal(body.data?.visibility, 'staff_only');
      assert.equal(body.data?.explicitConfirmation, true);

      // Verify persistent in mockDb.notes
      const inNotes = (mockDb.notes || []).find(n => n.id === body.data?.id);
      assert.ok(inNotes, 'Note must exist in mockDb.notes');

      // Verify automatic timeline event generation
      const timelineRes = await fetch(`${baseUrl}/api/v1/clients/cli_woofington_grp/timeline`, {
        headers: { Authorization: `Bearer ${TEST_API_KEY}` }
      });
      const timelineBody = await timelineRes.json();
      const match = (timelineBody.data || []).find(e => e.eventType === 'NOTE_CREATED' && e.description.includes(noteContent));
      assert.ok(match, 'Opt-in note must generate NOTE_CREATED timeline event');
    });
  });

  describe('3. Frontend Implementation & UI Sanitization', () => {
    const appJsPath = path.join(rootDir, 'scripts/app.js');
    const apiJsPath = path.join(rootDir, 'scripts/services/api.js');
    const indexHtmlPath = path.join(rootDir, 'index.html');

    const appJsContent = frontendSource();
    const apiJsContent = fs.readFileSync(apiJsPath, 'utf8');
    const indexHtmlContent = fs.readFileSync(indexHtmlPath, 'utf8');

    test('3.1 handleSaveBrain validates non-empty input and saves the note on the server', () => {
      assert.match(appJsContent, /handleSaveBrain\s*\(/, 'Must implement handleSaveBrain');
      assert.match(appJsContent, /ApiService\.createPrivateNote\(/, 'Must save notes on the server, not only in the browser');
      assert.match(appJsContent, /Please write something before saving/, 'Must warn if user attempts to save an empty note');
      assert.doesNotMatch(appJsContent, /StorageService\.saveBrainEntries\(entries\)/, 'New notes must not be written to localStorage');
    });

    test('3.2 renderBrain renders honest empty state and escapeHtml', () => {
      assert.match(appJsContent, /renderBrain\s*\(/, 'Must implement renderBrain');
      assert.match(appJsContent, /No private notes yet/, 'Must contain honest empty state');
      assert.match(appJsContent, /escapeHtml\s*\(\s*entry\.text\s*\)/, 'Must sanitize entry text with escapeHtml');
      assert.match(appJsContent, /escapeHtml\s*\(\s*stamp\(entry\.createdAt\)\s*\)/, 'Must sanitize entry timestamp with escapeHtml');
    });

    test('3.2b Notes saved only in this browser are moved to the server once', () => {
      assert.match(appJsContent, /migrateBrowserNotes\s*\(/);
      assert.match(appJsContent, /ApiService\.importPrivateNotes\(/);
      assert.match(appJsContent, /StorageService\.saveBrainEntries\(\[\]\)/, 'Browser copy is cleared only after a successful move');
    });

    test('3.3 openTrinovaNoteModal requires explicit checkbox and offers the live client list', () => {
      assert.match(appJsContent, /openTrinovaNoteModal\s*\(/, 'Must implement openTrinovaNoteModal');
      assert.match(appJsContent, /confirmBox\.checked\s*=\s*false/, 'Must explicitly uncheck confirmation box on modal open');
      assert.match(appJsContent, /getClientChoices\(\)/, 'Must offer the clients from the Clients page');
    });

    test('3.3b The copy dialog says truthfully that the note is not sent to TriNova', () => {
      assert.match(indexHtmlContent, /Nothing is sent to TriNova or to the client/);
      assert.doesNotMatch(indexHtmlContent, /TriNova staff will be able to read it/);
    });

    test('3.4 handleSendNoteToTrinova verifies checkbox before calling ApiService.sendNoteToTrinova', () => {
      assert.match(appJsContent, /handleSendNoteToTrinova\s*\(/, 'Must implement handleSendNoteToTrinova');
      assert.match(appJsContent, /!confirmBox\s*\|\|\s*!confirmBox\.checked/, 'Must enforce confirmBox check');
      assert.match(appJsContent, /ApiService\.sendNoteToTrinova\(/, 'Must dispatch via ApiService.sendNoteToTrinova');
    });

    test('3.5 ApiService.sendNoteToTrinova requires confirm_write_to_trinova: true', () => {
      assert.match(apiJsContent, /sendNoteToTrinova\s*\(/, 'Must implement sendNoteToTrinova');
      assert.match(apiJsContent, /confirm_write_to_trinova:\s*true/, 'Must set confirm_write_to_trinova: true');
    });

    test('3.6 index.html static shell has zero literal @ symbols and zero leaks', () => {
      assert.doesNotMatch(indexHtmlContent, /@/, 'index.html must not contain literal @ characters');
      assert.doesNotMatch(indexHtmlContent, /woofington/i, 'index.html must not leak client entities');
      assert.doesNotMatch(indexHtmlContent, /Confirmed corporate tax/i, 'index.html must not leak test notes');
    });
  });
});
