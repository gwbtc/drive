// Mnemonyms: the word form of a Groundwire comet's name (`.word.word…`), the
// form Causeway prints. A port of gwbtc/mnemonyms' reference encoder for the
// one case Drive needs: a comet @p (128 bits), tweaked (one leading dot).
//
//   bits  = the 16 bytes big-endian, then the top 4 bits of sha256(bytes)
//   words = those 132 bits as twelve 11-bit indexes into the 2048-word list,
//           leading zero indexes dropped, joined with '.', prefixed '.'
//
// Only comets have a mnemonym. Anything else keeps its @p (shipToNym → null).
// The @p stays the canonical identity everywhere it is sent or stored.

import { PREFIXES, SUFFIXES, WORDS } from './mnemonym-data';

const COMET_MIN = 1n << 64n; // a comet is more than 8 bytes (clan %pawn)
const WIDTH = 128;
const CS_BITS = WIDTH / 32; // 4
const N_WORDS = (WIDTH + CS_BITS) / 11; // 12

const syl = (table: string, i: number) => table.slice(i * 3, i * 3 + 3);
const sylIndex = (table: string, s: string): number => {
  for (let i = 0; i < 256; i++) if (syl(table, i) === s) return i;
  return -1;
};

// ~ponnyd-toblun-… → 0xf8d0…  (comets only: no @p scrambling above 32 bits
// except moons, and comets are past them). null if it is not a well-formed
// comet @p.
export function cometToBigint(patp: string): bigint | null {
  const words = patp.replace(/^~/, '').replace(/--/g, '-').split('-');
  if (words.length < 5 || words.length > 8) return null;
  let n = 0n;
  for (const w of words) {
    if (w.length !== 6) return null;
    const hi = sylIndex(PREFIXES, w.slice(0, 3));
    const lo = sylIndex(SUFFIXES, w.slice(3));
    if (hi < 0 || lo < 0) return null;
    n = (n << 16n) | BigInt((hi << 8) | lo);
  }
  return n >= COMET_MIN ? n : null;
}

export function bigintToComet(n: bigint): string {
  let out = '';
  let i = 0;
  for (let t = n; t > 0n; t >>= 16n, i++) {
    const w = Number(t & 0xffffn);
    const s = syl(PREFIXES, w >> 8) + syl(SUFFIXES, w & 0xff);
    const sep = i === 0 ? '' : i % 4 === 0 ? '--' : '-';
    out = s + sep + out;
  }
  return '~' + out;
}

const toBytes = (n: bigint): Uint8Array => {
  const b = new Uint8Array(WIDTH / 8);
  for (let i = b.length - 1, t = n; i >= 0; i--, t >>= 8n) b[i] = Number(t & 0xffn);
  return b;
};
const checksum = (bytes: Uint8Array): number => sha256(bytes)[0] >> (8 - CS_BITS);

/** A comet's mnemonym, or null for anything that is not a comet @p. */
export function shipToNym(patp: string): string | null {
  const n = cometToBigint(patp);
  if (n === null) return null;
  let bits = (n << BigInt(CS_BITS)) | BigInt(checksum(toBytes(n)));
  const idx: number[] = [];
  for (let i = 0; i < N_WORDS; i++, bits >>= 11n) idx.unshift(Number(bits & 0x7ffn));
  while (idx.length && idx[0] === 0) idx.shift();
  return '.' + idx.map((i) => WORDS[i]).join('.');
}

/** The @p a comet mnemonym names, or null if it is not a valid one. */
export function nymToShip(nym: string): string | null {
  const s = nym.trim().toLowerCase();
  if (!s.startsWith('.') || s.startsWith('..')) return null;
  const words = s.slice(1).split('.');
  if (!words.length || words.length > N_WORDS) return null;
  let bits = 0n;
  for (let i = 0; i < N_WORDS - words.length; i++) bits <<= 11n;
  for (const w of words) {
    const i = WORDS.indexOf(w);
    if (i < 0) return null;
    bits = (bits << 11n) | BigInt(i);
  }
  const n = bits >> BigInt(CS_BITS);
  const cs = Number(bits & BigInt((1 << CS_BITS) - 1));
  if (n < COMET_MIN || cs !== checksum(toBytes(n))) return null;
  return bigintToComet(n);
}

// --- SHA-256 (FIPS 180-4), synchronous: names render in synchronous code
// and the input is 16 bytes, so Web Crypto's async digest does not fit. ----
const K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

export function sha256(msg: Uint8Array): Uint8Array {
  const len = msg.length;
  const padded = new Uint8Array(((len + 9 + 63) >> 6) << 6);
  padded.set(msg);
  padded[len] = 0x80;
  const dv = new DataView(padded.buffer);
  dv.setUint32(padded.length - 4, len * 8);
  dv.setUint32(padded.length - 8, Math.floor((len * 8) / 2 ** 32));
  const H = new Uint32Array([
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
  ]);
  const W = new Uint32Array(64);
  const rotr = (x: number, n: number) => (x >>> n) | (x << (32 - n));
  for (let off = 0; off < padded.length; off += 64) {
    for (let i = 0; i < 16; i++) W[i] = dv.getUint32(off + i * 4);
    for (let i = 16; i < 64; i++) {
      const s0 = rotr(W[i - 15], 7) ^ rotr(W[i - 15], 18) ^ (W[i - 15] >>> 3);
      const s1 = rotr(W[i - 2], 17) ^ rotr(W[i - 2], 19) ^ (W[i - 2] >>> 10);
      W[i] = (W[i - 16] + s0 + W[i - 7] + s1) | 0;
    }
    let [a, b, c, d, e, f, g, h] = H;
    for (let i = 0; i < 64; i++) {
      const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      const t1 = (h + S1 + ((e & f) ^ (~e & g)) + K[i] + W[i]) | 0;
      const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      const t2 = (S0 + ((a & b) ^ (a & c) ^ (b & c))) | 0;
      h = g; g = f; f = e; e = (d + t1) | 0; d = c; c = b; b = a; a = (t1 + t2) | 0;
    }
    H[0] += a; H[1] += b; H[2] += c; H[3] += d; H[4] += e; H[5] += f; H[6] += g; H[7] += h;
  }
  const out = new Uint8Array(32);
  const odv = new DataView(out.buffer);
  for (let i = 0; i < 8; i++) odv.setUint32(i * 4, H[i]);
  return out;
}
