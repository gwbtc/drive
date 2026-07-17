import { describe, expect, test } from 'bun:test';
import {
  windowRange,
  scrollToShow,
  normRange,
  inRange,
  inNormRange,
  rangeCells,
  parseCellKey,
  clamp,
  computeColOffsets,
  pointToCell,
  type CellGeom,
} from './gridmath';

describe('windowRange', () => {
  test('top of a tall sheet renders the first screenful plus overscan', () => {
    // 30px rows, 600px viewport => 20 visible; +overscan on the bottom.
    const { start, end } = windowRange(0, 600, 30, 1000, 5, 0);
    expect(start).toBe(0);
    expect(end).toBeGreaterThanOrEqual(20);
    expect(end).toBeLessThan(40);
  });

  test('scrolled down: window tracks the scroll offset with overscan', () => {
    const { start, end } = windowRange(3000, 600, 30, 1000, 5, 0);
    // firstVisible = 100; start = 95 (overscan), end covers viewport+overscan.
    expect(start).toBe(95);
    expect(end).toBeGreaterThan(120);
    expect(end).toBeLessThan(130);
  });

  test('never renders past the total row count', () => {
    const { start, end } = windowRange(1e6, 600, 30, 1000, 5, 0);
    expect(end).toBe(1000);
    expect(start).toBeLessThanOrEqual(1000);
  });

  test('frozen rows are excluded from the scrollable window', () => {
    const { start } = windowRange(0, 600, 30, 1000, 5, 2);
    expect(start).toBeGreaterThanOrEqual(2);
  });

  test('degenerate sizes are handled', () => {
    expect(windowRange(0, 600, 0, 1000)).toEqual({ start: 0, end: 1000 });
    expect(windowRange(0, 600, 30, 0)).toEqual({ start: 0, end: 0 });
  });
});

describe('scrollToShow', () => {
  const SIZE = 30;
  test('scrolls down to reveal a cell below the viewport', () => {
    // viewport 300px (10 rows). Cell 20 is far below; new scroll shows it.
    const next = scrollToShow(20, 0, 300, SIZE, 0);
    expect(next).toBe(21 * SIZE - 300);
  });
  test('scrolls up to reveal a cell above the viewport', () => {
    const next = scrollToShow(2, 300, 300, SIZE, 0);
    expect(next).toBe(2 * SIZE);
  });
  test('leaves scroll unchanged when the cell is already visible', () => {
    expect(scrollToShow(5, 0, 300, SIZE, 0)).toBe(0);
  });
});

describe('selection helpers', () => {
  test('normRange orders inverted drags', () => {
    expect(normRange({ r1: 5, c1: 4, r2: 1, c2: 2 })).toEqual({ r1: 1, c1: 2, r2: 5, c2: 4 });
  });
  test('inRange respects normalization', () => {
    const rg = { r1: 3, c1: 3, r2: 1, c2: 1 };
    expect(inRange(2, 2, rg)).toBe(true);
    expect(inRange(4, 2, rg)).toBe(false);
    expect(inRange(0, 0, null)).toBe(false);
  });
  test('rangeCells enumerates every cell', () => {
    expect(rangeCells({ r1: 0, c1: 0, r2: 1, c2: 1 })).toEqual([
      [0, 0], [0, 1], [1, 0], [1, 1],
    ]);
    expect(rangeCells(null)).toEqual([]);
  });
  test('parseCellKey / clamp', () => {
    expect(parseCellKey('12:3')).toEqual({ r: 12, c: 3 });
    expect(clamp(5, 0, 3)).toBe(3);
    expect(clamp(-1, 0, 3)).toBe(0);
  });
  test('inNormRange tests an already-normalized range', () => {
    const n = normRange({ r1: 3, c1: 3, r2: 1, c2: 1 }); // -> {1,1,3,3}
    expect(inNormRange(2, 2, n)).toBe(true);
    expect(inNormRange(1, 1, n)).toBe(true);
    expect(inNormRange(3, 3, n)).toBe(true);
    expect(inNormRange(4, 2, n)).toBe(false);
    expect(inNormRange(0, 0, n)).toBe(false);
    expect(inNormRange(0, 0, null)).toBe(false);
  });
});

describe('computeColOffsets', () => {
  test('uniform widths: left edges plus a trailing total width', () => {
    // gutter 48, 5 cols of 100 each.
    expect(computeColOffsets(5, {}, 48, 100)).toEqual([48, 148, 248, 348, 448, 548]);
  });
  test('per-column overrides are honored', () => {
    // col 0 = 60, col 2 = 200, others default 100.
    expect(computeColOffsets(4, { 0: 60, 2: 200 }, 48, 100)).toEqual([48, 108, 208, 408, 508]);
  });
  test('zero columns yields just the gutter edge', () => {
    expect(computeColOffsets(0, {}, 48, 100)).toEqual([48]);
  });
});

describe('pointToCell', () => {
  // rowH=28, headerH=28, gutterW=48, 5 uniform 100px cols, 1000 rows.
  const base: Omit<CellGeom, 'frozenRows' | 'frozenCols'> = {
    rowH: 28,
    headerH: 28,
    gutterW: 48,
    colOffsets: computeColOffsets(5, {}, 48, 100),
    rows: 1000,
    cols: 5,
  };
  const geom = (frozenRows = 0, frozenCols = 0): CellGeom => ({ ...base, frozenRows, frozenCols });

  test('top-left cell at zero scroll', () => {
    expect(pointToCell(48, 28, 0, 0, geom())).toEqual({ r: 0, c: 0 });
  });

  test('interior cell at zero scroll', () => {
    // y within row 3, x within col 2.
    expect(pointToCell(258, 117, 0, 0, geom())).toEqual({ r: 3, c: 2 });
  });

  test('scrolled down: pointer just below the header maps past the scroll', () => {
    // scrollTop 280 == 10 rows; the row at the top of the scroll area is 10.
    expect(pointToCell(48, 28, 0, 280, geom()).r).toBe(10);
    // 5 rows further down the viewport -> row 15.
    expect(pointToCell(48, 168, 0, 280, geom()).r).toBe(15);
  });

  test('scrolled right: pointer at the left of the scroll area maps past scroll', () => {
    // scrollLeft 200 == 2 cols; first scrollable col at x=48 -> col 2.
    expect(pointToCell(48, 28, 200, 0, geom()).c).toBe(2);
    // one column further right (x within the next col).
    expect(pointToCell(150, 28, 200, 0, geom()).c).toBe(3);
  });

  test('frozen rows: the pinned band hit-tests to frozen rows, not scrolled ones', () => {
    const g = geom(2, 0); // 2 frozen rows; frozen band screen y in [28, 84)
    expect(pointToCell(48, 28, 0, 280, g).r).toBe(0); // frozen row 0
    expect(pointToCell(48, 56, 0, 280, g).r).toBe(1); // frozen row 1
    // At the frozen-band bottom the scrollable region begins: frozen(2)+scroll(10).
    expect(pointToCell(48, 84, 0, 280, g).r).toBe(12);
  });

  test('frozen cols: the pinned band hit-tests to frozen cols, not scrolled ones', () => {
    const g = geom(0, 1); // 1 frozen col; frozen band screen x in [48, 148)
    expect(pointToCell(48, 28, 200, 0, g).c).toBe(0); // frozen col 0
    // At the frozen-band right the scrollable region begins: col at x=148,+scroll 200.
    expect(pointToCell(148, 28, 200, 0, g).c).toBe(3);
  });

  test('over the header (above the grid) snaps to the top scrollable row', () => {
    // offsetY below headerH -> upward-drag case; maps to the topmost visible row.
    expect(pointToCell(48, 5, 0, 280, geom()).r).toBe(10);
    const g = geom(2, 0);
    expect(pointToCell(48, 5, 0, 280, g).r).toBe(12); // frozen(2)+scroll(10)
  });

  test('over the gutter snaps to the leftmost scrollable column', () => {
    expect(pointToCell(10, 28, 200, 0, geom()).c).toBe(2);
  });

  test('coordinates past the sheet clamp to the last row/column', () => {
    expect(pointToCell(99999, 99999, 0, 0, geom())).toEqual({ r: 999, c: 4 });
  });
});
