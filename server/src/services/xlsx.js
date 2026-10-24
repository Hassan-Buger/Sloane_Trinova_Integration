/**
 * A small, dependency-free Excel (.xlsx) writer.
 *
 * An .xlsx file is a zip of a few XML files. This writes exactly what Excel, Numbers, LibreOffice
 * and Google Sheets need for plain tables:
 * - one worksheet per table, with a bold header row that stays in view when scrolling
 * - text kept as text (never run as a formula), numbers as numbers
 * - dates (YYYY-MM-DD) and date-times as real Excel dates, shown day first (31/03/2027)
 * - column widths sized to the content
 *
 * Usage: buildXlsx([{ name: 'Clients', columns: ['Name', ...], rows: [['Acme Ltd', ...], ...] }])
 * returns a Buffer.
 */

import zlib from 'node:zlib';

const STYLE = { text: 0, header: 1, date: 2, wrap: 3, dateTime: 4 };
const MAX_CELL = 32767;
const MAX_WIDTH = 60;

/** Excel cell text: no control characters (they make the file unreadable). */
function clean(text) {
  // eslint-disable-next-line no-control-regex
  return String(text).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/g, '');
}

function xml(text) {
  return clean(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** 0 -> A, 25 -> Z, 26 -> AA */
export function columnLetter(index) {
  let n = index + 1;
  let s = '';
  while (n > 0) {
    const m = (n - 1) % 26;
    s = String.fromCharCode(65 + m) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

const EXCEL_EPOCH = Date.UTC(1899, 11, 30);
const DAY_MS = 24 * 60 * 60 * 1000;

/** A YYYY-MM-DD date or an ISO date-time as an Excel serial number, or null. */
export function toExcelDate(value) {
  if (typeof value !== 'string') return null;
  const day = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (day) {
    const t = Date.UTC(Number(day[1]), Number(day[2]) - 1, Number(day[3]));
    return Number.isNaN(t) ? null : { serial: (t - EXCEL_EPOCH) / DAY_MS, withTime: false };
  }
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(value)) {
    const t = Date.parse(value);
    if (Number.isNaN(t)) return null;
    return { serial: Math.round(((t - EXCEL_EPOCH) / DAY_MS) * 86400) / 86400, withTime: true };
  }
  return null;
}

function cell(ref, value, isHeader) {
  if (value === null || value === undefined || value === '') return '';
  if (isHeader) {
    return `<c r="${ref}" t="inlineStr" s="${STYLE.header}"><is><t xml:space="preserve">${xml(value)}</t></is></c>`;
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    return `<c r="${ref}"><v>${value}</v></c>`;
  }
  if (typeof value === 'boolean') {
    return `<c r="${ref}" t="inlineStr"><is><t>${value ? 'Yes' : 'No'}</t></is></c>`;
  }
  const date = toExcelDate(value);
  if (date) {
    return `<c r="${ref}" s="${date.withTime ? STYLE.dateTime : STYLE.date}"><v>${date.serial}</v></c>`;
  }
  let text = String(value);
  if (text.length > MAX_CELL) text = `${text.slice(0, MAX_CELL - 1)}…`;
  const style = text.includes('\n') || text.length > MAX_WIDTH ? ` s="${STYLE.wrap}"` : '';
  return `<c r="${ref}" t="inlineStr"${style}><is><t xml:space="preserve">${xml(text)}</t></is></c>`;
}

function displayLength(value) {
  if (value === null || value === undefined) return 0;
  if (typeof value === 'string' && toExcelDate(value)) return value.length > 10 ? 16 : 10;
  return Math.max(...String(value).split('\n').map(l => l.length));
}

function sheetXml({ columns, rows }) {
  const widths = columns.map((c, i) => {
    const longest = Math.max(displayLength(c), ...rows.map(r => displayLength(r[i])));
    return Math.min(MAX_WIDTH, Math.max(8, longest + 2));
  });
  const cols = widths.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join('');
  const all = [columns, ...rows];
  const body = all.map((row, r) => {
    const cells = row.map((v, c) => cell(`${columnLetter(c)}${r + 1}`, v, r === 0)).join('');
    return `<row r="${r + 1}">${cells}</row>`;
  }).join('');
  const lastRef = `${columnLetter(Math.max(0, columns.length - 1))}${Math.max(1, all.length)}`;
  return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
    `<dimension ref="A1:${lastRef}"/>` +
    '<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>' +
    `<cols>${cols}</cols>` +
    `<sheetData>${body}</sheetData>` +
    (rows.length ? `<autoFilter ref="A1:${lastRef}"/>` : '') +
    '</worksheet>';
}

const STYLES_XML = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
  '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
  '<numFmts count="2"><numFmt numFmtId="164" formatCode="dd/mm/yyyy"/><numFmt numFmtId="165" formatCode="dd/mm/yyyy hh:mm"/></numFmts>' +
  '<fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts>' +
  '<fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill>' +
  '<fill><patternFill patternType="solid"><fgColor rgb="FFF2E6D0"/><bgColor indexed="64"/></patternFill></fill></fills>' +
  '<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>' +
  '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
  '<cellXfs count="5">' +
  '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>' +
  '<xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"/>' +
  '<xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>' +
  '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment wrapText="1" vertical="top"/></xf>' +
  '<xf numFmtId="165" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>' +
  '</cellXfs>' +
  '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>' +
  '</styleSheet>';

/** Sheet names: at most 31 characters, none of : \ / ? * [ ], and unique. */
function sheetNames(sheets) {
  const used = new Set();
  return sheets.map((s, i) => {
    let name = String(s.name || `Sheet${i + 1}`).replace(/[:\\/?*[\]]/g, ' ').trim().slice(0, 31) || `Sheet${i + 1}`;
    let n = 2;
    const base = name;
    while (used.has(name.toLowerCase())) name = `${base.slice(0, 28)} ${n++}`;
    used.add(name.toLowerCase());
    return name;
  });
}

/* ---------------- zip (deflate) ---------------- */

function dosDateTime(d) {
  const time = (d.getHours() << 11) | (d.getMinutes() << 5) | Math.floor(d.getSeconds() / 2);
  const date = ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
  return { time, date };
}

export function zip(files, now = new Date()) {
  const { time, date } = dosDateTime(now);
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const f of files) {
    const name = Buffer.from(f.name, 'utf8');
    const raw = Buffer.isBuffer(f.data) ? f.data : Buffer.from(f.data, 'utf8');
    const data = zlib.deflateRawSync(raw);
    const crc = zlib.crc32(raw) >>> 0;

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);        // version needed
    local.writeUInt16LE(0x0800, 6);    // UTF-8 names
    local.writeUInt16LE(8, 8);         // deflate
    local.writeUInt16LE(time, 10);
    local.writeUInt16LE(date, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(raw.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);
    locals.push(local, name, data);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(8, 10);
    central.writeUInt16LE(time, 12);
    central.writeUInt16LE(date, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(raw.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt16LE(0, 30);
    central.writeUInt16LE(0, 32);
    central.writeUInt16LE(0, 34);
    central.writeUInt16LE(0, 36);
    central.writeUInt32LE(0, 38);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, name);

    offset += local.length + name.length + data.length;
  }
  const centralSize = centrals.reduce((n, b) => n + b.length, 0);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(centralSize, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(0, 20);
  return Buffer.concat([...locals, ...centrals, end]);
}

/**
 * @param {Array<{name:string, columns:string[], rows:any[][]}>} sheets
 * @returns {Buffer} the .xlsx file
 */
export function buildXlsx(sheets) {
  const names = sheetNames(sheets);
  const files = [
    {
      name: '[Content_Types].xml',
      data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
        '<Default Extension="xml" ContentType="application/xml"/>' +
        '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
        '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' +
        sheets.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('') +
        '</Types>'
    },
    {
      name: '_rels/.rels',
      data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
        '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>' +
        '</Relationships>'
    },
    {
      name: 'xl/workbook.xml',
      data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
        '<sheets>' + names.map((n, i) => `<sheet name="${xml(n)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('') + '</sheets>' +
        (sheets.some(s => s.rows.length)
          ? '<definedNames>' + names.map((n, i) => sheets[i].rows.length
            ? `<definedName name="_xlnm._FilterDatabase" localSheetId="${i}" hidden="1">'${xml(n).replace(/'/g, "''")}'!$A$1:$${columnLetter(sheets[i].columns.length - 1)}$${sheets[i].rows.length + 1}</definedName>`
            : '').join('') + '</definedNames>'
          : '') +
        '</workbook>'
    },
    {
      name: 'xl/_rels/workbook.xml.rels',
      data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
        sheets.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('') +
        `<Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>` +
        '</Relationships>'
    },
    { name: 'xl/styles.xml', data: STYLES_XML },
    ...sheets.map((s, i) => ({ name: `xl/worksheets/sheet${i + 1}.xml`, data: sheetXml(s) }))
  ];
  return zip(files);
}
