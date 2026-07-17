// Pure fill-series logic for the spreadsheet's drag-fill (the fill handle).
// Given the raw source cell values along a fill axis, it produces the raw
// values for the dragged target cells. The behaviour is decided per source
// line (a single column when filling down, a single row when filling right):
//
//   * Formula — relative refs are offset by the fill distance ($absolute stays
//     put); a multi-cell source block tiles. `=A1*2` filled down becomes
//     `=A2*2`, `=A3*2`, … ; `=$A$1*2` stays `=$A$1*2`.
//   * Number — a lone number is copied (no increment); 2+ numbers in an
//     arithmetic run extrapolate the series (1,2 -> 3,4,5 ; 5,10,15 -> 20,25).
//     A non-arithmetic numeric run tiles.
//   * Date — ISO yyyy-mm-dd; a lone date steps +1 day; 2+ dates infer the day
//     step and continue it.
//   * Text / other / mixed — the source block is tiled (copied) over the target.
//
// Everything here is pure (no DOM / Yjs). Formula fill reuses the engine's
// read-only parse / serialize / offsetRefs, so it honours $absolutes, sheet
// qualifiers and every operator exactly as the engine does.

import { parse, serializeFormula, ParseError } from './engine/ast';
import { offsetRefs } from './engine/refs';

export type FillAxis = 'row' | 'col';

export interface Rect { r1: number; c1: number; r2: number; c2: number }
export interface FillWrite { r: number; c: number; raw: string }

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const NUMERIC = /^-?\d+(?:\.\d+)?$/;
const MS_PER_DAY = 86_400_000;
const EPS = 1e-9;

type LineMode = 'formula' | 'number' | 'date' | 'text';

// Classify a source line. A line only qualifies as a series (formula / number /
// date) when EVERY cell is non-empty and of that one kind; anything mixed or
// containing a blank tiles as text.
function classify(src: string[]): LineMode {
  if (src.length === 0 || src.some((s) => s.trim() === '')) return 'text';
  if (src.every((s) => s.startsWith('='))) return 'formula';
  if (src.every((s) => ISO_DATE.test(s.trim()))) return 'date';
  if (src.every((s) => NUMERIC.test(s.trim()))) return 'number';
  return 'text';
}

// -----------------------------------------------------------------------------
// 1-D series generation
// -----------------------------------------------------------------------------

// Produce `count` target values that continue `src` (the source cells along the
// fill axis, in order). `axis` says whether formula offsets shift rows or cols.
export function fillLine(src: string[], count: number, axis: FillAxis): string[] {
  if (src.length === 0 || count <= 0) return [];
  switch (classify(src)) {
    case 'formula': return fillFormula(src, count, axis);
    case 'number': return fillNumber(src, count);
    case 'date': return fillDate(src, count);
    default: return fillTile(src, count);
  }
}

// Copy the source block, repeating it over the target.
function fillTile(src: string[], count: number): string[] {
  const h = src.length;
  const out: string[] = [];
  for (let i = 0; i < count; i++) out.push(src[i % h]);
  return out;
}

// Offset each source formula by its distance from the target cell, tiling the
// block. Target position p (0-based from the source start) maps back to source
// cell `p % h`, shifted by `p - (p % h)` (= a whole number of block heights).
function fillFormula(src: string[], count: number, axis: FillAxis): string[] {
  const h = src.length;
  const out: string[] = [];
  for (let i = 0; i < count; i++) {
    const p = h + i;
    const idx = p % h;
    const shift = p - idx;
    out.push(offsetFormula(src[idx], axis === 'row' ? shift : 0, axis === 'col' ? shift : 0));
  }
  return out;
}

function offsetFormula(raw: string, dRow: number, dCol: number): string {
  try {
    return serializeFormula(offsetRefs(parse(raw), { dRow, dCol }));
  } catch (e) {
    if (e instanceof ParseError) return raw; // unparseable: copy verbatim
    throw e;
  }
}

function fillNumber(src: string[], count: number): string[] {
  const nums = src.map((s) => parseFloat(s));
  const step = arithmeticStep(nums);
  if (step === null) return fillTile(src, count); // irregular run: tile
  const last = nums[nums.length - 1];
  const out: string[] = [];
  for (let i = 0; i < count; i++) out.push(formatNumber(last + step * (i + 1)));
  return out;
}

function fillDate(src: string[], count: number): string[] {
  const days = src.map(isoToDays);
  let step: number;
  if (days.length === 1) {
    step = 1;
  } else {
    const s = arithmeticStep(days);
    if (s === null) return fillTile(src, count); // irregular gaps: tile
    step = s;
  }
  const last = days[days.length - 1];
  const out: string[] = [];
  for (let i = 0; i < count; i++) out.push(daysToIso(last + step * (i + 1)));
  return out;
}

// Common difference of an arithmetic run: 0 for a single value (=> copy), the
// shared step for 2+ equally-spaced values, or null when the spacing varies.
function arithmeticStep(nums: number[]): number | null {
  if (nums.length === 1) return 0;
  const step = nums[1] - nums[0];
  for (let i = 2; i < nums.length; i++) {
    if (Math.abs((nums[i] - nums[i - 1]) - step) > EPS) return null;
  }
  return step;
}

function formatNumber(n: number): string {
  if (Number.isInteger(n)) return String(n);
  // Strip binary float noise accumulated by repeated addition.
  return String(Number(n.toPrecision(12)));
}

function isoToDays(iso: string): number {
  return Date.parse(iso.trim() + 'T00:00:00Z') / MS_PER_DAY;
}

function daysToIso(days: number): string {
  return new Date(Math.round(days) * MS_PER_DAY).toISOString().slice(0, 10);
}

// -----------------------------------------------------------------------------
// 2-D fill (drag geometry -> writes)
// -----------------------------------------------------------------------------

// Which way `dest` extends `src`. Ties (or a pure-diagonal drag) resolve to the
// axis with the larger extension, preferring 'down'.
export function fillDirection(src: Rect, dest: Rect): FillAxis | null {
  const down = Math.max(0, dest.r2 - src.r2);
  const right = Math.max(0, dest.c2 - src.c2);
  if (down === 0 && right === 0) return null;
  return down >= right ? 'row' : 'col';
}

// Given a (normalized) source rect and the drag-target rect that extends it
// down or right, produce the raw writes for the newly covered cells only.
// `getRaw(r, c)` reads a source cell's raw text.
export function computeFill(
  src: Rect,
  dest: Rect,
  getRaw: (r: number, c: number) => string,
): FillWrite[] {
  const writes: FillWrite[] = [];
  const dir = fillDirection(src, dest);
  if (!dir) return writes;

  if (dir === 'row') {
    const count = dest.r2 - src.r2;
    if (count <= 0) return writes;
    for (let c = src.c1; c <= src.c2; c++) {
      const line: string[] = [];
      for (let r = src.r1; r <= src.r2; r++) line.push(getRaw(r, c));
      const produced = fillLine(line, count, 'row');
      for (let i = 0; i < count; i++) writes.push({ r: src.r2 + 1 + i, c, raw: produced[i] });
    }
  } else {
    const count = dest.c2 - src.c2;
    if (count <= 0) return writes;
    for (let r = src.r1; r <= src.r2; r++) {
      const line: string[] = [];
      for (let c = src.c1; c <= src.c2; c++) line.push(getRaw(r, c));
      const produced = fillLine(line, count, 'col');
      for (let i = 0; i < count; i++) writes.push({ r, c: src.c2 + 1 + i, raw: produced[i] });
    }
  }
  return writes;
}
