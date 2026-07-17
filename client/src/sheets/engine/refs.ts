// Pure reference transforms on ASTs. Used by the engine for structural edits
// (insert/delete row or column) and by fill/drag. Both respect `$` absolute
// flags. Every transform returns a fresh AST and round-trips through the
// ast.ts serializer.
//
// Sheet scoping (shiftRefs): a reference "belongs to" a sheet when its explicit
// `sheet` equals `opts.sheet`, or — for an unqualified ref — when the formula's
// home sheet (`opts.homeSheet`, defaulting to `opts.sheet`) equals `opts.sheet`.
// So editing rows on Sheet2 shifts `Sheet2!A5` inside a Sheet1 formula, but
// leaves that formula's unqualified (Sheet1-local) refs alone when homeSheet is
// provided.

import type { Ast, Corner } from './ast';

export interface ShiftOpts {
  sheet: string;
  axis: 'row' | 'col';
  at: number; // 0-based index at which rows/cols are inserted or removed
  delta: number; // +n = insert n, -n = delete n
  homeSheet?: string; // home sheet of the formula (defaults to `sheet`)
}

export interface OffsetOpts {
  dRow: number;
  dCol: number;
}

const REF_ERR: Ast = { type: 'err', code: '#REF' };

// -----------------------------------------------------------------------------
// shiftRefs — insert/delete rows or columns
// -----------------------------------------------------------------------------

// Result of shifting a single scalar coordinate: a new value, or 'ref' when the
// coordinate lands inside a deleted band (=> #REF).
type Shifted = number | 'ref';

// Structural insert/delete renumbers coordinates REGARDLESS of the `$` absolute
// flag: the data physically moves (the model's shiftKeys), so `A$5` must become
// `A$6` after inserting a row above it to keep pointing at the same data. The
// `$` flag itself is preserved by the caller (via spread); it only pins refs
// during COPY/FILL (offsetRefs), never structural edits.
function shiftScalar(v: number, at: number, delta: number): Shifted {
  if (delta >= 0) return v >= at ? v + delta : v; // insert
  // delete: removes indices [at, at - delta - 1]
  const removedEnd = at - delta - 1;
  if (v < at) return v;
  if (v <= removedEnd) return 'ref';
  return v + delta;
}

// Clamp a range endpoint for deletion instead of erroring: a start inside the
// deleted band snaps to `at`; an end inside snaps to `at-1`. Absolute flags are
// ignored here for the same reason as shiftScalar.
function clampEndpoint(v: number, at: number, delta: number, isStart: boolean): Shifted {
  if (delta >= 0) return v >= at ? v + delta : v;
  const removedEnd = at - delta - 1;
  if (v < at) return v;
  if (v <= removedEnd) return isStart ? at : at - 1;
  return v + delta;
}

function refSheetMatches(nodeSheet: string | undefined, opts: ShiftOpts): boolean {
  const home = opts.homeSheet ?? opts.sheet;
  const refSheet = nodeSheet ?? home;
  return refSheet === opts.sheet;
}

function shiftCornerAxis(c: Corner, opts: ShiftOpts): Shifted {
  if (opts.axis === 'row') return shiftScalar(c.row, opts.at, opts.delta);
  return shiftScalar(c.col, opts.at, opts.delta);
}

export function shiftRefs(ast: Ast, opts: ShiftOpts): Ast {
  switch (ast.type) {
    case 'cell': {
      if (!refSheetMatches(ast.sheet, opts)) return ast;
      const s = shiftCornerAxis(ast, opts);
      if (s === 'ref') return REF_ERR;
      return opts.axis === 'row' ? { ...ast, row: s } : { ...ast, col: s };
    }
    case 'range': {
      if (!refSheetMatches(ast.sheet, opts)) return ast;
      const startS = clampEndpoint(
        opts.axis === 'row' ? ast.start.row : ast.start.col,
        opts.at, opts.delta, true,
      );
      const endS = clampEndpoint(
        opts.axis === 'row' ? ast.end.row : ast.end.col,
        opts.at, opts.delta, false,
      );
      // Normalize so start<=end before clamping decisions.
      const lo = opts.axis === 'row' ? Math.min(ast.start.row, ast.end.row) : Math.min(ast.start.col, ast.end.col);
      const hi = opts.axis === 'row' ? Math.max(ast.start.row, ast.end.row) : Math.max(ast.start.col, ast.end.col);
      if (opts.delta < 0) {
        const removedEnd = opts.at - opts.delta - 1;
        if (lo >= opts.at && hi <= removedEnd) return REF_ERR; // whole span deleted
      }
      if (startS === 'ref' || endS === 'ref') return REF_ERR;
      const start = applyCornerAxis(ast.start, opts.axis, startS);
      const end = applyCornerAxis(ast.end, opts.axis, endS);
      return { ...ast, start, end };
    }
    case 'unary': return { ...ast, expr: shiftRefs(ast.expr, opts) };
    case 'percent': return { ...ast, expr: shiftRefs(ast.expr, opts) };
    case 'binary': return { ...ast, left: shiftRefs(ast.left, opts), right: shiftRefs(ast.right, opts) };
    case 'call': return { ...ast, args: ast.args.map((a) => shiftRefs(a, opts)) };
    default: return ast;
  }
}

function applyCornerAxis(c: Corner, axis: 'row' | 'col', v: number): Corner {
  return axis === 'row' ? { ...c, row: v } : { ...c, col: v };
}

// -----------------------------------------------------------------------------
// offsetRefs — fill / drag
// -----------------------------------------------------------------------------

// Offset a single corner by (dRow, dCol); absolute axes stay put; a negative
// result marks the whole reference #REF.
function offsetCorner(c: Corner, dRow: number, dCol: number): Corner | 'ref' {
  const row = c.rowAbs ? c.row : c.row + dRow;
  const col = c.colAbs ? c.col : c.col + dCol;
  if (row < 0 || col < 0) return 'ref';
  return { ...c, row, col };
}

export function offsetRefs(ast: Ast, opts: OffsetOpts): Ast {
  switch (ast.type) {
    case 'cell': {
      const c = offsetCorner(ast, opts.dRow, opts.dCol);
      if (c === 'ref') return REF_ERR;
      return { ...ast, row: c.row, col: c.col };
    }
    case 'range': {
      const s = offsetCorner(ast.start, opts.dRow, opts.dCol);
      const e = offsetCorner(ast.end, opts.dRow, opts.dCol);
      if (s === 'ref' || e === 'ref') return REF_ERR;
      return { ...ast, start: s, end: e };
    }
    case 'unary': return { ...ast, expr: offsetRefs(ast.expr, opts) };
    case 'percent': return { ...ast, expr: offsetRefs(ast.expr, opts) };
    case 'binary': return { ...ast, left: offsetRefs(ast.left, opts), right: offsetRefs(ast.right, opts) };
    case 'call': return { ...ast, args: ast.args.map((a) => offsetRefs(a, opts)) };
    default: return ast;
  }
}

// -----------------------------------------------------------------------------
// renameSheetRefs — rewrite sheet-qualified refs during a sheet rename
// -----------------------------------------------------------------------------

export function renameSheetRefs(ast: Ast, oldName: string, newName: string): Ast {
  switch (ast.type) {
    case 'cell': return ast.sheet === oldName ? { ...ast, sheet: newName } : ast;
    case 'range': return ast.sheet === oldName ? { ...ast, sheet: newName } : ast;
    case 'unary': return { ...ast, expr: renameSheetRefs(ast.expr, oldName, newName) };
    case 'percent': return { ...ast, expr: renameSheetRefs(ast.expr, oldName, newName) };
    case 'binary': return {
      ...ast,
      left: renameSheetRefs(ast.left, oldName, newName),
      right: renameSheetRefs(ast.right, oldName, newName),
    };
    case 'call': return { ...ast, args: ast.args.map((a) => renameSheetRefs(a, oldName, newName)) };
    default: return ast;
  }
}
