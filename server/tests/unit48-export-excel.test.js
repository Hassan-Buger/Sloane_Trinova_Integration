/**
 * Unit 48 Test Suite: "Download a copy of everything" (Excel)
 *
 * Verifies:
 * - Only the signed-in owner can download it (it holds private notes); an API key gets 403
 * - The file is a real .xlsx: a valid zip whose parts Excel needs are all there and well-formed
 * - It has one sheet per kind of record, with the owner's records in plain words
 * - Dates are real Excel dates; text is never written as a formula
 * - Nothing internal leaks (storage paths, disk ids, keys)
 * - The zip writer and date conversion work on their own
 */

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import zlib from 'node:zlib';
import { randomUUID } from 'node:crypto';

import { createApp } from '../src/app.js';
import { mockDb } from '../src/data/db.js';
import { buildXlsx, toExcelDate, columnLetter, zip } from '../src/services/xlsx.js';
import { TEST_API_KEY } from './fixtures.js';
import { loginCookie } from './support.js';

const PORT = 5048;

/** Reads every file in a zip (deflate or stored) from its central directory. */
function unzip(buf) {
  const files = {};
  let end = buf.length - 22;
  while (end >= 0 && buf.readUInt32LE(end) !== 0x06054b50) end--;
  assert.ok(end >= 0, 'zip has an end record');
  const count = buf.readUInt16LE(end + 10);
  let p = buf.readUInt32LE(end + 16);
  for (let i = 0; i < count; i++) {
    assert.equal(buf.readUInt32LE(p), 0x02014b50, 'central directory entry');
    const method = buf.readUInt16LE(p + 10);
    const crc = buf.readUInt32LE(p + 16);
    const csize = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const localOffset = buf.readUInt32LE(p + 42);
    const name = buf.slice(p + 46, p + 46 + nameLen).toString('utf8');
    const lNameLen = buf.readUInt16LE(localOffset + 26);
    const lExtraLen = buf.readUInt16LE(localOffset + 28);
    const start = localOffset + 30 + lNameLen + lExtraLen;
    const raw = buf.slice(start, start + csize);
    const data = method === 8 ? zlib.inflateRawSync(raw) : raw;
    assert.equal(zlib.crc32(data) >>> 0, crc, `crc of ${name}`);
    files[name] = data.toString('utf8');
    p += 46 + nameLen + extraLen + commentLen;
  }
  return files;
}

/** Very small XML well-formedness check: tags open and close in order. */
function wellFormed(xmlText) {
  const stack = [];
  const re = /<(\/?)([A-Za-z_][\w:.-]*)([^>]*?)(\/?)>/g;
  let m;
  while ((m = re.exec(xmlText))) {
    if (m[0].startsWith('<?')) continue;
    const [, closing, tag, , selfClosing] = m;
    if (selfClosing) continue;
    if (closing) {
      if (stack.pop() !== tag) return false;
    } else {
      stack.push(tag);
    }
  }
  return stack.length === 0;
}

describe('Unit 48: Download a copy of everything (Excel)', () => {
  let server;
  let baseUrl;
  let cookie;

  before(async () => {
    const app = createApp();
    await new Promise(resolve => {
      server = app.listen(PORT, () => {
        baseUrl = `http://localhost:${PORT}`;
        resolve();
      });
    });
    cookie = await loginCookie(baseUrl);
    const json = { 'Content-Type': 'application/json', Cookie: cookie };
    // Records with awkward text: formula-like, XML special characters, line breaks
    await fetch(`${baseUrl}/api/v1/clients`, { method: 'POST', headers: json, body: JSON.stringify({ name: 'Export & <Test> Ltd', no: 'EX480001', accounts: '2027-03-31' }) });
    await fetch(`${baseUrl}/api/v1/tasks`, { method: 'POST', headers: { ...json, 'Idempotency-Key': randomUUID() }, body: JSON.stringify({ title: '=SUM(A1:A9) not a formula', general: true, dueDate: '2027-01-15' }) });
    await fetch(`${baseUrl}/api/v1/ceo-notes`, { method: 'POST', headers: json, body: JSON.stringify({ text: 'Export private thought\nsecond line' }) });
  });

  after(async () => {
    if (server) await new Promise(resolve => server.close(resolve));
  });

  test('48.1 only the signed-in owner can download it', async () => {
    const key = await fetch(`${baseUrl}/api/v1/export/excel`, { headers: { Authorization: `Bearer ${TEST_API_KEY}` } });
    assert.equal(key.status, 403);
    const anon = await fetch(`${baseUrl}/api/v1/export/excel`);
    assert.equal(anon.status, 401);
  });

  test('48.2 the download is a real Excel file with every sheet, in plain words', async () => {
    const res = await fetch(`${baseUrl}/api/v1/export/excel`, { headers: { Cookie: cookie } });
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('content-type'), 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    assert.match(res.headers.get('content-disposition'), /attachment; filename="sloane-copy-\d{4}-\d{2}-\d{2}\.xlsx"/);
    assert.equal(res.headers.get('cache-control'), 'no-store');

    const buf = Buffer.from(await res.arrayBuffer());
    assert.equal(buf.readUInt32LE(0), 0x04034b50, 'starts like a zip');
    const files = unzip(buf);
    for (const part of ['[Content_Types].xml', '_rels/.rels', 'xl/workbook.xml', 'xl/_rels/workbook.xml.rels', 'xl/styles.xml', 'xl/worksheets/sheet1.xml']) {
      assert.ok(files[part], `${part} is in the file`);
    }
    for (const [name, text] of Object.entries(files)) assert.ok(wellFormed(text), `${name} is well-formed XML`);

    const sheetNames = [...files['xl/workbook.xml'].matchAll(/<sheet name="([^"]+)"/g)].map(m => m[1]);
    assert.deepEqual(sheetNames, ['About this file', 'Clients', 'Deadlines', 'VAT returns', 'Tasks', 'Team', 'Businesses',
      'Client notes', 'Documents', 'History', 'Signing requests', 'Private notes', 'Bin']);
    const sheetCount = Object.keys(files).filter(n => n.startsWith('xl/worksheets/sheet')).length;
    assert.equal(sheetCount, sheetNames.length);

    const sheet = n => files[`xl/worksheets/sheet${sheetNames.indexOf(n) + 1}.xml`];

    // Clients: the new client, with XML characters escaped, and its accounts date as a real date
    assert.match(sheet('Clients'), /Export &amp; &lt;Test&gt; Ltd/);
    assert.match(sheet('Clients'), /EX480001/);
    const accountsSerial = toExcelDate('2027-03-31').serial;
    assert.ok(sheet('Clients').includes(`<v>${accountsSerial}</v>`), 'accounts due is a real Excel date');

    // Tasks: formula-like text is stored as text, never as a formula
    assert.match(sheet('Tasks'), /t="inlineStr"[^>]*><is><t xml:space="preserve">=SUM\(A1:A9\) not a formula<\/t>/);
    assert.equal(/<f>/.test(Object.values(files).join('')), false, 'no formulas anywhere');
    assert.match(sheet('Tasks'), /General task/);
    assert.match(sheet('Tasks'), /Nobody yet/);

    // Private notes: the owner's note, line break kept
    assert.match(sheet('Private notes'), /Export private thought\nsecond line/);

    // Header row is bold and stays in view
    assert.match(sheet('Clients'), /state="frozen"/);
    assert.match(sheet('Clients'), /<c r="A1" t="inlineStr" s="1">/);

    // About sheet lists the version and the row counts
    assert.match(sheet('About this file'), /Sloane version/);
    assert.match(sheet('About this file'), /Uploaded document files are not inside this spreadsheet/);
  });

  test('48.3 nothing internal leaks into the file', async () => {
    const res = await fetch(`${baseUrl}/api/v1/export/excel`, { headers: { Cookie: cookie } });
    const all = Object.values(unzip(Buffer.from(await res.arrayBuffer()))).join('\n');
    for (const doc of mockDb.documents) {
      if (doc.storagePath) assert.equal(all.includes(doc.storagePath), false, 'no storage paths');
      if (doc.diskId) assert.equal(all.includes(doc.diskId), false, 'no disk ids');
    }
    assert.equal(all.includes(TEST_API_KEY), false, 'no keys');
    assert.equal(/idempotency/i.test(all), false, 'no internal fields');
  });

  test('48.4 the parts on their own: dates, column letters, a tiny workbook', () => {
    assert.equal(toExcelDate('1900-03-01').serial, 61);
    assert.equal(toExcelDate('2027-03-31').serial, 46477);
    assert.equal(toExcelDate('2027-03-31T12:00:00.000Z').serial, 46477.5);
    assert.equal(toExcelDate('31/03/2027'), null);
    assert.equal(toExcelDate(42), null);
    assert.equal(columnLetter(0), 'A');
    assert.equal(columnLetter(25), 'Z');
    assert.equal(columnLetter(26), 'AA');
    assert.equal(columnLetter(701), 'ZZ');

    const book = buildXlsx([{ name: 'Bad:/Name*?', columns: ['A', 'B'], rows: [['x\u0001y', 5], [true, null]] }]);
    const files = unzip(book);
    assert.match(files['xl/workbook.xml'], /<sheet name="Bad  Name"/, 'unsafe characters removed from sheet names');
    assert.match(files['xl/worksheets/sheet1.xml'], /<t xml:space="preserve">xy<\/t>/, 'control characters removed');
    assert.match(files['xl/worksheets/sheet1.xml'], /<c r="B2"><v>5<\/v><\/c>/, 'numbers stay numbers');
    assert.match(files['xl/worksheets/sheet1.xml'], /<t>Yes<\/t>/, 'yes/no in words');

    const z = unzip(zip([{ name: 'a.txt', data: 'hello' }, { name: 'b/c.txt', data: Buffer.from('world') }]));
    assert.deepEqual(z, { 'a.txt': 'hello', 'b/c.txt': 'world' });
  });
});
