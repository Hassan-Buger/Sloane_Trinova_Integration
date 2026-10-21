/**
 * Unit 17 Test Suite: Outlook Logging Hygiene & Redaction (Task P4.2)
 *
 * Verifies:
 * - Redaction of access_token, refresh_token, id_token, client_secret, code_verifier
 * - Supports both snake_case and camelCase variations
 * - Deep nested object and array redaction
 * - Query parameter / URL string redaction for sensitive keys
 * - Logger wrapper (logger.info, logger.warn, logger.error) correctly masks secrets
 * - Preservation of non-sensitive diagnostic properties
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { sanitizeForLog, logger } from '../src/middleware/sanitizer.js';

describe('Task P4.2: Outlook-Specific Logging Hygiene & Sanitization', () => {
  test('1. Redacts access_token, refresh_token, id_token, client_secret, code_verifier in flat objects', () => {
    const raw = {
      accountEmail: 'kirsty.allen@trinova.co.uk',
      displayName: 'Kirsty Allen',
      access_token: 'secret_live_access_token_123',
      refresh_token: 'secret_live_refresh_token_456',
      id_token: 'secret_live_id_token_jwt_789',
      client_secret: 'azure_app_client_secret_xyz',
      code_verifier: 'pkce_high_entropy_verifier_abc',
      scope: 'offline_access Mail.Read Calendars.Read'
    };

    const sanitized = sanitizeForLog(raw);

    assert.equal(sanitized.access_token, '[REDACTED]');
    assert.equal(sanitized.refresh_token, '[REDACTED]');
    assert.equal(sanitized.id_token, '[REDACTED]');
    assert.equal(sanitized.client_secret, '[REDACTED]');
    assert.equal(sanitized.code_verifier, '[REDACTED]');

    // Preserves non-sensitive attributes
    assert.equal(sanitized.accountEmail, 'kirsty.allen@trinova.co.uk');
    assert.equal(sanitized.displayName, 'Kirsty Allen');
    assert.equal(sanitized.scope, 'offline_access Mail.Read Calendars.Read');
  });

  test('2. Redacts camelCase variants (accessToken, refreshToken, idToken, clientSecret, codeVerifier)', () => {
    const raw = {
      accessToken: 'token_abc',
      refreshToken: 'token_def',
      idToken: 'token_ghi',
      clientSecret: 'secret_jkl',
      codeVerifier: 'verifier_mno',
      normalField: 'visible_data'
    };

    const sanitized = sanitizeForLog(raw);

    assert.equal(sanitized.accessToken, '[REDACTED]');
    assert.equal(sanitized.refreshToken, '[REDACTED]');
    assert.equal(sanitized.idToken, '[REDACTED]');
    assert.equal(sanitized.clientSecret, '[REDACTED]');
    assert.equal(sanitized.codeVerifier, '[REDACTED]');
    assert.equal(sanitized.normalField, 'visible_data');
  });

  test('3. Recursively redacts sensitive keys within deeply nested objects and arrays', () => {
    const raw = {
      transaction: 'oauth_token_exchange',
      payload: {
        oauth: {
          tokens: [
            { type: 'primary', access_token: 'secret_1', refresh_token: 'secret_2' },
            { type: 'secondary', id_token: 'secret_3' }
          ],
          params: {
            auth: {
              client_secret: 'secret_4',
              code_verifier: 'secret_5'
            }
          }
        }
      }
    };

    const sanitized = sanitizeForLog(raw);

    assert.equal(sanitized.payload.oauth.tokens[0].access_token, '[REDACTED]');
    assert.equal(sanitized.payload.oauth.tokens[0].refresh_token, '[REDACTED]');
    assert.equal(sanitized.payload.oauth.tokens[0].type, 'primary');
    assert.equal(sanitized.payload.oauth.tokens[1].id_token, '[REDACTED]');
    assert.equal(sanitized.payload.oauth.params.auth.client_secret, '[REDACTED]');
    assert.equal(sanitized.payload.oauth.params.auth.code_verifier, '[REDACTED]');
  });

  test('4. Redacts Bearer tokens and sensitive token parameters in raw log strings', () => {
    const logString1 = 'Connecting with Authorization: Bearer secret_live_graph_bearer_9999 for user';
    const logString2 = 'POST /token?client_secret=mysecret123&code_verifier=pkce_val_456&grant_type=code';

    assert.equal(
      sanitizeForLog(logString1),
      'Connecting with Authorization: Bearer [REDACTED] for user'
    );
    assert.equal(
      sanitizeForLog(logString2),
      'POST /token?client_secret=[REDACTED]&code_verifier=[REDACTED]&grant_type=code'
    );
  });

  test('5. logger methods (info, warn, error) redact sensitive keys in console output', () => {
    const loggedMessages = [];

    const origLog = console.log;
    const origWarn = console.warn;
    const origError = console.error;

    try {
      console.log = (...args) => loggedMessages.push({ level: 'info', text: args.join(' ') });
      console.warn = (...args) => loggedMessages.push({ level: 'warn', text: args.join(' ') });
      console.error = (...args) => loggedMessages.push({ level: 'error', text: args.join(' ') });

      logger.info('OAuth callback payload received', {
        access_token: 'sensitive_at_123',
        refresh_token: 'sensitive_rt_456',
        client_secret: 'sensitive_cs_789',
        code_verifier: 'sensitive_cv_012',
        id_token: 'sensitive_it_345'
      });

      logger.warn('Token refresh warning', {
        refreshToken: 'sensitive_camel_rt',
        error: 'invalid_scope'
      });

      logger.error('Failed code exchange', {
        clientSecret: 'sensitive_camel_cs',
        codeVerifier: 'sensitive_camel_cv'
      });

      // Verify that NO logged string contains the plaintext secret values
      const fullLogOutput = loggedMessages.map(m => m.text).join('\n');

      assert.ok(!fullLogOutput.includes('sensitive_at_123'));
      assert.ok(!fullLogOutput.includes('sensitive_rt_456'));
      assert.ok(!fullLogOutput.includes('sensitive_cs_789'));
      assert.ok(!fullLogOutput.includes('sensitive_cv_012'));
      assert.ok(!fullLogOutput.includes('sensitive_it_345'));
      assert.ok(!fullLogOutput.includes('sensitive_camel_rt'));
      assert.ok(!fullLogOutput.includes('sensitive_camel_cs'));
      assert.ok(!fullLogOutput.includes('sensitive_camel_cv'));

      // Verify [REDACTED] appears in the log messages
      assert.ok(fullLogOutput.includes('[REDACTED]'));
    } finally {
      console.log = origLog;
      console.warn = origWarn;
      console.error = origError;
    }
  });
});
