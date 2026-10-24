/**
 * Unit 42 Test Suite: The TriNova connection check never reveals client data
 *
 * Verifies the shape report (which the owner may share) holds field names and kinds only:
 * no names, emails, numbers, dates or ids.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { shape } from '../scripts/lib/describeShape.js';

describe('Unit 42: TriNova check reports shape, not data', () => {
  const sample = {
    status: 'success',
    data: [{
      id: 8841,
      name: 'Jane Q. Customer Ltd',
      email: 'jane@customer-secret.example',
      company_number: '09876543',
      accounts_due: '2027-03-31',
      vat_registered: true,
      risk_tier: 'High',
      directors: ['Jane Customer', 'Bob Customer'],
      primary_contact: { name: 'Jane Customer', phone: '+44 7700 900123' },
      companies: [{ id: 'comp-77', companyName: 'Jane Q. Customer Ltd', accountsDueDate: '2027-03-31' }],
      notes: ''
    }],
    pagination: { page: 1, pageSize: 2, total: 31, hasMore: true }
  };

  test('1. No personal value appears anywhere in the report', () => {
    const text = JSON.stringify(shape(sample));
    for (const secret of ['Jane', 'Customer', 'customer-secret', '09876543', '2027-03-31', '8841', '7700', 'comp-77', 'Bob']) {
      assert.ok(!text.includes(secret), `"${secret}" must not appear`);
    }
  });

  test('2. Field names and kinds of value are kept, so the structure can be understood', () => {
    const s = shape(sample);
    assert.deepEqual(Object.keys(s.data.firstItem), Object.keys(sample.data[0]));
    assert.equal(s.data.firstItem.id, 'number');
    assert.equal(s.data.firstItem.accounts_due, 'date');
    assert.match(s.data.firstItem.name, /^text \(\d+ characters\)$/);
    assert.match(s.data.firstItem.vat_registered, /^yes\/no/);
    assert.equal(s.data.firstItem.notes, 'text (empty)');
    assert.equal(s.data.list, '1 item(s)');
    assert.equal(s.pagination.hasMore.startsWith('yes/no'), true);
  });

  test('3. Only a short list of label fields shows its value (such as a risk level)', () => {
    const s = shape(sample);
    assert.equal(s.data.firstItem.risk_tier, 'label: "High"');
    assert.equal(s.status, 'label: "success"');
    // a long value in a label field is still hidden
    assert.match(shape({ status: 'x'.repeat(60) }).status, /^text \(60 characters\)$/);
  });

  test('4. Empty and missing values are described, not guessed', () => {
    assert.equal(shape(null), 'empty');
    assert.equal(shape(undefined), 'empty');
    assert.equal(shape([]), 'list (empty)');
  });

  test('5. The script reads the key from the environment and never prints it', async () => {
    const fs = await import('node:fs');
    const src = fs.readFileSync(new URL('../scripts/check-trinova.js', import.meta.url), 'utf8');
    assert.match(src, /process\.env\.TRINOVA_API_KEY/);
    assert.doesNotMatch(src, /console\.(log|error)\([^)]*\bKEY\b[^)]*\)/, 'the key is never logged');
    assert.doesNotMatch(src, /tn_sec_live/);
  });
});
