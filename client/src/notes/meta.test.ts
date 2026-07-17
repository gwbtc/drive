import { describe, expect, test } from 'bun:test';
import * as Y from 'yjs';
import {
  DEFAULT_META,
  NOTE_META_KEY,
  type NoteEntry,
  type NoteMeta,
  addLabel,
  collectLabels,
  metaEqual,
  metaFromRecord,
  normColor,
  normLabels,
  partitionNotes,
  readNoteMeta,
  removeLabel,
} from './meta';

describe('normColor', () => {
  test('accepts known palette colors', () => {
    expect(normColor('red')).toBe('red');
    expect(normColor('gray')).toBe('gray');
    expect(normColor('default')).toBe('default');
  });

  test('falls back to default for unknown / wrong-typed values', () => {
    expect(normColor('chartreuse')).toBe('default');
    expect(normColor('')).toBe('default');
    expect(normColor(undefined)).toBe('default');
    expect(normColor(42)).toBe('default');
    expect(normColor({ color: 'red' })).toBe('default');
  });
});

describe('normLabels', () => {
  test('non-arrays yield an empty list', () => {
    expect(normLabels(undefined)).toEqual([]);
    expect(normLabels('work')).toEqual([]);
    expect(normLabels(null)).toEqual([]);
  });

  test('trims, drops blanks and non-strings, preserves order', () => {
    expect(normLabels(['  work ', '', 'home', 3, '  '])).toEqual(['work', 'home']);
  });

  test('dedupes (first occurrence wins)', () => {
    expect(normLabels(['a', 'b', 'a', ' b '])).toEqual(['a', 'b']);
  });
});

describe('metaFromRecord', () => {
  test('empty record yields the default meta', () => {
    expect(metaFromRecord({})).toEqual(DEFAULT_META);
  });

  test('only literal true counts as pinned/archived', () => {
    expect(metaFromRecord({ pinned: true, archived: true })).toMatchObject({
      pinned: true,
      archived: true,
    });
    expect(metaFromRecord({ pinned: 1, archived: 'yes' })).toMatchObject({
      pinned: false,
      archived: false,
    });
  });

  test('normalizes color and labels together', () => {
    expect(metaFromRecord({ color: 'teal', labels: [' x ', 'x'] })).toEqual({
      color: 'teal',
      labels: ['x'],
      pinned: false,
      archived: false,
    });
  });
});

describe('readNoteMeta (over a real Y.Doc)', () => {
  test('empty map reads as default', () => {
    const doc = new Y.Doc();
    expect(readNoteMeta(doc.getMap(NOTE_META_KEY))).toEqual(DEFAULT_META);
  });

  test('reads values written to the map', () => {
    const doc = new Y.Doc();
    const m = doc.getMap(NOTE_META_KEY);
    m.set('color', 'blue');
    m.set('labels', ['work', 'urgent']);
    m.set('pinned', true);
    expect(readNoteMeta(m)).toEqual({
      color: 'blue',
      labels: ['work', 'urgent'],
      pinned: true,
      archived: false,
    });
  });

  test('syncs across two docs via Yjs updates', () => {
    const a = new Y.Doc();
    const b = new Y.Doc();
    a.getMap(NOTE_META_KEY).set('color', 'pink');
    a.getMap(NOTE_META_KEY).set('pinned', true);
    Y.applyUpdate(b, Y.encodeStateAsUpdate(a));
    expect(readNoteMeta(b.getMap(NOTE_META_KEY))).toMatchObject({
      color: 'pink',
      pinned: true,
    });
  });
});

describe('metaEqual', () => {
  const base: NoteMeta = { color: 'red', labels: ['a', 'b'], pinned: true, archived: false };
  test('equal metas compare equal (including label order)', () => {
    expect(metaEqual(base, { ...base, labels: ['a', 'b'] })).toBe(true);
  });
  test('differing scalar fields compare unequal', () => {
    expect(metaEqual(base, { ...base, color: 'blue' })).toBe(false);
    expect(metaEqual(base, { ...base, pinned: false })).toBe(false);
    expect(metaEqual(base, { ...base, archived: true })).toBe(false);
  });
  test('differing labels (order or membership) compare unequal', () => {
    expect(metaEqual(base, { ...base, labels: ['b', 'a'] })).toBe(false);
    expect(metaEqual(base, { ...base, labels: ['a'] })).toBe(false);
  });
});

describe('addLabel / removeLabel', () => {
  test('addLabel trims and appends', () => {
    expect(addLabel(['a'], '  b ')).toEqual(['a', 'b']);
  });
  test('addLabel ignores blanks and duplicates (returns same ref)', () => {
    const l = ['a'];
    expect(addLabel(l, '   ')).toBe(l);
    expect(addLabel(l, 'a')).toBe(l);
  });
  test('removeLabel drops the matching label only', () => {
    expect(removeLabel(['a', 'b', 'c'], 'b')).toEqual(['a', 'c']);
    expect(removeLabel(['a'], 'x')).toEqual(['a']);
  });
});

// --- layout logic ---------------------------------------------------------

type Note = { id: string };
const entry = (id: string, meta: Partial<NoteMeta> | null): NoteEntry<Note> => ({
  note: { id },
  meta: meta === null ? null : { ...DEFAULT_META, ...meta },
});

describe('collectLabels', () => {
  test('gathers distinct labels sorted case-insensitively', () => {
    const entries = [
      entry('1', { labels: ['Work', 'home'] }),
      entry('2', { labels: ['home', 'zebra'] }),
      entry('3', null),
    ];
    expect(collectLabels(entries)).toEqual(['home', 'Work', 'zebra']);
  });

  test('empty when no labels exist', () => {
    expect(collectLabels([entry('1', {}), entry('2', null)])).toEqual([]);
  });
});

describe('partitionNotes', () => {
  test('splits pinned / others / archived and preserves input order', () => {
    const entries = [
      entry('a', { pinned: true }),
      entry('b', {}),
      entry('c', { archived: true }),
      entry('d', { pinned: true }),
      entry('e', {}),
    ];
    const { pinned, others, archived } = partitionNotes(entries, null);
    expect(pinned.map((n) => n.id)).toEqual(['a', 'd']);
    expect(others.map((n) => n.id)).toEqual(['b', 'e']);
    expect(archived.map((n) => n.id)).toEqual(['c']);
  });

  test('a note with unknown meta (null) lands in others', () => {
    const { pinned, others, archived } = partitionNotes([entry('x', null)], null);
    expect(pinned).toEqual([]);
    expect(archived).toEqual([]);
    expect(others.map((n) => n.id)).toEqual(['x']);
  });

  test('archived is exclusive even when the note is also pinned', () => {
    const { pinned, archived } = partitionNotes(
      [entry('p', { pinned: true, archived: true })],
      null,
    );
    expect(pinned).toEqual([]);
    expect(archived.map((n) => n.id)).toEqual(['p']);
  });

  test('label filter keeps only matching notes across every bucket', () => {
    const entries = [
      entry('a', { pinned: true, labels: ['work'] }),
      entry('b', { labels: ['home'] }),
      entry('c', { archived: true, labels: ['work'] }),
      entry('d', { labels: ['work'] }),
    ];
    const { pinned, others, archived } = partitionNotes(entries, 'work');
    expect(pinned.map((n) => n.id)).toEqual(['a']);
    expect(others.map((n) => n.id)).toEqual(['d']);
    expect(archived.map((n) => n.id)).toEqual(['c']);
  });

  test('null label filter keeps everything', () => {
    const entries = [entry('a', { labels: ['x'] }), entry('b', {})];
    const { others } = partitionNotes(entries, null);
    expect(others.map((n) => n.id)).toEqual(['a', 'b']);
  });
});
