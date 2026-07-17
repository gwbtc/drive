// Pure function registry. Each FnImpl receives lazy argument thunks (so IF and
// other short-circuiting functions only evaluate the branch they take) and
// returns a Scalar. No engine/graph/DOM dependencies live here — a thunk that
// resolves to a range exposes a `get(r,c)` closure the engine wires up.
//
// This is a faithful port of the legacy formula.ts functions, with the flagged
// "arguably buggy" behaviours corrected to Google Sheets semantics:
//   * SUMIF/AVERAGEIF sum-range is positionally parallel to the criteria range
//     (by row/col offset from each range's top-left), including blanks, and a
//     short sum-range extends its shape from its top-left (never falls back to
//     the test cell's own value).
//   * MATCH counts blanks when reporting a 1-based position.
//   * COUNT counts numbers/numeric-strings only (COUNT("") = 0).
//   * LEN of a blank cell is 0.
//   * ROUND rounds halves away from zero (ROUND(-2.5) = -3).
//   * Criterion string comparisons (=, <>, <, >, <=, >=) are all
//     case-insensitive; criteria can match truly-blank cells with "".
//   * Booleans render UPPERCASE in CONCAT (via toStr).

import {
  type Scalar,
  type CellError,
  err,
  isErr,
  isBlank,
  toNumStrict,
  toNumAgg,
  isCountable,
  toStr,
  toDate,
} from './types';

// A materialized range argument. `get(r,c)` resolves an absolute cell (r,c) on
// `sheet` through the engine — it may be queried outside [r1..r2, c1..c2] (used
// by SUMIF to extend a short sum-range from its top-left).
export interface RangeArg {
  kind: 'range';
  sheet: string;
  r1: number;
  c1: number;
  r2: number;
  c2: number;
  get(r: number, c: number): Scalar;
}

export interface ScalarArg {
  kind: 'scalar';
  value: Scalar;
}

export type ArgValue = ScalarArg | RangeArg;
export type Thunk = () => ArgValue;

export interface FnImpl {
  volatile?: boolean;
  call(args: Thunk[]): Scalar;
}

// -----------------------------------------------------------------------------
// Argument helpers
// -----------------------------------------------------------------------------

function forceScalar(a: ArgValue): Scalar {
  if (a.kind === 'scalar') return a.value;
  return err('#ERR'); // a bare range used where a scalar is expected
}

// Iterate a range (or a lone scalar) as a flat list, row-major, keeping blanks.
function flatten(a: ArgValue, out: Scalar[]): void {
  if (a.kind === 'scalar') { out.push(a.value); return; }
  for (let r = a.r1; r <= a.r2; r++) {
    for (let c = a.c1; c <= a.c2; c++) out.push(a.get(r, c));
  }
}

function collectScalars(args: Thunk[]): Scalar[] {
  const out: Scalar[] = [];
  for (const t of args) flatten(t(), out);
  return out;
}

function firstError(values: Scalar[]): CellError | null {
  for (const v of values) if (isErr(v)) return v;
  return null;
}

// IF-condition truthiness: numeric coercion (non-numeric text is falsy).
function truthy(v: Scalar): boolean {
  if (isErr(v)) return false;
  if (typeof v === 'boolean') return v;
  const n = toNumStrict(v);
  return n !== null && n !== 0;
}

// Round halves away from zero (Excel/Sheets ROUND). toPrecision(15) strips
// binary-representation noise before the half-decision, matching ROUNDUP/
// ROUNDDOWN (roundDir) — so e.g. ROUND(1.005,2)=1.01 and ROUND(2.675,2)=2.68
// instead of spuriously rounding down on 1.00499999…/2.67499999….
function roundHalfAway(n: number, digits: number): number {
  const f = 10 ** digits;
  const scaled = Number((n * f).toPrecision(15));
  const r = (scaled < 0 ? -1 : 1) * Math.round(Math.abs(scaled));
  return r / f;
}

// -----------------------------------------------------------------------------
// Criterion matching (SUMIF / COUNTIF / AVERAGEIF)
// -----------------------------------------------------------------------------

function looseEquals(a: Scalar, b: Scalar): boolean {
  const an = toNumAgg(a);
  const bn = toNumAgg(b);
  if (an !== null && bn !== null) return an === bn;
  return toStr(a).toLowerCase() === toStr(b).toLowerCase();
}

// Ordering used by approximate lookups (VLOOKUP is_sorted=TRUE, MATCH type
// 1/-1). Two numbers compare numerically; two non-numeric values compare as
// case-insensitive text (a blank '' sorts lowest). A number vs text pair is
// treated as not comparable (null) and simply skipped by the caller.
function cmpLookup(a: Scalar, b: Scalar): number | null {
  const an = toNumAgg(a);
  const bn = toNumAgg(b);
  if (an !== null && bn !== null) return an < bn ? -1 : an > bn ? 1 : 0;
  if (an === null && bn === null) {
    const as = toStr(a).toLowerCase();
    const bs = toStr(b).toLowerCase();
    return as < bs ? -1 : as > bs ? 1 : 0;
  }
  return null;
}

function matchCriterion(value: Scalar, criterion: Scalar): boolean {
  if (isErr(value)) return false;
  // A non-string criterion (e.g. COUNTIF(range, 2)) is a plain equality test.
  if (typeof criterion !== 'string') return looseEquals(value, criterion);

  let op = '=';
  let rhs = criterion;
  const m = criterion.match(/^\s*(>=|<=|<>|!=|>|<|=)\s*([\s\S]*)$/);
  if (m) {
    op = m[1] === '!=' ? '<>' : m[1];
    rhs = m[2];
  }
  rhs = rhs.trim();
  if ((rhs.startsWith('"') && rhs.endsWith('"')) || (rhs.startsWith("'") && rhs.endsWith("'"))) {
    rhs = rhs.slice(1, -1);
  }

  // Empty right-hand side matches truly-blank cells.
  if (rhs === '') {
    const blank = isBlank(value);
    if (op === '=') return blank;
    if (op === '<>') return !blank;
    return false;
  }

  const vNum = toNumAgg(value);
  const rNum = Number(rhs);
  if (vNum !== null && !Number.isNaN(rNum)) {
    switch (op) {
      case '=': return vNum === rNum;
      case '<>': return vNum !== rNum;
      case '>': return vNum > rNum;
      case '<': return vNum < rNum;
      case '>=': return vNum >= rNum;
      case '<=': return vNum <= rNum;
    }
  }
  const vs = toStr(value).toLowerCase();
  const rs = rhs.toLowerCase();
  switch (op) {
    case '=': return vs === rs;
    case '<>': return vs !== rs;
    case '>': return vs > rs;
    case '<': return vs < rs;
    case '>=': return vs >= rs;
    case '<=': return vs <= rs;
  }
  return false;
}

// Normalize an ArgValue into range geometry. A scalar becomes a 1x1 "range"
// anchored at (0,0) whose get() always yields that scalar.
interface Grid { r1: number; c1: number; r2: number; c2: number; get(r: number, c: number): Scalar }
function asGrid(a: ArgValue): Grid {
  if (a.kind === 'range') return a;
  return { r1: 0, c1: 0, r2: 0, c2: 0, get: () => a.value };
}

// -----------------------------------------------------------------------------
// *IF aggregates
// -----------------------------------------------------------------------------

type IfName = 'SUMIF' | 'COUNTIF' | 'AVERAGEIF';
function conditionalAggregate(name: IfName, args: Thunk[]): Scalar {
  const isCount = name === 'COUNTIF';
  if (args.length < 2 || args.length > (isCount ? 2 : 3)) return err('#ERR');

  const testArg = args[0]();
  const test = asGrid(testArg);
  const crit = forceScalar(args[1]());
  if (isErr(crit)) return crit;

  const sum: Grid | null = isCount ? null : asGrid(args[2] ? args[2]() : testArg);

  const rows = test.r2 - test.r1;
  const cols = test.c2 - test.c1;
  let total = 0;
  let count = 0;

  for (let i = 0; i <= rows; i++) {
    for (let j = 0; j <= cols; j++) {
      const tv = test.get(test.r1 + i, test.c1 + j);
      if (isErr(tv)) continue;
      if (!matchCriterion(tv, crit)) continue;
      if (isCount) { count++; continue; }
      // Positionally parallel by (i,j) offset from the sum-range's top-left;
      // get() extends the shape past the declared sum-range if it is shorter.
      const sv = sum!.get(sum!.r1 + i, sum!.c1 + j);
      if (isErr(sv)) continue;
      const n = toNumAgg(sv);
      if (n !== null) { total += n; count++; }
    }
  }

  if (name === 'COUNTIF') return count;
  if (name === 'SUMIF') return total;
  if (count === 0) return err('#DIV/0');
  return total / count;
}

// -----------------------------------------------------------------------------
// Registry
// -----------------------------------------------------------------------------

function num1(args: Thunk[], f: (n: number) => Scalar): Scalar {
  if (args.length !== 1) return err('#ERR');
  const v = forceScalar(args[0]());
  if (isErr(v)) return v;
  const n = toNumStrict(v);
  if (n === null) return err('#ERR');
  return f(n);
}

function str1(args: Thunk[], f: (s: string) => Scalar): Scalar {
  if (args.length !== 1) return err('#ERR');
  const v = forceScalar(args[0]());
  if (isErr(v)) return v;
  return f(toStr(v));
}

export const FUNCTIONS: Record<string, FnImpl> = {
  SUM: { call(args) {
    const vals = collectScalars(args);
    const e = firstError(vals);
    if (e) return e;
    let s = 0;
    for (const v of vals) { const n = toNumAgg(v); if (n !== null) s += n; }
    return s;
  } },

  AVG: { call: (args) => avg(args) },
  AVERAGE: { call: (args) => avg(args) },

  MIN: { call: (args) => minmax(args, true) },
  MAX: { call: (args) => minmax(args, false) },

  COUNT: { call(args) {
    let c = 0;
    for (const v of collectScalars(args)) {
      if (isErr(v)) continue; // errors are skipped, not counted or propagated
      if (isCountable(v)) c++;
    }
    return c;
  } },

  IF: { call(args) {
    if (args.length < 2 || args.length > 3) return err('#ERR');
    const cond = forceScalar(args[0]());
    if (isErr(cond)) return cond;
    if (truthy(cond)) return forceScalar(args[1]());
    if (args[2]) return forceScalar(args[2]());
    return '';
  } },

  TODAY: { volatile: true, call() {
    const d = new Date();
    d.setUTCHours(0, 0, 0, 0);
    return d;
  } },
  NOW: { volatile: true, call: () => new Date() },

  DATE: { call(args) {
    if (args.length !== 3) return err('#ERR');
    const y = forceScalar(args[0]()); if (isErr(y)) return y;
    const m = forceScalar(args[1]()); if (isErr(m)) return m;
    const d = forceScalar(args[2]()); if (isErr(d)) return d;
    const yn = toNumStrict(y), mn = toNumStrict(m), dn = toNumStrict(d);
    if (yn === null || mn === null || dn === null) return err('#ERR');
    return new Date(Date.UTC(yn, mn - 1, dn));
  } },

  YEAR: { call: (args) => datePart(args, (d) => d.getUTCFullYear()) },
  MONTH: { call: (args) => datePart(args, (d) => d.getUTCMonth() + 1) },
  DAY: { call: (args) => datePart(args, (d) => d.getUTCDate()) },

  ABS: { call: (args) => num1(args, (n) => Math.abs(n)) },
  SQRT: { call: (args) => num1(args, (n) => (n < 0 ? err('#ERR') : Math.sqrt(n))) },
  ROUND: { call(args) {
    if (args.length < 1 || args.length > 2) return err('#ERR');
    const v = forceScalar(args[0]()); if (isErr(v)) return v;
    const n = toNumStrict(v); if (n === null) return err('#ERR');
    let digits = 0;
    if (args[1]) {
      const dv = forceScalar(args[1]()); if (isErr(dv)) return dv;
      const dn = toNumStrict(dv); if (dn === null) return err('#ERR');
      digits = Math.trunc(dn);
    }
    return roundHalfAway(n, digits);
  } },

  LEN: { call: (args) => str1(args, (s) => s.length) },
  UPPER: { call: (args) => str1(args, (s) => s.toUpperCase()) },
  LOWER: { call: (args) => str1(args, (s) => s.toLowerCase()) },
  TRIM: { call: (args) => str1(args, (s) => s.trim()) },

  LEFT: { call: (args) => sideSlice(args, true) },
  RIGHT: { call: (args) => sideSlice(args, false) },

  MID: { call(args) {
    if (args.length !== 3) return err('#ERR');
    const v = forceScalar(args[0]()); if (isErr(v)) return v;
    const sv = forceScalar(args[1]()); if (isErr(sv)) return sv;
    const lv = forceScalar(args[2]()); if (isErr(lv)) return lv;
    const s = toStr(v);
    const start = toNumStrict(sv), len = toNumStrict(lv);
    if (start === null || len === null) return err('#ERR');
    // Google Sheets: start_num < 1 is #VALUE (not a slice-from-the-end). Clamp
    // is wrong here — a negative `start-1` would make slice count from the end.
    const startI = Math.floor(start);
    if (startI < 1) return err('#VALUE');
    return s.slice(startI - 1, startI - 1 + Math.max(0, Math.floor(len)));
  } },

  CONCATENATE: { call: (args) => concat(args) },
  CONCAT: { call: (args) => concat(args) },

  SUMIF: { call: (args) => conditionalAggregate('SUMIF', args) },
  COUNTIF: { call: (args) => conditionalAggregate('COUNTIF', args) },
  AVERAGEIF: { call: (args) => conditionalAggregate('AVERAGEIF', args) },

  // VLOOKUP(key, range, colIndex, [isApprox]). isApprox defaults to TRUE, the
  // Google Sheets / Excel default: an approximate match assumes the first
  // column is sorted ascending and returns the row with the largest first-
  // column value that is <= key. isApprox=FALSE performs an exact match.
  VLOOKUP: { call(args) {
    if (args.length < 3 || args.length > 4) return err('#ERR');
    const lk = forceScalar(args[0]()); if (isErr(lk)) return lk;
    const colV = forceScalar(args[2]()); if (isErr(colV)) return colV;
    const colN = toNumStrict(colV);
    if (colN === null || colN < 1) return err('#ERR');
    const rng = args[1]();
    if (rng.kind !== 'range') return err('#REF');
    let approx = true;
    if (args[3]) {
      const av = forceScalar(args[3]()); if (isErr(av)) return av;
      approx = truthy(av);
    }
    const targetCol = rng.c1 + colN - 1;
    if (targetCol > rng.c2) return err('#REF');

    if (!approx) {
      for (let r = rng.r1; r <= rng.r2; r++) {
        if (looseEquals(rng.get(r, rng.c1), lk)) return rng.get(r, targetCol);
      }
      return err('#N/A');
    }
    // Approximate: first column assumed ascending; take the last row whose
    // first-column value is <= key, stopping once a value exceeds key.
    let candidate = -1;
    for (let r = rng.r1; r <= rng.r2; r++) {
      const cmp = cmpLookup(rng.get(r, rng.c1), lk);
      if (cmp === null) continue;
      if (cmp <= 0) candidate = r;
      else break;
    }
    if (candidate < 0) return err('#N/A');
    return rng.get(candidate, targetCol);
  } },

  INDEX: { call(args) {
    if (args.length < 2 || args.length > 3) return err('#ERR');
    const rv = forceScalar(args[1]()); if (isErr(rv)) return rv;
    const rn = toNumStrict(rv);
    if (rn === null || rn < 1) return err('#ERR');
    let cn = 1;
    if (args[2]) {
      const cv = forceScalar(args[2]()); if (isErr(cv)) return cv;
      const x = toNumStrict(cv);
      if (x === null || x < 1) return err('#ERR');
      cn = x;
    }
    const rng = args[0]();
    if (rng.kind !== 'range') return err('#REF');
    const rows = rng.r2 - rng.r1 + 1;
    const cols = rng.c2 - rng.c1 + 1;
    if (rn > rows || cn > cols) return err('#REF');
    return rng.get(rng.r1 + rn - 1, rng.c1 + cn - 1);
  } },

  // MATCH(key, range, [match_type]). match_type 0 = exact (the engine default;
  // note Google's own default is 1, but this registry keeps exact-when-omitted
  // for backward compatibility). match_type 1 = largest value <= key with the
  // range assumed sorted ASCENDING; -1 = smallest value >= key with the range
  // assumed sorted DESCENDING. Positions are 1-based and count blanks.
  MATCH: { call(args) {
    if (args.length < 2 || args.length > 3) return err('#ERR');
    const lk = forceScalar(args[0]()); if (isErr(lk)) return lk;
    let type = 0;
    if (args[2]) {
      const tv = forceScalar(args[2]()); if (isErr(tv)) return tv;
      const tn = toNumStrict(tv); if (tn === null) return err('#ERR');
      type = tn > 0 ? 1 : tn < 0 ? -1 : 0;
    }
    const vals: Scalar[] = [];
    flatten(args[1](), vals); // row-major; a lone scalar becomes 1 element

    if (type === 0) {
      for (let i = 0; i < vals.length; i++) {
        const v = vals[i];
        if (isErr(v)) continue;
        if (looseEquals(v, lk)) return i + 1;
      }
      return err('#N/A');
    }
    // Approximate: scan while comparable, tracking the last acceptable
    // position, and stop as soon as the sorted order is broken past key.
    let result = -1;
    for (let i = 0; i < vals.length; i++) {
      const v = vals[i];
      if (isErr(v)) continue;
      const cmp = cmpLookup(v, lk);
      if (cmp === null) continue;
      if (type === 1) {
        if (cmp <= 0) result = i + 1; else break;   // ascending: v <= key
      } else {
        if (cmp >= 0) result = i + 1; else break;   // descending: v >= key
      }
    }
    return result < 0 ? err('#N/A') : result;
  } },

  // ---- additional functions -----------------------------------------------

  // IFERROR(value, [fallback]) — if value evaluates to any error, return
  // fallback (default ''); otherwise value. Lazy: fallback is only evaluated
  // when needed. Errors in this engine are {err} scalars, not thrown, so
  // simply evaluating value's thunk and testing isErr catches them (same
  // mechanism IF uses to avoid evaluating the untaken branch).
  IFERROR: { call(args) {
    if (args.length < 1 || args.length > 2) return err('#ERR');
    const v = forceScalar(args[0]());
    if (isErr(v)) return args[1] ? forceScalar(args[1]()) : '';
    return v;
  } },

  // IFNA(value, fallback) — like IFERROR but only catches #N/A; any other
  // error propagates.
  IFNA: { call(args) {
    if (args.length !== 2) return err('#ERR');
    const v = forceScalar(args[0]());
    if (isErr(v) && v.err === '#N/A') return forceScalar(args[1]());
    return v;
  } },

  // COUNTA — count non-empty cells: text, numbers, booleans and errors all
  // count; only a truly-blank '' does not. (A formula that yields "" is
  // indistinguishable from blank here and is treated as blank.)
  COUNTA: { call(args) {
    let c = 0;
    for (const v of collectScalars(args)) if (!isBlank(v)) c++;
    return c;
  } },

  // COUNTBLANK — count empty ('' / blank) cells in the argument(s).
  COUNTBLANK: { call(args) {
    let c = 0;
    for (const v of collectScalars(args)) if (isBlank(v)) c++;
    return c;
  } },

  // TEXT(value, pattern) — format a number or date as text. See textFormat for
  // the supported pattern set.
  TEXT: { call(args) {
    if (args.length !== 2) return err('#ERR');
    const v = forceScalar(args[0]()); if (isErr(v)) return v;
    const pv = forceScalar(args[1]()); if (isErr(pv)) return pv;
    return textFormat(v, toStr(pv));
  } },

  // SUMPRODUCT(a, b, ...) — element-wise multiply parallel ranges then sum.
  // All arguments must share the same shape (else #VALUE). Non-numeric cells
  // contribute 0; an error cell propagates. A single argument reduces to SUM.
  SUMPRODUCT: { call(args) {
    if (args.length < 1) return err('#ERR');
    const grids = args.map((a) => asGrid(a()));
    const rows = grids[0].r2 - grids[0].r1;
    const cols = grids[0].c2 - grids[0].c1;
    for (const g of grids) {
      if (g.r2 - g.r1 !== rows || g.c2 - g.c1 !== cols) return err('#VALUE');
    }
    let total = 0;
    for (let i = 0; i <= rows; i++) {
      for (let j = 0; j <= cols; j++) {
        let prod = 1;
        for (const g of grids) {
          const v = g.get(g.r1 + i, g.c1 + j);
          if (isErr(v)) return v;
          prod *= toNumAgg(v) ?? 0;
        }
        total += prod;
      }
    }
    return total;
  } },

  // ROUNDUP / ROUNDDOWN(n, [digits]) — round away-from-zero / toward-zero at
  // `digits` decimal places (default 0).
  ROUNDUP: { call: (args) => roundDir(args, true) },
  ROUNDDOWN: { call: (args) => roundDir(args, false) },

  // POWER(base, exp) — mirrors the ^ operator exactly (toNumStrict coercion,
  // Math.pow; degenerate inputs yield the same Infinity/NaN the operator does).
  POWER: { call(args) {
    if (args.length !== 2) return err('#ERR');
    const b = forceScalar(args[0]()); if (isErr(b)) return b;
    const e = forceScalar(args[1]()); if (isErr(e)) return e;
    const bn = toNumStrict(b), en = toNumStrict(e);
    if (bn === null || en === null) return err('#ERR');
    return Math.pow(bn, en);
  } },

  // MOD(a, b) — Google MOD: the result takes the sign of the divisor
  // (MOD(-3,2)=1). #DIV/0 when b=0.
  MOD: { call(args) {
    if (args.length !== 2) return err('#ERR');
    const av = forceScalar(args[0]()); if (isErr(av)) return av;
    const bv = forceScalar(args[1]()); if (isErr(bv)) return bv;
    const a = toNumStrict(av), b = toNumStrict(bv);
    if (a === null || b === null) return err('#ERR');
    if (b === 0) return err('#DIV/0');
    return a - b * Math.floor(a / b);
  } },

  // XLOOKUP(key, lookupRange, resultRange, [ifNotFound]) — exact-match lookup
  // only (no approximate/wildcard modes). lookupRange and resultRange are
  // flattened row-major and must be the same length (else #VALUE); the element
  // of resultRange parallel to the first matching lookup element is returned.
  // ifNotFound (lazy) is returned when there is no match, defaulting to #N/A.
  XLOOKUP: { call(args) {
    if (args.length < 3 || args.length > 4) return err('#ERR');
    const key = forceScalar(args[0]()); if (isErr(key)) return key;
    const lookup: Scalar[] = []; flatten(args[1](), lookup);
    const result: Scalar[] = []; flatten(args[2](), result);
    if (lookup.length !== result.length) return err('#VALUE');
    for (let i = 0; i < lookup.length; i++) {
      const lv = lookup[i];
      if (isErr(lv)) continue;
      if (looseEquals(lv, key)) return result[i];
    }
    return args[3] ? forceScalar(args[3]()) : err('#N/A');
  } },
};

// -----------------------------------------------------------------------------
// Shared implementations
// -----------------------------------------------------------------------------

function avg(args: Thunk[]): Scalar {
  const vals = collectScalars(args);
  const e = firstError(vals);
  if (e) return e;
  let s = 0, count = 0;
  for (const v of vals) { const n = toNumAgg(v); if (n !== null) { s += n; count++; } }
  if (count === 0) return err('#DIV/0');
  return s / count;
}

function minmax(args: Thunk[], isMin: boolean): Scalar {
  const vals = collectScalars(args);
  const e = firstError(vals);
  if (e) return e;
  let m: number | null = null;
  for (const v of vals) {
    const n = toNumAgg(v);
    if (n === null) continue;
    m = m === null ? n : (isMin ? Math.min(m, n) : Math.max(m, n));
  }
  return m ?? 0;
}

function datePart(args: Thunk[], f: (d: Date) => number): Scalar {
  if (args.length !== 1) return err('#ERR');
  const v = forceScalar(args[0]()); if (isErr(v)) return v;
  const d = toDate(v);
  if (d === null) return err('#ERR');
  return f(d);
}

function sideSlice(args: Thunk[], left: boolean): Scalar {
  if (args.length < 1 || args.length > 2) return err('#ERR');
  const v = forceScalar(args[0]()); if (isErr(v)) return v;
  const s = toStr(v);
  let n = 1;
  if (args[1]) {
    const nv = forceScalar(args[1]()); if (isErr(nv)) return nv;
    const nn = toNumStrict(nv);
    if (nn === null) return err('#ERR');
    n = Math.max(0, Math.floor(nn));
  }
  return left ? s.slice(0, n) : s.slice(Math.max(0, s.length - n));
}

function concat(args: Thunk[]): Scalar {
  let out = '';
  for (const t of args) {
    const vals: Scalar[] = [];
    flatten(t(), vals);
    for (const v of vals) {
      if (isErr(v)) return v;
      out += toStr(v);
    }
  }
  return out;
}

// ROUNDUP (away from zero) / ROUNDDOWN (toward zero). toPrecision(15) strips
// binary-representation noise so e.g. 2.675*100 doesn't spuriously ceil.
function roundDir(args: Thunk[], away: boolean): Scalar {
  if (args.length < 1 || args.length > 2) return err('#ERR');
  const v = forceScalar(args[0]()); if (isErr(v)) return v;
  const n = toNumStrict(v); if (n === null) return err('#ERR');
  let digits = 0;
  if (args[1]) {
    const dv = forceScalar(args[1]()); if (isErr(dv)) return dv;
    const dn = toNumStrict(dv); if (dn === null) return err('#ERR');
    digits = Math.trunc(dn);
  }
  const f = 10 ** digits;
  const scaled = Number((n * f).toPrecision(15));
  const sign = scaled < 0 ? -1 : 1;
  const mag = Math.abs(scaled);
  const r = away ? Math.ceil(mag) : Math.floor(mag);
  return (sign * r) / f;
}

// -----------------------------------------------------------------------------
// TEXT formatting
// -----------------------------------------------------------------------------
// Supported patterns (pragmatic subset of Sheets number/date formats):
//   Numbers: '0', '0.00' (fixed decimals); '#,##0', '#,##0.00' (thousands
//            grouping); '0%', '0.00%' (percent); '$#,##0.00' (currency).
//            Decimals = count of '0' after '.'; grouping = a ',' in the integer
//            part; leading '$' and trailing '%' are honoured anywhere.
//   Dates:   tokens yyyy, yy, mm, m, dd, d (case-insensitive), e.g.
//            'yyyy-mm-dd', 'mm/dd/yyyy', 'm/d/yyyy'. Month/day NAMES are not
//            supported.
// Any pattern that matches neither shape returns the value stringified.

function textFormat(value: Scalar, pattern: string): Scalar {
  if (isErr(value)) return value;
  // Numeric format: only $ # 0 , . % and whitespace, and at least one digit slot.
  if (/^[$#0,.%\s]+$/.test(pattern) && /[0#]/.test(pattern)) {
    const n = toNumStrict(value);
    if (n === null) return toStr(value);
    return formatNumberPattern(n, pattern);
  }
  // Date format: contains a y/m/d token.
  if (/[ymd]/i.test(pattern)) {
    const d = toDate(value);
    if (d === null) return toStr(value);
    return formatDatePattern(d, pattern);
  }
  return toStr(value);
}

function formatNumberPattern(n: number, pattern: string): string {
  const isPercent = pattern.includes('%');
  const isCurrency = pattern.includes('$');
  const dot = pattern.indexOf('.');
  const decimals = dot >= 0 ? (pattern.slice(dot + 1).match(/0/g) || []).length : 0;
  const intPart = dot >= 0 ? pattern.slice(0, dot) : pattern;
  const grouping = intPart.includes(',');

  let x = isPercent ? n * 100 : n;
  let neg = x < 0;
  x = Math.abs(x);
  let s = x.toFixed(decimals);
  if (Number(s) === 0) neg = false; // avoid a "-0" result
  if (grouping) {
    const parts = s.split('.');
    parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    s = parts.join('.');
  }
  return (neg ? '-' : '') + (isCurrency ? '$' : '') + s + (isPercent ? '%' : '');
}

function formatDatePattern(d: Date, pattern: string): string {
  const yyyy = d.getUTCFullYear();
  const mo = d.getUTCMonth() + 1;
  const day = d.getUTCDate();
  const p2 = (x: number) => String(x).padStart(2, '0');
  // Replace longest tokens first so 'yyyy' is consumed before 'yy', etc.
  return pattern
    .replace(/yyyy/gi, String(yyyy))
    .replace(/yy/gi, p2(yyyy % 100))
    .replace(/mm/gi, p2(mo))
    .replace(/m/gi, String(mo))
    .replace(/dd/gi, p2(day))
    .replace(/d/gi, String(day));
}
