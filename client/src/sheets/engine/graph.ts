// Dependency graph: forward deps + reverse deps (rdeps). Small ranges expand
// into precise per-cell reverse edges; large ranges (>= RANGE_EDGE_LIMIT cells)
// are kept as per-sheet interval "subscriptions" scanned on each change, so a
// formula like =SUM(A:A) never materializes tens of thousands of edges.

import { type CellId, makeCellId, parseCellId } from './types';

export interface RangeRef {
  sheet: string;
  r1: number;
  c1: number;
  r2: number;
  c2: number;
}

// A range large enough to keep as a subscription rather than expand to edges.
interface RangeSub extends RangeRef {
  owner: CellId;
}

// Ranges with fewer than this many cells expand to precise edges.
export const RANGE_EDGE_LIMIT = 256;

function rangeArea(r: RangeRef): number {
  return (r.r2 - r.r1 + 1) * (r.c2 - r.c1 + 1);
}

export class DependencyGraph {
  // Reverse edges: dep cell -> owners that read it (precise, incl. small ranges).
  private rdeps = new Map<CellId, Set<CellId>>();
  // Per-owner record of the precise dep cells it registered (for teardown).
  private ownerCells = new Map<CellId, CellId[]>();
  // Per-owner large-range subscriptions (for teardown).
  private ownerSubs = new Map<CellId, RangeSub[]>();
  // Per-sheet list of active large-range subscriptions.
  private sheetSubs = new Map<string, RangeSub[]>();

  // Replace all of `owner`'s dependencies. `cells` are individual dep cells;
  // `ranges` are range references (this method decides edge vs subscription).
  setDeps(owner: CellId, refs: { cells: CellId[]; ranges: RangeRef[] }): void {
    this.clearDeps(owner);

    const cellDeps: CellId[] = [];
    const seen = new Set<CellId>();
    const addCell = (id: CellId) => {
      if (seen.has(id)) return;
      seen.add(id);
      cellDeps.push(id);
      let set = this.rdeps.get(id);
      if (!set) { set = new Set(); this.rdeps.set(id, set); }
      set.add(owner);
    };

    for (const c of refs.cells) addCell(c);

    const subs: RangeSub[] = [];
    for (const range of refs.ranges) {
      if (rangeArea(range) < RANGE_EDGE_LIMIT) {
        for (let r = range.r1; r <= range.r2; r++) {
          for (let c = range.c1; c <= range.c2; c++) addCell(makeCellId(range.sheet, r, c));
        }
      } else {
        const sub: RangeSub = { owner, ...range };
        subs.push(sub);
        let list = this.sheetSubs.get(range.sheet);
        if (!list) { list = []; this.sheetSubs.set(range.sheet, list); }
        list.push(sub);
      }
    }

    if (cellDeps.length) this.ownerCells.set(owner, cellDeps);
    if (subs.length) this.ownerSubs.set(owner, subs);
  }

  clearDeps(owner: CellId): void {
    const cells = this.ownerCells.get(owner);
    if (cells) {
      for (const id of cells) {
        const set = this.rdeps.get(id);
        if (set) { set.delete(owner); if (set.size === 0) this.rdeps.delete(id); }
      }
      this.ownerCells.delete(owner);
    }
    const subs = this.ownerSubs.get(owner);
    if (subs) {
      for (const sub of subs) {
        const list = this.sheetSubs.get(sub.sheet);
        if (list) {
          const idx = list.indexOf(sub);
          if (idx >= 0) list.splice(idx, 1);
          if (list.length === 0) this.sheetSubs.delete(sub.sheet);
        }
      }
      this.ownerSubs.delete(owner);
    }
  }

  // Cells that directly read `cell` (precise reverse edges + any large-range
  // subscription whose rectangle contains it). A self-reference (a cell that
  // reads itself, directly or via a range that covers it) is reported so the
  // topological sort can flag it #CIRCULAR.
  dependentsOf(cell: CellId): CellId[] {
    const out: CellId[] = [];
    const seen = new Set<CellId>();
    const push = (id: CellId) => { if (!seen.has(id)) { seen.add(id); out.push(id); } };

    const precise = this.rdeps.get(cell);
    if (precise) for (const o of precise) push(o);

    const { sheet, row, col } = parseCellId(cell);
    const subs = this.sheetSubs.get(sheet);
    if (subs) {
      for (const s of subs) {
        if (row >= s.r1 && row <= s.r2 && col >= s.c1 && col <= s.c2) push(s.owner);
      }
    }
    return out;
  }

  // Purge every subscription belonging to a sheet (used on sheet removal). Does
  // not touch precise edges — the engine clears owners' deps separately.
  removeSheetSubs(sheet: string): void {
    const subs = this.sheetSubs.get(sheet);
    if (!subs) return;
    for (const sub of subs) {
      const list = this.ownerSubs.get(sub.owner);
      if (list) {
        const idx = list.indexOf(sub);
        if (idx >= 0) list.splice(idx, 1);
        if (list.length === 0) this.ownerSubs.delete(sub.owner);
      }
    }
    this.sheetSubs.delete(sheet);
  }
}
