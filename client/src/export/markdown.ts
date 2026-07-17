import type { Editor } from '@tiptap/core';

// Minimal Tiptap → Markdown serializer for our schema. Hand-rolled to avoid
// pulling in prosemirror-markdown (~80KB) for what amounts to ~10 node types.
// Output is GitHub-flavored: pipe tables, task list checkboxes, fenced code.

type Node = any; // ProseMirror node — we only read .type.name, .attrs, .content, .text

export function docToMarkdown(editor: Editor): string {
  return jsonToMarkdown(editor.state.doc.toJSON());
}

// Pure serializer entry point: takes ProseMirror doc JSON (the output of
// `editor.state.doc.toJSON()`), so it can run outside a browser.
export function jsonToMarkdown(doc: Node): string {
  return blocks(doc?.content || []).trim() + '\n';
}

function blocks(nodes: Node[]): string {
  return nodes.map(block).filter(Boolean).join('\n\n');
}

function block(n: Node): string {
  switch (n.type) {
    case 'paragraph':
      return alignWrap(n, inline(n.content || []));
    case 'heading': {
      const level = Math.max(1, Math.min(6, n.attrs?.level || 1));
      return alignWrap(n, '#'.repeat(level) + ' ' + inline(n.content || []));
    }
    case 'blockquote':
      return (n.content || []).map((c: Node) => '> ' + block(c).replace(/\n/g, '\n> ')).join('\n>\n');
    case 'bulletList':
      return (n.content || []).map((li: Node) => '- ' + listItemBody(li)).join('\n');
    case 'orderedList':
      return (n.content || []).map((li: Node, i: number) => `${i + 1}. ${listItemBody(li)}`).join('\n');
    case 'taskList':
      return (n.content || []).map((li: Node) => {
        const checked = li.attrs?.checked ? 'x' : ' ';
        return `- [${checked}] ${listItemBody(li)}`;
      }).join('\n');
    case 'codeBlock': {
      const lang = n.attrs?.language || '';
      const body = (n.content || []).map((c: Node) => c.text || '').join('');
      return '```' + lang + '\n' + body + '\n```';
    }
    case 'horizontalRule':
      return '---';
    case 'image': {
      const src = n.attrs?.src || '';
      const alt = n.attrs?.alt || '';
      return `![${alt}](${src})`;
    }
    case 'table':
      return table(n);
    case 'hardBreak':
      return '  ';
    default:
      // Fallback: serialize as inline if it has text content.
      return inline(n.content || []);
  }
}

function alignWrap(n: Node, body: string): string {
  // We don't have a native markdown alignment; emit raw body. Tables emit
  // GFM `:--:` alignments separately.
  return body;
}

function listItemBody(li: Node): string {
  const parts: string[] = (li.content || []).map((c: Node) => block(c));
  // Indent continuation lines so nested lists stay attached to the item.
  return parts
    .map((p, i) => (i === 0 ? p : p.split('\n').map((l) => '  ' + l).join('\n')))
    .join('\n\n  ');
}

function table(t: Node): string {
  const rows: Node[] = t.content || [];
  if (rows.length === 0) return '';
  const lines: string[] = [];
  let header: Node[] = [];
  let body: Node[][] = [];
  rows.forEach((row: Node, idx: number) => {
    const cells = row.content || [];
    if (idx === 0 && cells.some((c: Node) => c.type === 'tableHeader')) header = cells;
    else body.push(cells);
  });
  if (header.length === 0) {
    header = rows[0].content || [];
    body = rows.slice(1).map((r: Node) => r.content || []);
  }
  const cellText = (c: Node) => inline(blockToInline(c)).replace(/\|/g, '\\|').replace(/\n/g, ' ');
  lines.push('| ' + header.map(cellText).join(' | ') + ' |');
  lines.push('| ' + header.map(() => '---').join(' | ') + ' |');
  for (const row of body) {
    lines.push('| ' + row.map(cellText).join(' | ') + ' |');
  }
  return lines.join('\n');
}

function blockToInline(c: Node): Node[] {
  // Tables contain blocks (paragraphs) inside cells; flatten to inline.
  const out: Node[] = [];
  for (const child of c.content || []) {
    if (child.type === 'paragraph') {
      for (const t of child.content || []) out.push(t);
      out.push({ type: 'text', text: ' ' });
    } else {
      out.push(child);
    }
  }
  return out;
}

function inline(nodes: Node[]): string {
  let out = '';
  for (const n of nodes) {
    if (n.type === 'hardBreak') {
      out += '  \n';
      continue;
    }
    if (n.type !== 'text') {
      if (n.type === 'image') {
        out += `![${n.attrs?.alt || ''}](${n.attrs?.src || ''})`;
        continue;
      }
      // Unknown inline; fall back to its text content.
      out += inline(n.content || []);
      continue;
    }
    let s = n.text ?? '';
    const marks = n.marks || [];
    let bold = false, italic = false, strike = false, code = false, underline = false, link: string | null = null, mark = false;
    for (const m of marks) {
      if (m.type === 'bold') bold = true;
      else if (m.type === 'italic') italic = true;
      else if (m.type === 'strike') strike = true;
      else if (m.type === 'code') code = true;
      else if (m.type === 'underline') underline = true;
      else if (m.type === 'highlight') mark = true;
      else if (m.type === 'link') link = m.attrs?.href || null;
    }
    if (code) s = '`' + s + '`';
    else {
      if (bold) s = '**' + s + '**';
      if (italic) s = '*' + s + '*';
      if (strike) s = '~~' + s + '~~';
      if (underline) s = '<u>' + s + '</u>';
      if (mark) s = '<mark>' + s + '</mark>';
      if (link) s = `[${s}](${link})`;
    }
    out += s;
  }
  return out;
}

export function downloadMarkdown(editor: Editor, filename: string) {
  const md = docToMarkdown(editor);
  const blob = new Blob([md], { type: 'text/markdown;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename.replace(/[^\w.-]+/g, '_') + '.md';
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
