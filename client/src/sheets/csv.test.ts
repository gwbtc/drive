// Tests for the minimal CSV parser/serializer used by sheet import/export.

import { describe, expect, test } from 'bun:test';
import { cellsToCSV, parseCSV } from './csv';

describe('parseCSV', () => {
  test('simple rows and columns', () => {
    expect(parseCSV('a,b\nc,d')).toEqual([['a', 'b'], ['c', 'd']]);
  });

  test('single row without trailing newline', () => {
    expect(parseCSV('a,b')).toEqual([['a', 'b']]);
  });

  test('trailing newline does not add an empty row', () => {
    expect(parseCSV('a,b\nc,d\n')).toEqual([['a', 'b'], ['c', 'd']]);
  });

  test('empty input yields no rows', () => {
    expect(parseCSV('')).toEqual([]);
  });

  test('a lone newline yields one row with one empty field', () => {
    expect(parseCSV('\n')).toEqual([['']]);
  });

  test('empty fields are preserved', () => {
    expect(parseCSV('a,,b')).toEqual([['a', '', 'b']]);
    expect(parseCSV(',,')).toEqual([['', '', '']]);
  });

  test('blank line in the middle becomes a one-empty-field row', () => {
    expect(parseCSV('a,b\n\nc')).toEqual([['a', 'b'], [''], ['c']]);
  });

  test('quoted field containing commas', () => {
    expect(parseCSV('"a,b",c')).toEqual([['a,b', 'c']]);
  });

  test('quoted field containing newlines', () => {
    expect(parseCSV('"a\nb",c\nd,e')).toEqual([['a\nb', 'c'], ['d', 'e']]);
  });

  test('doubled quotes escape a literal quote', () => {
    expect(parseCSV('"a""b",c')).toEqual([['a"b', 'c']]);
    expect(parseCSV('""""')).toEqual([['"']]);
  });

  test('CRLF line endings are handled', () => {
    expect(parseCSV('a,b\r\nc,d\r\n')).toEqual([['a', 'b'], ['c', 'd']]);
  });

  test('bare CR outside quotes is dropped, not a row break', () => {
    // NOTE: arguably buggy — a mid-field CR simply vanishes ('a\rb' → 'ab')
    // and classic Mac \r-only line endings do not split rows (csv.ts:39-43).
    expect(parseCSV('a\rb,c')).toEqual([['ab', 'c']]);
  });

  test('CR inside a quoted field is preserved', () => {
    expect(parseCSV('"a\rb"')).toEqual([['a\rb']]);
  });

  test('quotes adjacent to unquoted text concatenate', () => {
    expect(parseCSV('"a"b,c')).toEqual([['ab', 'c']]);
  });
});

describe('cellsToCSV', () => {
  test('serializes a full grid', () => {
    expect(
      cellsToCSV({ '0:0': '1', '0:1': '2', '1:0': '3', '1:1': '4' }, 2, 2),
    ).toBe('1,2\n3,4');
  });

  test('no cells yields a single empty field', () => {
    expect(cellsToCSV({}, 50, 16)).toBe('');
  });

  test('a single cell at origin', () => {
    expect(cellsToCSV({ '0:0': 'x' }, 50, 16)).toBe('x');
  });

  test('exports only the bounding box of non-empty cells', () => {
    expect(cellsToCSV({ '1:1': 'x' }, 50, 16)).toBe(',\n,x');
  });

  test('bounding box is clipped to the rows/cols caps', () => {
    // The only value sits outside the 3×3 cap, so the export is all-empty.
    expect(cellsToCSV({ '5:5': 'x' }, 3, 3)).toBe(',,\n,,\n,,');
  });

  test('quotes fields containing commas, quotes, and newlines', () => {
    expect(cellsToCSV({ '0:0': 'a,b' }, 1, 1)).toBe('"a,b"');
    expect(cellsToCSV({ '0:0': 'say "hi"' }, 1, 1)).toBe('"say ""hi"""');
    expect(cellsToCSV({ '0:0': 'l1\nl2' }, 1, 1)).toBe('"l1\nl2"');
  });

  test('plain values are not quoted', () => {
    expect(cellsToCSV({ '0:0': ' padded ', '0:1': "it's" }, 1, 2)).toBe(" padded ,it's");
  });
});

describe('round-trips', () => {
  test('tricky values survive cellsToCSV → parseCSV', () => {
    const cells = {
      '0:0': 'a,b',
      '0:1': 'he said "hi"',
      '1:0': 'line1\nline2',
      '1:1': 'plain',
    };
    const csv = cellsToCSV(cells, 2, 2);
    expect(csv).toBe('"a,b","he said ""hi"""\n"line1\nline2",plain');
    expect(parseCSV(csv)).toEqual([
      ['a,b', 'he said "hi"'],
      ['line1\nline2', 'plain'],
    ]);
  });

  test('carriage returns inside values survive the round-trip', () => {
    const csv = cellsToCSV({ '0:0': 'a\rb' }, 1, 1);
    expect(csv).toBe('"a\rb"');
    expect(parseCSV(csv)).toEqual([['a\rb']]);
  });

  test('empty cells inside the bounding box survive as empty strings', () => {
    const csv = cellsToCSV({ '0:0': 'a', '1:1': 'd' }, 2, 2);
    expect(csv).toBe('a,\n,d');
    expect(parseCSV(csv)).toEqual([['a', ''], ['', 'd']]);
  });
});
