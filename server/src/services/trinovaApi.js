/**
 * One small helper for reading from the TriNova portal's API with Sloane's TriNova key.
 * The key never leaves the server: the browser only ever talks to Sloane.
 */

import { config } from '../config.js';

/**
 * GET a TriNova path. Never throws.
 * @returns {Promise<{status:number, ok:boolean, json:any, error?:string}>}
 */
export async function trinovaGet(pathAndQuery, { auth = true, timeoutMs } = {}) {
  const { baseUrl, apiKey, timeoutMs: defaultTimeout } = config.trinova;
  const limit = timeoutMs || defaultTimeout || 8000;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), limit);
  try {
    const res = await fetch(`${baseUrl}${pathAndQuery}`, {
      headers: {
        Accept: 'application/json',
        'X-Requested-With': 'sloane',
        ...(auth && apiKey ? { Authorization: `Bearer ${apiKey}` } : {})
      },
      signal: controller.signal
    });
    let json = null;
    try { json = await res.json(); } catch (_) { /* not JSON */ }
    return { status: res.status, ok: res.ok, json };
  } catch (err) {
    return {
      status: 0,
      ok: false,
      json: null,
      error: err.name === 'AbortError' ? `no answer within ${Math.round(limit / 1000)} seconds` : err.message
    };
  } finally {
    clearTimeout(timer);
  }
}
