import { describe, expect, test } from 'bun:test';
import * as Y from 'yjs';
import {
  extractText,
  xmlFragmentText,
  sheetText,
  makeSnippet,
  scanEntries,
  type IndexEntry,
} from './indexer';

// Build a Tiptap-shaped doc: XmlFragment 'default' with block elements.
const richDoc = (): Y.Doc => {
  const d = new Y.Doc();
  const frag = d.getXmlFragment('default');
  const p1 = new Y.XmlElement('paragraph');
  p1.insert(0, [new Y.XmlText('Hello world.')]);
  const list = new Y.XmlElement('bulletList');
  const item = new Y.XmlElement('listItem');
  const p2 = new Y.XmlElement('paragraph');
  p2.insert(0, [new Y.XmlText('nested item')]);
  item.insert(0, [p2]);
  list.insert(0, [item]);
  frag.insert(0, [p1, list]);
  return d;
};

describe('xmlFragmentText', () => {
  test('collects text across nested block elements with separators', () => {
    const d = richDoc();
    expect(xmlFragmentText(d.getXmlFragment('default'))).toBe(
      'Hello world. nested item',
    );
  });

  test('strips formatting attributes instead of serializing them as tags', () => {
    const d = new Y.Doc();
    const frag = d.getXmlFragment('default');
    const p = new Y.XmlElement('paragraph');
    const t = new Y.XmlText('bold and plain');
    p.insert(0, [t]);
    frag.insert(0, [p]);
    t.format(0, 4, { bold: {} });
    const out = xmlFragmentText(frag);
    expect(out).toBe('bold and plain');
    expect(out).not.toContain('<');
  });

  test('empty fragment yields empty string', () => {
    const d = new Y.Doc();
    expect(xmlFragmentText(d.getXmlFragment('default'))).toBe('');
  });
});

describe('extractText (text/note)', () => {
  test('reads the Tiptap XmlFragment', () => {
    expect(extractText(richDoc(), 'text')).toBe('Hello world. nested item');
  });

  test("includes plain Y.Text 't' (e2e-written docs)", () => {
    const d = new Y.Doc();
    d.getText('t').insert(0, 'legacy plain text');
    expect(extractText(d, 'note')).toBe('legacy plain text');
  });

  test("concatenates fragment and 't' when both are present", () => {
    const d = richDoc();
    d.getText('t').insert(0, 'tail text');
    expect(extractText(d, 'text')).toBe('Hello world. nested item tail text');
  });
});

describe('extractText (sheet)', () => {
  test('joins cell values, formulas included, in sorted-key order', () => {
    const d = new Y.Doc();
    const cells = d.getMap('cells');
    cells.set('B1', '=SUM(A1:A9)');
    cells.set('A1', 'Revenue');
    cells.set('A2', '100');
    expect(extractText(d, 'sheet')).toBe('Revenue 100 =SUM(A1:A9)');
    expect(sheetText(d.getMap('cells'))).toContain('=SUM(A1:A9)');
  });

  test('skips empty and non-string values', () => {
    const d = new Y.Doc();
    const cells = d.getMap('cells');
    cells.set('A1', 'kept');
    cells.set('A2', '');
    expect(sheetText(cells)).toBe('kept');
  });
});

describe('makeSnippet', () => {
  test('match at the start of a short text: no ellipses, exact offsets', () => {
    const { snippet, matchStart, matchEnd } = makeSnippet('needle in a haystack', 0, 6);
    expect(snippet).toBe('needle in a haystack');
    expect(matchStart).toBe(0);
    expect(matchEnd).toBe(6);
    expect(snippet.slice(matchStart, matchEnd)).toBe('needle');
  });

  test('match mid-text: ellipses on both sides, offsets track the shift', () => {
    const text = 'a'.repeat(100) + 'NEEDLE' + 'b'.repeat(100);
    const { snippet, matchStart, matchEnd } = makeSnippet(text, 100, 6);
    expect(snippet.startsWith('…')).toBe(true);
    expect(snippet.endsWith('…')).toBe(true);
    expect(snippet.slice(matchStart, matchEnd)).toBe('NEEDLE');
    // ~80 chars of context + match + two ellipses.
    expect(snippet.length).toBe(1 + 40 + 6 + 40 + 1);
  });

  test('match near the end: no trailing ellipsis', () => {
    const text = 'x'.repeat(60) + 'end';
    const { snippet, matchStart, matchEnd } = makeSnippet(text, 60, 3);
    expect(snippet.endsWith('end')).toBe(true);
    expect(snippet.startsWith('…')).toBe(true);
    expect(snippet.slice(matchStart, matchEnd)).toBe('end');
  });
});

const entry = (over: Partial<IndexEntry>): IndexEntry => ({
  id: '0v1',
  title: 'Doc',
  type: 'text',
  text: '',
  modified: 0,
  indexedAt: 0,
  ...over,
});

describe('scanEntries', () => {
  test('case-insensitive match, preserving original casing in the snippet', () => {
    const hits = scanEntries(
      [entry({ id: 'a', text: 'Quarterly Budget Review' })],
      'bUdGeT',
      8,
    );
    expect(hits.length).toBe(1);
    const h = hits[0];
    expect(h.snippet.slice(h.matchStart, h.matchEnd)).toBe('Budget');
  });

  test('orders by modified descending and honors the limit', () => {
    const es = [
      entry({ id: 'old', text: 'shared term', modified: 1 }),
      entry({ id: 'new', text: 'shared term', modified: 3 }),
      entry({ id: 'mid', text: 'shared term', modified: 2 }),
    ];
    expect(scanEntries(es, 'shared', 8).map((h) => h.id)).toEqual(['new', 'mid', 'old']);
    expect(scanEntries(es, 'shared', 2).map((h) => h.id)).toEqual(['new', 'mid']);
  });

  test('non-matching and empty queries yield nothing', () => {
    const es = [entry({ text: 'some content here' })];
    expect(scanEntries(es, 'absent', 8)).toEqual([]);
    expect(scanEntries(es, '   ', 8)).toEqual([]);
  });

  test('hit carries id/title/type/modified from the entry', () => {
    const hits = scanEntries(
      [entry({ id: '0vx', title: 'Notes', type: 'note', text: 'find me', modified: 42 })],
      'find',
      8,
    );
    expect(hits[0]).toMatchObject({ id: '0vx', title: 'Notes', type: 'note', modified: 42 });
  });
});
