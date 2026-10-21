/**
 * Unit 15 Test Suite: Outlook JWKS Fetch with Cache & id_token Verification (Task P3.3 Option A)
 *
 * Verifies:
 * - JWT parsing and format validation
 * - JWKS fetching from Microsoft discovery endpoint with in-memory caching and TTL
 * - Cache bypass on forceRefresh and automatic key rollover retry
 * - RS256 cryptographic signature verification against JWK public keys
 * - Claims validation: expiration (with clock skew), audience, nonce, and issuer
 * - Identity attribute extraction: preferred_username/email/upn, displayName, tid
 */

import { test, describe, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';

import {
  parseJwt,
  getJwks,
  clearJwksCache,
  setJwksCache,
  verifyIdToken,
  DEFAULT_JWKS_TTL_MS
} from '../src/services/outlookIdentityService.js';

describe('Task P3.3: Microsoft Entra ID JWKS & id_token Verification (Option A)', () => {
  let primaryPrivateKey;
  let primaryJwk;
  let secondaryPrivateKey;
  let secondaryJwk;

  const TEST_TENANT_ID = 'test-tenant-123';
  const TEST_CLIENT_ID = 'test-client-abc';

  before(() => {
    // Generate primary RSA key pair
    const keyPair1 = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
    primaryPrivateKey = keyPair1.privateKey;
    primaryJwk = keyPair1.publicKey.export({ format: 'jwk' });
    primaryJwk.kid = 'primary-key-id-001';
    primaryJwk.use = 'sig';
    primaryJwk.alg = 'RS256';

    // Generate secondary RSA key pair (for key rollover & wrong-key tests)
    const keyPair2 = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
    secondaryPrivateKey = keyPair2.privateKey;
    secondaryJwk = keyPair2.publicKey.export({ format: 'jwk' });
    secondaryJwk.kid = 'secondary-key-id-002';
    secondaryJwk.use = 'sig';
    secondaryJwk.alg = 'RS256';
  });

  beforeEach(() => {
    clearJwksCache();
  });

  // Helper to build and sign a JWT
  function createSignedToken({
    headerOverrides = {},
    payloadOverrides = {},
    signingKey = primaryPrivateKey,
    tamperSignature = false,
    tamperPayload = false
  } = {}) {
    const header = {
      alg: 'RS256',
      kid: primaryJwk.kid,
      typ: 'JWT',
      ...headerOverrides
    };

    const nowSec = Math.floor(Date.now() / 1000);
    const payload = {
      aud: TEST_CLIENT_ID,
      iss: `https://login.microsoftonline.com/${TEST_TENANT_ID}/v2.0`,
      iat: nowSec,
      nbf: nowSec,
      exp: nowSec + 3600,
      name: 'Kirsty Allen',
      preferred_username: 'kirsty.allen@trinova.co.uk',
      tid: TEST_TENANT_ID,
      nonce: 'test-secure-nonce-xyz',
      ...payloadOverrides
    };

    const headerB64 = Buffer.from(JSON.stringify(header)).toString('base64url');
    let payloadB64 = Buffer.from(JSON.stringify(payload)).toString('base64url');

    const signedData = Buffer.from(`${headerB64}.${payloadB64}`);
    const signature = crypto.sign('SHA256', signedData, signingKey);

    if (tamperPayload) {
      payload.preferred_username = 'hacked@malicious.com';
      payloadB64 = Buffer.from(JSON.stringify(payload)).toString('base64url');
    }

    let signatureB64 = signature.toString('base64url');
    if (tamperSignature) {
      const sigBuf = Buffer.from(signature);
      sigBuf[0] ^= 0xff;
      signatureB64 = sigBuf.toString('base64url');
    }

    return `${headerB64}.${payloadB64}.${signatureB64}`;
  }

  describe('JWT Parsing & Format Validation (parseJwt)', () => {
    test('1. Correctly decodes valid 3-segment JWT into header, payload, and binary signature', () => {
      const token = createSignedToken();
      const parsed = parseJwt(token);

      assert.equal(parsed.header.alg, 'RS256');
      assert.equal(parsed.header.kid, primaryJwk.kid);
      assert.equal(parsed.payload.name, 'Kirsty Allen');
      assert.equal(parsed.payload.preferred_username, 'kirsty.allen@trinova.co.uk');
      assert.ok(Buffer.isBuffer(parsed.signature));
      assert.ok(Buffer.isBuffer(parsed.signedData));
    });

    test('2. Rejects non-string, empty, or missing token with descriptive error', () => {
      assert.throws(() => parseJwt(null), /must be a non-empty string/);
      assert.throws(() => parseJwt(''), /must be a non-empty string/);
      assert.throws(() => parseJwt(12345), /must be a non-empty string/);
    });

    test('3. Rejects token with invalid segment count', () => {
      assert.throws(() => parseJwt('only.two'), /expected 3 dot-separated segments, got 2/);
      assert.throws(() => parseJwt('four.parts.in.here'), /expected 3 dot-separated segments, got 4/);
    });

    test('4. Rejects token with invalid base64url or malformed JSON in header/payload', () => {
      assert.throws(() => parseJwt('not-json.eyJmIjoxfQ.sig'), /Failed to parse JWT header/);
      assert.throws(() => parseJwt('eyJhbGciOiJSUzI1NiJ9.not-json.sig'), /Failed to parse JWT payload/);
    });
  });

  describe('JWKS Retrieval & In-Memory Caching (getJwks)', () => {
    test('5. Fetches JWKS from tenant discovery URL and caches in memory', async () => {
      let fetchCount = 0;
      const mockFetch = async (url) => {
        fetchCount++;
        assert.equal(url, `https://login.microsoftonline.com/${TEST_TENANT_ID}/discovery/v2.0/keys`);
        return {
          ok: true,
          status: 200,
          json: async () => ({ keys: [primaryJwk] })
        };
      };

      // First call fetches from endpoint
      const keys1 = await getJwks(TEST_TENANT_ID, { fetchFn: mockFetch });
      assert.equal(fetchCount, 1);
      assert.equal(keys1.length, 1);
      assert.equal(keys1[0].kid, primaryJwk.kid);

      // Second call retrieves from in-memory cache without hitting fetch
      const keys2 = await getJwks(TEST_TENANT_ID, { fetchFn: mockFetch });
      assert.equal(fetchCount, 1);
      assert.deepEqual(keys2, keys1);
    });

    test('6. Honors cache TTL and refetches when expired', async () => {
      let fetchCount = 0;
      const mockFetch = async () => {
        fetchCount++;
        return {
          ok: true,
          status: 200,
          json: async () => ({ keys: [primaryJwk] })
        };
      };

      // Call with 1ms TTL
      await getJwks(TEST_TENANT_ID, { fetchFn: mockFetch, ttlMs: 1 });
      assert.equal(fetchCount, 1);

      // Wait 5ms for cache to expire
      await new Promise(r => setTimeout(r, 10));

      await getJwks(TEST_TENANT_ID, { fetchFn: mockFetch, ttlMs: 1 });
      assert.equal(fetchCount, 2);
    });

    test('7. forceRefresh bypasses cache even within TTL', async () => {
      let fetchCount = 0;
      const mockFetch = async () => {
        fetchCount++;
        return {
          ok: true,
          status: 200,
          json: async () => ({ keys: [primaryJwk] })
        };
      };

      await getJwks(TEST_TENANT_ID, { fetchFn: mockFetch });
      assert.equal(fetchCount, 1);

      await getJwks(TEST_TENANT_ID, { fetchFn: mockFetch, forceRefresh: true });
      assert.equal(fetchCount, 2);
    });

    test('8. Throws descriptive error on HTTP non-200 responses', async () => {
      const mockFetch = async () => ({
        ok: false,
        status: 503
      });

      await assert.rejects(
        () => getJwks(TEST_TENANT_ID, { fetchFn: mockFetch }),
        /Failed to fetch JWKS from .* HTTP 503/
      );
    });

    test('9. clearJwksCache purges cache and setJwksCache primes cache directly', async () => {
      setJwksCache(TEST_TENANT_ID, [secondaryJwk]);

      let fetchCalled = false;
      const mockFetch = async () => { fetchCalled = true; };

      const cachedKeys = await getJwks(TEST_TENANT_ID, { fetchFn: mockFetch });
      assert.equal(fetchCalled, false);
      assert.equal(cachedKeys[0].kid, secondaryJwk.kid);

      clearJwksCache();

      let refetched = false;
      const mockFetch2 = async () => {
        refetched = true;
        return { ok: true, json: async () => ({ keys: [primaryJwk] }) };
      };

      const keysAfterClear = await getJwks(TEST_TENANT_ID, { fetchFn: mockFetch2 });
      assert.equal(refetched, true);
      assert.equal(keysAfterClear[0].kid, primaryJwk.kid);
    });
  });

  describe('Cryptographic Signature Verification (verifyIdToken)', () => {
    test('10. Successfully verifies valid RS256 signed token against matching JWK', async () => {
      const token = createSignedToken();
      const identity = await verifyIdToken(token, {
        clientId: TEST_CLIENT_ID,
        nonce: 'test-secure-nonce-xyz',
        keyset: [primaryJwk]
      });

      assert.equal(identity.accountEmail, 'kirsty.allen@trinova.co.uk');
      assert.equal(identity.displayName, 'Kirsty Allen');
      assert.equal(identity.tenantId, TEST_TENANT_ID);
      assert.equal(identity.claims.aud, TEST_CLIENT_ID);
    });

    test('11. Rejects non-RS256 algorithms (e.g., HS256, none)', async () => {
      const tokenHS = createSignedToken({ headerOverrides: { alg: 'HS256' } });
      await assert.rejects(
        () => verifyIdToken(tokenHS, { keyset: [primaryJwk] }),
        /Unsupported JWT algorithm "HS256". Expected RS256/
      );

      const tokenNone = createSignedToken({ headerOverrides: { alg: 'none' } });
      await assert.rejects(
        () => verifyIdToken(tokenNone, { keyset: [primaryJwk] }),
        /Unsupported JWT algorithm "none". Expected RS256/
      );
    });

    test('12. Rejects token missing kid in header', async () => {
      const tokenNoKid = createSignedToken({ headerOverrides: { kid: undefined } });
      await assert.rejects(
        () => verifyIdToken(tokenNoKid, { keyset: [primaryJwk] }),
        /JWT header missing required "kid"/
      );
    });

    test('13. Rejects token with unknown kid not found in JWKS', async () => {
      const tokenUnknownKid = createSignedToken({ headerOverrides: { kid: 'non-existent-kid' } });
      await assert.rejects(
        () => verifyIdToken(tokenUnknownKid, { keyset: [primaryJwk] }),
        /Signing key with kid "non-existent-kid" not found in JWKS/
      );
    });

    test('14. Key rollover: automatically forces fresh JWKS fetch when kid is missing from cache', async () => {
      // Prime cache with only primary key
      setJwksCache(TEST_TENANT_ID, [primaryJwk]);

      // Create token signed with secondary key (kid: secondary-key-id-002)
      const tokenSecondary = createSignedToken({
        headerOverrides: { kid: secondaryJwk.kid },
        signingKey: secondaryPrivateKey
      });

      let refetched = false;
      const mockFetch = async () => {
        refetched = true;
        return {
          ok: true,
          json: async () => ({ keys: [primaryJwk, secondaryJwk] })
        };
      };

      const identity = await verifyIdToken(tokenSecondary, {
        clientId: TEST_CLIENT_ID,
        nonce: 'test-secure-nonce-xyz',
        tenantId: TEST_TENANT_ID,
        fetchFn: mockFetch
      });

      assert.equal(refetched, true, 'Expected forced JWKS refetch on unknown kid');
      assert.equal(identity.accountEmail, 'kirsty.allen@trinova.co.uk');
    });

    test('15. Rejects token with tampered signature', async () => {
      const tamperedToken = createSignedToken({ tamperSignature: true });
      await assert.rejects(
        () => verifyIdToken(tamperedToken, { keyset: [primaryJwk] }),
        /Invalid JWT cryptographic signature/
      );
    });

    test('16. Rejects token with tampered payload', async () => {
      const tamperedToken = createSignedToken({ tamperPayload: true });
      await assert.rejects(
        () => verifyIdToken(tamperedToken, { keyset: [primaryJwk] }),
        /Invalid JWT cryptographic signature/
      );
    });

    test('17. Rejects token signed by different private key than the advertised JWK public key', async () => {
      // Sign with secondary key, but keep primaryJwk in keyset under same kid
      const wrongKeyToken = createSignedToken({
        headerOverrides: { kid: primaryJwk.kid },
        signingKey: secondaryPrivateKey
      });

      await assert.rejects(
        () => verifyIdToken(wrongKeyToken, { keyset: [primaryJwk] }),
        /Invalid JWT cryptographic signature/
      );
    });
  });

  describe('Claims Validation & Attribute Extraction', () => {
    test('18. Rejects expired token past the 60-second clock skew tolerance', async () => {
      const expiredSec = Math.floor(Date.now() / 1000) - 120; // 2 minutes ago
      const token = createSignedToken({ payloadOverrides: { exp: expiredSec } });

      await assert.rejects(
        () => verifyIdToken(token, { keyset: [primaryJwk] }),
        /id_token has expired/
      );
    });

    test('19. Accepts token within 60-second clock skew tolerance', async () => {
      const slightlyPastSec = Math.floor(Date.now() / 1000) - 20; // 20s ago (within 60s skew)
      const token = createSignedToken({ payloadOverrides: { exp: slightlyPastSec } });

      const identity = await verifyIdToken(token, {
        keyset: [primaryJwk],
        clientId: TEST_CLIENT_ID,
        nonce: 'test-secure-nonce-xyz'
      });
      assert.equal(identity.accountEmail, 'kirsty.allen@trinova.co.uk');
    });

    test('20. Rejects token when nonce is expected but mismatched or absent', async () => {
      const tokenWrongNonce = createSignedToken({ payloadOverrides: { nonce: 'wrong-nonce-123' } });
      await assert.rejects(
        () => verifyIdToken(tokenWrongNonce, { keyset: [primaryJwk], nonce: 'expected-nonce-abc' }),
        /Nonce mismatch: expected "expected-nonce-abc", got "wrong-nonce-123"/
      );

      const tokenNoNonce = createSignedToken({ payloadOverrides: { nonce: undefined } });
      await assert.rejects(
        () => verifyIdToken(tokenNoNonce, { keyset: [primaryJwk], nonce: 'expected-nonce-abc' }),
        /id_token missing required nonce claim/
      );
    });

    test('21. Rejects token with mismatched audience', async () => {
      const tokenWrongAud = createSignedToken({ payloadOverrides: { aud: 'unauthorized-app-id' } });
      await assert.rejects(
        () => verifyIdToken(tokenWrongAud, { keyset: [primaryJwk], clientId: TEST_CLIENT_ID }),
        /Audience mismatch: expected "test-client-abc", got "unauthorized-app-id"/
      );
    });

    test('22. Accepts array audience containing the client ID', async () => {
      const tokenArrayAud = createSignedToken({
        payloadOverrides: { aud: ['another-service', TEST_CLIENT_ID] }
      });
      const identity = await verifyIdToken(tokenArrayAud, {
        keyset: [primaryJwk],
        clientId: TEST_CLIENT_ID,
        nonce: 'test-secure-nonce-xyz'
      });
      assert.equal(identity.accountEmail, 'kirsty.allen@trinova.co.uk');
    });

    test('23. Rejects non-Microsoft untrusted issuer or issuer mismatch', async () => {
      const tokenUntrustedIss = createSignedToken({
        payloadOverrides: { iss: 'https://attacker.example.com/oauth2/v2.0' }
      });
      await assert.rejects(
        () => verifyIdToken(tokenUntrustedIss, { keyset: [primaryJwk] }),
        /Untrusted issuer: "https:\/\/attacker.example.com\/oauth2\/v2.0". Expected Microsoft Online issuer/
      );

      const tokenMismatch = createSignedToken();
      await assert.rejects(
        () => verifyIdToken(tokenMismatch, {
          keyset: [primaryJwk],
          issuer: 'https://login.microsoftonline.com/other-tenant/v2.0'
        }),
        /Issuer mismatch/
      );
    });

    test('24. Falls back to email or upn claims when preferred_username is absent', async () => {
      // 1. Fallback to 'email'
      const tokenWithEmail = createSignedToken({
        payloadOverrides: {
          preferred_username: undefined,
          email: 'ceo.email@trinova.co.uk'
        }
      });
      const id1 = await verifyIdToken(tokenWithEmail, {
        keyset: [primaryJwk],
        clientId: TEST_CLIENT_ID,
        nonce: 'test-secure-nonce-xyz'
      });
      assert.equal(id1.accountEmail, 'ceo.email@trinova.co.uk');

      // 2. Fallback to 'upn'
      const tokenWithUpn = createSignedToken({
        payloadOverrides: {
          preferred_username: undefined,
          email: undefined,
          upn: 'kirsty.upn@trinova.co.uk'
        }
      });
      const id2 = await verifyIdToken(tokenWithUpn, {
        keyset: [primaryJwk],
        clientId: TEST_CLIENT_ID,
        nonce: 'test-secure-nonce-xyz'
      });
      assert.equal(id2.accountEmail, 'kirsty.upn@trinova.co.uk');
    });

    test('25. Rejects token missing any recognizable email claim', async () => {
      const tokenNoEmail = createSignedToken({
        payloadOverrides: {
          preferred_username: undefined,
          email: undefined,
          upn: undefined
        }
      });
      await assert.rejects(
        () => verifyIdToken(tokenNoEmail, { keyset: [primaryJwk] }),
        /does not contain a recognizable email claim/
      );
    });
  });
});
