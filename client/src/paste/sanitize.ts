// Pure, DOM-free HTML sanitizer for pasted content (Word / Google Docs / web).
//
// Wired via Tiptap's `editorProps.transformPastedHTML`, which hands us the raw
// clipboard HTML string BEFORE any ProseMirror transaction is created — so it
// is fully compatible with the Yjs-bound (Collaboration) editor: the cleaned
// HTML is parsed into the schema and applied as an ordinary collaborative
// update, exactly like typed input.
//
// Strategy: keep the semantic structure the editor's schema understands
// (headings, lists, tables, bold/italic/underline/strike/links) and drop the
// junk that makes pasted content ugly:
//   - Office conditional comments and `<o:p>` / `<w:*>` namespaced tags
//   - `<style>` / `<script>` / `<xml>` / `<head>` blocks (with their contents)
//   - class / id / lang / dir / align / width / data-* attributes
//   - inline styles, EXCEPT a whitelist of formatting properties the editor
//     understands (font-weight, font-style, text-decoration[-line],
//     text-align, vertical-align). This preserves Google Docs bold/italic —
//     which it encodes as `<span style="font-weight:700">` rather than
//     `<b>`/`<i>` — while dropping colours, font families, font sizes,
//     margins, line-heights and every `mso-*` declaration.
//   - attribute-less / junk-only `<span>` wrappers (unwrapped)
//   - unknown wrapper tags like `<font>`, `<section>`, `<o:p>` (unwrapped,
//     keeping their children); `<div>` is renamed to `<p>` so block breaks
//     survive.
//
// Kept intentionally regex/string based (no DOMParser) so it is a genuinely
// pure function and can be unit-tested under `bun test` with real fixtures.

// Tags we keep in the output. `span` and `div` are handled specially below.
const ALLOWED_TAGS = new Set([
  'p', 'br', 'hr',
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'ul', 'ol', 'li',
  'strong', 'b', 'em', 'i', 'u', 's', 'strike', 'del',
  'sub', 'sup', 'mark', 'code', 'pre',
  'blockquote',
  'a', 'img',
  'table', 'thead', 'tbody', 'tfoot', 'tr', 'td', 'th', 'caption',
  'span',
]);

// CSS declarations worth preserving; everything else (colour, font-family,
// font-size, margin, line-height, mso-*, …) is discarded.
const STYLE_WHITELIST = new Set([
  'font-weight',
  'font-style',
  'text-decoration',
  'text-decoration-line',
  'text-align',
  'vertical-align',
]);

// Matches a single start/end tag. Assumes no literal '>' inside attribute
// values (true for clipboard formatting HTML). Group 1 = optional '/', group
// 2 = tag name, group 3 = the raw attribute text (may end with '/').
const TAG_RE = /<(\/?)\s*([a-zA-Z][\w:-]*)([^>]*?)>/g;

function getAttr(rest: string, name: string): string | null {
  // Anchor the attribute name to a boundary (tag-start or whitespace) so a
  // lookup for `href` does NOT match inside `data-href` / `xhref` and pull the
  // wrong value. `(?:^|\s)` is non-capturing, so group indices are unchanged.
  const re = new RegExp(
    `(?:^|\\s)` + name + `\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s>]+))`,
    'i',
  );
  const m = rest.match(re);
  if (!m) return null;
  return m[2] ?? m[3] ?? m[4] ?? '';
}

// --- URL scheme safety -----------------------------------------------------
// Read the scheme after removing characters browsers ignore inside URLs
// (ASCII whitespace + control chars), defeating `java\tscript:` style bypasses.
function urlScheme(url: string): string {
  const cleaned = url.replace(/[\u0000-\u0020]/g, '');
  const m = /^([a-z][a-z0-9+.-]*):/i.exec(cleaned);
  return m ? m[1].toLowerCase() : '';
}

// Hostile for a hyperlink: can execute script (javascript:/vbscript:) or smuggle
// markup (any data: URL — an <a href="data:text/html,…"> is a classic XSS).
function isUnsafeHref(url: string): boolean {
  const s = urlScheme(url);
  return s === 'javascript' || s === 'vbscript' || s === 'data';
}

// Hostile for an image src: script schemes always; data: only when it is NOT a
// real inline image (`data:image/*` is legitimate pasted content and kept).
function isUnsafeImgSrc(url: string): boolean {
  const s = urlScheme(url);
  if (s === 'javascript' || s === 'vbscript') return true;
  if (s === 'data') return !/^data:image\//i.test(url.replace(/[\u0000-\u0020]/g, ''));
  return false;
}

function filterStyle(style: string | null): string {
  if (!style) return '';
  const keep: string[] = [];
  for (const decl of style.split(';')) {
    const idx = decl.indexOf(':');
    if (idx < 0) continue;
    const prop = decl.slice(0, idx).trim().toLowerCase();
    const val = decl.slice(idx + 1).trim();
    if (!val) continue;
    if (STYLE_WHITELIST.has(prop) && !/mso-/i.test(val)) {
      keep.push(`${prop}:${val}`);
    }
  }
  return keep.join(';');
}

function escAttr(v: string): string {
  return v.replace(/"/g, '&quot;');
}

function filterAttrs(tag: string, rest: string): string {
  let out = '';
  const style = filterStyle(getAttr(rest, 'style'));
  if (style) out += ` style="${escAttr(style)}"`;
  if (tag === 'a') {
    const href = getAttr(rest, 'href');
    if (href && !isUnsafeHref(href)) out += ` href="${escAttr(href)}"`;
  }
  if (tag === 'img') {
    const src = getAttr(rest, 'src');
    const alt = getAttr(rest, 'alt');
    if (src && !isUnsafeImgSrc(src)) out += ` src="${escAttr(src)}"`;
    if (alt) out += ` alt="${escAttr(alt)}"`;
  }
  if (tag === 'td' || tag === 'th') {
    for (const a of ['colspan', 'rowspan']) {
      const v = getAttr(rest, a);
      if (v && /^\d+$/.test(v)) out += ` ${a}="${v}"`;
    }
  }
  return out;
}

/**
 * Clean a raw pasted-HTML string down to the editor's supported subset.
 * Pure: no DOM, no side effects.
 */
export function sanitizePastedHtml(html: string): string {
  if (!html) return '';
  let s = html;

  // --- Pre-clean: strip blocks whose *contents* must go too. -------------
  s = s.replace(/<!--[\s\S]*?-->/g, ''); // comments incl. <!--[if]>..<![endif]-->
  s = s.replace(/<\?[\s\S]*?\?>/g, ''); // xml processing instructions
  s = s.replace(/<(script|style|head|title|select|option)\b[\s\S]*?<\/\1>/gi, '');
  s = s.replace(/<xml\b[\s\S]*?<\/xml>/gi, '');
  s = s.replace(/<!\[if[\s\S]*?\]>/gi, '').replace(/<!\[endif\]>/gi, '');
  s = s.replace(/<!DOCTYPE[^>]*>/gi, '');

  // --- Tag pass: rewrite/keep/unwrap every remaining tag. ----------------
  const spanStack: Array<'keep' | 'drop'> = [];
  s = s.replace(TAG_RE, (_m, slash: string, rawName: string, rest: string) => {
    const isEnd = slash === '/';
    let lower = rawName.toLowerCase();

    // Namespaced Office tags: <o:p>, <w:sdt>, <m:oMath>, … → drop entirely.
    if (lower.includes(':')) return '';

    // Preserve paragraph breaks: treat <div> like <p>. The browser DOM that
    // ProseMirror parses with normalises any resulting <p><p> nesting.
    if (lower === 'div') lower = 'p';

    const selfClose = /\/\s*$/.test(rest);

    if (lower === 'span') {
      if (isEnd) {
        return spanStack.pop() === 'keep' ? '</span>' : '';
      }
      if (selfClose) return '';
      const style = filterStyle(getAttr(rest, 'style'));
      if (style) {
        spanStack.push('keep');
        return `<span style="${escAttr(style)}">`;
      }
      spanStack.push('drop');
      return '';
    }

    // Unknown/formatting wrappers (font, section, article, b-with-namespace…)
    // are unwrapped: drop the tag, keep the children.
    if (!ALLOWED_TAGS.has(lower)) return '';

    if (isEnd) return `</${lower}>`;
    return `<${lower}${filterAttrs(lower, rest)}>`;
  });

  // --- Tidy whitespace: collapse runs of blank lines. --------------------
  s = s.replace(/[ \t]*\r?\n(?:[ \t]*\r?\n)+/g, '\n');
  return s.trim();
}
