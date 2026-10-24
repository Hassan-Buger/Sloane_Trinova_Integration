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
import { runTrinovaCheck } from '../src/services/trinovaCheck.js';

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

console.log(`Checking TriNova at ${BASE}\n`);
const report = await runTrinovaCheck({ get, base: BASE, log: line => console.log(line) });

const dir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../data-private');
fs.mkdirSync(dir, { recursive: true });
const file = path.join(dir, 'trinova-shape.json');
fs.writeFileSync(file, JSON.stringify(report, null, 2));
console.log(`\nSaved the report (field names only, no client data) to:\n  ${file}`);
