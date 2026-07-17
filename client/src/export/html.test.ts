// Tests for the pure HTML document wrapper.

import { describe, expect, test } from 'bun:test';
import { wrapHtml } from './html';

describe('wrapHtml', () => {
  test('produces a standalone HTML document', () => {
    const out = wrapHtml('<p>hi</p>', 'My Doc');
    expect(out.startsWith('<!doctype html>')).toBe(true);
    expect(out).toContain('<meta charset="utf-8">');
    expect(out).toContain('<title>My Doc</title>');
    expect(out).toContain('<p>hi</p>');
    expect(out).toContain('</html>');
  });

  test('embeds inline styles (self-contained, no external assets)', () => {
    const out = wrapHtml('<p>x</p>', 'T');
    expect(out).toContain('<style>');
    expect(out).not.toContain('http://');
    expect(out).not.toContain('src=');
  });

  test('escapes the title', () => {
    const out = wrapHtml('<p>x</p>', 'A <b> & "C"');
    expect(out).toContain('<title>A &lt;b&gt; &amp; "C"</title>');
    expect(out).not.toContain('<title>A <b>');
  });

  test('falls back to Untitled for an empty title', () => {
    expect(wrapHtml('<p>x</p>', '')).toContain('<title>Untitled</title>');
  });

  test('does not escape the body html (already schema-safe)', () => {
    const out = wrapHtml('<h1>Title</h1><ul><li>a</li></ul>', 'T');
    expect(out).toContain('<h1>Title</h1>');
    expect(out).toContain('<ul><li>a</li></ul>');
  });
});
