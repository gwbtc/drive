// Tests for the pure STORE-only ZIP writer. Beyond checking the PK signature,
// these write the produced bytes to a temp file and shell out to `unzip` (like
// docx.test.ts) to prove the archive is standard-conformant and that file
// names + contents round-trip — including nested directory paths and binary
// (non-text) payloads.

import { afterAll, describe, expect, test } from 'bun:test';
import { spawnSync } from 'bun';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { zipStore, type ZipEntry } from './zip';

const enc = (s: string) => new TextEncoder().encode(s);

describe('zipStore basics', () => {
  test('produces a PK-signature archive', () => {
    const bytes = zipStore([{ path: 'a.txt', bytes: enc('hello') }]);
    expect(bytes[0]).toBe(0x50); // 'P'
    expect(bytes[1]).toBe(0x4b); // 'K'
    expect(bytes.length).toBeGreaterThan(20);
  });

  test('an empty archive is still a valid EOCD-only ZIP', () => {
    const bytes = zipStore([]);
    // Just the 22-byte end-of-central-directory record.
    expect(bytes.length).toBe(22);
    expect(bytes[0]).toBe(0x50);
    expect(bytes[1]).toBe(0x4b);
  });
});

describe('end-to-end ZIP integrity (via unzip)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'zip-'));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  // A mix of: root-level text, nested directories, a deep path, binary bytes
  // spanning the full 0..255 range (exercises CRC + raw store fidelity), and a
  // UTF-8 filename (proves the archive stays integrity-clean with bit-11 names).
  const binary = new Uint8Array(256);
  for (let i = 0; i < 256; i++) binary[i] = i;
  // ASCII-only paths — Info-ZIP's `unzip` on macOS mangles UTF-8 names in its
  // listing and refuses to *create* them under a C locale ("Illegal byte
  // sequence"), so name/round-trip assertions use these; the UTF-8 entry rides
  // along only to prove `unzip -t` still passes with a bit-11 filename.
  const asciiPaths = ['readme.md', 'Sheets/data.csv', 'Sub/Deep/note.md', 'assets/blob.bin'];
  const entries: ZipEntry[] = [
    { path: 'readme.md', bytes: enc('# Hello\n\nWorld.\n') },
    { path: 'Sheets/data.csv', bytes: enc('a,b\n1,2\n') },
    { path: 'Sub/Deep/note.md', bytes: enc('nested note') },
    { path: 'assets/blob.bin', bytes: binary },
    { path: 'unicode/名前.txt', bytes: enc('utf-8 name') },
  ];
  const bytes = zipStore(entries);
  const file = join(dir, 'out.zip');
  writeFileSync(file, bytes);

  test('unzip -t reports no errors (including the UTF-8 entry)', () => {
    const r = spawnSync(['unzip', '-t', file]);
    const out = r.stdout.toString() + r.stderr.toString();
    expect(r.exitCode).toBe(0);
    expect(out).toContain('No errors detected');
  });

  test('unzip -l lists every entry name and directory', () => {
    const r = spawnSync(['unzip', '-l', file]);
    expect(r.exitCode).toBe(0);
    const out = r.stdout.toString();
    for (const p of asciiPaths) expect(out).toContain(p);
    expect(out).toContain('5 files');
  });

  test('text contents round-trip', () => {
    const r = spawnSync(['unzip', '-p', file, 'readme.md']);
    expect(r.exitCode).toBe(0);
    expect(r.stdout.toString()).toBe('# Hello\n\nWorld.\n');
  });

  test('a nested-directory entry round-trips', () => {
    const r = spawnSync(['unzip', '-p', file, 'Sub/Deep/note.md']);
    expect(r.exitCode).toBe(0);
    expect(r.stdout.toString()).toBe('nested note');
  });

  test('binary bytes round-trip exactly (via unzip -p)', () => {
    // `-p` streams the raw member to stdout without creating a file, so the
    // locale issue that blocks extracting the UTF-8 name never applies here.
    const r = spawnSync(['unzip', '-p', file, 'assets/blob.bin']);
    expect(r.exitCode).toBe(0);
    const got = new Uint8Array(r.stdout);
    expect(got.length).toBe(256);
    for (let i = 0; i < 256; i++) expect(got[i]).toBe(i);
  });
});
