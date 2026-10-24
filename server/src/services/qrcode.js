/**
 * A small QR code maker (ISO/IEC 18004), so the authenticator set-up code is drawn by Sloane
 * itself and the secret never goes to an outside service.
 *
 * Byte mode, error correction level M (15%), versions 1 to 10 (up to 213 bytes, plenty for an
 * otpauth:// address). The steps follow the well-known reference design by Project Nayuki
 * (MIT): function patterns, Reed-Solomon error correction, interleaving, zig-zag placement,
 * and the mask with the lowest penalty.
 */

// Level M, versions 0..10 (index 0 unused)
const ECC_PER_BLOCK = [-1, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26];
const NUM_BLOCKS = [-1, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5];
const ECL_FORMAT_BITS = 0; // M
const MAX_VERSION = 10;

function rawDataModules(ver) {
  let result = (16 * ver + 128) * ver + 64;
  if (ver >= 2) {
    const numAlign = Math.floor(ver / 7) + 2;
    result -= (25 * numAlign - 10) * numAlign - 55;
    if (ver >= 7) result -= 36;
  }
  return result;
}

function dataCodewordCapacity(ver) {
  return Math.floor(rawDataModules(ver) / 8) - ECC_PER_BLOCK[ver] * NUM_BLOCKS[ver];
}

/* ---- Reed-Solomon over GF(2^8), polynomial 0x11D ---- */

function gfMul(x, y) {
  let z = 0;
  for (let i = 7; i >= 0; i--) {
    z = (z << 1) ^ ((z >>> 7) * 0x11d);
    z ^= ((y >>> i) & 1) * x;
  }
  return z & 0xff;
}

function rsDivisor(degree) {
  const result = new Array(degree).fill(0);
  result[degree - 1] = 1;
  let root = 1;
  for (let i = 0; i < degree; i++) {
    for (let j = 0; j < result.length; j++) {
      result[j] = gfMul(result[j], root);
      if (j + 1 < result.length) result[j] ^= result[j + 1];
    }
    root = gfMul(root, 0x02);
  }
  return result;
}

function rsRemainder(data, divisor) {
  const result = divisor.map(() => 0);
  for (const b of data) {
    const factor = b ^ result.shift();
    result.push(0);
    divisor.forEach((coef, i) => { result[i] ^= gfMul(coef, factor); });
  }
  return result;
}

/* ---- Encoding ---- */

function encodeData(bytes, ver) {
  const bits = [];
  const push = (val, len) => { for (let i = len - 1; i >= 0; i--) bits.push((val >>> i) & 1); };
  push(0b0100, 4);                                  // byte mode
  push(bytes.length, ver <= 9 ? 8 : 16);            // character count
  for (const b of bytes) push(b, 8);
  const capacityBits = dataCodewordCapacity(ver) * 8;
  push(0, Math.min(4, capacityBits - bits.length));  // terminator
  push(0, (8 - (bits.length % 8)) % 8);              // to a whole byte
  const out = [];
  for (let i = 0; i < bits.length; i += 8) {
    let b = 0;
    for (let j = 0; j < 8; j++) b = (b << 1) | bits[i + j];
    out.push(b);
  }
  for (let pad = 0xec; out.length < capacityBits / 8; pad ^= 0xec ^ 0x11) out.push(pad);
  return out;
}

function addEccAndInterleave(data, ver) {
  const numBlocks = NUM_BLOCKS[ver];
  const blockEccLen = ECC_PER_BLOCK[ver];
  const rawCodewords = Math.floor(rawDataModules(ver) / 8);
  const numShortBlocks = numBlocks - (rawCodewords % numBlocks);
  const shortBlockLen = Math.floor(rawCodewords / numBlocks);
  const divisor = rsDivisor(blockEccLen);
  const blocks = [];
  for (let i = 0, k = 0; i < numBlocks; i++) {
    const dat = data.slice(k, k + shortBlockLen - blockEccLen + (i < numShortBlocks ? 0 : 1));
    k += dat.length;
    const ecc = rsRemainder(dat, divisor);
    if (i < numShortBlocks) dat.push(0);
    blocks.push(dat.concat(ecc));
  }
  const result = [];
  for (let i = 0; i < blocks[0].length; i++) {
    blocks.forEach((block, j) => {
      if (i !== shortBlockLen - blockEccLen || j >= numShortBlocks) result.push(block[i]);
    });
  }
  return result;
}

/* ---- The symbol ---- */

class QrSymbol {
  constructor(ver, codewords) {
    this.version = ver;
    this.size = ver * 4 + 17;
    this.modules = Array.from({ length: this.size }, () => new Array(this.size).fill(false));
    this.isFunction = Array.from({ length: this.size }, () => new Array(this.size).fill(false));
    this.drawFunctionPatterns();
    this.drawCodewords(codewords);
    let best = 0;
    let minPenalty = Infinity;
    for (let mask = 0; mask < 8; mask++) {
      this.applyMask(mask);
      this.drawFormatBits(mask);
      const p = this.penalty();
      if (p < minPenalty) { best = mask; minPenalty = p; }
      this.applyMask(mask); // undo
    }
    this.mask = best;
    this.applyMask(best);
    this.drawFormatBits(best);
  }

  set(x, y, dark) {
    this.modules[y][x] = dark;
    this.isFunction[y][x] = true;
  }

  drawFunctionPatterns() {
    const n = this.size;
    for (let i = 0; i < n; i++) {
      this.set(6, i, i % 2 === 0);
      this.set(i, 6, i % 2 === 0);
    }
    this.drawFinder(3, 3);
    this.drawFinder(n - 4, 3);
    this.drawFinder(3, n - 4);
    const pos = this.alignmentPositions();
    const na = pos.length;
    for (let i = 0; i < na; i++) {
      for (let j = 0; j < na; j++) {
        if ((i === 0 && j === 0) || (i === 0 && j === na - 1) || (i === na - 1 && j === 0)) continue;
        this.drawAlignment(pos[i], pos[j]);
      }
    }
    this.drawFormatBits(0);
    this.drawVersion();
  }

  alignmentPositions() {
    const ver = this.version;
    if (ver === 1) return [];
    const numAlign = Math.floor(ver / 7) + 2;
    const step = Math.ceil((ver * 4 + 4) / (numAlign * 2 - 2)) * 2;
    const result = [6];
    for (let p = this.size - 7; result.length < numAlign; p -= step) result.splice(1, 0, p);
    return result;
  }

  drawFinder(x, y) {
    for (let dy = -4; dy <= 4; dy++) {
      for (let dx = -4; dx <= 4; dx++) {
        const dist = Math.max(Math.abs(dx), Math.abs(dy));
        const xx = x + dx;
        const yy = y + dy;
        if (xx >= 0 && xx < this.size && yy >= 0 && yy < this.size) this.set(xx, yy, dist !== 2 && dist !== 4);
      }
    }
  }

  drawAlignment(x, y) {
    for (let dy = -2; dy <= 2; dy++) {
      for (let dx = -2; dx <= 2; dx++) this.set(x + dx, y + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
    }
  }

  drawFormatBits(mask) {
    const data = (ECL_FORMAT_BITS << 3) | mask;
    let rem = data;
    for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
    const bits = ((data << 10) | rem) ^ 0x5412;
    const bit = i => ((bits >>> i) & 1) !== 0;
    const n = this.size;
    for (let i = 0; i <= 5; i++) this.set(8, i, bit(i));
    this.set(8, 7, bit(6));
    this.set(8, 8, bit(7));
    this.set(7, 8, bit(8));
    for (let i = 9; i < 15; i++) this.set(14 - i, 8, bit(i));
    for (let i = 0; i < 8; i++) this.set(n - 1 - i, 8, bit(i));
    for (let i = 8; i < 15; i++) this.set(8, n - 15 + i, bit(i));
    this.set(8, n - 8, true); // the dark module
  }

  drawVersion() {
    if (this.version < 7) return;
    let rem = this.version;
    for (let i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1f25);
    const bits = (this.version << 12) | rem;
    for (let i = 0; i < 18; i++) {
      const dark = ((bits >>> i) & 1) !== 0;
      const a = this.size - 11 + (i % 3);
      const b = Math.floor(i / 3);
      this.set(a, b, dark);
      this.set(b, a, dark);
    }
  }

  drawCodewords(data) {
    const n = this.size;
    let i = 0;
    for (let right = n - 1; right >= 1; right -= 2) {
      if (right === 6) right = 5;
      for (let vert = 0; vert < n; vert++) {
        for (let j = 0; j < 2; j++) {
          const x = right - j;
          const upward = ((right + 1) & 2) === 0;
          const y = upward ? n - 1 - vert : vert;
          if (!this.isFunction[y][x] && i < data.length * 8) {
            this.modules[y][x] = ((data[i >>> 3] >>> (7 - (i & 7))) & 1) !== 0;
            i++;
          }
        }
      }
    }
  }

  applyMask(mask) {
    for (let y = 0; y < this.size; y++) {
      for (let x = 0; x < this.size; x++) {
        let invert;
        switch (mask) {
          case 0: invert = (x + y) % 2 === 0; break;
          case 1: invert = y % 2 === 0; break;
          case 2: invert = x % 3 === 0; break;
          case 3: invert = (x + y) % 3 === 0; break;
          case 4: invert = (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0; break;
          case 5: invert = ((x * y) % 2) + ((x * y) % 3) === 0; break;
          case 6: invert = (((x * y) % 2) + ((x * y) % 3)) % 2 === 0; break;
          default: invert = (((x + y) % 2) + ((x * y) % 3)) % 2 === 0;
        }
        if (!this.isFunction[y][x] && invert) this.modules[y][x] = !this.modules[y][x];
      }
    }
  }

  /** Readability score (lower is better): long runs, 2x2 blocks, finder look-alikes, balance. */
  penalty() {
    const n = this.size;
    const m = this.modules;
    let result = 0;
    const runs = line => {
      let p = 0;
      let run = 1;
      for (let i = 1; i <= line.length; i++) {
        if (i < line.length && line[i] === line[i - 1]) run++;
        else { if (run >= 5) p += 3 + (run - 5); run = 1; }
      }
      return p;
    };
    const finderLike = line => {
      let p = 0;
      const s = line.map(v => (v ? 1 : 0)).join('');
      const re = /(?=(10111010000|00001011101))/g;
      while (re.exec(s)) { p += 40; re.lastIndex++; }
      return p;
    };
    for (let y = 0; y < n; y++) { result += runs(m[y]) + finderLike(m[y]); }
    for (let x = 0; x < n; x++) {
      const col = m.map(row => row[x]);
      result += runs(col) + finderLike(col);
    }
    for (let y = 0; y < n - 1; y++) {
      for (let x = 0; x < n - 1; x++) {
        const c = m[y][x];
        if (c === m[y][x + 1] && c === m[y + 1][x] && c === m[y + 1][x + 1]) result += 3;
      }
    }
    let dark = 0;
    for (const row of m) for (const v of row) if (v) dark++;
    const total = n * n;
    result += Math.floor(Math.abs(dark * 20 - total * 10) / total) * 10;
    return result;
  }
}

/** Makes a QR code for some text. Returns { version, size, mask, modules[y][x] }. */
export function makeQr(text) {
  const bytes = [...Buffer.from(String(text), 'utf8')];
  let ver = 1;
  for (; ver <= MAX_VERSION; ver++) {
    const countBits = ver <= 9 ? 8 : 16;
    if (4 + countBits + bytes.length * 8 <= dataCodewordCapacity(ver) * 8) break;
  }
  if (ver > MAX_VERSION) throw new Error('That is too much text for this QR code.');
  const symbol = new QrSymbol(ver, addEccAndInterleave(encodeData(bytes, ver), ver));
  return { version: ver, size: symbol.size, mask: symbol.mask, modules: symbol.modules };
}

/** The QR code as an SVG picture (black on white, with the quiet border scanners need). */
export function qrSvg(text, { moduleSize = 6, margin = 4 } = {}) {
  const qr = makeQr(text);
  const full = qr.size + margin * 2;
  let path = '';
  for (let y = 0; y < qr.size; y++) {
    for (let x = 0; x < qr.size; x++) {
      if (qr.modules[y][x]) path += `M${x + margin},${y + margin}h1v1h-1z`;
    }
  }
  const px = full * moduleSize;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${full} ${full}" width="${px}" height="${px}" shape-rendering="crispEdges" role="img" aria-label="QR code for your authenticator app"><rect width="${full}" height="${full}" fill="#ffffff"/><path d="${path}" fill="#000000"/></svg>`;
}

// For the self-check in the tests
export const _internals = { rsDivisor, rsRemainder, gfMul, dataCodewordCapacity, rawDataModules, NUM_BLOCKS, ECC_PER_BLOCK };
