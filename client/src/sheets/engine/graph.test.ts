// DependencyGraph unit tests: precise edges, small-range expansion, large-range
// subscriptions, teardown, and the edge/subscription threshold.

import { describe, expect, test } from 'bun:test';
import { DependencyGraph, RANGE_EDGE_LIMIT, type RangeRef } from './graph';

const cell = (r: number, c: number) => `S!${r}:${c}`;
const sorted = (xs: string[]) => [...xs].sort();

describe('precise cell edges', () => {
  test('a dependency reports its owner', () => {
    const g = new DependencyGraph();
    g.setDeps(cell(0, 1), { cells: [cell(0, 0)], ranges: [] });
    expect(g.dependentsOf(cell(0, 0))).toEqual([cell(0, 1)]);
  });

  test('multiple owners of the same dep', () => {
    const g = new DependencyGraph();
    g.setDeps(cell(1, 0), { cells: [cell(0, 0)], ranges: [] });
    g.setDeps(cell(2, 0), { cells: [cell(0, 0)], ranges: [] });
    expect(sorted(g.dependentsOf(cell(0, 0)))).toEqual([cell(1, 0), cell(2, 0)]);
  });

  test('setDeps replaces old edges', () => {
    const g = new DependencyGraph();
    g.setDeps(cell(5, 5), { cells: [cell(0, 0)], ranges: [] });
    g.setDeps(cell(5, 5), { cells: [cell(1, 1)], ranges: [] });
    expect(g.dependentsOf(cell(0, 0))).toEqual([]);
    expect(g.dependentsOf(cell(1, 1))).toEqual([cell(5, 5)]);
  });

  test('clearDeps removes edges', () => {
    const g = new DependencyGraph();
    g.setDeps(cell(5, 5), { cells: [cell(0, 0)], ranges: [] });
    g.clearDeps(cell(5, 5));
    expect(g.dependentsOf(cell(0, 0))).toEqual([]);
  });

  test('self dependency is reported (for circular detection)', () => {
    const g = new DependencyGraph();
    g.setDeps(cell(0, 0), { cells: [cell(0, 0)], ranges: [] });
    expect(g.dependentsOf(cell(0, 0))).toEqual([cell(0, 0)]);
  });
});

describe('small ranges expand to precise edges', () => {
  test('every cell in a small range points at the owner', () => {
    const g = new DependencyGraph();
    const range: RangeRef = { sheet: 'S', r1: 0, c1: 0, r2: 2, c2: 0 }; // A1:A3, 3 cells
    g.setDeps(cell(9, 9), { cells: [], ranges: [range] });
    expect(g.dependentsOf(cell(0, 0))).toEqual([cell(9, 9)]);
    expect(g.dependentsOf(cell(1, 0))).toEqual([cell(9, 9)]);
    expect(g.dependentsOf(cell(2, 0))).toEqual([cell(9, 9)]);
    expect(g.dependentsOf(cell(3, 0))).toEqual([]); // outside the range
  });
});

describe('large ranges use subscriptions', () => {
  test('a change anywhere in a big range notifies the owner without materializing edges', () => {
    const g = new DependencyGraph();
    // A1:A1000 — 1000 cells, well over the threshold.
    const range: RangeRef = { sheet: 'S', r1: 0, c1: 0, r2: 999, c2: 0 };
    g.setDeps(cell(0, 5), { cells: [], ranges: [range] });
    expect(g.dependentsOf(cell(0, 0))).toEqual([cell(0, 5)]);
    expect(g.dependentsOf(cell(500, 0))).toEqual([cell(0, 5)]);
    expect(g.dependentsOf(cell(999, 0))).toEqual([cell(0, 5)]);
    expect(g.dependentsOf(cell(0, 1))).toEqual([]); // different column, outside
  });

  test('clearDeps removes a subscription', () => {
    const g = new DependencyGraph();
    g.setDeps(cell(0, 5), { cells: [], ranges: [{ sheet: 'S', r1: 0, c1: 0, r2: 999, c2: 0 }] });
    g.clearDeps(cell(0, 5));
    expect(g.dependentsOf(cell(500, 0))).toEqual([]);
  });

  test('removeSheetSubs purges a sheet', () => {
    const g = new DependencyGraph();
    g.setDeps(cell(0, 5), { cells: [], ranges: [{ sheet: 'S', r1: 0, c1: 0, r2: 999, c2: 0 }] });
    g.removeSheetSubs('S');
    expect(g.dependentsOf(cell(500, 0))).toEqual([]);
  });
});

describe('edge/subscription threshold', () => {
  test('just under the limit expands to edges (last cell tracked precisely)', () => {
    const g = new DependencyGraph();
    const n = RANGE_EDGE_LIMIT - 1; // 255 cells: a 255x1 column
    g.setDeps(cell(0, 9), { cells: [], ranges: [{ sheet: 'S', r1: 0, c1: 0, r2: n - 1, c2: 0 }] });
    expect(g.dependentsOf(cell(n - 1, 0))).toEqual([cell(0, 9)]);
  });

  test('at the limit uses a subscription (still tracked, via interval scan)', () => {
    const g = new DependencyGraph();
    const n = RANGE_EDGE_LIMIT; // 256 cells
    g.setDeps(cell(0, 9), { cells: [], ranges: [{ sheet: 'S', r1: 0, c1: 0, r2: n - 1, c2: 0 }] });
    expect(g.dependentsOf(cell(n - 1, 0))).toEqual([cell(0, 9)]);
  });
});
