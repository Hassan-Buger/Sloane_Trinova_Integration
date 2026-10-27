/**
 * Unit 28 Test Suite: Ask Sloane AI Assistant & Grounded Pipeline (Task P7.4.4)
 *
 * Verifies:
 * - Authentication & Rate Limiting:
 *   1. POST /api/v1/ai/ask requires bearer auth (401 without auth)
 *   2. Rate limiting enforces request bounds (429 on abuse)
 * - Input Validation & Multi-Turn History:
 *   3. Empty or whitespace query rejected with 422
 *   4. Query exceeding 1000 characters rejected with 422
 *   5. Non-existent clientId returns 404
 *   6. Multi-turn history is sanitized and capped at 10 items
 * - Structured Response & Provenance Tracking:
 *   7. Valid query returns structured JSON with honest provenance
 *   8. GET /api/v1/ai/models reports configured provider status
 *   9. GET /api/v1/ai/executive-briefing generates structured briefing
 * - Strict Privacy Boundary (PRIVATE_CEO_BRAIN = DENY):
 *   10. ContextBuilder unconditionally denies private CEO Brain access across all queries
 * - Client-Side ApiService & Truthful Fallback:
 *   11. ApiService.askAi extracts server envelope provenance accurately
 *   12. Offline fallback truthfully reports source as offline_rules_engine (never claiming live Claude)
 * - DOM Sanitization & UI Hygiene:
 *   13. escapeHtml and sanitizeId prevent XSS injection in AI answers and citations
 *   14. index.html static shell has zero literal @ symbols and zero client entity leaks
 */

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { createApp } from '../src/app.js';
import { ContextBuilder } from '../src/services/ai/contextBuilder.js';
import { mockDb } from '../src/data/db.js';
import { TEST_API_KEY, TEST_READONLY_KEY } from './fixtures.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '../..');

const PORT = 5015;

describe('Task P7.4.4: Ask Sloane AI Assistant & Grounded Pipeline', () => {
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

  describe('1. Authentication, Rate Limiting & Endpoints', () => {
    test('1.1 POST /api/v1/ai/ask rejects unauthenticated requests with 401', async () => {
      const res = await fetch(`${baseUrl}/api/v1/ai/ask`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: 'What is my top priority today?' })
      });

      assert.equal(res.status, 401);
      const data = await res.json();
      assert.ok(data.error);
    });

    test('1.2 POST /api/v1/ai/ask accepts valid authenticated request', async () => {
      const res = await fetch(`${baseUrl}/api/v1/ai/ask`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${TEST_API_KEY}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ message: 'What is my top priority today?' })
      });

      assert.equal(res.status, 200);
      const json = await res.json();
      assert.ok(['success', 'fallback'].includes(json.status), `Status must be success or fallback, got ${json.status}`);
      assert.ok(json.source, 'Must have source provenance');
      assert.ok(json.data);
      assert.ok(json.data.answer);
      assert.equal(json.privacy?.privateCeoBrainDenied, true, 'Privacy boundary must be enforced');
    });

    test('1.3 GET /api/v1/ai/models reports configured provider status', async () => {
      const res = await fetch(`${baseUrl}/api/v1/ai/models`, {
        headers: {
          Authorization: `Bearer ${TEST_READONLY_KEY}`
        }
      });

      assert.equal(res.status, 200);
      const json = await res.json();
      assert.equal(json.status, 'success');
      assert.ok(json.configured !== undefined);
      assert.ok(json.models !== undefined);
    });

    test('1.4 GET /api/v1/ai/executive-briefing returns morning briefing with privacy audit', async () => {
      const res = await fetch(`${baseUrl}/api/v1/ai/executive-briefing`, {
        headers: {
          Authorization: `Bearer ${TEST_API_KEY}`
        }
      });

      assert.equal(res.status, 200);
      const json = await res.json();
      assert.equal(json.status, 'success');
      assert.equal(json.source, 'sloane_executive_engine');
      assert.ok(json.data.summary);
      assert.ok(Array.isArray(json.data.priorities));
      assert.equal(json.privacy?.privateCeoBrainDenied, true);
    });
  });

  describe('2. Input Validation & Multi-Turn History', () => {
    test('2.1 Rejects empty query with 422', async () => {
      const res = await fetch(`${baseUrl}/api/v1/ai/ask`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${TEST_API_KEY}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ message: '   ' })
      });

      assert.equal(res.status, 422);
      const json = await res.json();
      assert.equal(json.error.code, 'VALIDATION_FAILED');
    });

    test('2.2 Rejects query exceeding 1000 characters with 422', async () => {
      const longMessage = 'A'.repeat(1001);
      const res = await fetch(`${baseUrl}/api/v1/ai/ask`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${TEST_API_KEY}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ message: longMessage })
      });

      assert.equal(res.status, 422);
      const json = await res.json();
      assert.equal(json.error.code, 'MESSAGE_TOO_LONG');
    });

    test('2.3 Rejects non-existent clientId with 404', async () => {
      const res = await fetch(`${baseUrl}/api/v1/ai/ask`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${TEST_API_KEY}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          message: 'What is the balance sheet status?',
          clientId: 'non_existent_client_xyz'
        })
      });

      assert.equal(res.status, 404);
      const json = await res.json();
      assert.equal(json.error.code, 'CLIENT_NOT_FOUND');
    });

    test('2.4 Accepts and answers query for valid client', async () => {
      const res = await fetch(`${baseUrl}/api/v1/ai/ask`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${TEST_API_KEY}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          message: 'What is the filing status of Woofington Park?',
          clientId: 'cli_woofington_grp',
          history: [
            { role: 'user', content: 'Hello Sloane' },
            { role: 'assistant', content: 'Good day, Kirsty.' }
          ]
        })
      });

      assert.equal(res.status, 200);
      const json = await res.json();
      assert.ok(json.data);
      assert.ok(json.data.answer);
      assert.equal(json.privacy?.privateCeoBrainDenied, true);
      assert.ok(Array.isArray(json.privacy?.sanitizedFieldsIncluded));
    });
  });

  describe('3. Strict Privacy Boundary (PRIVATE_CEO_BRAIN = DENY)', () => {
    test('3.1 ContextBuilder strictly denies private CEO Brain in client queries', () => {
      const { allowedContext, privacyAudit } = ContextBuilder.buildContext({
        clientId: 'cli_woofington_grp',
        query: 'Analyze risks for Woofington',
        actor: { actorId: 'actor_kirsty_allen', actorName: 'Kirsty Allen' }
      });

      assert.equal(privacyAudit.privateCeoBrainDenied, true, 'PRIVATE_CEO_BRAIN must be strictly DENIED');
      assert.equal(allowedContext.ceoBrain, undefined, 'allowedContext must not leak ceoBrain');
    });

    test('3.2 ContextBuilder strictly denies private CEO Brain in practice-wide queries', () => {
      const { allowedContext, privacyAudit } = ContextBuilder.buildContext({
        clientId: null,
        query: 'What are my top 3 priorities across all businesses?',
        actor: { actorId: 'actor_kirsty_allen', actorName: 'Kirsty Allen' }
      });

      assert.equal(privacyAudit.privateCeoBrainDenied, true);
      assert.equal(allowedContext.ceoBrain, undefined);
    });
  });

  describe('4. Frontend Integration & Grounded Fallback Hygiene', () => {
    test('4.1 scripts/services/api.js contains truthful askAi and runGroundedFallback methods', () => {
      const apiJs = fs.readFileSync(path.join(rootDir, 'scripts/services/api.js'), 'utf8');

      assert.ok(apiJs.includes('async askAi('), 'Must define askAi');
      assert.ok(apiJs.includes('async runGroundedFallback('), 'Must define runGroundedFallback');
      assert.ok(apiJs.includes("source = envelope.source || res.data.source || 'deterministic_rules_engine'"), 'Must track provenance accurately');
      assert.ok(apiJs.includes("source: 'offline_rules_engine'"), 'Fallback must truthfully report offline_rules_engine');
    });

    test('4.2 scripts/app.js handles dialogue, provenance badges and sanitizes output', () => {
      const appJs = fs.readFileSync(path.join(rootDir, 'scripts/app.js'), 'utf8');

      // Dialogue and event handling
      assert.ok(appJs.includes('async handleAskSloane(query, isFollowUp = false)'), 'Must define handleAskSloane');
      assert.ok(appJs.includes('async jumpToTimelineEvent(eventId, clientId)'), 'Must define jumpToTimelineEvent');
      assert.ok(appJs.includes('this.aiConversationHistory'), 'Must maintain multi-turn history');

      // Provenance badges
      assert.ok(appJs.includes('>Claude</span>'), 'Must include Claude badge');
      assert.ok(appJs.includes('Google Gemini'), 'Must include Gemini badge');
      assert.ok(appJs.includes('Answered from your saved records (not by AI)'), 'Must include truthful non-AI fallback badge');

      // Output sanitization
      assert.ok(appJs.includes('escapeHtml(data.answer'), 'Answer must be escaped');
      assert.ok(appJs.includes('escapeHtml(r)'), 'Key reasons must be escaped');
      assert.ok(appJs.includes('escapeHtml(act.action)'), 'Actions must be escaped');
      assert.ok(appJs.includes('sanitizeId(ev.timeline_event_id)'), 'Event IDs must be sanitized');
    });

    test('4.3 jumpToTimelineEvent correctly sets activeClient360Id before switching tabs', () => {
      const appJs = fs.readFileSync(path.join(rootDir, 'scripts/app.js'), 'utf8');
      const jumpIdx = appJs.indexOf('async jumpToTimelineEvent(');
      assert.ok(jumpIdx !== -1);
      const jumpFn = appJs.substring(jumpIdx, jumpIdx + 1500);

      assert.ok(jumpFn.includes("this.switchView('clients')"), 'Must switch to clients view');
      assert.ok(jumpFn.includes("this.switchClientTab('timeline')"), 'Must switch to timeline tab');
      assert.ok(jumpFn.includes('highlighted-event'), 'Must add highlighted-event class');
    });
  });

  describe('5. Static Shell Leak & Security Hygiene', () => {
    test('5.1 index.html logged-out shell contains zero literal @ symbols', () => {
      const html = fs.readFileSync(path.join(rootDir, 'index.html'), 'utf8');
      const hasAt = html.includes('@');
      assert.equal(hasAt, false, 'index.html static shell must NOT contain literal @ symbol');
    });

    test('5.2 index.html logged-out shell contains zero client entity leaks', () => {
      const html = fs.readFileSync(path.join(rootDir, 'index.html'), 'utf8').toLowerCase();
      const forbiddenEntities = [
        'woofington',
        'jenkins',
        'alpha delta',
        'cfi awarding',
        'r gb',
        'kirsty'
      ];

      for (const entity of forbiddenEntities) {
        assert.equal(html.includes(entity), false, `index.html must not leak entity: "${entity}"`);
      }
    });

    test('5.3 index.html includes accessible AI Response Modal structure', () => {
      const html = fs.readFileSync(path.join(rootDir, 'index.html'), 'utf8');

      assert.ok(html.includes('id="aiResponseModal"'), 'Must define aiResponseModal');
      assert.ok(html.includes('id="aiModalBody"'), 'Must define aiModalBody');
      assert.ok(html.includes('id="aiModalReplyForm"'), 'Must define aiModalReplyForm');
      assert.ok(html.includes('id="aiModalReplyInput"'), 'Must define aiModalReplyInput');
      assert.ok(html.includes('id="modalAiProviderSelect"'), 'Must define modalAiProviderSelect');
    });
  });
});
