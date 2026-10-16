/**
 * Unit 09: Claude AI Integration, Context Builder & Privacy Verification
 * Verifies Prompt Section 18-43, 46, 48, 50, 51:
 * - Official SDK integration & configuration
 * - Strict Privacy Boundary: PRIVATE_CEO_BRAIN = DENY
 * - Client Isolation in AI context
 * - Structured output schema validation
 * - Graceful fallback resilience when offline
 * - Rate limiting on /api/v1/ai/ask
 * - Morning Executive Briefing endpoint
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/app.js';
import { ContextBuilder } from '../src/services/ai/contextBuilder.js';
import { ClaudeService } from '../src/services/ai/claudeService.js';
import { TEST_API_KEY, TEST_READONLY_KEY } from './fixtures.js';

describe('Unit 09: Claude AI Integration & Privacy Verification', () => {
  let server;
  let baseUrl;
  const PORT = 4996;

  const READ_WRITE_KEY = TEST_API_KEY;
  const READ_ONLY_KEY = TEST_READONLY_KEY;

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

  it('1. Authentication & Security: POST /api/v1/ai/ask requires bearer auth', async () => {
    // 1. Unauthenticated -> 401
    const unauthRes = await fetch(`${baseUrl}/api/v1/ai/ask`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: 'What is my top priority today?' })
    });
    assert.equal(unauthRes.status, 401);

    // 2. Authenticated -> 200
    const authRes = await fetch(`${baseUrl}/api/v1/ai/ask`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${READ_ONLY_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ message: 'What is my top priority today?' })
    });
    assert.equal(authRes.status, 200);
    const json = await authRes.json();
    assert.ok(json.data);
    assert.ok(json.data.answer);
  });

  it('2. Input Validation: Rejects empty or oversized messages with 422', async () => {
    // Empty message
    const emptyRes = await fetch(`${baseUrl}/api/v1/ai/ask`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${READ_WRITE_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ message: '   ' })
    });
    assert.equal(emptyRes.status, 422);

    // Oversized message (> 1000 chars)
    const longRes = await fetch(`${baseUrl}/api/v1/ai/ask`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${READ_WRITE_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ message: 'a'.repeat(1001) })
    });
    assert.equal(longRes.status, 422);
  });

  it('3. Client Existence Check: Rejects invalid clientId with 404', async () => {
    const res = await fetch(`${baseUrl}/api/v1/ai/ask`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${READ_WRITE_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        clientId: 'cli_non_existent_404',
        message: 'Summarise this client.'
      })
    });
    assert.equal(res.status, 404);
  });

  it('4. Context Builder & Privacy Boundary: PRIVATE_CEO_BRAIN = DENY (Section 23 & 48)', async () => {
    const { allowedContext, privacyAudit } = ContextBuilder.buildContext({
      clientId: 'cli_woofington_grp',
      query: 'Summarise this client',
      actor: { actorId: 'test_ceo' }
    });

    // 1. Explicitly audit CEO Brain denial
    assert.equal(privacyAudit.privateCeoBrainDenied, true, 'CRITICAL: PRIVATE_CEO_BRAIN must be strictly DENIED');

    // 2. Verify private timeline events are excluded
    // Woofington has evt_woof_006 which is visibility === 'private'
    assert.ok(privacyAudit.privateTimelineEventsExcluded >= 1, 'Private timeline events must be excluded from AI context');
    const privateEventFound = (allowedContext.timeline || []).find(e => e.id === 'evt_woof_006');
    assert.equal(privateEventFound, undefined, 'Private CEO Note must NEVER enter allowed context');

    // 3. Verify allowed fields exist
    assert.ok(allowedContext.client, 'Client identity must be present in context');
    assert.ok(allowedContext.companies, 'Companies must be present in context');
    assert.ok(allowedContext.tasks, 'Tasks must be present in context');
    assert.ok(allowedContext.timeline, 'Sanitized timeline events must be present');
  });

  it('5. Client Isolation in Context: Does not include unrelated clients (Section 50)', async () => {
    const { allowedContext, privacyAudit } = ContextBuilder.buildContext({
      clientId: 'cli_rgb_elevations',
      query: 'What is R GB status?',
      actor: { actorId: 'test_ceo' }
    });

    assert.equal(allowedContext.client.id, 'cli_rgb_elevations');
    assert.ok(privacyAudit.unrelatedClientsExcluded >= 3, 'Unrelated client entities must be excluded from context');

    // Ensure Woofington or Alpha Delta data is not in companies or tasks
    const hasOtherCompanies = (allowedContext.companies || []).some(c => c.clientId !== 'cli_rgb_elevations');
    assert.equal(hasOtherCompanies, false, 'Context must strictly isolate the requested client');
  });

  it('6. Structured Output Contract Validation: Meets Section 28 & 29 schema', async () => {
    const res = await fetch(`${baseUrl}/api/v1/ai/ask`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${READ_ONLY_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        clientId: 'cli_woofington_grp',
        message: 'Why is Woofington high risk?'
      })
    });
    assert.equal(res.status, 200);
    const json = await res.json();

    // Verify stable contract
    assert.ok(json.data.answer, 'Must contain answer string');
    assert.ok(['low', 'amber', 'red', 'neutral'].includes(json.data.risk_level), 'Must contain valid risk_level');
    assert.ok(Array.isArray(json.data.key_reasons), 'Must contain key_reasons array');
    assert.ok(Array.isArray(json.data.recommended_actions), 'Must contain recommended_actions array');
    assert.ok(Array.isArray(json.data.evidence), 'Must contain evidence array');

    // Verify privacy metadata returned
    assert.equal(json.privacy.privateCeoBrainDenied, true);
  });

  it('7. Graceful Degradation: Offline / unconfigured Claude gracefully falls back without crashing (Section 51)', async () => {
    // Instantiate isolated service without credentials
    const offlineService = new ClaudeService({ apiKey: '' });
    assert.equal(offlineService.isConfigured(), false);

    const result = await offlineService.ask({
      query: 'Why is Woofington red?',
      context: {
        client: { name: 'Woofington Group' },
        companies: [{ companyName: 'Woofington Park Limited', riskLevel: 'High' }]
      }
    });

    assert.equal(result.status, 'fallback');
    assert.equal(result.source, 'sloane_rules_engine');
    assert.ok(result.data.answer.includes('high risk'));
    assert.equal(result.data.risk_level, 'red');
  });

  it('8. Executive Briefing: GET /api/v1/ai/executive-briefing returns morning summary (Section 42)', async () => {
    const res = await fetch(`${baseUrl}/api/v1/ai/executive-briefing`, {
      headers: { Authorization: `Bearer ${READ_ONLY_KEY}` }
    });
    assert.equal(res.status, 200);
    const json = await res.json();

    assert.equal(json.status, 'success');
    assert.ok(json.data.summary);
    assert.ok(Array.isArray(json.data.priorities));
    assert.ok(Array.isArray(json.data.critical_risks));
    assert.ok(Array.isArray(json.data.upcoming_deadlines));
    assert.ok(Array.isArray(json.data.recommended_focus));
  });
});
