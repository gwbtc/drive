import type { Editor } from '@tiptap/core';

// Clean, standalone HTML export. `editor.getHTML()` gives us the body markup
// (already the editor's schema — headings/lists/tables/marks/links); we wrap
// it in a minimal, self-contained HTML document with a little readable CSS so
// the file opens nicely on its own in any browser.

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

const STYLES = `
  :root { color-scheme: light dark; }
  body {
    max-width: 720px;
    margin: 48px auto;
    padding: 0 24px;
    font-family: Georgia, "Times New Roman", serif;
    font-size: 17px;
    line-height: 1.7;
    color: #1a1a1a;
  }
  h1 { font-size: 28px; margin: 32px 0 8px; letter-spacing: -0.02em; }
  h2 { font-size: 22px; margin: 28px 0 8px; }
  h3 { font-size: 18px; margin: 24px 0 6px; }
  p { margin: 8px 0; }
  ul, ol { margin: 8px 0; padding-left: 28px; }
  a { color: #1a73e8; }
  blockquote {
    margin: 12px 0;
    padding-left: 16px;
    border-left: 3px solid #ccc;
    color: #555;
  }
  code {
    font-family: ui-monospace, Menlo, monospace;
    background: rgba(0,0,0,0.06);
    padding: 1px 4px;
    border-radius: 4px;
  }
  pre {
    background: rgba(0,0,0,0.06);
    padding: 12px 16px;
    border-radius: 8px;
    overflow: auto;
  }
  pre code { background: none; padding: 0; }
  img { max-width: 100%; height: auto; }
  table { border-collapse: collapse; margin: 12px 0; }
  th, td { border: 1px solid #ccc; padding: 6px 10px; text-align: left; }
  th { background: rgba(0,0,0,0.04); }
  ul[data-type="taskList"] { list-style: none; padding-left: 0; }
  ul[data-type="taskList"] li { display: flex; gap: 8px; align-items: baseline; }
  mark { background: #fff3a3; }
  @media (prefers-color-scheme: dark) {
    body { color: #e8e8e8; background: #1a1a1a; }
    a { color: #8ab4f8; }
  }
`.trim();

/** Pure: wraps body HTML in a full standalone document. Testable off-DOM. */
export function wrapHtml(bodyHtml: string, title: string): string {
  const safeTitle = escapeHtml(title || 'Untitled');
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${safeTitle}</title>
<style>
${STYLES}
</style>
</head>
<body>
<article>
${bodyHtml}
</article>
</body>
</html>
`;
}

export function docToHtml(editor: Editor, title: string): string {
  return wrapHtml(editor.getHTML(), title);
}

export function downloadHtml(editor: Editor, filename: string) {
  const html = docToHtml(editor, filename);
  const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename.replace(/[^\w.-]+/g, '_') + '.html';
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
