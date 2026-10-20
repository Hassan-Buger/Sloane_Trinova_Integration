/**
 * Outlook OAuth 2.0 PKCE & Ephemeral State Store
 * Implements S256 PKCE generation and single-use 10-minute TTL state binding
 * for cross-site authorization redirects.
 */

import crypto from 'node:crypto';

// In-memory store: state -> { state, codeVerifier, codeChallenge, nonce, actorId, createdAt, expiresAt }
const stateStore = new Map();

export const DEFAULT_TTL_MS = 10 * 60 * 1000; // 10 minutes

/**
 * Generates a cryptographically secure high-entropy PKCE code verifier (43-128 chars base64url).
 *
 * @param {number} [byteLength=32]
 * @returns {string} Base64url encoded code verifier
 */
export function generateCodeVerifier(byteLength = 32) {
  return crypto.randomBytes(byteLength).toString('base64url');
}

/**
 * Derives the S256 PKCE code challenge from a code verifier.
 *
 * @param {string} verifier
 * @returns {string} Base64url encoded SHA-256 hash
 */
export function generateCodeChallenge(verifier) {
  if (!verifier || typeof verifier !== 'string') {
    throw new Error('Code verifier must be a non-empty string');
  }
  return crypto.createHash('sha256').update(verifier).digest('base64url');
}

/**
 * Generates a high-entropy OAuth state parameter (32 random bytes, base64url).
 *
 * @returns {string}
 */
export function generateState() {
  return crypto.randomBytes(32).toString('base64url');
}

/**
 * Generates an OpenID Connect nonce.
 *
 * @returns {string}
 */
export function generateNonce() {
  return crypto.randomBytes(16).toString('base64url');
}

/**
 * Creates and stores a new PKCE + state entry bound to an actor.
 *
 * @param {object} params
 * @param {string} params.actorId - Authenticated session actor ID
 * @param {number} [params.ttlMs=600000] - Time to live in ms (default 10m)
 * @returns {{ state: string, codeVerifier: string, codeChallenge: string, nonce: string, actorId: string, expiresAt: number }}
 */
export function createStateEntry({ actorId, ttlMs = DEFAULT_TTL_MS }) {
  if (!actorId || typeof actorId !== 'string') {
    throw new Error('actorId is required to bind OAuth state parameter');
  }

  // Periodic cleanup of expired entries
  cleanupExpired();

  const state = generateState();
  const codeVerifier = generateCodeVerifier();
  const codeChallenge = generateCodeChallenge(codeVerifier);
  const nonce = generateNonce();
  const createdAt = Date.now();
  const expiresAt = createdAt + ttlMs;

  const entry = {
    state,
    codeVerifier,
    codeChallenge,
    nonce,
    actorId: actorId.trim(),
    createdAt,
    expiresAt
  };

  stateStore.set(state, entry);

  return entry;
}

/**
 * Consumes an OAuth state parameter exactly once.
 * Deletes the entry immediately upon lookup to prevent replay attacks and double-clicks.
 *
 * @param {string} state
 * @returns {{ valid: boolean, data?: object, error?: string, message?: string }}
 */
export function consumeState(state) {
  if (!state || typeof state !== 'string') {
    return {
      valid: false,
      error: 'INVALID_STATE',
      message: 'OAuth state parameter is missing or malformed'
    };
  }

  const trimmedState = state.trim();
  const entry = stateStore.get(trimmedState);

  // Single-use: immediately delete regardless of validity to prevent reuse attempts
  if (entry) {
    stateStore.delete(trimmedState);
  } else {
    return {
      valid: false,
      error: 'UNKNOWN_STATE',
      message: 'This sign-in link is invalid or has already been used'
    };
  }

  // Check TTL expiration
  if (Date.now() > entry.expiresAt) {
    return {
      valid: false,
      error: 'EXPIRED_STATE',
      message: 'Sign-in session expired (10-minute limit exceeded). Please try connecting again.'
    };
  }

  return {
    valid: true,
    data: entry
  };
}

/**
 * Purges all expired entries from memory.
 *
 * @returns {number} Count of pruned records
 */
export function cleanupExpired() {
  const now = Date.now();
  let pruned = 0;
  for (const [key, entry] of stateStore.entries()) {
    if (now > entry.expiresAt) {
      stateStore.delete(key);
      pruned++;
    }
  }
  return pruned;
}

/**
 * Clears all entries from the store (primarily for unit test isolation).
 */
export function clearStore() {
  stateStore.clear();
}

/**
 * Returns current store size.
 *
 * @returns {number}
 */
export function getStoreSize() {
  return stateStore.size;
}

export const outlookOAuthStateStore = {
  DEFAULT_TTL_MS,
  generateCodeVerifier,
  generateCodeChallenge,
  generateState,
  generateNonce,
  createStateEntry,
  consumeState,
  cleanupExpired,
  clearStore,
  getStoreSize
};

export default outlookOAuthStateStore;
