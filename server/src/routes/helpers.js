/**
 * Small helpers shared by the route files, so every create / update / delete answers in the
 * same plain-English shape: { error: { code, message } }.
 */

import crypto from 'node:crypto';

/** Sends a plain error response. */
export function sendError(res, status, code, message) {
  return res.status(status).json({ error: { code, message } });
}

/** A new record id such as `tsk_1792826055918_a1b2`. */
export function newId(prefix) {
  return `${prefix}_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`;
}

/** True for a real calendar date written YYYY-MM-DD. */
export function isIsoDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const d = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().startsWith(value);
}

/** Trims a value to a string, or returns '' when it is not text. */
export function cleanText(value) {
  return typeof value === 'string' ? value.trim() : '';
}

/**
 * Only the signed-in owner (a browser session) may use these routes. A server-to-server API
 * key is refused, so private notes can never be read by an integration.
 */
export function requireSession(req, res, next) {
  if (!req.session) {
    return sendError(res, 403, 'SESSION_REQUIRED', 'Private notes can only be opened while you are signed in to Sloane.');
  }
  return next();
}
