/**
 * Two-step sign-in for the owner: password + a 6-digit code from an authenticator app.
 *
 * What is stored (in the saved "security" collection, one record for the owner):
 * - the authenticator secret, encrypted (AES-256-GCM, key derived from STORAGE_PRESIGNED_TOKEN_SECRET,
 *   or TWO_FACTOR_ENC_KEY when set)
 * - recovery codes, as SHA-256 hashes only
 * - trusted browsers ("Trust this browser for 30 days"), as SHA-256 hashes of a random token kept
 *   in an HttpOnly cookie, with a label, dates and the last time each was used
 * - the last code step used, so a code cannot be used twice
 *
 * Sign-in challenges (password accepted, code still needed) live only in memory for 5 minutes,
 * and allow 5 tries.
 *
 * Emergency switch: TWO_FACTOR_RESET=true on the server turns two-step sign-in off at start-up
 * (for the developer, if the owner loses both the phone and the recovery codes).
 */

import crypto from 'node:crypto';
import { mockDb } from '../data/db.js';
import { generateSecret, verifyCode, otpauthUri, stepAt } from './totp.js';
import { qrSvg } from './qrcode.js';

export const TRUST_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;
const CHALLENGE_TTL_MS = 5 * 60 * 1000;
const CHALLENGE_TRIES = 5;
const PENDING_TTL_MS = 15 * 60 * 1000;
const RECOVERY_CODE_COUNT = 10;
const MAX_TRUSTED = 10;
export const TRUST_COOKIE = 'slon_trusted';

const sha256 = text => crypto.createHash('sha256').update(String(text)).digest('hex');

/* ---------------- encryption of the authenticator secret ---------------- */

function encryptionKey() {
  const material = (process.env.TWO_FACTOR_ENC_KEY || process.env.STORAGE_PRESIGNED_TOKEN_SECRET ||
    process.env.SLON_TOKEN_SECRET || process.env.SLON_API_KEY || process.env.SLOANE_API_KEY || '').trim();
  if (!material) throw new Error('Two-step sign-in needs a server secret (STORAGE_PRESIGNED_TOKEN_SECRET) to keep the authenticator key safe.');
  return Buffer.from(crypto.hkdfSync('sha256', material, 'sloane-two-factor', 'authenticator secret', 32));
}

function encrypt(text) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', encryptionKey(), iv);
  const data = Buffer.concat([cipher.update(String(text), 'utf8'), cipher.final()]);
  return `v1.${iv.toString('base64')}.${cipher.getAuthTag().toString('base64')}.${data.toString('base64')}`;
}

function decrypt(packed) {
  const [v, iv, tag, data] = String(packed || '').split('.');
  if (v !== 'v1') throw new Error('Unknown format');
  const decipher = crypto.createDecipheriv('aes-256-gcm', encryptionKey(), Buffer.from(iv, 'base64'));
  decipher.setAuthTag(Buffer.from(tag, 'base64'));
  return Buffer.concat([decipher.update(Buffer.from(data, 'base64')), decipher.final()]).toString('utf8');
}

/* ---------------- the owner's security record ---------------- */

function ownerKey(email) {
  return `owner:${String(email || '').trim().toLowerCase()}`;
}

function record(email, create = false) {
  if (!Array.isArray(mockDb.security)) mockDb.security = [];
  const id = ownerKey(email);
  let rec = mockDb.security.find(r => r.id === id);
  if (!rec && create) {
    rec = { id, enabled: false, secretEnc: null, enabledAt: null, lastUsedStep: null, recoveryCodes: [], trustedBrowsers: [], pending: null };
    mockDb.security.push(rec);
  }
  return rec || null;
}

export function isEnabled(email) {
  const rec = record(email);
  return Boolean(rec && rec.enabled && rec.secretEnc);
}

/* ---------------- recovery codes ---------------- */

function newRecoveryCodes() {
  const codes = [];
  for (let i = 0; i < RECOVERY_CODE_COUNT; i++) {
    const raw = crypto.randomBytes(5).toString('hex').toUpperCase(); // 10 characters
    codes.push(`${raw.slice(0, 5)}-${raw.slice(5)}`);
  }
  return codes;
}

function normaliseRecovery(code) {
  return String(code || '').toUpperCase().replace(/[^0-9A-F]/g, '');
}

/** Uses a recovery code if it is valid and unused. */
function useRecoveryCode(rec, code) {
  const clean = normaliseRecovery(code);
  if (clean.length !== 10) return false;
  const hash = sha256(clean);
  const entry = (rec.recoveryCodes || []).find(c => c.hash === hash && !c.usedAt);
  if (!entry) return false;
  entry.usedAt = new Date().toISOString();
  return true;
}

/** Checks a 6-digit code or a recovery code. Returns 'app', 'recovery' or null. */
function checkCode(rec, code) {
  const clean = String(code || '').trim();
  if (/^\d{6}$/.test(clean.replace(/\s/g, ''))) {
    let secret;
    try { secret = decrypt(rec.secretEnc); } catch (_) { return null; }
    const step = verifyCode(secret, clean, { lastUsedStep: rec.lastUsedStep });
    if (step === null) return null;
    rec.lastUsedStep = step;
    return 'app';
  }
  return useRecoveryCode(rec, clean) ? 'recovery' : null;
}

/* ---------------- set-up, confirm, turn off ---------------- */

/** Starts set-up: a new secret (not active until confirmed with a code). */
export function startSetup(email) {
  const rec = record(email, true);
  const secret = generateSecret();
  rec.pending = { secretEnc: encrypt(secret), createdAt: new Date().toISOString() };
  const uri = otpauthUri({ secret, account: email });
  return { secret: secret.replace(/(.{4})/g, '$1 ').trim(), uri, qrSvg: qrSvg(uri, { moduleSize: 5 }) };
}

/** Confirms set-up with the first code from the app; turns two-step sign-in on. */
export function confirmSetup(email, code) {
  const rec = record(email);
  if (!rec || !rec.pending) return { error: 'Please start the set-up again.' };
  if (Date.now() - Date.parse(rec.pending.createdAt) > PENDING_TTL_MS) {
    rec.pending = null;
    return { error: 'The set-up took too long. Please start again.' };
  }
  let secret;
  try { secret = decrypt(rec.pending.secretEnc); } catch (_) { return { error: 'Please start the set-up again.' }; }
  const step = verifyCode(secret, code);
  if (step === null) return { error: 'That code is not right. Check the 6 digits in your authenticator app, and that your phone\'s clock is set automatically.' };
  const codes = newRecoveryCodes();
  rec.secretEnc = rec.pending.secretEnc;
  rec.pending = null;
  rec.enabled = true;
  rec.enabledAt = new Date().toISOString();
  rec.lastUsedStep = step;
  rec.recoveryCodes = codes.map(c => ({ hash: sha256(normaliseRecovery(c)), usedAt: null }));
  return { recoveryCodes: codes };
}

/** New recovery codes (the old ones stop working). Needs a current code. */
export function regenerateRecoveryCodes(email, code) {
  const rec = record(email);
  if (!isEnabled(email)) return { error: 'Two-step sign-in is not switched on.' };
  if (!checkCode(rec, code)) return { error: 'That code is not right.' };
  const codes = newRecoveryCodes();
  rec.recoveryCodes = codes.map(c => ({ hash: sha256(normaliseRecovery(c)), usedAt: null }));
  return { recoveryCodes: codes };
}

/** Turns two-step sign-in off. Needs a current code (or a recovery code). */
export function disable(email, code) {
  const rec = record(email);
  if (!isEnabled(email)) return { error: 'Two-step sign-in is already off.' };
  if (!checkCode(rec, code)) return { error: 'That code is not right.' };
  Object.assign(rec, { enabled: false, secretEnc: null, enabledAt: null, lastUsedStep: null, recoveryCodes: [], trustedBrowsers: [], pending: null });
  return { ok: true };
}

/** The emergency switch (TWO_FACTOR_RESET=true). */
export function resetAll() {
  if (!Array.isArray(mockDb.security)) return 0;
  const n = mockDb.security.filter(r => r.enabled).length;
  for (const rec of mockDb.security) {
    Object.assign(rec, { enabled: false, secretEnc: null, enabledAt: null, lastUsedStep: null, recoveryCodes: [], trustedBrowsers: [], pending: null });
  }
  return n;
}

/* ---------------- trusted browsers ---------------- */

/** A short, plain name for a browser from its User-Agent ("Edge on Windows"). */
export function browserLabel(userAgent = '') {
  const ua = String(userAgent);
  const browser = /Edg\//.test(ua) ? 'Edge' : /OPR\//.test(ua) ? 'Opera' : /Firefox\//.test(ua) ? 'Firefox'
    : /Chrome\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : 'A browser';
  const os = /Windows/.test(ua) ? 'Windows' : /iPhone|iPad/.test(ua) ? 'iPhone or iPad' : /Android/.test(ua) ? 'Android'
    : /Mac OS X|Macintosh/.test(ua) ? 'Mac' : /Linux/.test(ua) ? 'Linux' : '';
  return os ? `${browser} on ${os}` : browser;
}

/** Remembers this browser for 30 days. Returns the token for the cookie. */
export function trustBrowser(email, userAgent) {
  const rec = record(email, true);
  const token = crypto.randomBytes(32).toString('base64url');
  const now = Date.now();
  rec.trustedBrowsers = (rec.trustedBrowsers || []).filter(t => Date.parse(t.expiresAt) > now);
  rec.trustedBrowsers.push({
    id: crypto.randomBytes(6).toString('hex'),
    tokenHash: sha256(token),
    label: browserLabel(userAgent),
    createdAt: new Date(now).toISOString(),
    expiresAt: new Date(now + TRUST_DAYS * DAY_MS).toISOString(),
    lastUsedAt: new Date(now).toISOString()
  });
  // Keep the newest few
  rec.trustedBrowsers = rec.trustedBrowsers.slice(-MAX_TRUSTED);
  return token;
}

/** True if the cookie token belongs to a trusted browser that has not expired. */
export function isTrustedBrowser(email, token) {
  if (!token) return false;
  const rec = record(email);
  if (!rec) return false;
  const hash = sha256(token);
  const entry = (rec.trustedBrowsers || []).find(t => t.tokenHash === hash);
  if (!entry || Date.parse(entry.expiresAt) <= Date.now()) return false;
  entry.lastUsedAt = new Date().toISOString();
  return true;
}

export function forgetBrowser(email, id) {
  const rec = record(email);
  if (!rec) return false;
  const before = (rec.trustedBrowsers || []).length;
  rec.trustedBrowsers = (rec.trustedBrowsers || []).filter(t => t.id !== id);
  return rec.trustedBrowsers.length < before;
}

export function forgetAllBrowsers(email) {
  const rec = record(email);
  if (!rec) return 0;
  const n = (rec.trustedBrowsers || []).length;
  rec.trustedBrowsers = [];
  return n;
}

/** What Settings shows. `currentToken` marks "this browser". */
export function status(email, currentToken = null) {
  const rec = record(email);
  const now = Date.now();
  const currentHash = currentToken ? sha256(currentToken) : null;
  return {
    enabled: isEnabled(email),
    enabledAt: rec?.enabledAt || null,
    recoveryCodesLeft: rec ? (rec.recoveryCodes || []).filter(c => !c.usedAt).length : 0,
    trustDays: TRUST_DAYS,
    trustedBrowsers: (rec?.trustedBrowsers || [])
      .filter(t => Date.parse(t.expiresAt) > now)
      .map(t => ({ id: t.id, label: t.label, createdAt: t.createdAt, lastUsedAt: t.lastUsedAt, expiresAt: t.expiresAt, current: t.tokenHash === currentHash }))
  };
}

/* ---------------- sign-in challenges ---------------- */

const challenges = new Map();

export function createChallenge(user) {
  const now = Date.now();
  for (const [id, c] of challenges) if (now - c.createdAt > CHALLENGE_TTL_MS) challenges.delete(id);
  const id = crypto.randomBytes(24).toString('base64url');
  challenges.set(id, { user, createdAt: now, tries: 0 });
  return id;
}

/**
 * Finishes a sign-in with the code. Returns { user, method } or { error, expired }.
 */
export function completeChallenge(id, code) {
  const c = challenges.get(id);
  if (!c || Date.now() - c.createdAt > CHALLENGE_TTL_MS) {
    challenges.delete(id);
    return { error: 'That sign-in took too long. Please type your email and password again.', expired: true };
  }
  c.tries++;
  const rec = record(c.user.email);
  const method = rec && isEnabled(c.user.email) ? checkCode(rec, code) : null;
  if (!method) {
    if (c.tries >= CHALLENGE_TRIES) {
      challenges.delete(id);
      return { error: 'Too many wrong codes. Please type your email and password again.', expired: true };
    }
    return { error: 'That code is not right. Type the 6 digits your authenticator app shows now, or one of your recovery codes.' };
  }
  challenges.delete(id);
  return { user: c.user, method };
}

// For the tests
export const _internals = { encrypt, decrypt, challenges, sha256, stepAt };
