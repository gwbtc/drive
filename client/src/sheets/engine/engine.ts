// CalcEngine — the only stateful piece. Holds raw cell text, parsed ASTs, a
// dependency graph, and a value cache. On each edit it reparses just the
// changed formulas, computes the dirty set (changed cells + transitive
// dependents via reverse edges), topologically sorts ONLY that subgraph, and
// re-evaluates in order with memoization. Non-dirty cells are never touched —
// this replaces the legacy O(n^2)-on-chains full recalc.
//
// CellId = `${sheetId}!${r}:${c}` (0-based). Scalar values and coercions live
// in ./types; the AST/parser/serializer in ./ast; the function registry in
// ./functions; the graph in ./graph; reference transforms in ./refs.

import {
  type Ast,
  parse,
  ParseError,
  serializeFormula,
} from './ast';
import {
  type Scalar,
  type ErrCode,
  type CellId,
  err,
  isErr,
  toNumStrict,
  toStr,
  fmtNum,
  makeCellId,
  parseCellId,
} from './types';
import { FUNCTIONS, type ArgValue, type Thunk } from './functions';
import { DependencyGraph, type RangeRef } from './graph';
import { renameSheetRefs } from './refs';

export type { Scalar, ErrCode, CellId };

// A formula cell is stored as either a parsed AST or a parse error.
type Formula = { ast: Ast } | { error: ErrCode };

export class CalcEngine {
  private cells = new Map<CellId, string>();
  private formulas = new Map<CellId, Formula>();
  private values = new Map<CellId, Scalar>();
  private volatileCells = new Set<CellId>();
  private sheets = new Set<string>();
  private graph = new DependencyGraph();

  // Instrumentation: total AST-node evaluations since construction. Tests use
  // this to prove incrementality (edits are O(dirty), not O(n) or O(n^2)).
  evalCount = 0;

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  // Apply raw-text changes; return the set of cells whose displayed value
  // changed (the repaint set).
  setCells(changes: Array<{ id: CellId; raw: string }>): Set<CellId> {
    const changed = new Set<CellId>();
    for (const { id, raw } of changes) {
      this.applyOne(id, raw);
      changed.add(id);
    }
    return this.recompute(this.closure(changed));
  }

  getValue(id: CellId): Scalar {
    return this.values.get(id) ?? '';
  }

  getDisplay(id: CellId): string {
    return display(this.values.get(id) ?? '');
  }

  addSheet(id: string): void {
    this.sheets.add(id);
  }

  // Remove a sheet and all its cells; dependents on other sheets are recomputed
  // (a reference to the now-missing sheet resolves to #REF). Returns the
  // repaint set.
  removeSheet(id: string): Set<CellId> {
    const removed: CellId[] = [];
    for (const cellId of this.cells.keys()) {
      if (parseCellId(cellId).sheet === id) removed.push(cellId);
    }
    const dependents = new Set<CellId>();
    for (const cellId of removed) {
      for (const dep of this.graph.dependentsOf(cellId)) dependents.add(dep);
    }
    for (const cellId of removed) {
      this.cells.delete(cellId);
      this.formulas.delete(cellId);
      this.values.delete(cellId);
      this.volatileCells.delete(cellId);
      this.graph.clearDeps(cellId);
    }
    this.graph.removeSheetSubs(id);
    this.sheets.delete(id);
    const dirty = this.closure(dependents);
    for (const cellId of removed) dirty.delete(cellId);
    const repaint = this.recompute(dirty);
    for (const cellId of removed) repaint.add(cellId);
    return repaint;
  }

  // Rename a sheet: move its cells and rewrite every sheet-qualified reference
  // (`Old!A1` -> `New!A1`) across all formulas via the AST serializer. Returns
  // the repaint set.
  renameSheet(oldName: string, newName: string): Set<CellId> {
    if (oldName === newName) return new Set();

    const entries: Array<{ id: CellId; raw: string }> = [];
    const oldDisplayByNewId = new Map<CellId, string>();
    const renamedOld: CellId[] = [];

    for (const [id, raw] of this.cells) {
      const { sheet, row, col } = parseCellId(id);
      let newId = id;
      if (sheet === oldName) { newId = makeCellId(newName, row, col); renamedOld.push(id); }
      let newRaw = raw;
      const fp = this.formulas.get(id);
      if (fp && 'ast' in fp) newRaw = serializeFormula(renameSheetRefs(fp.ast, oldName, newName));
      oldDisplayByNewId.set(newId, display(this.values.get(id) ?? ''));
      entries.push({ id: newId, raw: newRaw });
    }

    // Reset and rebuild.
    this.cells.clear();
    this.formulas.clear();
    this.values.clear();
    this.volatileCells.clear();
    this.graph = new DependencyGraph();
    this.sheets.delete(oldName);
    this.sheets.add(newName);

    for (const { id, raw } of entries) this.applyOne(id, raw);
    const dirty = new Set(entries.map((e) => e.id));
    this.evaluateDirty(dirty);

    const repaint = new Set<CellId>();
    for (const { id } of entries) {
      if (display(this.values.get(id) ?? '') !== (oldDisplayByNewId.get(id) ?? '')) repaint.add(id);
    }
    for (const oldId of renamedOld) if (!this.cells.has(oldId)) repaint.add(oldId);
    return repaint;
  }

  // Re-evaluate volatile-dependent cells (e.g. driven by a NOW() timer).
  recalcVolatiles(): Set<CellId> {
    return this.recompute(this.closure(new Set(this.volatileCells)));
  }

  // ---------------------------------------------------------------------------
  // Edit application
  // ---------------------------------------------------------------------------

  private applyOne(id: CellId, raw: string): void {
    if (raw === '') {
      this.cells.delete(id);
      this.formulas.delete(id);
      this.graph.clearDeps(id);
      this.volatileCells.delete(id);
      return;
    }
    this.cells.set(id, raw);
    if (raw.startsWith('=')) {
      const home = parseCellId(id).sheet;
      try {
        const ast = parse(raw);
        this.formulas.set(id, { ast });
        this.graph.setDeps(id, extractRefs(ast, home));
        if (hasVolatile(ast)) this.volatileCells.add(id);
        else this.volatileCells.delete(id);
      } catch (e) {
        const code = e instanceof ParseError ? e.code : '#ERR';
        this.formulas.set(id, { error: code });
        this.graph.setDeps(id, { cells: [], ranges: [] });
        this.volatileCells.delete(id);
      }
    } else {
      this.formulas.delete(id);
      this.graph.clearDeps(id);
      this.volatileCells.delete(id);
    }
  }

  // ---------------------------------------------------------------------------
  // Dirty-set computation & recompute
  // ---------------------------------------------------------------------------

  // Transitive closure of `seed` over reverse dependency edges.
  private closure(seed: Set<CellId>): Set<CellId> {
    const dirty = new Set(seed);
    const stack = [...seed];
    while (stack.length) {
      const u = stack.pop()!;
      for (const v of this.graph.dependentsOf(u)) {
        if (!dirty.has(v)) { dirty.add(v); stack.push(v); }
      }
    }
    return dirty;
  }

  private recompute(dirty: Set<CellId>): Set<CellId> {
    const oldDisplay = new Map<CellId, string>();
    for (const id of dirty) oldDisplay.set(id, display(this.values.get(id) ?? ''));
    this.evaluateDirty(dirty);
    const repaint = new Set<CellId>();
    for (const id of dirty) {
      if (display(this.values.get(id) ?? '') !== oldDisplay.get(id)) repaint.add(id);
    }
    return repaint;
  }

  // Kahn topological sort of the dirty subgraph, then evaluate in order.
  // Cells left with nonzero in-degree are cycle members (or downstream of one)
  // and get #CIRCULAR.
  private evaluateDirty(dirty: Set<CellId>): void {
    const adj = new Map<CellId, CellId[]>();
    const indeg = new Map<CellId, number>();
    for (const id of dirty) indeg.set(id, 0);
    for (const u of dirty) {
      for (const v of this.graph.dependentsOf(u)) {
        if (!dirty.has(v)) continue;
        let a = adj.get(u);
        if (!a) { a = []; adj.set(u, a); }
        a.push(v);
        indeg.set(v, (indeg.get(v) ?? 0) + 1);
      }
    }
    const queue: CellId[] = [];
    for (const [id, d] of indeg) if (d === 0) queue.push(id);
    const evaluated = new Set<CellId>();
    while (queue.length) {
      const u = queue.shift()!;
      evaluated.add(u);
      this.values.set(u, this.evaluateCell(u));
      const a = adj.get(u);
      if (a) for (const v of a) {
        const d = indeg.get(v)! - 1;
        indeg.set(v, d);
        if (d === 0) queue.push(v);
      }
    }
    for (const id of dirty) if (!evaluated.has(id)) this.values.set(id, err('#CIRCULAR'));
  }

  private evaluateCell(id: CellId): Scalar {
    const fp = this.formulas.get(id);
    if (fp) {
      if ('error' in fp) return err(fp.error);
      const home = parseCellId(id).sheet;
      const v = this.evalExpr(fp.ast, home);
      return v.kind === 'scalar' ? v.value : err('#ERR'); // a bare range isn't a scalar
    }
    return rawScalar(this.cells.get(id) ?? '');
  }

  private resolveValue(sheet: string, row: number, col: number): Scalar {
    // A reference to a sheet that does not exist (never added, or removed) is
    // #REF — distinct from a known sheet's empty cell, which is blank ('').
    if (!this.sheets.has(sheet)) return err('#REF');
    return this.values.get(makeCellId(sheet, row, col)) ?? '';
  }

  // ---------------------------------------------------------------------------
  // Expression evaluation
  // ---------------------------------------------------------------------------

  private evalExpr(node: Ast, home: string): ArgValue {
    this.evalCount++;
    switch (node.type) {
      case 'num': return { kind: 'scalar', value: node.value };
      case 'str': return { kind: 'scalar', value: node.value };
      case 'bool': return { kind: 'scalar', value: node.value };
      case 'err': return { kind: 'scalar', value: err(node.code) };
      case 'cell': {
        const sheet = node.sheet ?? home;
        return { kind: 'scalar', value: this.resolveValue(sheet, node.row, node.col) };
      }
      case 'range': {
        const sheet = node.sheet ?? home;
        const r1 = Math.min(node.start.row, node.end.row);
        const r2 = Math.max(node.start.row, node.end.row);
        const c1 = Math.min(node.start.col, node.end.col);
        const c2 = Math.max(node.start.col, node.end.col);
        return {
          kind: 'range',
          sheet, r1, c1, r2, c2,
          get: (r, c) => this.resolveValue(sheet, r, c),
        };
      }
      case 'unary': {
        const v = scalarOf(this.evalExpr(node.expr, home));
        if (isErr(v)) return { kind: 'scalar', value: v };
        const n = toNumStrict(v);
        if (n === null) return { kind: 'scalar', value: err('#ERR') };
        return { kind: 'scalar', value: node.op === '-' ? -n : n };
      }
      case 'percent': {
        const v = scalarOf(this.evalExpr(node.expr, home));
        if (isErr(v)) return { kind: 'scalar', value: v };
        const n = toNumStrict(v);
        if (n === null) return { kind: 'scalar', value: err('#ERR') };
        return { kind: 'scalar', value: n / 100 };
      }
      case 'binary': {
        const l = scalarOf(this.evalExpr(node.left, home));
        if (isErr(l)) return { kind: 'scalar', value: l };
        const r = scalarOf(this.evalExpr(node.right, home));
        if (isErr(r)) return { kind: 'scalar', value: r };
        return { kind: 'scalar', value: applyBinary(node.op, l, r) };
      }
      case 'call': {
        const fn = FUNCTIONS[node.name];
        if (!fn) return { kind: 'scalar', value: err('#NAME') };
        const thunks: Thunk[] = node.args.map((a) => () => this.evalExpr(a, home));
        return { kind: 'scalar', value: fn.call(thunks) };
      }
    }
  }
}

// -----------------------------------------------------------------------------
// Pure helpers
// -----------------------------------------------------------------------------

// A range used where a scalar is required collapses to #ERR.
function scalarOf(a: ArgValue): Scalar {
  return a.kind === 'scalar' ? a.value : err('#ERR');
}

// Coerce raw (non-formula) cell text into a scalar. Numeric strings become
// numbers, ISO dates become Dates, blank stays '', everything else is text
// (preserving original whitespace, matching legacy rawValue).
function rawScalar(s: string): Scalar {
  const t = s.trim();
  if (t === '') return '';
  if (/^-?\d+(\.\d+)?$/.test(t)) return parseFloat(t);
  if (/^\d{4}-\d{2}-\d{2}$/.test(t)) {
    const d = new Date(t + 'T00:00:00Z');
    if (!Number.isNaN(d.getTime())) return d;
  }
  return s;
}

function applyBinary(op: string, l: Scalar, r: Scalar): Scalar {
  switch (op) {
    case '+': case '-': case '*': case '/': case '^': {
      const ln = toNumStrict(l), rn = toNumStrict(r);
      if (ln === null || rn === null) return err('#ERR');
      switch (op) {
        case '+': return ln + rn;
        case '-': return ln - rn;
        case '*': return ln * rn;
        case '^': return Math.pow(ln, rn);
        case '/': return rn === 0 ? err('#DIV/0') : ln / rn;
      }
      return err('#ERR');
    }
    case '&': return toStr(l) + toStr(r);
    case '=': return looseEq(l, r);
    case '<>': return !looseEq(l, r);
    case '<': case '>': case '<=': case '>=': {
      const ln = toNumStrict(l), rn = toNumStrict(r);
      if (ln === null || rn === null) return err('#ERR');
      switch (op) {
        case '<': return ln < rn;
        case '>': return ln > rn;
        case '<=': return ln <= rn;
        case '>=': return ln >= rn;
      }
      return err('#ERR');
    }
  }
  return err('#ERR');
}

// Operator `=` equality: numeric when either side is a number (with coercion);
// otherwise case-SENSITIVE string equality (unlike criteria, which are
// case-insensitive). Dates compare by timestamp.
function looseEq(a: Scalar, b: Scalar): boolean {
  if (a instanceof Date && b instanceof Date) return a.getTime() === b.getTime();
  if (typeof a === 'number' || typeof b === 'number') {
    const an = toNumStrict(a), bn = toNumStrict(b);
    if (an === null || bn === null) return false;
    return an === bn;
  }
  return toStr(a) === toStr(b);
}

// Format a scalar for display. Blank => ''; small magnitudes keep precision
// (no truncate-to-zero); float noise is cleaned; booleans/dates/errors render
// canonically. getValue stays exact; only this display layer rounds noise.
function display(v: Scalar): string {
  if (isErr(v)) return v.err;
  if (v === '') return '';
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === 'boolean') return v ? 'TRUE' : 'FALSE';
  if (typeof v === 'number') return fmtNum(v);
  return v;
}

// Collect a formula's dependencies. Unqualified refs resolve to `home`.
function extractRefs(ast: Ast, home: string): { cells: CellId[]; ranges: RangeRef[] } {
  const cells: CellId[] = [];
  const ranges: RangeRef[] = [];
  const walk = (n: Ast): void => {
    switch (n.type) {
      case 'cell':
        cells.push(makeCellId(n.sheet ?? home, n.row, n.col));
        break;
      case 'range': {
        const sheet = n.sheet ?? home;
        ranges.push({
          sheet,
          r1: Math.min(n.start.row, n.end.row),
          r2: Math.max(n.start.row, n.end.row),
          c1: Math.min(n.start.col, n.end.col),
          c2: Math.max(n.start.col, n.end.col),
        });
        break;
      }
      case 'unary': case 'percent': walk((n as { expr: Ast }).expr); break;
      case 'binary': walk(n.left); walk(n.right); break;
      case 'call': for (const a of n.args) walk(a); break;
    }
  };
  walk(ast);
  return { cells, ranges };
}

function hasVolatile(ast: Ast): boolean {
  let found = false;
  const walk = (n: Ast): void => {
    if (found) return;
    switch (n.type) {
      case 'call':
        if (FUNCTIONS[n.name]?.volatile) { found = true; return; }
        for (const a of n.args) walk(a);
        break;
      case 'unary': case 'percent': walk((n as { expr: Ast }).expr); break;
      case 'binary': walk(n.left); walk(n.right); break;
    }
  };
  walk(ast);
  return found;
}
