// Tests for the pure drag-fill series/offset math (fill.ts). The DOM drag
// wiring is covered by a later Playwright pass; here we prove the value math:
// formula offsetting, numeric/date extrapolation, tiling, and the 2-D geometry.

import { describe, expect, test } from 'bun:test';
import { fillLine, fillDirection, computeFill, type Rect } from './fill';

describe('fillLine — formulas', () => {
  test('single relative formula offsets down', () => {
    expect(fillLine(['=A1*2'], 3, 'row')).toEqual(['=A2*2', '=A3*2', '=A4*2']);
  });

  test('single relative formula offsets right', () => {
    expect(fillLine(['=A1'], 2, 'col')).toEqual(['=B1', '=C1']);
  });

  test('absolute refs stay pinned', () => {
    expect(fillLine(['=$A$1*2'], 2, 'row')).toEqual(['=$A$1*2', '=$A$1*2']);
  });

  test('mixed absolute/relative offsets only the relative axis', () => {
    // $A1 -> col pinned, row relative: down-fill bumps the row only.
    expect(fillLine(['=$A1+A$1'], 2, 'row')).toEqual(['=$A2+A$1', '=$A3+A$1']);
  });

  test('a source block tiles with a whole-block offset', () => {
    // rows 0,1 hold =A1,=A2; filling down repeats the block shifted by 2.
    expect(fillLine(['=A1', '=A2'], 2, 'row')).toEqual(['=A3', '=A4']);
    expect(fillLine(['=A1', '=A2'], 4, 'row')).toEqual(['=A3', '=A4', '=A5', '=A6']);
  });

  test('range refs offset', () => {
    expect(fillLine(['=SUM(A1:A3)'], 2, 'row')).toEqual(['=SUM(A2:A4)', '=SUM(A3:A5)']);
  });

  test('unparseable "formula" is copied verbatim', () => {
    expect(fillLine(['=??'], 2, 'row')).toEqual(['=??', '=??']);
  });
});

describe('fillLine — numbers', () => {
  test('a lone number is copied, not incremented', () => {
    expect(fillLine(['5'], 3, 'row')).toEqual(['5', '5', '5']);
  });

  test('an arithmetic pair extrapolates', () => {
    expect(fillLine(['1', '2'], 3, 'row')).toEqual(['3', '4', '5']);
  });

  test('a longer arithmetic run extrapolates', () => {
    expect(fillLine(['5', '10', '15'], 2, 'row')).toEqual(['20', '25']);
  });

  test('descending / negative steps work', () => {
    expect(fillLine(['10', '8'], 3, 'row')).toEqual(['6', '4', '2']);
  });

  test('fractional steps avoid float noise', () => {
    expect(fillLine(['1', '1.5'], 3, 'row')).toEqual(['2', '2.5', '3']);
  });

  test('a non-arithmetic numeric run tiles', () => {
    expect(fillLine(['2', '4', '8'], 4, 'row')).toEqual(['2', '4', '8', '2']);
  });
});

describe('fillLine — dates', () => {
  test('a lone date steps forward one day', () => {
    expect(fillLine(['2024-01-15'], 2, 'row')).toEqual(['2024-01-16', '2024-01-17']);
  });

  test('crosses a month boundary', () => {
    expect(fillLine(['2024-01-31'], 1, 'row')).toEqual(['2024-02-01']);
  });

  test('two dates infer the day step', () => {
    expect(fillLine(['2024-01-01', '2024-01-03'], 2, 'row')).toEqual(['2024-01-05', '2024-01-07']);
  });

  test('irregular date gaps tile', () => {
    expect(fillLine(['2024-01-01', '2024-01-03', '2024-01-10'], 3, 'row'))
      .toEqual(['2024-01-01', '2024-01-03', '2024-01-10']);
  });
});

describe('fillLine — text / mixed', () => {
  test('text tiles', () => {
    expect(fillLine(['x', 'y'], 3, 'row')).toEqual(['x', 'y', 'x']);
  });

  test('a lone text value is copied', () => {
    expect(fillLine(['hi'], 2, 'row')).toEqual(['hi', 'hi']);
  });

  test('a mixed number+text line tiles (no series)', () => {
    expect(fillLine(['1', 'x'], 3, 'row')).toEqual(['1', 'x', '1']);
  });

  test('a line containing a blank tiles', () => {
    expect(fillLine(['1', '', '3'], 2, 'row')).toEqual(['1', '']);
  });

  test('empty source or zero count yields nothing', () => {
    expect(fillLine([], 3, 'row')).toEqual([]);
    expect(fillLine(['1'], 0, 'row')).toEqual([]);
  });
});

describe('fillDirection', () => {
  const src: Rect = { r1: 0, c1: 0, r2: 1, c2: 1 };
  test('down when rows extend', () => {
    expect(fillDirection(src, { r1: 0, c1: 0, r2: 5, c2: 1 })).toBe('row');
  });
  test('right when cols extend', () => {
    expect(fillDirection(src, { r1: 0, c1: 0, r2: 1, c2: 5 })).toBe('col');
  });
  test('null when nothing extends', () => {
    expect(fillDirection(src, src)).toBeNull();
  });
  test('ties prefer down', () => {
    expect(fillDirection(src, { r1: 0, c1: 0, r2: 4, c2: 4 })).toBe('row');
  });
});

describe('computeFill — 2-D geometry', () => {
  // Build a getRaw from a sparse "r:c" -> raw map.
  const gridOf = (cells: Record<string, string>) => (r: number, c: number) => cells[`${r}:${c}`] ?? '';

  test('fills a numeric series down a single column', () => {
    const getRaw = gridOf({ '0:0': '1', '1:0': '2' });
    const src: Rect = { r1: 0, c1: 0, r2: 1, c2: 0 };
    const dest: Rect = { r1: 0, c1: 0, r2: 4, c2: 0 };
    expect(computeFill(src, dest, getRaw)).toEqual([
      { r: 2, c: 0, raw: '3' },
      { r: 3, c: 0, raw: '4' },
      { r: 4, c: 0, raw: '5' },
    ]);
  });

  test('fills each column of a multi-column source down independently', () => {
    const getRaw = gridOf({ '0:0': '1', '0:1': '10', '1:0': '2', '1:1': '20' });
    const src: Rect = { r1: 0, c1: 0, r2: 1, c2: 1 };
    const dest: Rect = { r1: 0, c1: 0, r2: 2, c2: 1 };
    expect(computeFill(src, dest, getRaw)).toEqual([
      { r: 2, c: 0, raw: '3' },
      { r: 2, c: 1, raw: '30' },
    ]);
  });

  test('fills a formula series to the right', () => {
    const getRaw = gridOf({ '0:0': '=A1' });
    const src: Rect = { r1: 0, c1: 0, r2: 0, c2: 0 };
    const dest: Rect = { r1: 0, c1: 0, r2: 0, c2: 2 };
    expect(computeFill(src, dest, getRaw)).toEqual([
      { r: 0, c: 1, raw: '=B1' },
      { r: 0, c: 2, raw: '=C1' },
    ]);
  });

  test('down-fills a formula that references another column', () => {
    const getRaw = gridOf({ '0:1': '=A1*2' }); // B1 = =A1*2
    const src: Rect = { r1: 0, c1: 1, r2: 0, c2: 1 };
    const dest: Rect = { r1: 0, c1: 1, r2: 2, c2: 1 };
    expect(computeFill(src, dest, getRaw)).toEqual([
      { r: 1, c: 1, raw: '=A2*2' },
      { r: 2, c: 1, raw: '=A3*2' },
    ]);
  });

  test('no target cells => no writes', () => {
    const getRaw = gridOf({ '0:0': '1' });
    const src: Rect = { r1: 0, c1: 0, r2: 0, c2: 0 };
    expect(computeFill(src, src, getRaw)).toEqual([]);
  });
});
