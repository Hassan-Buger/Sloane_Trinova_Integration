/**
 * Unit 36 Test Suite: Deadlines (own dates) and VAT returns
 *
 * Verifies:
 * - The deadline list includes live TriNova clients that carry dates, and shows the date columns
 * - Deadlines can be added, changed and removed; own dates replace the TriNova date, and removing
 *   them brings the TriNova date back
 * - VAT returns can be added, changed and removed
 * - Validation, 404 and 409 answers are plain English, every change is audited
 * - The page is only labelled "example data" while example data is switched on
 */

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';

import { createApp } from '../src/app.js';
import { mockDb } from '../src/data/db.js';
import { auditStore } from '../src/middleware/audit.js';
import { clientDirectory } from '../src/services/clientDirectory.js';
import { TEST_API_KEY, TEST_READONLY_KEY } from './fixtures.js';

const PORT = 5036;
const auth = { Authorization: `Bearer ${TEST_API_KEY}`, 'Content-Type': 'application/json' };

describe('Unit 36: Deadlines and VAT returns', () => {
  let server;
  let baseUrl;
  const call = (method, path, body) =>
    fetch(`${baseUrl}/api/v1${path}`, { method, headers: auth, body: body ? JSON.stringify(body) : undefined });
  const lastAudit = () => auditStore.logs[0];

  before(async () => {
    clientDirectory.setTrinovaClients([
      { id: 'tn-2001', name: 'Dated Live Client Ltd', company_number: '66660001', financial_year_end: '2026-06-30', accounts_due: '2027-03-31', confirmation_statement_due: '2027-01-10' },
      { id: 'tn-2002', name: 'Individual With No Company', company_number: '' }
    ]);
    const app = createApp();
    await new Promise(resolve => {
      server = app.listen(PORT, () => {
        baseUrl = `http://localhost:${PORT}`;
        resolve();
      });
    });
  });

  after(async () => {
    clientDirectory.clearTrinova();
    if (server) await new Promise(resolve => server.close(resolve));
  });

  describe('1. The deadline list', () => {
    test('1.1 A live TriNova client with dates appears, with the date columns the page reads', async () => {
      const body = await (await call('GET', '/statutory')).json();
      const row = body.data.find(r => r.companyNumber === '66660001');
      assert.ok(row, 'live client appears');
      assert.equal(row.origin, 'trinova');
      assert.equal(row.accountsDueDate, '2027-03-31');
      assert.equal(row.confirmationDueDate, '2027-01-10');
      assert.equal(row.yearEnd, '2026-06-30');
      assert.equal(row.recordId, null);
      assert.match(row.id, /^derived:/);
      assert.equal(row.clientId, 'tn-2001');
    });

    test('1.2 A client with no dates and no company number is not listed as a deadline', async () => {
      const body = await (await call('GET', '/statutory')).json();
      assert.equal(body.data.find(r => r.clientId === 'tn-2002'), undefined);
    });

    test('1.3 The example rows have the same date columns and an id (so they can be edited)', async () => {
      const body = await (await call('GET', '/statutory')).json();
      const woof = body.data.find(r => r.companyNumber === '12345678');
      assert.ok(woof.id);
      assert.ok(woof.accountsDueDate);
      assert.ok(woof.yearEnd);
    });

    test('1.4 The page is labelled example data only while examples are on', async () => {
      const body = await (await call('GET', '/statutory')).json();
      assert.equal(body.meta.dataSource, 'sample');   // tests run with example data switched on
      assert.ok(['not_configured', 'ok', 'unreachable'].includes(body.meta.trinovaStatus));
    });
  });

  describe('2. Own deadlines', () => {
    let ownId;

    test('2.1 A deadline can be added by hand', async () => {
      const res = await call('POST', '/statutory/deadlines', {
        name: 'My Property Co', companyNumber: 'sc123456', accountsDueDate: '2027-05-01', confirmationDueDate: '2027-04-01', notes: 'Chase landlord'
      });
      assert.equal(res.status, 201);
      const d = (await res.json()).data;
      ownId = d.id;
      assert.equal(d.companyNumber, 'SC123456');
      assert.equal(lastAudit().action, 'deadline_created');
      const list = await (await call('GET', '/statutory')).json();
      const row = list.data.find(r => r.recordId === ownId);
      assert.equal(row.origin, 'manual');
      assert.equal(row.accountsDueDate, '2027-05-01');
    });

    test('2.2 The same company twice is a plain conflict', async () => {
      const res = await call('POST', '/statutory/deadlines', { name: 'Again', companyNumber: 'SC123456' });
      assert.equal(res.status, 409);
      assert.match((await res.json()).error.message, /already a saved deadline/);
    });

    test('2.3 A deadline can be changed', async () => {
      const res = await call('PATCH', `/statutory/deadlines/${ownId}`, { accountsDueDate: '2027-06-01', status: 'In progress' });
      assert.equal(res.status, 200);
      assert.equal((await res.json()).data.accountsDueDate, '2027-06-01');
      assert.equal(lastAudit().action, 'deadline_updated');
    });

    test('2.4 Bad dates, names and numbers are refused with plain messages', async () => {
      const cases = [
        [{ name: '', companyNumber: '1' }, /type the company or client name/i],
        [{ name: 'x', accountsDueDate: '31/12/2027' }, /accounts due date as a real date/],
        [{ name: 'x', confirmationDueDate: '2027-13-01' }, /yearly update due date as a real date/],
        [{ name: 'x', companyNumber: 'AB 12!' }, /only letters and numbers/]
      ];
      for (const [body, pattern] of cases) {
        const res = await call('POST', '/statutory/deadlines', body);
        assert.equal(res.status, 400, JSON.stringify(body));
        assert.match((await res.json()).error.message, pattern);
      }
    });

    test('2.5 Own dates replace the TriNova date for that company; removing them brings it back', async () => {
      const created = await call('POST', '/statutory/deadlines', {
        name: 'Dated Live Client Ltd', companyNumber: '66660001', clientId: 'tn-2001', accountsDueDate: '2027-09-09'
      });
      assert.equal(created.status, 201);
      const rec = (await created.json()).data;

      let list = await (await call('GET', '/statutory')).json();
      let row = list.data.find(r => r.companyNumber === '66660001');
      assert.equal(row.accountsDueDate, '2027-09-09');
      assert.equal(row.origin, 'manual');

      assert.equal((await call('DELETE', `/statutory/deadlines/${rec.id}`)).status, 200);
      list = await (await call('GET', '/statutory')).json();
      row = list.data.find(r => r.companyNumber === '66660001');
      assert.equal(row.accountsDueDate, '2027-03-31');
      assert.equal(row.origin, 'trinova');
    });

    test('2.6 An unknown client id is refused', async () => {
      const res = await call('POST', '/statutory/deadlines', { name: 'Ghost', clientId: 'ghost-id' });
      assert.equal(res.status, 422);
    });

    test('2.7 Example rows can be edited and removed too', async () => {
      const list = await (await call('GET', '/statutory')).json();
      const sample = list.data.find(r => r.companyNumber === '09876543');
      const res = await call('PATCH', `/statutory/deadlines/${sample.recordId}`, { notes: 'Edited by owner' });
      assert.equal(res.status, 200);
      assert.equal((await call('DELETE', `/statutory/deadlines/${sample.recordId}`)).status, 200);
      assert.equal(mockDb.statutoryTracker.find(r => r.companyNumber === '09876543'), undefined);
    });

    test('2.8 A deadline can be removed, then it is gone (plain 404)', async () => {
      const res = await call('DELETE', `/statutory/deadlines/${ownId}`);
      assert.equal(res.status, 200);
      assert.equal(lastAudit().action, 'deadline_deleted');
      const again = await call('DELETE', `/statutory/deadlines/${ownId}`);
      assert.equal(again.status, 404);
      assert.match((await again.json()).error.message, /already have been removed/);
      assert.equal((await call('PATCH', `/statutory/deadlines/${ownId}`, { name: 'x' })).status, 404);
    });

    test('2.9 Read-only keys cannot change deadlines', async () => {
      const ro = { Authorization: `Bearer ${TEST_READONLY_KEY}`, 'Content-Type': 'application/json' };
      const res = await fetch(`${baseUrl}/api/v1/statutory/deadlines`, { method: 'POST', headers: ro, body: JSON.stringify({ name: 'x' }) });
      assert.equal(res.status, 403);
    });
  });

  describe('3. VAT returns', () => {
    let vatId;

    test('3.1 Starts empty (no invented VAT dates)', async () => {
      const body = await (await call('GET', '/vat-returns')).json();
      assert.deepEqual(body.data, []);
    });

    test('3.2 A VAT return can be added', async () => {
      const res = await call('POST', '/vat-returns', { clientName: 'Dated Live Client Ltd', clientId: 'tn-2001', period: 'Jul to Sep 2026', dueDate: '2026-11-07' });
      assert.equal(res.status, 201);
      const vat = (await res.json()).data;
      vatId = vat.id;
      assert.equal(vat.status, 'Not started');
      assert.equal(lastAudit().action, 'vat_return_created');
    });

    test('3.3 Bad input is refused with plain messages', async () => {
      const cases = [
        [{ clientName: '', period: 'x', dueDate: '2026-11-07' }, /client this VAT return is for/],
        [{ clientName: 'x', period: '', dueDate: '2026-11-07' }, /which period/],
        [{ clientName: 'x', period: 'x', dueDate: '07/11/2026' }, /due date as a real date/],
        [{ clientName: 'x', period: 'x', dueDate: '2026-11-07', status: 'Done' }, /Status must be one of/]
      ];
      for (const [body, pattern] of cases) {
        const res = await call('POST', '/vat-returns', body);
        assert.equal(res.status, 400, JSON.stringify(body));
        assert.match((await res.json()).error.message, pattern);
      }
    });

    test('3.4 It can be changed (marked as filed) and the list is sorted by due date', async () => {
      await call('POST', '/vat-returns', { clientName: 'Earlier Co', period: 'Q1', dueDate: '2026-08-07' });
      const res = await call('PATCH', `/vat-returns/${vatId}`, { status: 'Filed' });
      assert.equal(res.status, 200);
      assert.equal(lastAudit().action, 'vat_return_updated');
      const list = (await (await call('GET', '/vat-returns')).json()).data;
      assert.deepEqual(list.map(v => v.dueDate), [...list.map(v => v.dueDate)].sort());
      assert.equal(list.find(v => v.id === vatId).status, 'Filed');
    });

    test('3.5 It can be removed, then it is gone (plain 404)', async () => {
      assert.equal((await call('DELETE', `/vat-returns/${vatId}`)).status, 200);
      assert.equal(lastAudit().action, 'vat_return_deleted');
      const again = await call('DELETE', `/vat-returns/${vatId}`);
      assert.equal(again.status, 404);
      assert.match((await again.json()).error.message, /already have been removed/);
    });
  });
});
