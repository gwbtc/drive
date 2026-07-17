import type { Editor } from '@tiptap/core';

// Zero-dependency Tiptap-JSON → .docx exporter.
//
// Why hand-rolled instead of the `docx` npm package: the project ships as a
// single-file IIFE bundle (`bun build --format=iife --outfile`), which cannot
// code-split, so a dynamic `import('docx')` would be INLINED into the main
// js.js (+~420 KB, ~60% larger). The desk serves that one bundle via a
// build-time Clay import, so there is no way to lazy-load a separate vendor
// chunk without editing the Hoon app + service worker (out of scope). A
// small, self-contained OOXML writer keeps the main bundle lean while still
// producing a real Word document.
//
// A .docx is an OPC (Open Packaging Conventions) ZIP of XML parts. We build
// the parts as strings and pack them with a minimal STORE-only ZIP writer.
//
// Mapping coverage:
//   paragraph (+ text-align), heading 1-3, bold, italic, underline, strike,
//   inline code, subscript, superscript, highlight, links (external
//   hyperlink relationships), bullet & ordered lists (nested), task lists
//   (rendered with ☐/☑ prefixes), blockquote (indented + rule), code block,
//   horizontal rule, and tables (with header shading & colspan/gridSpan).
//
// Not mapped (documented gaps): images (rendered as "[image: alt]" text —
// embedding would require fetching each blob and is async/CORS-bound), text
// colour / font family / font size, table cell rowspan (colspan only), and
// ordered-list "start" offsets. These degrade gracefully.

// ---------------------------------------------------------------------------
// XML helpers
// ---------------------------------------------------------------------------

type Node = {
  type: string;
  attrs?: Record<string, any>;
  content?: Node[];
  text?: string;
  marks?: Array<{ type: string; attrs?: Record<string, any> }>;
};

// C0 control characters that are ILLEGAL in XML 1.0 — everything below 0x20
// except tab (#x9), LF (#xA) and CR (#xD). If any survive into document.xml,
// Word (and `unzip`/parsers) reject the whole .docx, so strip them defensively:
// pasted text from odd sources can carry them.
// eslint-disable-next-line no-control-regex
const INVALID_XML_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g;

function esc(s: string): string {
  return s
    .replace(INVALID_XML_CHARS, '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

const XML_DECL = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';
const W_NS =
  'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" ' +
  'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"';

// A collector threaded through serialization to allocate hyperlink rels and
// per-list numbering instances.
//
// `numId` 1 is reserved for bullets (they never need to restart). Every
// independent ordered list gets a FRESH `numId` allocated from `nextNumId`
// (starting at 2) and recorded in `orderedNumIds`, so numbering.xml can emit a
// distinct `w:num` per list that restarts at 1 — otherwise two separate
// numbered lists share one instance and Word counts 1,2,3,4 straight through.
type Ctx = {
  links: Array<{ id: string; target: string }>;
  orderedNumIds: number[];
  nextNumId: number;
};

const BULLET_NUM_ID = 1;

function allocOrderedNumId(ctx: Ctx): number {
  const id = ctx.nextNumId++;
  ctx.orderedNumIds.push(id);
  return id;
}

function alignVal(a: string | undefined): string {
  switch (a) {
    case 'center':
      return 'center';
    case 'right':
      return 'right';
    case 'justify':
      return 'both';
    default:
      return '';
  }
}

// ---------------------------------------------------------------------------
// Inline runs
// ---------------------------------------------------------------------------

function runProps(marks: Node['marks']): { rpr: string; href: string | null } {
  let b = false,
    i = false,
    u = false,
    strike = false,
    code = false,
    sub = false,
    sup = false,
    hl = false;
  let href: string | null = null;
  for (const m of marks ?? []) {
    switch (m.type) {
      case 'bold':
        b = true;
        break;
      case 'italic':
        i = true;
        break;
      case 'underline':
        u = true;
        break;
      case 'strike':
        strike = true;
        break;
      case 'code':
        code = true;
        break;
      case 'subscript':
        sub = true;
        break;
      case 'superscript':
        sup = true;
        break;
      case 'highlight':
        hl = true;
        break;
      case 'link':
        href = m.attrs?.href ?? null;
        break;
    }
  }
  let rpr = '';
  if (b) rpr += '<w:b/>';
  if (i) rpr += '<w:i/>';
  if (u || href) rpr += '<w:u w:val="single"/>';
  if (strike) rpr += '<w:strike/>';
  if (code) rpr += '<w:rFonts w:ascii="Consolas" w:hAnsi="Consolas"/>';
  if (sub) rpr += '<w:vertAlign w:val="subscript"/>';
  if (sup) rpr += '<w:vertAlign w:val="superscript"/>';
  if (hl) rpr += '<w:highlight w:val="yellow"/>';
  if (href) rpr += '<w:color w:val="0563C1"/>';
  return { rpr: rpr ? `<w:rPr>${rpr}</w:rPr>` : '', href };
}

function textRun(text: string, rpr: string): string {
  // Split on newlines so soft breaks inside a text node become <w:br/>.
  const parts = text.split('\n');
  let out = '';
  parts.forEach((part, idx) => {
    if (idx > 0) out += `<w:r>${rpr}<w:br/></w:r>`;
    if (part.length === 0) return;
    out += `<w:r>${rpr}<w:t xml:space="preserve">${esc(part)}</w:t></w:r>`;
  });
  return out;
}

function inlineRuns(nodes: Node[] | undefined, ctx: Ctx, prefix = ''): string {
  let out = prefix ? `<w:r><w:t xml:space="preserve">${esc(prefix)}</w:t></w:r>` : '';
  for (const n of nodes ?? []) {
    if (n.type === 'hardBreak') {
      out += '<w:r><w:br/></w:r>';
      continue;
    }
    if (n.type === 'image') {
      const alt = (n.attrs?.alt as string) || 'image';
      out += `<w:r><w:t xml:space="preserve">${esc('[image: ' + alt + ']')}</w:t></w:r>`;
      continue;
    }
    if (n.type !== 'text') {
      out += inlineRuns(n.content, ctx);
      continue;
    }
    const { rpr, href } = runProps(n.marks);
    const runs = textRun(n.text ?? '', rpr);
    if (href) {
      const id = `rIdL${ctx.links.length + 1}`;
      ctx.links.push({ id, target: href });
      out += `<w:hyperlink r:id="${id}">${runs}</w:hyperlink>`;
    } else {
      out += runs;
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Block nodes
// ---------------------------------------------------------------------------

function paragraph(
  n: Node,
  ctx: Ctx,
  opts: { style?: string; numId?: number; ilvl?: number; extraPpr?: string; prefix?: string } = {},
): string {
  let ppr = '';
  if (opts.style) ppr += `<w:pStyle w:val="${opts.style}"/>`;
  if (opts.numId != null) {
    ppr += `<w:numPr><w:ilvl w:val="${opts.ilvl ?? 0}"/><w:numId w:val="${opts.numId}"/></w:numPr>`;
  }
  if (opts.extraPpr) ppr += opts.extraPpr;
  const jc = alignVal(n.attrs?.textAlign);
  if (jc) ppr += `<w:jc w:val="${jc}"/>`;
  const pPr = ppr ? `<w:pPr>${ppr}</w:pPr>` : '';
  return `<w:p>${pPr}${inlineRuns(n.content, ctx, opts.prefix)}</w:p>`;
}

function headingStyle(level: number): string {
  const l = Math.max(1, Math.min(3, level || 1));
  return `Heading${l}`;
}

function list(
  n: Node,
  ctx: Ctx,
  ordered: boolean,
  depth: number,
  inheritedNumId: number | null,
): string[] {
  // A nested ordered list *directly* inside another ordered list continues the
  // same numbering instance at a deeper ilvl (inheritedNumId). Every other
  // ordered list — top-level, or nested inside a bullet/task list — is an
  // independent list and gets a fresh numId so it restarts at 1. Bullets always
  // use the shared, restart-free bullet instance.
  const numId = ordered ? (inheritedNumId ?? allocOrderedNumId(ctx)) : BULLET_NUM_ID;
  const out: string[] = [];
  for (const item of n.content ?? []) {
    // listItem → its children are paragraphs and/or nested lists.
    for (const child of item.content ?? []) {
      if (child.type === 'bulletList') {
        out.push(...list(child, ctx, false, depth + 1, null));
      } else if (child.type === 'orderedList') {
        // Reuse this list's numId only when the current list is itself ordered.
        out.push(...list(child, ctx, true, depth + 1, ordered ? numId : null));
      } else if (child.type === 'paragraph') {
        out.push(paragraph(child, ctx, { numId, ilvl: depth }));
      } else {
        out.push(...blocks([child], ctx));
      }
    }
  }
  return out;
}

function taskList(n: Node, ctx: Ctx, depth: number): string[] {
  const out: string[] = [];
  for (const item of n.content ?? []) {
    const checked = !!item.attrs?.checked;
    const mark = checked ? '☑ ' : '☐ ';
    let first = true;
    for (const child of item.content ?? []) {
      if (child.type === 'taskList') {
        out.push(...taskList(child, ctx, depth + 1));
      } else if (child.type === 'paragraph') {
        out.push(
          paragraph(child, ctx, {
            prefix: first ? mark : '',
            extraPpr: `<w:ind w:left="${(depth + 1) * 360}"/>`,
          }),
        );
        first = false;
      } else {
        out.push(...blocks([child], ctx));
      }
    }
  }
  return out;
}

const QUOTE_PPR =
  '<w:ind w:left="480"/>' +
  '<w:pBdr><w:left w:val="single" w:sz="18" w:space="8" w:color="CCCCCC"/></w:pBdr>';

function blockquote(n: Node, ctx: Ctx): string[] {
  const out: string[] = [];
  for (const child of n.content ?? []) {
    if (child.type === 'paragraph') {
      out.push(paragraph(child, ctx, { extraPpr: QUOTE_PPR }));
    } else {
      out.push(...blocks([child], ctx));
    }
  }
  if (out.length === 0) out.push(`<w:p><w:pPr>${QUOTE_PPR}</w:pPr></w:p>`);
  return out;
}

function codeBlock(n: Node, ctx: Ctx): string {
  void ctx;
  const text = (n.content ?? []).map((c) => c.text ?? '').join('');
  const rpr = '<w:rPr><w:rFonts w:ascii="Consolas" w:hAnsi="Consolas"/></w:rPr>';
  const runs = textRun(text, rpr);
  return `<w:p><w:pPr><w:shd w:val="clear" w:color="auto" w:fill="F5F5F5"/></w:pPr>${runs}</w:p>`;
}

const HR_PARAGRAPH =
  '<w:p><w:pPr><w:pBdr><w:bottom w:val="single" w:sz="6" w:space="1" w:color="CCCCCC"/></w:pBdr></w:pPr></w:p>';

const CELL_BORDERS =
  '<w:tcBorders>' +
  '<w:top w:val="single" w:sz="4" w:color="CCCCCC"/>' +
  '<w:bottom w:val="single" w:sz="4" w:color="CCCCCC"/>' +
  '<w:left w:val="single" w:sz="4" w:color="CCCCCC"/>' +
  '<w:right w:val="single" w:sz="4" w:color="CCCCCC"/>' +
  '</w:tcBorders>';

function tableCell(cell: Node, ctx: Ctx): string {
  const isHeader = cell.type === 'tableHeader';
  const colspan = Number(cell.attrs?.colspan) || 1;
  let tcpr = CELL_BORDERS;
  if (colspan > 1) tcpr += `<w:gridSpan w:val="${colspan}"/>`;
  if (isHeader) tcpr += '<w:shd w:val="clear" w:color="auto" w:fill="F0F0F0"/>';
  let body = blocks(cell.content ?? [], ctx).join('');
  if (!body) body = '<w:p/>'; // a cell must contain at least one paragraph
  return `<w:tc><w:tcPr>${tcpr}</w:tcPr>${body}</w:tc>`;
}

function table(n: Node, ctx: Ctx): string {
  const rows = n.content ?? [];
  let cols = 0;
  for (const row of rows) {
    let c = 0;
    for (const cell of row.content ?? []) c += Number(cell.attrs?.colspan) || 1;
    cols = Math.max(cols, c);
  }
  const grid = `<w:tblGrid>${'<w:gridCol/>'.repeat(Math.max(1, cols))}</w:tblGrid>`;
  const tblPr =
    '<w:tblPr>' +
    '<w:tblW w:w="0" w:type="auto"/>' +
    '<w:tblBorders>' +
    '<w:top w:val="single" w:sz="4" w:color="CCCCCC"/>' +
    '<w:bottom w:val="single" w:sz="4" w:color="CCCCCC"/>' +
    '<w:left w:val="single" w:sz="4" w:color="CCCCCC"/>' +
    '<w:right w:val="single" w:sz="4" w:color="CCCCCC"/>' +
    '<w:insideH w:val="single" w:sz="4" w:color="CCCCCC"/>' +
    '<w:insideV w:val="single" w:sz="4" w:color="CCCCCC"/>' +
    '</w:tblBorders>' +
    '</w:tblPr>';
  let body = '';
  for (const row of rows) {
    const cells = (row.content ?? []).map((c) => tableCell(c, ctx)).join('');
    body += `<w:tr>${cells}</w:tr>`;
  }
  return `<w:tbl>${tblPr}${grid}${body}</w:tbl>`;
}

function blocks(nodes: Node[], ctx: Ctx): string[] {
  const out: string[] = [];
  for (const n of nodes) {
    switch (n.type) {
      case 'paragraph':
        out.push(paragraph(n, ctx));
        break;
      case 'heading':
        out.push(paragraph(n, ctx, { style: headingStyle(n.attrs?.level) }));
        break;
      case 'bulletList':
        out.push(...list(n, ctx, false, 0, null));
        break;
      case 'orderedList':
        out.push(...list(n, ctx, true, 0, null));
        break;
      case 'taskList':
        out.push(...taskList(n, ctx, 0));
        break;
      case 'blockquote':
        out.push(...blockquote(n, ctx));
        break;
      case 'codeBlock':
        out.push(codeBlock(n, ctx));
        break;
      case 'horizontalRule':
        out.push(HR_PARAGRAPH);
        break;
      case 'table':
        out.push(table(n, ctx));
        break;
      case 'image':
        out.push(paragraph({ type: 'paragraph', content: [n] }, ctx));
        break;
      default:
        // Unknown block: serialize any inline content into a paragraph.
        if (n.content) out.push(paragraph({ type: 'paragraph', content: n.content }, ctx));
        break;
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Package parts
// ---------------------------------------------------------------------------

/** Pure: ProseMirror doc JSON → `word/document.xml` body + collected links. */
export function buildDocumentXml(doc: any): {
  xml: string;
  links: Ctx['links'];
  orderedNumIds: number[];
} {
  const ctx: Ctx = { links: [], orderedNumIds: [], nextNumId: 2 };
  const body = blocks(doc?.content ?? [], ctx).join('\n');
  const sectPr =
    '<w:sectPr><w:pgSz w:w="12240" w:h="15840"/>' +
    '<w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="720" w:footer="720" w:gutter="0"/></w:sectPr>';
  const xml =
    XML_DECL + `<w:document ${W_NS}><w:body>${body}${sectPr}</w:body></w:document>`;
  return { xml, links: ctx.links, orderedNumIds: ctx.orderedNumIds };
}

const CONTENT_TYPES =
  XML_DECL +
  '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
  '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
  '<Default Extension="xml" ContentType="application/xml"/>' +
  '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
  '<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>' +
  '<Override PartName="/word/numbering.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml"/>' +
  '</Types>';

const ROOT_RELS =
  XML_DECL +
  '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
  '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>' +
  '</Relationships>';

function headingStyleXml(id: string, name: string, outline: number, sz: number): string {
  return (
    `<w:style w:type="paragraph" w:styleId="${id}"><w:name w:val="${name}"/>` +
    `<w:basedOn w:val="Normal"/><w:next w:val="Normal"/>` +
    `<w:pPr><w:keepNext/><w:spacing w:before="240" w:after="60"/><w:outlineLvl w:val="${outline}"/></w:pPr>` +
    `<w:rPr><w:b/><w:sz w:val="${sz}"/></w:rPr></w:style>`
  );
}

const STYLES_XML =
  XML_DECL +
  `<w:styles ${W_NS}>` +
  '<w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri"/><w:sz w:val="22"/></w:rPr></w:rPrDefault></w:docDefaults>' +
  '<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style>' +
  headingStyleXml('Heading1', 'heading 1', 0, 48) +
  headingStyleXml('Heading2', 'heading 2', 1, 36) +
  headingStyleXml('Heading3', 'heading 3', 2, 28) +
  '</w:styles>';

function numLevels(format: 'bullet' | 'decimal'): string {
  let out = '';
  for (let lvl = 0; lvl < 9; lvl++) {
    const indent = 720 * (lvl + 1);
    if (format === 'bullet') {
      out +=
        `<w:lvl w:ilvl="${lvl}"><w:start w:val="1"/><w:numFmt w:val="bullet"/>` +
        `<w:lvlText w:val="•"/><w:lvlJc w:val="left"/>` +
        `<w:pPr><w:ind w:left="${indent}" w:hanging="360"/></w:pPr>` +
        `<w:rPr><w:rFonts w:ascii="Symbol" w:hAnsi="Symbol"/></w:rPr></w:lvl>`;
    } else {
      out +=
        `<w:lvl w:ilvl="${lvl}"><w:start w:val="1"/><w:numFmt w:val="decimal"/>` +
        `<w:lvlText w:val="%${lvl + 1}."/><w:lvlJc w:val="left"/>` +
        `<w:pPr><w:ind w:left="${indent}" w:hanging="360"/></w:pPr></w:lvl>`;
    }
  }
  return out;
}

// Two abstract definitions (0 = bullet, 1 = decimal) are shared by every list;
// the `w:num` INSTANCES are emitted per document. Bullets all point at one
// instance (numId 1). Each ordered list gets its own instance referencing the
// shared decimal abstractNum, with a level-0 `w:startOverride` forcing it to
// restart at 1 — so a second numbered list begins at 1, not where the first
// left off.
function buildNumberingXml(orderedNumIds: number[]): string {
  let nums = `<w:num w:numId="${BULLET_NUM_ID}"><w:abstractNumId w:val="0"/></w:num>`;
  for (const id of orderedNumIds) {
    nums +=
      `<w:num w:numId="${id}"><w:abstractNumId w:val="1"/>` +
      '<w:lvlOverride w:ilvl="0"><w:startOverride w:val="1"/></w:lvlOverride>' +
      '</w:num>';
  }
  return (
    XML_DECL +
    `<w:numbering ${W_NS}>` +
    `<w:abstractNum w:abstractNumId="0">${numLevels('bullet')}</w:abstractNum>` +
    `<w:abstractNum w:abstractNumId="1">${numLevels('decimal')}</w:abstractNum>` +
    nums +
    '</w:numbering>'
  );
}

function documentRels(links: Ctx['links']): string {
  let out =
    XML_DECL +
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>' +
    '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/numbering" Target="numbering.xml"/>';
  for (const l of links) {
    out += `<Relationship Id="${l.id}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="${esc(
      l.target,
    )}" TargetMode="External"/>`;
  }
  out += '</Relationships>';
  return out;
}

/** Pure: assemble every part of the .docx package as name→string. */
export function buildDocxParts(doc: any): Record<string, string> {
  const { xml, links, orderedNumIds } = buildDocumentXml(doc);
  return {
    '[Content_Types].xml': CONTENT_TYPES,
    '_rels/.rels': ROOT_RELS,
    'word/document.xml': xml,
    'word/styles.xml': STYLES_XML,
    'word/numbering.xml': buildNumberingXml(orderedNumIds),
    'word/_rels/document.xml.rels': documentRels(links),
  };
}

// ---------------------------------------------------------------------------
// Minimal STORE-only ZIP writer (no external deps)
// ---------------------------------------------------------------------------

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

/** Pure: pack files into a ZIP (stored, uncompressed). Returns raw bytes. */
export function zipStore(files: Array<{ name: string; data: Uint8Array }>): Uint8Array {
  const enc = new TextEncoder();
  const chunks: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;

  const u16 = (v: number) => new Uint8Array([v & 0xff, (v >>> 8) & 0xff]);
  const u32 = (v: number) =>
    new Uint8Array([v & 0xff, (v >>> 8) & 0xff, (v >>> 16) & 0xff, (v >>> 24) & 0xff]);
  const push = (arr: Uint8Array[], ...parts: Uint8Array[]) => {
    for (const p of parts) arr.push(p);
  };

  for (const f of files) {
    const nameBytes = enc.encode(f.name);
    const crc = crc32(f.data);
    const size = f.data.length;

    // Local file header (bit 11 flags UTF-8 filenames).
    const local: Uint8Array[] = [];
    push(
      local,
      u32(0x04034b50),
      u16(20),
      u16(0x0800),
      u16(0),
      u16(0),
      u16(0),
      u32(crc),
      u32(size),
      u32(size),
      u16(nameBytes.length),
      u16(0),
      nameBytes,
      f.data,
    );
    const localSize = local.reduce((a, p) => a + p.length, 0);
    for (const p of local) chunks.push(p);

    // Central directory record.
    push(
      central,
      u32(0x02014b50),
      u16(20),
      u16(20),
      u16(0x0800),
      u16(0),
      u16(0),
      u16(0),
      u32(crc),
      u32(size),
      u32(size),
      u16(nameBytes.length),
      u16(0),
      u16(0),
      u16(0),
      u16(0),
      u32(0),
      u32(offset),
      nameBytes,
    );

    offset += localSize;
  }

  const centralSize = central.reduce((a, p) => a + p.length, 0);
  const centralOffset = offset;
  for (const p of central) chunks.push(p);

  const eocd: Uint8Array[] = [];
  push(
    eocd,
    u32(0x06054b50),
    u16(0),
    u16(0),
    u16(files.length),
    u16(files.length),
    u32(centralSize),
    u32(centralOffset),
    u16(0),
  );
  for (const p of eocd) chunks.push(p);

  const total = chunks.reduce((a, p) => a + p.length, 0);
  const out = new Uint8Array(total);
  let pos = 0;
  for (const p of chunks) {
    out.set(p, pos);
    pos += p.length;
  }
  return out;
}

/** Pure: ProseMirror doc JSON → .docx bytes. */
export function docToDocxBytes(doc: any): Uint8Array {
  const parts = buildDocxParts(doc);
  const enc = new TextEncoder();
  const files = Object.entries(parts).map(([name, str]) => ({ name, data: enc.encode(str) }));
  return zipStore(files);
}

export function downloadDocx(editor: Editor, filename: string) {
  const bytes = docToDocxBytes(editor.getJSON());
  const blob = new Blob([bytes as BlobPart], {
    type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename.replace(/[^\w.-]+/g, '_') + '.docx';
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
