/**
 * Comprehensive AI Intelligence Engine Regression Test Suite
 * Covers Master Engineering Prompt Tests A through H:
 * - Test A: Natural conversation (hi, hey, whats up, How are you?)
 * - Test B: General knowledge (What is 2 + 2?, capabilities)
 * - Test C: Practice intelligence (How many companies are flagged red?)
 * - Test D: Executive assessment (Urgent statutory risks across practice)
 * - Test E: Multi-turn follow-up context resolution
 * - Test F: Provider failure and timeout resilience (no fake success cards)
 * - Test G: Frontend/backend API contract validation
 * - Test H: Privacy isolation (Strict boundary: PRIVATE_CEO_BRAIN = DENY)
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/app.js';
import { ClaudeService } from '../src/services/ai/claudeService.js';
import { ContextBuilder } from '../src/services/ai/contextBuilder.js';

describe('Regression Suite: Sloane AI Intelligence Engine Lifecycle', () => {
  let server;
  let baseUrl;
  const PORT = 4995;

  const READ_ONLY_KEY = 'tn_sec_live_sloane_readonly_2026';
  const READ_WRITE_KEY = 'tn_sec_live_sloane_readwrite_2026';

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

  // --- Test A: Natural conversation ---
  it('Test A: Natural conversation — Greetings receive natural, non-assessment responses', async () => {
    const greetings = ['hi', 'hey', 'whats up', 'How are you?'];

    for (const greeting of greetings) {
      const res = await fetch(`${baseUrl}/api/v1/ai/ask`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${READ_ONLY_KEY}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ message: greeting })
      });

      assert.equal(res.status, 200, `Greeting "${greeting}" should return HTTP 200`);
      const json = await res.json();

      assert.ok(json.data, 'Response must have data object');
      assert.ok(json.data.answer, 'Response must have answer text');
      assert.equal(json.data.response_type, 'conversational', `Greeting "${greeting}" must be classified as conversational`);

      // Verify no unrelated audit or risk assessment is forced on greetings
      assert.equal(json.data.risk_level, null, 'Greeting must not have an active risk level banner');
      assert.equal(json.data.key_reasons.length, 0, 'Greeting must not have unrequested key reasons/drivers');
      assert.equal(json.data.recommended_actions.length, 0, 'Greeting must not inject unrequested action recommendations');
      assert.equal(json.data.evidence.length, 0, 'Greeting must not cite unrequested timeline evidence');

      // Check tone: natural executive welcome without generic 33 companies pitch
      assert.match(json.data.answer, /Hello|Sloane|assist/i, 'Greeting response should be warm, concise, and professional');
      assert.doesNotMatch(json.data.answer, /Active monitoring is in effect across 33 practice entities/, 'Greeting must NOT return the generic 33 entities assessment');
    }
  });

  // --- Test B: General knowledge ---
  it('Test B: General knowledge — Arithmetic and capabilities answer directly without portfolio summary', async () => {
    // Math inquiry
    const mathRes = await fetch(`${baseUrl}/api/v1/ai/ask`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${READ_ONLY_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ message: 'What is 2 + 2?' })
    });

    assert.equal(mathRes.status, 200);
    const mathJson = await mathRes.json();
    assert.equal(mathJson.data.response_type, 'general_knowledge');
    assert.match(mathJson.data.answer, /4/, 'Must accurately answer 2 + 2 = 4');
    assert.equal(mathJson.data.risk_level, null);
    assert.equal(mathJson.data.key_reasons.length, 0);

    // Capability explanation inquiry
    const capRes = await fetch(`${baseUrl}/api/v1/ai/ask`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${READ_ONLY_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ message: 'Explain what you can help me with.' })
    });

    assert.equal(capRes.status, 200);
    const capJson = await capRes.json();
    assert.equal(capJson.data.response_type, 'general_knowledge');
    assert.match(capJson.data.answer, /executive|statutory|Companies House|timeline|signing/i);
    assert.equal(capJson.data.risk_level, null);
  });

  // --- Test C: Practice intelligence ---
  it('Test C: Practice intelligence — Answers practice statistics using authorized live records', async () => {
    const res = await fetch(`${baseUrl}/api/v1/ai/ask`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${READ_ONLY_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ message: 'How many companies are currently flagged red?' })
    });

    assert.equal(res.status, 200);
    const json = await res.json();
    assert.equal(json.data.response_type, 'practice_assessment');
    assert.equal(json.data.risk_level, 'red');

    // Authorized records indicate 2 high-risk companies in mockDb (Woofington Park and R GB Elevations)
    assert.match(json.data.answer, /2 companies|Woofington|R GB/i);
    assert.ok(json.data.key_reasons.length >= 1, 'Must provide concrete factual drivers');
    assert.ok(json.data.recommended_actions.length >= 1, 'Must provide recommended actions');
  });

  // --- Test D: Executive assessment ---
  it('Test D: Executive assessment — Reviews urgent statutory risks with grounded evidence', async () => {
    const res = await fetch(`${baseUrl}/api/v1/ai/ask`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${READ_ONLY_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ message: 'Review the most urgent statutory risks across the practice.' })
    });

    assert.equal(res.status, 200);
    const json = await res.json();
    assert.equal(json.data.response_type, 'practice_assessment');
    assert.equal(json.data.risk_level, 'red');
    assert.ok(json.data.key_reasons.length >= 2);
    assert.ok(json.data.recommended_actions.length >= 1);

    // Verify recommendations have priority labels
    for (const act of json.data.recommended_actions) {
      assert.ok(['high', 'normal', 'low'].includes(act.priority));
    }
  });

  // --- Test E: Follow-up context ---
  it('Test E: Follow-up context — Resolves references across multi-turn conversation turns', async () => {
    const history = [
      { role: 'user', content: 'Which company needs the most urgent attention, and why?' },
      { role: 'assistant', content: 'The most urgent company requiring immediate attention is Woofington Park Limited due to an active strike-off notice published by Companies House and overdue accounts.' }
    ];

    const res = await fetch(`${baseUrl}/api/v1/ai/ask`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${READ_ONLY_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        message: 'Tell me more about the first company you mentioned.',
        history
      })
    });

    assert.equal(res.status, 200);
    const json = await res.json();
    assert.ok(json.data);
    assert.ok(json.data.answer);
    // Assistant resolves reference to Woofington Park Limited
    assert.match(json.data.answer, /Woofington|strike-off|Sarah Jenkins/i);
  });

  // --- Test F: Provider failure and fallback transparency ---
  it('Test F: Provider failure — Truthfully identifies fallback when API key is missing or invalid', async () => {
    // 1. Unconfigured Claude service
    const offlineService = new ClaudeService({ apiKey: '' });
    assert.equal(offlineService.isConfigured(), false);

    const fallbackResult = await offlineService.ask({
      query: 'hi',
      context: { intent: 'GREETING' }
    });

    assert.equal(fallbackResult.status, 'fallback');
    assert.equal(fallbackResult.source, 'sloane_rules_engine');
    assert.equal(fallbackResult.data.response_type, 'conversational');
    assert.equal(fallbackResult.reason, 'ANTHROPIC_API_KEY_NOT_CONFIGURED');
    assert.ok(fallbackResult.data.answer.includes('Hello Kirsty'));

    // 2. Timeout resilience
    const timeoutService = new ClaudeService({ apiKey: 'sk-ant-mock-key-for-test-timeout', timeoutMs: 5 });
    // Mock the SDK client to simulate timeout
    timeoutService.client = {
      messages: {
        create: () => new Promise((_, reject) => setTimeout(() => {
          const err = new Error('The request was aborted.');
          err.name = 'AbortError';
          reject(err);
        }, 10))
      }
    };

    const timeoutRes = await timeoutService.ask({
      query: 'What is my highest risk?',
      context: {
        client: { name: 'Woofington Group' },
        companies: [{ companyName: 'Woofington Park Limited', riskLevel: 'High' }]
      }
    });

    assert.equal(timeoutRes.status, 'fallback');
    assert.equal(timeoutRes.reason, 'TIMEOUT_EXCEEDED');
    assert.equal(timeoutRes.data.risk_level, 'red');
  });

  // --- Test G: Frontend/backend contract ---
  it('Test G: Frontend/backend contract — Validates payload schemas and HTTP status codes', async () => {
    // Missing payload -> 422
    const emptyRes = await fetch(`${baseUrl}/api/v1/ai/ask`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${READ_ONLY_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({})
    });
    assert.equal(emptyRes.status, 422);

    // Whitespace message -> 422
    const wsRes = await fetch(`${baseUrl}/api/v1/ai/ask`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${READ_ONLY_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: '   ' })
    });
    assert.equal(wsRes.status, 422);

    // Message too long (> 1000) -> 422
    const longRes = await fetch(`${baseUrl}/api/v1/ai/ask`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${READ_ONLY_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: 'x'.repeat(1001) })
    });
    assert.equal(longRes.status, 422);

    // Non-existent client ID -> 404
    const notFoundRes = await fetch(`${baseUrl}/api/v1/ai/ask`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${READ_ONLY_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ clientId: 'cli_invalid_9999', message: 'Summarize client' })
    });
    assert.equal(notFoundRes.status, 404);
  });

  // --- Test H: Privacy isolation ---
  it('Test H: Privacy isolation — Verifies PRIVATE_CEO_BRAIN = DENY and client data isolation', async () => {
    const { allowedContext, privacyAudit } = ContextBuilder.buildContext({
      clientId: 'cli_woofington_grp',
      query: 'Review practice risk',
      actor: { actorId: 'actor_kirsty_allen' }
    });

    // 1. Explicitly verify PRIVATE_CEO_BRAIN = DENY
    assert.equal(privacyAudit.privateCeoBrainDenied, true, 'CRITICAL: PRIVATE_CEO_BRAIN must be strictly DENIED');

    // 2. Private timeline events must be excluded from context
    assert.ok(privacyAudit.privateTimelineEventsExcluded >= 1);
    const hasPrivate = (allowedContext.timeline || []).some(e => e.id === 'evt_woof_006');
    assert.equal(hasPrivate, false, 'Private observation evt_woof_006 must never enter LLM context');

    // 3. Client isolation: Unrelated client records are excluded
    assert.ok(privacyAudit.unrelatedClientsExcluded >= 1);
    const hasOtherClient = (allowedContext.companies || []).some(c => c.clientId !== 'cli_woofington_grp');
    assert.equal(hasOtherClient, false, 'No companies from unrelated clients may enter client context');
  });
});
