/**
 * Authenticator-app codes (TOTP, RFC 6238): the 6-digit codes that Microsoft Authenticator,
 * Google Authenticator, 1Password and others show, changing every 30 seconds.
 * Built on Node's crypto only.
 */

import crypto from 'node:crypto';

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
export const STEP_SECONDS = 30;
export const DIGITS = 6;

export function base32Encode(buf) {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(text) {
  const clean = String(text || '').toUpperCase().replace(/[\s=-]/g, '');
  let bits = 0;
  let value = 0;
  const out = [];
  for (const ch of clean) {
    const idx = ALPHABET.indexOf(ch);
    if (idx === -1) throw new Error('Not a valid setup key.');
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

/** A new random secret (160 bits), as the base32 text authenticator apps use. */
export function generateSecret() {
  return base32Encode(crypto.randomBytes(20));
}

/** The time step (30-second window number) for a moment in time. */
export function stepAt(ms = Date.now()) {
  return Math.floor(ms / 1000 / STEP_SECONDS);
}

/** The code for one time step. `digits` is 6 for the apps; 8 is used by the RFC test values. */
export function codeForStep(secret, step, digits = DIGITS) {
  const key = Buffer.isBuffer(secret) ? secret : base32Decode(secret);
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(step));
  const hmac = crypto.createHmac('sha1', key).update(counter).digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  const binary = ((hmac[offset] & 0x7f) << 24) | (hmac[offset + 1] << 16) | (hmac[offset + 2] << 8) | hmac[offset + 3];
  return String(binary % 10 ** digits).padStart(digits, '0');
}

/**
 * Checks a code, allowing one step either side for a phone clock that is slightly off.
 * Refuses a code from a step at or before `lastUsedStep`, so a code cannot be used twice.
 * Returns the step that matched, or null.
 */
export function verifyCode(secret, code, { now = Date.now(), window = 1, lastUsedStep = null } = {}) {
  const clean = String(code || '').replace(/\s/g, '');
  if (!/^\d{6}$/.test(clean)) return null;
  const current = stepAt(now);
  for (let d = -window; d <= window; d++) {
    const step = current + d;
    if (lastUsedStep !== null && step <= lastUsedStep) continue;
    const expected = codeForStep(secret, step);
    if (crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(clean))) return step;
  }
  return null;
}

/**
 * The otpauth:// address that the QR code holds (and that a phone can open directly).
 * SHA1, 6 digits and 30 seconds are the defaults every app assumes, so they are left out to
 * keep the QR code small and easy to scan.
 */
export function otpauthUri({ secret, account, issuer = 'Sloane' }) {
  const label = `${encodeURIComponent(issuer)}:${encodeURIComponent(account)}`;
  return `otpauth://totp/${label}?secret=${secret}&issuer=${encodeURIComponent(issuer)}`;
}
