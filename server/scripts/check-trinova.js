#!/usr/bin/env node
/**
 * Checks Sloane's connection to TriNova and writes down the SHAPE of what TriNova returns:
 * field names and kinds of value (text, number, date ...), never the real values. The one
 * exception is a short list of label fields (status, type, risk ...) whose values are not personal.
 * The report is safe to share; it holds no client names, emails or numbers.
 *
 * Run it in your own terminal (the key stays on your computer):
 *
 *   PowerShell:  $env:TRINOVA_API_KEY = "<your TriNova key>"; node server/scripts/check-trinova.js
 *   bash:        TRINOVA_API_KEY="<your TriNova key>" node server/scripts/check-trinova.js
 *
 * Optional: TRINOVA_API_URL (default https://portal.trinovaaccounting.co.uk/api/v1)
 * Output: printed here, and saved to server/data-private/trinova-shape.json (git-ignored).
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { shape } from './lib/describeShape.js';

const BASE = (process.env.TRINOVA_API_URL || 'https://portal.trinovaaccounting.co.uk/api/v1').trim().replace(/\/+$/, '');
const KEY = (process.env.TRINOVA_API_KEY || '').trim();
if (!KEY) {
  console.error('TRINOVA_API_KEY is not set. Set it in your own terminal (see the top of this file). Do not paste it anywhere else.');
  process.exit(1);
}

async function get(pathAndQuery, { auth = true } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);
  try {
    const res = await fetch(`${BASE}${pathAndQuery}`, {
      headers: { Accept: 'application/json', ...(auth ? { Authorization: `Bearer ${KEY}` } : {}) },
      signal: controller.signal
    });
    let json = null;
    try { json = await res.json(); } catch (_) { /* not JSON */ }
    return { status: res.status, ok: res.ok, json };
  } catch (err) {
    return { status: 0, ok: false, json: null, error: err.name === 'AbortError' ? 'no answer within 15 seconds' : err.message };
  } finally {
    clearTimeout(timer);
  }
}

const report = { checkedAt: new Date().toISOString(), base: BASE, steps: [] };

async function step(name, pathAndQuery, options) {
  const r = await get(pathAndQuery, options);
  const entry = { name, path: pathAndQuery, httpStatus: r.status, ok: r.ok };
  if (r.error) entry.problem = r.error;
  if (r.json) {
    entry.topLevelKeys = Object.keys(r.json);
    if (r.json.error) entry.error = { code: r.json.error.code, message: r.json.error.message };
    entry.shape = shape(r.json);
  }
  report.steps.push(entry);
  const mark = r.ok ? 'OK ' : 'FAIL';
  console.log(`${mark} ${String(r.status).padEnd(4)} ${name}  (${pathAndQuery})${r.error ? `  ${r.error}` : ''}${r.json?.error ? `  ${r.json.error.message}` : ''}`);
  return r;
}

console.log(`Checking TriNova at ${BASE}\n`);
await step('Is TriNova up? (no key needed)', '/health', { auth: false });
const who = await step('Is the key accepted?', '/auth/verify');

if (who.status === 401) {
  console.log('\nTriNova refused the key. It is missing, wrong, expired or revoked. Ask TriNova for a new one.');
} else {
  const clients = await step('Clients (first 2)', '/clients?per_page=2&page=1');
  await step('Clients, second page (does paging work?)', '/clients?per_page=2&page=2');
  await step('Deadlines feed', '/statutory');

  const first = Array.isArray(clients.json?.data) ? clients.json.data[0] : null;
  const companyId = first && ((first.companies && first.companies[0] && first.companies[0].id) || first.company_id || first.id);
  if (companyId !== undefined && companyId !== null) {
    const id = encodeURIComponent(String(companyId));
    await step('One company', `/companies/${id}`);
    await step('A company\'s documents', `/companies/${id}/documents`);
    await step('A company\'s signing requests', `/companies/${id}/signing-requests`);
  } else {
    console.log('\n(No client came back, so the single-company checks were skipped.)');
  }
}

const dir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../data-private');
fs.mkdirSync(dir, { recursive: true });
const file = path.join(dir, 'trinova-shape.json');
fs.writeFileSync(file, JSON.stringify(report, null, 2));
console.log(`\nSaved the report (field names only, no client data) to:\n  ${file}`);
