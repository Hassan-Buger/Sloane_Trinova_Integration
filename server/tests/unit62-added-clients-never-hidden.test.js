/**
 * Unit 62 Test Suite: a client the owner adds is never hidden
 *
 * The page hides old example records by their company number (12345678 and three others). That
 * rule must never hide a client the owner added by hand: such a client then looks as if it was
 * not saved, and cannot be removed. Verifies, in every place the rule is applied:
 * - the rule lets a client flagged addedInSloane through
 * - the server really does list a client added with one of those numbers (so the fault was in the page)
 */

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { createApp } from '../src/app.js';
import { mockDb } from '../src/data/db.js';
import { loginCookie } from './support.js';

const PORT = 5162;
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = f => fs.readFileSync(path.join(root, f), 'utf8');

describe('Unit 62: clients added by the owner are never hidden', () => {
  test('62.1 every place that hides the example company numbers lets an added client through', () => {
    let found = 0;
    for (const file of ['scripts/services/api.js', 'scripts/services/storage.js']) {
      const text = read(file);
      for (const m of text.matchAll(/return ([^;\n]*)\['12345678', '08923412', '11223344', '07788991'\]\.includes\(crn\);/g)) {
        found++;
        assert.match(m[1], /c\.addedInSloane \|\|\s*!$/, `${file}: the rule must start with "c.addedInSloane || !"`);
      }
    }
    assert.equal(found, 3, 'the rule is applied in three places');
  });

  describe('62.2 the server lists a client added with an example number', () => {
    let server; let baseUrl; let saved;
    before(async () => {
      saved = { clients: [...mockDb.clients], companies: [...mockDb.companies] };
      const app = createApp();
      await new Promise(resolve => { server = app.listen(PORT, () => { baseUrl = `http://localhost:${PORT}`; resolve(); }); });
    });
    after(async () => {
      if (server) await new Promise(resolve => server.close(resolve));
      mockDb.clients.length = 0; mockDb.clients.push(...saved.clients);
      mockDb.companies.length = 0; mockDb.companies.push(...saved.companies);
    });

    test('added with 12345678, listed, flagged as added in Sloane, and removable', async () => {
      const cookie = await loginCookie(baseUrl);
      const h = { Cookie: cookie, 'Content-Type': 'application/json', 'X-Requested-With': 'sloane', 'Idempotency-Key': crypto.randomUUID() };
      const made = await fetch(`${baseUrl}/api/v1/clients`, { method: 'POST', headers: h, body: JSON.stringify({ name: 'UNIT62 Example Number Ltd', companyNumber: '12345678', businessArea: 'TriNova Accounting' }) });
      assert.equal(made.status, 201);
      const list = await (await fetch(`${baseUrl}/api/v1/clients?search=UNIT62`, { headers: { Cookie: cookie } })).json();
      const row = list.data.find(c => c.name === 'UNIT62 Example Number Ltd');
      assert.ok(row, 'the server lists it');
      assert.equal(row.addedInSloane, true, 'it is flagged, so the page shows its remove button');
      const gone = await fetch(`${baseUrl}/api/v1/clients/${encodeURIComponent(row.id)}`, { method: 'DELETE', headers: { Cookie: cookie, 'X-Requested-With': 'sloane' } });
      assert.equal(gone.status, 200);
    });
  });
});
