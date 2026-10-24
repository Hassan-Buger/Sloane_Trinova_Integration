/**
 * An independent QR code reader for the tests (level M, versions 1-10, byte mode).
 *
 * It does not reuse the encoder's code: alignment positions, block layout and format codes come
 * from the tables printed in the QR standard (ISO/IEC 18004 Annex E and Table 9), and the
 * Reed-Solomon check evaluates syndromes instead of dividing. If the encoder put a single
 * module in the wrong place, the syndromes or the decoded text would not come out right.
 */

// Annex E: alignment pattern centre positions
const ALIGN = { 1: [], 2: [6, 18], 3: [6, 22], 4: [6, 26], 5: [6, 30], 6: [6, 34], 7: [6, 22, 38], 8: [6, 24, 42], 9: [6, 26, 46], 10: [6, 28, 50] };

// Table 9, level M: [ecc codewords per block, [[number of blocks, data codewords per block], ...]]
const BLOCKS_M = {
  1: [10, [[1, 16]]],
  2: [16, [[1, 28]]],
  3: [26, [[1, 44]]],
  4: [18, [[2, 32]]],
  5: [24, [[2, 43]]],
  6: [16, [[4, 27]]],
  7: [18, [[4, 31]]],
  8: [22, [[2, 38], [2, 39]]],
  9: [22, [[3, 36], [2, 37]]],
  10: [26, [[4, 43], [1, 44]]]
};

// The 32 valid 15-bit format strings, written out in the standard (Table C.1), level M rows (ECL bits 00)
const FORMAT_M = {
  0b101010000010010: 0, 0b101000100100101: 1, 0b101111001111100: 2, 0b101101101001011: 3,
  0b100010111111001: 4, 0b100000011001110: 5, 0b100111110010111: 6, 0b100101010100000: 7
};

const MASKS = [
  (x, y) => (x + y) % 2 === 0,
  (x, y) => y % 2 === 0,
  (x) => x % 3 === 0,
  (x, y) => (x + y) % 3 === 0,
  (x, y) => (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0,
  (x, y) => ((x * y) % 2) + ((x * y) % 3) === 0,
  (x, y) => (((x * y) % 2) + ((x * y) % 3)) % 2 === 0,
  (x, y) => (((x + y) % 2) + ((x * y) % 3)) % 2 === 0
];

/* GF(256) with log tables (a different method from the encoder's bit-by-bit multiply) */
const EXP = new Array(512);
const LOG = new Array(256);
(() => {
  let x = 1;
  for (let i = 0; i < 255; i++) {
    EXP[i] = x;
    LOG[x] = i;
    x <<= 1;
    if (x & 0x100) x ^= 0x11d;
  }
  for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255];
})();
const mul = (a, b) => (a === 0 || b === 0 ? 0 : EXP[LOG[a] + LOG[b]]);

/** True when every syndrome of the block is zero (no errors). */
function syndromesZero(block, eccLen) {
  for (let i = 0; i < eccLen; i++) {
    const alpha = EXP[i];
    let s = 0;
    for (const c of block) s = mul(s, alpha) ^ c;
    if (s !== 0) return false;
  }
  return true;
}

/**
 * Reads a QR code given as modules[y][x] (true = dark). Throws with a reason if anything is off.
 * Returns { text, version, mask }.
 */
export function readQr(modules) {
  const n = modules.length;
  const version = (n - 17) / 4;
  if (!Number.isInteger(version) || version < 1 || version > 10) throw new Error(`bad size ${n}`);
  const at = (x, y) => modules[y][x];

  // Finder patterns, separators and timing patterns look right
  for (const [cx, cy] of [[3, 3], [n - 4, 3], [3, n - 4]]) {
    for (let dy = -3; dy <= 3; dy++) {
      for (let dx = -3; dx <= 3; dx++) {
        const d = Math.max(Math.abs(dx), Math.abs(dy));
        if (at(cx + dx, cy + dy) !== (d !== 2)) throw new Error(`finder at ${cx},${cy} is wrong`);
      }
    }
  }
  for (let i = 8; i < n - 8; i++) {
    if (at(i, 6) !== (i % 2 === 0) || at(6, i) !== (i % 2 === 0)) throw new Error('timing pattern is wrong');
  }
  if (!at(8, n - 8)) throw new Error('dark module missing');

  // Format information: both copies, read as the standard lays them out
  let f1 = 0;
  const copy1 = [[8, 0], [8, 1], [8, 2], [8, 3], [8, 4], [8, 5], [8, 7], [8, 8], [7, 8], [5, 8], [4, 8], [3, 8], [2, 8], [1, 8], [0, 8]];
  copy1.forEach(([x, y], i) => { if (at(x, y)) f1 |= 1 << i; });
  let f2 = 0;
  for (let i = 0; i < 8; i++) if (at(n - 1 - i, 8)) f2 |= 1 << i;
  for (let i = 8; i < 15; i++) if (at(8, n - 15 + i)) f2 |= 1 << i;
  if (f1 !== f2) throw new Error('the two format copies differ');
  const mask = FORMAT_M[f1];
  if (mask === undefined) throw new Error(`format 0b${f1.toString(2)} is not a valid level-M format`);

  // Which modules are data (built from the standard's own tables)
  const reserved = Array.from({ length: n }, () => new Array(n).fill(false));
  const reserve = (x, y) => { if (x >= 0 && y >= 0 && x < n && y < n) reserved[y][x] = true; };
  for (let y = 0; y < 9; y++) for (let x = 0; x < 9; x++) reserve(x, y);             // top-left finder + format
  for (let y = 0; y < 9; y++) for (let x = n - 8; x < n; x++) reserve(x, y);         // top-right
  for (let y = n - 8; y < n; y++) for (let x = 0; x < 9; x++) reserve(x, y);         // bottom-left
  for (let i = 0; i < n; i++) { reserve(6, i); reserve(i, 6); }                       // timing
  const pos = ALIGN[version];
  for (const ax of pos) {
    for (const ay of pos) {
      const overlapsFinder = (ax < 9 && ay < 9) || (ax > n - 9 && ay < 9) || (ax < 9 && ay > n - 9);
      if (overlapsFinder) continue;
      for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) reserve(ax + dx, ay + dy);
    }
  }
  if (version >= 7) {
    for (let y = 0; y < 6; y++) for (let x = n - 11; x < n - 8; x++) { reserve(x, y); reserve(y, x); }
  }

  // Read the data bits in the zig-zag order, removing the mask
  const bits = [];
  let upward = true;
  for (let right = n - 1; right > 0; right -= 2) {
    if (right === 6) right = 5;
    for (let k = 0; k < n; k++) {
      const y = upward ? n - 1 - k : k;
      for (const x of [right, right - 1]) {
        if (reserved[y][x]) continue;
        bits.push(at(x, y) !== MASKS[mask](x, y));
      }
    }
    upward = !upward;
  }
  const codewords = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) {
    let b = 0;
    for (let j = 0; j < 8; j++) b = (b << 1) | (bits[i + j] ? 1 : 0);
    codewords.push(b);
  }

  // Undo the interleaving, check every block, collect the data
  const [eccLen, groups] = BLOCKS_M[version];
  const sizes = groups.flatMap(([count, len]) => new Array(count).fill(len));
  const blocks = sizes.map(len => ({ len, data: [], ecc: [] }));
  let p = 0;
  const maxLen = Math.max(...sizes);
  for (let i = 0; i < maxLen; i++) for (const b of blocks) if (i < b.len) b.data.push(codewords[p++]);
  for (let i = 0; i < eccLen; i++) for (const b of blocks) b.ecc.push(codewords[p++]);
  blocks.forEach((b, i) => { if (!syndromesZero([...b.data, ...b.ecc], eccLen)) throw new Error(`block ${i} fails its error check`); });
  const data = blocks.flatMap(b => b.data);

  // Byte mode
  let bitPos = 0;
  const read = len => {
    let v = 0;
    for (let i = 0; i < len; i++) {
      v = (v << 1) | ((data[bitPos >> 3] >> (7 - (bitPos & 7))) & 1);
      bitPos++;
    }
    return v;
  };
  if (read(4) !== 0b0100) throw new Error('not byte mode');
  const count = read(version <= 9 ? 8 : 16);
  const bytes = [];
  for (let i = 0; i < count; i++) bytes.push(read(8));
  return { text: Buffer.from(bytes).toString('utf8'), version, mask };
}
