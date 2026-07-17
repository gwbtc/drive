// Pure, dependency-free STORE-only (uncompressed) ZIP writer.
//
// Why hand-rolled instead of a library (e.g. fflate): the app ships as a
// single-file IIFE bundle (`bun build --format=iife --outfile`), which cannot
// code-split, so ANY dependency — even a dynamically imported one — is inlined
// into the main js.js. A store-only writer is ~90 lines and adds nothing to the
// bundle. STORE (no DEFLATE) is fine for a folder of documents: the payload is
// mostly already-compressed images plus small text/CSV/Markdown files, and
// skipping compression keeps this module pure and synchronous (no async
// deflate, no worker) so it stays trivially unit-testable.
//
// The output is a standard ZIP: local file headers + data, a central directory,
// and an end-of-central-directory record. Filenames are UTF-8 (general-purpose
// bit 11 set). Sizes are 32-bit — documents never approach the 4 GiB ceiling,
// so no ZIP64. Directory structure is expressed purely through '/'-separated
// entry paths; no explicit directory entries are emitted (unzip creates the
// parent directories on extraction).

export type ZipEntry = { path: string; bytes: Uint8Array };

// Standard CRC-32 (polynomial 0xEDB88320), required in every ZIP header.
const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

const u16 = (v: number) => new Uint8Array([v & 0xff, (v >>> 8) & 0xff]);
const u32 = (v: number) =>
  new Uint8Array([v & 0xff, (v >>> 8) & 0xff, (v >>> 16) & 0xff, (v >>> 24) & 0xff]);

const GP_FLAG_UTF8 = 0x0800; // filenames are UTF-8
const VERSION = 20; // 2.0 — minimum for the base format
const METHOD_STORE = 0; // no compression

/** Pure: pack entries into a ZIP archive (stored, uncompressed). */
export function zipStore(entries: ZipEntry[]): Uint8Array {
  const enc = new TextEncoder();
  const chunks: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;

  for (const entry of entries) {
    const nameBytes = enc.encode(entry.path);
    const data = entry.bytes;
    const crc = crc32(data);
    const size = data.length;

    // Local file header + name + data.
    const local: Uint8Array[] = [
      u32(0x04034b50), // local file header signature
      u16(VERSION),
      u16(GP_FLAG_UTF8),
      u16(METHOD_STORE),
      u16(0), // mod time
      u16(0), // mod date
      u32(crc),
      u32(size), // compressed size (== uncompressed, stored)
      u32(size), // uncompressed size
      u16(nameBytes.length),
      u16(0), // extra field length
      nameBytes,
      data,
    ];
    const localSize = local.reduce((a, p) => a + p.length, 0);
    for (const p of local) chunks.push(p);

    // Central directory file header.
    central.push(
      u32(0x02014b50), // central directory signature
      u16(VERSION), // version made by
      u16(VERSION), // version needed
      u16(GP_FLAG_UTF8),
      u16(METHOD_STORE),
      u16(0), // mod time
      u16(0), // mod date
      u32(crc),
      u32(size),
      u32(size),
      u16(nameBytes.length),
      u16(0), // extra length
      u16(0), // comment length
      u16(0), // disk number start
      u16(0), // internal attributes
      u32(0), // external attributes
      u32(offset), // local header offset
      nameBytes,
    );

    offset += localSize;
  }

  const centralSize = central.reduce((a, p) => a + p.length, 0);
  const centralOffset = offset;
  for (const p of central) chunks.push(p);

  // End of central directory record.
  chunks.push(
    u32(0x06054b50),
    u16(0), // this disk number
    u16(0), // disk with central directory
    u16(entries.length), // entries on this disk
    u16(entries.length), // total entries
    u32(centralSize),
    u32(centralOffset),
    u16(0), // comment length
  );

  const total = chunks.reduce((a, p) => a + p.length, 0);
  const out = new Uint8Array(total);
  let pos = 0;
  for (const p of chunks) {
    out.set(p, pos);
    pos += p.length;
  }
  return out;
}

/** Trigger a browser download of ZIP bytes. Appends `.zip` to a safe filename. */
export function downloadZip(filename: string, bytes: Uint8Array) {
  const blob = new Blob([bytes as BlobPart], { type: 'application/zip' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename.replace(/[^\w.-]+/g, '_').replace(/^_+|_+$/g, '') + '.zip';
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
