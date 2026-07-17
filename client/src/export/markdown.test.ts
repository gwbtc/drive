// Tests for the pure ProseMirror-JSON → Markdown serializer (jsonToMarkdown).
// Fixtures mirror the doc JSON produced by editor.state.doc.toJSON().

import { describe, expect, test } from 'bun:test';
import { jsonToMarkdown } from './markdown';

type Json = Record<string, unknown>;

const doc = (...content: Json[]) => ({ type: 'doc', content });
const md = (...content: Json[]) => jsonToMarkdown(doc(...content));
const p = (...content: Json[]) => ({ type: 'paragraph', content });
const text = (t: string, ...marks: Json[]): Json =>
  marks.length ? { type: 'text', text: t, marks } : { type: 'text', text: t };
const li = (...content: Json[]) => ({ type: 'listItem', content });

describe('document basics', () => {
  test('empty doc serializes to a single newline', () => {
    expect(jsonToMarkdown({ type: 'doc' })).toBe('\n');
    expect(jsonToMarkdown({ type: 'doc', content: [] })).toBe('\n');
  });

  test('a paragraph of plain text', () => {
    expect(md(p(text('hello')))).toBe('hello\n');
  });

  test('paragraphs are separated by blank lines', () => {
    expect(md(p(text('a')), p(text('b')))).toBe('a\n\nb\n');
  });

  test('empty paragraphs are dropped', () => {
    expect(md(p(text('a')), p(), p(text('b')))).toBe('a\n\nb\n');
  });

  test('markdown special characters are not escaped', () => {
    expect(md(p(text('a * b _ c')))).toBe('a * b _ c\n');
  });
});

describe('inline marks', () => {
  test('bold', () => {
    expect(md(p(text('x', { type: 'bold' })))).toBe('**x**\n');
  });

  test('italic', () => {
    expect(md(p(text('x', { type: 'italic' })))).toBe('*x*\n');
  });

  test('strike', () => {
    expect(md(p(text('x', { type: 'strike' })))).toBe('~~x~~\n');
  });

  test('code', () => {
    expect(md(p(text('x', { type: 'code' })))).toBe('`x`\n');
  });

  test('underline uses a <u> tag', () => {
    expect(md(p(text('x', { type: 'underline' })))).toBe('<u>x</u>\n');
  });

  test('highlight uses a <mark> tag', () => {
    expect(md(p(text('x', { type: 'highlight' })))).toBe('<mark>x</mark>\n');
  });

  test('link', () => {
    expect(md(p(text('x', { type: 'link', attrs: { href: 'https://e.co' } })))).toBe(
      '[x](https://e.co)\n',
    );
  });

  test('bold+italic nests as *** regardless of mark order', () => {
    expect(md(p(text('x', { type: 'bold' }, { type: 'italic' })))).toBe('***x***\n');
    expect(md(p(text('x', { type: 'italic' }, { type: 'bold' })))).toBe('***x***\n');
  });

  test('strike wraps outside bold', () => {
    expect(md(p(text('x', { type: 'bold' }, { type: 'strike' })))).toBe('~~**x**~~\n');
  });

  test('link wraps outside other marks', () => {
    expect(
      md(p(text('x', { type: 'bold' }, { type: 'link', attrs: { href: 'https://e.co' } }))),
    ).toBe('[**x**](https://e.co)\n');
    expect(
      md(p(text('x', { type: 'underline' }, { type: 'link', attrs: { href: 'https://e.co' } }))),
    ).toBe('[<u>x</u>](https://e.co)\n');
  });

  test('code suppresses all other styling marks', () => {
    expect(md(p(text('x', { type: 'code' }, { type: 'bold' })))).toBe('`x`\n');
  });

  // NOTE: arguably buggy — the code branch short-circuits the link mark too
  // (markdown.ts:144), so a linked code span loses its link entirely.
  test('code suppresses even the link mark', () => {
    expect(
      md(p(text('x', { type: 'code' }, { type: 'link', attrs: { href: 'https://e.co' } }))),
    ).toBe('`x`\n');
  });

  test('adjacent text nodes concatenate', () => {
    expect(md(p(text('a', { type: 'bold' }), text('b')))).toBe('**a**b\n');
  });

  test('hardBreak becomes two trailing spaces + newline', () => {
    expect(md(p(text('a'), { type: 'hardBreak' }, text('b')))).toBe('a  \nb\n');
  });

  test('inline images render inside paragraphs', () => {
    expect(
      md(p(text('see '), { type: 'image', attrs: { src: 'https://e.co/i.png', alt: 'pic' } })),
    ).toBe('see ![pic](https://e.co/i.png)\n');
  });

  test('unknown inline nodes fall back to their text content', () => {
    expect(md(p({ type: 'weird', content: [text('inner')] }))).toBe('inner\n');
  });
});

describe('headings', () => {
  test('levels map to # counts', () => {
    expect(md({ type: 'heading', attrs: { level: 2 }, content: [text('Title')] })).toBe(
      '## Title\n',
    );
    expect(md({ type: 'heading', attrs: { level: 6 }, content: [text('Deep')] })).toBe(
      '###### Deep\n',
    );
  });

  test('missing or falsy level defaults to 1', () => {
    expect(md({ type: 'heading', content: [text('x')] })).toBe('# x\n');
    expect(md({ type: 'heading', attrs: { level: 0 }, content: [text('x')] })).toBe('# x\n');
  });

  test('out-of-range level clamps to 6', () => {
    expect(md({ type: 'heading', attrs: { level: 9 }, content: [text('x')] })).toBe('###### x\n');
  });

  test('marks work inside headings', () => {
    expect(md({ type: 'heading', attrs: { level: 1 }, content: [text('x', { type: 'bold' })] }))
      .toBe('# **x**\n');
  });
});

describe('lists', () => {
  test('bullet list', () => {
    expect(md({ type: 'bulletList', content: [li(p(text('one'))), li(p(text('two')))] })).toBe(
      '- one\n- two\n',
    );
  });

  test('ordered list numbers sequentially', () => {
    expect(md({ type: 'orderedList', content: [li(p(text('a'))), li(p(text('b')))] })).toBe(
      '1. a\n2. b\n',
    );
  });

  // NOTE: arguably buggy — the `start` attr is ignored (markdown.ts:36);
  // GFM would honor a list starting at 3.
  test('ordered list ignores the start attribute', () => {
    expect(
      md({ type: 'orderedList', attrs: { start: 3 }, content: [li(p(text('a'))), li(p(text('b')))] }),
    ).toBe('1. a\n2. b\n');
  });

  // NOTE: nested lists are emitted with a blank line and 4-space indent,
  // which renders as a loose list rather than a tight nested one.
  test('nested bullet list', () => {
    expect(
      md({
        type: 'bulletList',
        content: [
          li(p(text('a')), {
            type: 'bulletList',
            content: [li(p(text('b')))],
          }),
        ],
      }),
    ).toBe('- a\n\n    - b\n');
  });

  test('multi-paragraph list item indents continuation paragraphs', () => {
    expect(md({ type: 'bulletList', content: [li(p(text('a')), p(text('b')))] })).toBe(
      '- a\n\n    b\n',
    );
  });

  test('task list checked and unchecked items', () => {
    expect(
      md({
        type: 'taskList',
        content: [
          { type: 'taskItem', attrs: { checked: true }, content: [p(text('done'))] },
          { type: 'taskItem', attrs: { checked: false }, content: [p(text('todo'))] },
        ],
      }),
    ).toBe('- [x] done\n- [ ] todo\n');
  });
});

describe('blockquote', () => {
  test('single paragraph', () => {
    expect(md({ type: 'blockquote', content: [p(text('quoted'))] })).toBe('> quoted\n');
  });

  test('multiple paragraphs join with a "> " continuation line', () => {
    expect(md({ type: 'blockquote', content: [p(text('one')), p(text('two'))] })).toBe(
      '> one\n>\n> two\n',
    );
  });

  test('nested block content is prefixed line by line', () => {
    expect(
      md({
        type: 'blockquote',
        content: [{ type: 'bulletList', content: [li(p(text('a'))), li(p(text('b')))] }],
      }),
    ).toBe('> - a\n> - b\n');
  });
});

describe('code blocks and rules', () => {
  test('fenced code block with language', () => {
    expect(
      md({ type: 'codeBlock', attrs: { language: 'js' }, content: [text('const x = 1;')] }),
    ).toBe('```js\nconst x = 1;\n```\n');
  });

  test('fenced code block without language', () => {
    expect(md({ type: 'codeBlock', content: [text('hi')] })).toBe('```\nhi\n```\n');
  });

  test('empty code block keeps its blank body line', () => {
    expect(md({ type: 'codeBlock' })).toBe('```\n\n```\n');
  });

  test('multiple text children concatenate', () => {
    expect(md({ type: 'codeBlock', content: [text('a'), text('b')] })).toBe('```\nab\n```\n');
  });

  test('horizontal rule', () => {
    expect(md(p(text('a')), { type: 'horizontalRule' }, p(text('b')))).toBe('a\n\n---\n\nb\n');
  });
});

describe('images', () => {
  test('block-level image', () => {
    expect(md({ type: 'image', attrs: { src: 'https://e.co/i.png', alt: 'alt text' } })).toBe(
      '![alt text](https://e.co/i.png)\n',
    );
  });

  test('missing alt renders empty brackets', () => {
    expect(md({ type: 'image', attrs: { src: 'https://e.co/i.png' } })).toBe(
      '![](https://e.co/i.png)\n',
    );
  });
});

describe('tables', () => {
  const cell = (type: 'tableHeader' | 'tableCell', ...content: Json[]) => ({ type, content });
  const row = (...content: Json[]) => ({ type: 'tableRow', content });

  // NOTE: arguably buggy — every cell picks up a trailing space because
  // blockToInline appends ' ' after each paragraph (markdown.ts:108), giving
  // double spaces before each pipe. Also: the separator row is always '---';
  // no :--: alignment is emitted despite the comment at markdown.ts:65-67.
  test('header row plus body rows', () => {
    expect(
      md({
        type: 'table',
        content: [
          row(cell('tableHeader', p(text('A'))), cell('tableHeader', p(text('B')))),
          row(cell('tableCell', p(text('1'))), cell('tableCell', p(text('2')))),
        ],
      }),
    ).toBe('| A  | B  |\n| --- | --- |\n| 1  | 2  |\n');
  });

  test('a table with no header cells promotes the first row', () => {
    expect(
      md({
        type: 'table',
        content: [
          row(cell('tableCell', p(text('A'))), cell('tableCell', p(text('B')))),
          row(cell('tableCell', p(text('1'))), cell('tableCell', p(text('2')))),
        ],
      }),
    ).toBe('| A  | B  |\n| --- | --- |\n| 1  | 2  |\n');
  });

  test('pipes inside cells are escaped', () => {
    expect(
      md({
        type: 'table',
        content: [
          row(cell('tableHeader', p(text('a|b')))),
          row(cell('tableCell', p(text('c')))),
        ],
      }),
    ).toBe('| a\\|b  |\n| --- |\n| c  |\n');
  });

  test('multi-paragraph cells flatten to space-separated text', () => {
    expect(
      md({
        type: 'table',
        content: [row(cell('tableHeader', p(text('x')), p(text('y'))))],
      }),
    ).toBe('| x y  |\n| --- |\n');
  });

  test('empty table serializes to nothing', () => {
    expect(md({ type: 'table' })).toBe('\n');
  });
});

describe('fallbacks', () => {
  test('unknown block types serialize their inline content', () => {
    expect(md({ type: 'callout', content: [text('hi')] })).toBe('hi\n');
  });
});
