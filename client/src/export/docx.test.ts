// Tests for the zero-dependency DOCX exporter: the pure OOXML serializer, and
// a real end-to-end ZIP integrity check (the produced bytes must unzip cleanly
// and contain well-formed document.xml).

import { afterAll, describe, expect, test } from 'bun:test';
import { spawnSync } from 'bun';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  buildDocumentXml,
  buildDocxParts,
  docToDocxBytes,
  zipStore,
} from './docx';

type Json = Record<string, any>;
const doc = (...content: Json[]) => ({ type: 'doc', content });
const p = (...content: Json[]) => ({ type: 'paragraph', content });
const text = (t: string, ...marks: Json[]): Json =>
  marks.length ? { type: 'text', text: t, marks } : { type: 'text', text: t };
const li = (...content: Json[]) => ({ type: 'listItem', content });

describe('document.xml serialization', () => {
  test('paragraph text', () => {
    const { xml } = buildDocumentXml(doc(p(text('hello'))));
    expect(xml).toContain('<w:document');
    expect(xml).toContain('<w:t xml:space="preserve">hello</w:t>');
  });

  test('bold and italic emit run properties', () => {
    const { xml } = buildDocumentXml(doc(p(text('x', { type: 'bold' }, { type: 'italic' }))));
    expect(xml).toContain('<w:b/>');
    expect(xml).toContain('<w:i/>');
  });

  test('headings use the Heading styles', () => {
    const { xml } = buildDocumentXml(
      doc({ type: 'heading', attrs: { level: 2 }, content: [text('T')] }),
    );
    expect(xml).toContain('<w:pStyle w:val="Heading2"/>');
  });

  test('links become hyperlink relationships', () => {
    const { xml, links } = buildDocumentXml(
      doc(p(text('site', { type: 'link', attrs: { href: 'https://e.co' } }))),
    );
    expect(links.length).toBe(1);
    expect(links[0].target).toBe('https://e.co');
    expect(xml).toContain(`<w:hyperlink r:id="${links[0].id}">`);
  });

  test('bullet list items reference the bullet numId', () => {
    const { xml } = buildDocumentXml(
      doc({ type: 'bulletList', content: [li(p(text('a'))), li(p(text('b')))] }),
    );
    expect(xml).toContain('<w:numId w:val="1"/>');
  });

  test('ordered list items reference the decimal numId', () => {
    const { xml } = buildDocumentXml(
      doc({ type: 'orderedList', content: [li(p(text('a')))] }),
    );
    expect(xml).toContain('<w:numId w:val="2"/>');
  });

  test('nested lists increment ilvl', () => {
    const { xml } = buildDocumentXml(
      doc({
        type: 'bulletList',
        content: [li(p(text('a')), { type: 'bulletList', content: [li(p(text('b')))] })],
      }),
    );
    expect(xml).toContain('<w:ilvl w:val="0"/>');
    expect(xml).toContain('<w:ilvl w:val="1"/>');
  });

  test('task items render checkbox prefixes', () => {
    const { xml } = buildDocumentXml(
      doc({
        type: 'taskList',
        content: [
          { type: 'taskItem', attrs: { checked: true }, content: [p(text('done'))] },
          { type: 'taskItem', attrs: { checked: false }, content: [p(text('todo'))] },
        ],
      }),
    );
    expect(xml).toContain('☑');
    expect(xml).toContain('☐');
  });

  test('table emits rows, cells and header shading', () => {
    const { xml } = buildDocumentXml(
      doc({
        type: 'table',
        content: [
          {
            type: 'tableRow',
            content: [
              { type: 'tableHeader', content: [p(text('H'))] },
              { type: 'tableHeader', content: [p(text('I'))] },
            ],
          },
          {
            type: 'tableRow',
            content: [
              { type: 'tableCell', content: [p(text('1'))] },
              { type: 'tableCell', content: [p(text('2'))] },
            ],
          },
        ],
      }),
    );
    expect(xml).toContain('<w:tbl>');
    expect(xml).toContain('<w:tr>');
    expect(xml).toContain('<w:tc>');
    expect(xml).toContain('w:fill="F0F0F0"'); // header shading
  });

  test('colspan becomes gridSpan', () => {
    const { xml } = buildDocumentXml(
      doc({
        type: 'table',
        content: [
          {
            type: 'tableRow',
            content: [{ type: 'tableCell', attrs: { colspan: 2 }, content: [p(text('wide'))] }],
          },
        ],
      }),
    );
    expect(xml).toContain('<w:gridSpan w:val="2"/>');
  });

  test('special characters are escaped', () => {
    const { xml } = buildDocumentXml(doc(p(text('a < b & c > d'))));
    expect(xml).toContain('a &lt; b &amp; c &gt; d');
  });

  test('image renders alt-text placeholder', () => {
    const { xml } = buildDocumentXml(
      doc({ type: 'image', attrs: { src: 'x', alt: 'chart' } }),
    );
    expect(xml).toContain('[image: chart]');
  });
});

describe('package parts', () => {
  test('all required OPC parts are present', () => {
    const parts = buildDocxParts(doc(p(text('hi'))));
    for (const name of [
      '[Content_Types].xml',
      '_rels/.rels',
      'word/document.xml',
      'word/styles.xml',
      'word/numbering.xml',
      'word/_rels/document.xml.rels',
    ]) {
      expect(parts[name]).toBeTruthy();
    }
  });
});

describe('zip writer', () => {
  test('produces a PK-signature ZIP', () => {
    const bytes = zipStore([{ name: 'a.txt', data: new TextEncoder().encode('hello') }]);
    expect(bytes[0]).toBe(0x50); // 'P'
    expect(bytes[1]).toBe(0x4b); // 'K'
    expect(bytes.length).toBeGreaterThan(20);
  });
});

describe('end-to-end .docx integrity (via unzip)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'docx-'));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  const bytes = docToDocxBytes(
    doc(
      { type: 'heading', attrs: { level: 1 }, content: [text('Report')] },
      p(text('Hello '), text('world', { type: 'bold' }), text('.')),
      { type: 'bulletList', content: [li(p(text('one'))), li(p(text('two')))] },
      p(text('link', { type: 'link', attrs: { href: 'https://e.co' } })),
    ),
  );
  const file = join(dir, 'out.docx');
  writeFileSync(file, bytes);

  test('unzip -t reports no errors', () => {
    const r = spawnSync(['unzip', '-t', file]);
    const out = r.stdout.toString() + r.stderr.toString();
    expect(r.exitCode).toBe(0);
    expect(out).toContain('No errors detected');
  });

  test('word/document.xml is present and contains the content', () => {
    const r = spawnSync(['unzip', '-p', file, 'word/document.xml']);
    expect(r.exitCode).toBe(0);
    const xml = r.stdout.toString();
    expect(xml).toContain('Report');
    expect(xml).toContain('world');
    expect(xml).toContain('<w:hyperlink');
  });
});

// --- Bug 1: each ordered list is an independent numbering instance ---------
const ol = (...items: Json[]) => ({ type: 'orderedList', content: items });
const hr = () => ({ type: 'horizontalRule' });

describe('ordered-list numbering restarts per list (bug 1)', () => {
  test('two separate ordered lists get DIFFERENT numIds', () => {
    const { xml, orderedNumIds } = buildDocumentXml(
      doc(ol(li(p(text('a'))), li(p(text('b')))), hr(), ol(li(p(text('c'))), li(p(text('d'))))),
    );
    expect(orderedNumIds.length).toBe(2);
    const [first, second] = orderedNumIds;
    expect(first).not.toBe(second);
    expect(xml).toContain(`<w:numId w:val="${first}"/>`);
    expect(xml).toContain(`<w:numId w:val="${second}"/>`);
    // Regression guard: the two lists must NOT share one continuous instance.
    const numIds = [...xml.matchAll(/<w:numId w:val="(\d+)"\/>/g)].map((m) => m[1]);
    expect(new Set(numIds).size).toBe(2);
  });

  test('numbering.xml emits a restart (startOverride=1) w:num per ordered list', () => {
    const numbering = buildDocxParts(
      doc(ol(li(p(text('a')))), hr(), ol(li(p(text('c'))))),
    )['word/numbering.xml'];
    // One w:num per ordered list, each restarting at 1 off the shared decimal.
    expect((numbering.match(/<w:startOverride w:val="1"\/>/g) ?? []).length).toBe(2);
    expect((numbering.match(/<w:num w:numId="\d+"><w:abstractNumId w:val="1"\/>/g) ?? []).length).toBe(2);
  });

  test('a single ordered list still allocates numId 2 (unchanged mapping)', () => {
    const { xml, orderedNumIds } = buildDocumentXml(doc(ol(li(p(text('only'))))));
    expect(orderedNumIds).toEqual([2]);
    expect(xml).toContain('<w:numId w:val="2"/>');
  });

  test('a nested ordered list shares its parent list numId at a deeper ilvl', () => {
    const { xml, orderedNumIds } = buildDocumentXml(
      doc(
        ol(
          li(p(text('a')), ol(li(p(text('a1'))), li(p(text('a2'))))),
          li(p(text('b'))),
        ),
      ),
    );
    // One continuous multi-level instance, not two.
    expect(orderedNumIds).toEqual([2]);
    expect(xml).toContain('<w:ilvl w:val="0"/><w:numId w:val="2"/>');
    expect(xml).toContain('<w:ilvl w:val="1"/><w:numId w:val="2"/>');
  });

  test('an ordered list nested inside a bullet list is its own instance', () => {
    const { orderedNumIds } = buildDocumentXml(
      doc({
        type: 'bulletList',
        content: [li(p(text('a')), ol(li(p(text('a1')))))],
      }),
    );
    // Fresh numId despite the nesting (the bullet breaks the ordered chain).
    expect(orderedNumIds).toEqual([2]);
  });

  test('bullets never allocate an ordered instance', () => {
    const { xml, orderedNumIds } = buildDocumentXml(
      doc({ type: 'bulletList', content: [li(p(text('a'))), li(p(text('b')))] }),
    );
    expect(orderedNumIds).toEqual([]);
    expect(xml).toContain('<w:numId w:val="1"/>');
  });
});

// --- Bug 2: illegal XML 1.0 control characters are stripped ----------------
const CONTROL_RE = /[\u0000-\u0008\u000B\u000C\u000E-\u001F]/;

describe('C0 control characters are stripped from output (bug 2)', () => {
  test('esc() drops NUL/BEL/US and other illegal control chars', () => {
    const { xml } = buildDocumentXml(doc(p(text('a\x00b\x07c\x1fd'))));
    expect(CONTROL_RE.test(xml)).toBe(false);
    expect(xml).toContain('abcd'); // visible text preserved, controls gone
  });

  test('legal whitespace (tab) is preserved', () => {
    const { xml } = buildDocumentXml(doc(p(text('a\tb'))));
    expect(xml).toContain('a\tb');
  });

  test('control chars in hyperlink targets are stripped too', () => {
    const { xml } = buildDocumentXml(
      doc(p(text('l', { type: 'link', attrs: { href: 'https://e.co/\x01x' } }))),
    );
    const rels = buildDocxParts(
      doc(p(text('l', { type: 'link', attrs: { href: 'https://e.co/\x01x' } }))),
    )['word/_rels/document.xml.rels'];
    expect(CONTROL_RE.test(xml)).toBe(false);
    expect(CONTROL_RE.test(rels)).toBe(false);
  });
});

// --- Bugs 1 & 2 end-to-end: a real archive that unzips and xml-parses ------
describe('end-to-end .docx integrity: numbering + control chars', () => {
  const dir = mkdtempSync(join(tmpdir(), 'docx2-'));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  const bytes = docToDocxBytes(
    doc(
      ol(li(p(text('one'))), li(p(text('two')))),
      hr(),
      ol(li(p(text('three\x00\x07'))), li(p(text('four\x1f')))),
    ),
  );
  const file = join(dir, 'out.docx');
  writeFileSync(file, bytes);

  // Extract a part, assert it is control-char-free and well-formed XML.
  const extractAndValidate = (part: string): string => {
    const r = spawnSync(['unzip', '-p', file, part]);
    expect(r.exitCode).toBe(0);
    const xml = r.stdout.toString();
    expect(CONTROL_RE.test(xml)).toBe(false);
    const partFile = join(dir, part.replace(/\//g, '_'));
    writeFileSync(partFile, xml);
    const lint = spawnSync(['xmllint', '--noout', partFile]);
    expect(lint.stderr.toString()).toBe('');
    expect(lint.exitCode).toBe(0);
    return xml;
  };

  test('unzip -t reports no errors', () => {
    const r = spawnSync(['unzip', '-t', file]);
    const out = r.stdout.toString() + r.stderr.toString();
    expect(r.exitCode).toBe(0);
    expect(out).toContain('No errors detected');
  });

  test('word/document.xml parses, is control-free, and has two distinct lists', () => {
    const xml = extractAndValidate('word/document.xml');
    const ordered = new Set(
      [...xml.matchAll(/<w:numId w:val="(\d+)"\/>/g)].map((m) => m[1]).filter((i) => i !== '1'),
    );
    expect(ordered.size).toBe(2);
  });

  test('word/numbering.xml parses and restarts each ordered list', () => {
    const xml = extractAndValidate('word/numbering.xml');
    expect((xml.match(/<w:startOverride w:val="1"\/>/g) ?? []).length).toBe(2);
  });
});
