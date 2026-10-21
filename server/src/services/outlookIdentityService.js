/**
 * Microsoft Entra ID (Outlook) Identity & JWT JWKS Verification Service
 * Implements Option A per Decision D0.1:
 * - Decodes and verifies id_token claims without extra Graph calls
 * - Verifies RS256 signatures against Microsoft tenant JWKS keyset
 * - Caches JWKS keys in memory with configurable TTL
 * - Extracts account email, display name, and tenant ID
 */

import crypto from 'node:crypto';

// In-memory JWKS cache: tenantId -> { keys: [], fetchedAt: number }
const jwksCache = new Map();
export const DEFAULT_JWKS_TTL_MS = 60 * 60 * 1000; // 1 hour

/**
 * Parses an unverified JWT into its header, payload, and raw signature.
 *
 * @param {string} token
 * @returns {{ header: object, payload: object, signature: Buffer, signedData: Buffer }}
 */
export function parseJwt(token) {
  if (!token || typeof token !== 'string') {
    throw new Error('JWT token must be a non-empty string');
  }

  const parts = token.trim().split('.');
  if (parts.length !== 3) {
    throw new Error(`Malformed JWT: expected 3 dot-separated segments, got ${parts.length}`);
  }

  let header;
  let payload;

  try {
    header = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8'));
  } catch (err) {
    throw new Error(`Failed to parse JWT header: ${err.message}`);
  }

  try {
    payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
  } catch (err) {
    throw new Error(`Failed to parse JWT payload: ${err.message}`);
  }

  const signature = Buffer.from(parts[2], 'base64url');
  const signedData = Buffer.from(`${parts[0]}.${parts[1]}`);

  return { header, payload, signature, signedData };
}

/**
 * Fetches or retrieves cached JWKS keyset for a Microsoft tenant.
 *
 * @param {string} [tenantId='common']
 * @param {object} [options]
 * @param {Function} [options.fetchFn=globalThis.fetch]
 * @param {number} [options.ttlMs]
 * @param {boolean} [options.forceRefresh=false]
 * @returns {Promise<Array<object>>}
 */
export async function getJwks(tenantId = 'common', options = {}) {
  const tenant = (tenantId || 'common').trim();
  const ttl = options.ttlMs || DEFAULT_JWKS_TTL_MS;
  const now = Date.now();

  const cached = jwksCache.get(tenant);
  if (cached && !options.forceRefresh && (now - cached.fetchedAt < ttl)) {
    return cached.keys;
  }

  const fetchFn = options.fetchFn || globalThis.fetch;
  if (typeof fetchFn !== 'function') {
    throw new Error('No fetch implementation available to retrieve JWKS');
  }

  const jwksUrl = options.jwksUri || `https://login.microsoftonline.com/${tenant}/discovery/v2.0/keys`;

  const res = await fetchFn(jwksUrl, {
    method: 'GET',
    headers: { 'Accept': 'application/json' },
    signal: AbortSignal.timeout(10000)
  });

  if (!res.ok) {
    throw new Error(`Failed to fetch JWKS from ${jwksUrl}: HTTP ${res.status}`);
  }

  const data = await res.json();
  const keys = Array.isArray(data.keys) ? data.keys : [];

  jwksCache.set(tenant, {
    keys,
    fetchedAt: now
  });

  return keys;
}

/**
 * Clears the in-memory JWKS cache (useful for testing or forced key rotation).
 */
export function clearJwksCache() {
  jwksCache.clear();
}

/**
 * Injects keys directly into the in-memory cache (primarily for unit tests).
 *
 * @param {string} tenantId
 * @param {Array<object>} keys
 */
export function setJwksCache(tenantId, keys) {
  jwksCache.set((tenantId || 'common').trim(), {
    keys: Array.isArray(keys) ? keys : [],
    fetchedAt: Date.now()
  });
}

/**
 * Verifies an id_token against Microsoft's JWKS and asserts required claims.
 *
 * @param {string} idToken - Raw JWT string
 * @param {object} options
 * @param {string} [options.nonce] - Expected nonce from state store
 * @param {string} [options.clientId] - Expected audience (OUTLOOK_CLIENT_ID)
 * @param {string} [options.tenantId='common']
 * @param {Array<object>} [options.keyset] - Explicit keyset override (bypasses network)
 * @param {Function} [options.fetchFn] - Fetch override
 * @returns {Promise<{ accountEmail: string, displayName: string, tenantId: string, claims: object }>}
 */
export async function verifyIdToken(idToken, options = {}) {
  const { header, payload, signature, signedData } = parseJwt(idToken);

  if (header.alg !== 'RS256') {
    throw new Error(`Unsupported JWT algorithm "${header.alg}". Expected RS256.`);
  }

  if (!header.kid) {
    throw new Error('JWT header missing required "kid" key identifier');
  }

  // 1. Obtain JWKS keys
  let keys = options.keyset;
  if (!keys) {
    keys = await getJwks(options.tenantId, {
      fetchFn: options.fetchFn,
      jwksUri: options.jwksUri
    });
  }

  let jwk = keys.find(k => k.kid === header.kid);

  // If not found in cache and network fetch is allowed, force a refresh once (key rollover)
  if (!jwk && !options.keyset && options.fetchFn) {
    keys = await getJwks(options.tenantId, {
      fetchFn: options.fetchFn,
      jwksUri: options.jwksUri,
      forceRefresh: true
    });
    jwk = keys.find(k => k.kid === header.kid);
  }

  if (!jwk) {
    throw new Error(`Signing key with kid "${header.kid}" not found in JWKS`);
  }

  // 2. Verify Cryptographic Signature
  let publicKey;
  try {
    publicKey = crypto.createPublicKey({ key: jwk, format: 'jwk' });
  } catch (err) {
    throw new Error(`Failed to create public key from JWK: ${err.message}`);
  }

  const isVerified = crypto.verify('SHA256', signedData, publicKey, signature);
  if (!isVerified) {
    throw new Error('Invalid JWT cryptographic signature');
  }

  // 3. Validate Claims
  const nowSec = Math.floor(Date.now() / 1000);

  // Expiration check (with 60-second clock skew tolerance)
  if (typeof payload.exp === 'number' && payload.exp < (nowSec - 60)) {
    throw new Error(`id_token has expired (exp: ${payload.exp}, now: ${nowSec})`);
  }

  // Nonce check
  if (options.nonce) {
    if (!payload.nonce) {
      throw new Error('id_token missing required nonce claim');
    }
    if (payload.nonce !== options.nonce) {
      throw new Error(`Nonce mismatch: expected "${options.nonce}", got "${payload.nonce}"`);
    }
  }

  // Audience check
  if (options.clientId) {
    const audMatches = Array.isArray(payload.aud)
      ? payload.aud.includes(options.clientId)
      : payload.aud === options.clientId;

    if (!audMatches) {
      throw new Error(`Audience mismatch: expected "${options.clientId}", got "${payload.aud}"`);
    }
  }

  // Issuer check
  if (options.issuer) {
    if (payload.iss !== options.issuer) {
      throw new Error(`Issuer mismatch: expected "${options.issuer}", got "${payload.iss}"`);
    }
  } else if (payload.iss && typeof payload.iss === 'string') {
    if (!payload.iss.startsWith('https://login.microsoftonline.com/')) {
      throw new Error(`Untrusted issuer: "${payload.iss}". Expected Microsoft Online issuer.`);
    }
  }

  // 4. Extract Identity Attributes
  const accountEmail = String(payload.preferred_username || payload.email || payload.upn || '').trim();
  if (!accountEmail) {
    throw new Error('id_token does not contain a recognizable email claim (preferred_username, email, or upn)');
  }

  const displayName = String(payload.name || payload.preferred_username || accountEmail).trim();
  const tenantId = String(payload.tid || options.tenantId || '').trim();

  return {
    accountEmail,
    displayName,
    tenantId,
    claims: payload
  };
}

export const outlookIdentityService = {
  parseJwt,
  getJwks,
  clearJwksCache,
  setJwksCache,
  verifyIdToken
};

export default outlookIdentityService;
