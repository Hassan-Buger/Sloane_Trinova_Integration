/**
 * Automated Unit Test Suite for Unit 13 / Task P3.1:
 * PKCE Generation & Ephemeral OAuth State Store with TTL & Single-Use
 */

import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {
  outlookOAuthStateStore,
  generateCodeVerifier,
  generateCodeChallenge,
  generateState,
  generateNonce,
  createStateEntry,
  consumeState,
  cleanupExpired,
  clearStore,
  getStoreSize,
  DEFAULT_TTL_MS
} from '../src/services/outlookOAuthStateStore.js';

describe('Task P3.1: PKCE + State Store with TTL and Single-Use (§4.2)', () => {
  beforeEach(() => {
    clearStore();
  });

  // 1. PKCE Generation & Verification
  describe('PKCE Code Verifier & Challenge (RFC 7636)', () => {
    test('1. Generates valid URL-safe high-entropy code verifier', () => {
      const verifier = generateCodeVerifier();
      assert.ok(typeof verifier === 'string');
      // 32 bytes base64url = 43 characters
      assert.equal(verifier.length, 43);
      assert.match(verifier, /^[A-Za-z0-9_-]+$/, 'Verifier must contain only URL-safe base64 characters');
    });

    test('2. Derives deterministic S256 code challenge from verifier', () => {
      const verifier = 'test_code_verifier_123456789012345678901234';
      const challenge = generateCodeChallenge(verifier);

      const expected = crypto.createHash('sha256').update(verifier).digest('base64url');
      assert.equal(challenge, expected);
    });

    test('3. Rejects invalid or empty code verifiers during challenge generation', () => {
      assert.throws(() => generateCodeChallenge(''), /Code verifier must be a non-empty string/);
      assert.throws(() => generateCodeChallenge(null), /Code verifier must be a non-empty string/);
    });

    test('4. Generates unique random states and nonces on successive invocations', () => {
      const state1 = generateState();
      const state2 = generateState();
      assert.notEqual(state1, state2);
      assert.equal(state1.length, 43);

      const nonce1 = generateNonce();
      const nonce2 = generateNonce();
      assert.notEqual(nonce1, nonce2);
    });
  });

  // 2. State Store Creation & Binding
  describe('State Store Binding & Parameters', () => {
    test('5. createStateEntry binds state and PKCE verifier to session actorId with 10m TTL', () => {
      const entry = createStateEntry({ actorId: 'actor_kirsty_allen' });

      assert.ok(entry.state);
      assert.ok(entry.codeVerifier);
      assert.ok(entry.codeChallenge);
      assert.ok(entry.nonce);
      assert.equal(entry.actorId, 'actor_kirsty_allen');
      assert.equal(entry.expiresAt - entry.createdAt, DEFAULT_TTL_MS);
      assert.equal(getStoreSize(), 1);
    });

    test('6. createStateEntry rejects missing or non-string actorId', () => {
      assert.throws(() => createStateEntry({ actorId: '' }), /actorId is required/);
      assert.throws(() => createStateEntry({}), /actorId is required/);
    });
  });

  // 3. Single-Use Consumption, Double-Click Protection & Unknown State
  describe('Single-Use Enforcement & Unknown State Rejection', () => {
    test('7. consumeState succeeds on first attempt with valid state', () => {
      const created = createStateEntry({ actorId: 'actor_kirsty_allen' });
      const result = consumeState(created.state);

      assert.equal(result.valid, true);
      assert.equal(result.data.actorId, 'actor_kirsty_allen');
      assert.equal(result.data.codeVerifier, created.codeVerifier);
      assert.equal(result.data.nonce, created.nonce);
    });

    test('8. Single use: second consumeState with identical state fails with UNKNOWN_STATE', () => {
      const created = createStateEntry({ actorId: 'actor_kirsty_allen' });

      // First lookup succeeds
      const first = consumeState(created.state);
      assert.equal(first.valid, true);

      // Replay / second lookup immediately fails
      const second = consumeState(created.state);
      assert.equal(second.valid, false);
      assert.equal(second.error, 'UNKNOWN_STATE');
      assert.match(second.message, /already been used/i);
    });

    test('9. Unknown state lookup returns UNKNOWN_STATE error', () => {
      const result = consumeState('completely_unknown_state_parameter_xyz');
      assert.equal(result.valid, false);
      assert.equal(result.error, 'UNKNOWN_STATE');
    });

    test('10. Missing or malformed state argument returns INVALID_STATE', () => {
      assert.equal(consumeState(null).valid, false);
      assert.equal(consumeState('').valid, false);
      assert.equal(consumeState(undefined).valid, false);
    });

    test('11. Double-click race condition simulation: exactly one request succeeds', async () => {
      const created = createStateEntry({ actorId: 'actor_kirsty_allen' });

      // Simulate two concurrent requests arriving with the same state parameter
      const [res1, res2] = await Promise.all([
        Promise.resolve().then(() => consumeState(created.state)),
        Promise.resolve().then(() => consumeState(created.state))
      ]);

      const successes = [res1, res2].filter(r => r.valid === true);
      const failures = [res1, res2].filter(r => r.valid === false);

      assert.equal(successes.length, 1, 'Exactly one concurrent request must succeed');
      assert.equal(failures.length, 1, 'The duplicate concurrent request must fail');
      assert.equal(failures[0].error, 'UNKNOWN_STATE');
    });
  });

  // 4. Expiry & Auto-Pruning
  describe('TTL Expiration & Pruning', () => {
    test('12. Expired state parameter is rejected with EXPIRED_STATE error', () => {
      // Create state with negative TTL to simulate past expiration
      const expired = createStateEntry({ actorId: 'actor_kirsty_allen', ttlMs: -1000 });
      const result = consumeState(expired.state);

      assert.equal(result.valid, false);
      assert.equal(result.error, 'EXPIRED_STATE');
      assert.match(result.message, /expired/i);

      // Verify that expired entry was also deleted from store
      assert.equal(getStoreSize(), 0);
    });

    test('13. cleanupExpired removes past entries while keeping unexpired ones', () => {
      // Create entries with positive TTL
      const e1 = createStateEntry({ actorId: 'actor_expired_1', ttlMs: 100 });
      const e2 = createStateEntry({ actorId: 'actor_expired_2', ttlMs: 100 });
      const valid = createStateEntry({ actorId: 'actor_valid', ttlMs: 60000 });

      assert.equal(getStoreSize(), 3);

      // Age e1 and e2 into the past
      e1.expiresAt = Date.now() - 1000;
      e2.expiresAt = Date.now() - 1000;

      const pruned = cleanupExpired();
      assert.equal(pruned, 2);
      assert.equal(getStoreSize(), 1);

      // Verify valid entry is still consumable
      const validResult = consumeState(valid.state);
      assert.equal(validResult.valid, true);
      assert.equal(validResult.data.actorId, 'actor_valid');
    });
  });
});
