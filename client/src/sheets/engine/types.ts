// Shared primitives for the incremental calc engine. No Yjs / DOM / Preact —
// pure TypeScript. Everything downstream (ast, functions, graph, engine, refs)
// builds on the Scalar value type and CellId string encoding defined here.

// Error codes. The engine surfaces the same set the legacy formula.ts used,
// plus #VALUE for type errors (though for parity with the existing repo we
// emit #ERR for non-numeric arithmetic — see functions.ts / engine.ts).
export type ErrCode =
  | '#CIRCULAR'
  | '#REF'
  | '#ERR'
  | '#DIV/0'
  | '#NAME'
  | '#N/A'
  | '#VALUE';

export type CellError = { err: ErrCode };

// The value type a cell (or an expression) evaluates to. A blank cell is
// represented as the empty string '' (see the engine's resolver).
export type Scalar = number | string | boolean | Date | CellError;

// A fully-qualified cell address: `${sheetId}!${row}:${col}` with 0-based
// row/col. e.g. Sheet1 A1 => "Sheet1!0:0", Sheet1 B3 => "Sheet1!2:1".
export type CellId = string;

export function isErr(v: Scalar): v is CellError {
  return typeof v === 'object' && v !== null && !(v instanceof Date) && 'err' in v;
}

export function err(code: ErrCode): CellError {
  return { err: code };
}

export function isBlank(v: Scalar): boolean {
  return v === '';
}

export function makeCellId(sheet: string, row: number, col: number): CellId {
  return `${sheet}!${row}:${col}`;
}

export function parseCellId(id: CellId): { sheet: string; row: number; col: number } {
  const m = id.match(/^(.*)!(\d+):(\d+)$/);
  if (!m) throw new Error(`invalid CellId: ${id}`);
  return { sheet: m[1], row: parseInt(m[2], 10), col: parseInt(m[3], 10) };
}

// -----------------------------------------------------------------------------
// Numeric coercions
// -----------------------------------------------------------------------------
// There are deliberately several coercions with different policies:
//   * toNumStrict  — for arithmetic operators (+ - * / ^ % unary). Numeric
//     strings coerce; a non-numeric string is a hard error (null). Blank => 0.
//   * toNumAgg     — for aggregations (SUM/AVG/MIN/MAX). Non-numeric text and
//     blanks are silently skipped (null); numeric strings still parse.
//   * isCountable  — for COUNT. Numbers and numeric strings count; blanks and
//     non-numeric text do not.
// This split is what fixes several of the flagged "arguably buggy" behaviours
// (parseFloat prefix coercion, COUNT("")=1, LEN(empty)=1, SUM of "2abc").

function parseNumericString(s: string): number | null {
  const t = s.trim();
  if (t === '') return null;
  const n = Number(t);
  return Number.isNaN(n) ? null : n;
}

// Strict arithmetic coercion. Returns null when the value cannot be a number
// (which the caller turns into #ERR). Note: unlike the legacy parseFloat path,
// "2abc" => null (error), not 2.
export function toNumStrict(v: Scalar): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v === 'boolean') return v ? 1 : 0;
  if (v instanceof Date) return v.getTime();
  if (typeof v === 'string') {
    const t = v.trim();
    if (t === '') return 0; // blank in arithmetic behaves as 0
    const n = Number(t);
    return Number.isNaN(n) ? null : n;
  }
  return null; // error value
}

// Aggregation coercion: skip (null) anything that isn't a number-ish value.
// Blanks and pure text are skipped; numeric strings parse; booleans count.
export function toNumAgg(v: Scalar): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v === 'boolean') return v ? 1 : 0;
  if (typeof v === 'string') return parseNumericString(v);
  return null; // Date / error / blank-string handled above
}

// COUNT policy: a number or a numeric string counts; blank/text does not.
export function isCountable(v: Scalar): boolean {
  if (typeof v === 'number') return Number.isFinite(v);
  if (typeof v === 'string') return parseNumericString(v) !== null;
  return false;
}

// Format a number for DISPLAY / string coercion: strip IEEE representation
// noise (0.1+0.2 -> "0.3") via toPrecision(12), keeping integers and non-finite
// values verbatim. Shared by the engine's display layer and by toStr (the
// & / CONCAT / TEXT string-coercion path) so both clean noise identically.
// getValue stays EXACT — only stringification passes through here.
export function fmtNum(n: number): string {
  if (!Number.isFinite(n)) return String(n);
  if (Number.isInteger(n)) return String(n);
  return String(Number(n.toPrecision(12)));
}

// Stringify a scalar consistently. Booleans render UPPERCASE everywhere (this
// fixes the CONCAT-lowercase-vs-formatResult-uppercase inconsistency). Dates
// render as ISO yyyy-mm-dd; errors render their code. Numbers are noise-cleaned
// (via fmtNum) so `="x"&(0.1+0.2)` yields "x0.3", not "x0.30000000000000004".
export function toStr(v: Scalar): string {
  if (typeof v === 'string') return v;
  if (typeof v === 'boolean') return v ? 'TRUE' : 'FALSE';
  if (typeof v === 'number') return fmtNum(v);
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  return v.err;
}

// Coerce a scalar to a Date, or null. Mirrors legacy YEAR/MONTH/DAY behaviour:
// numbers are epoch milliseconds, strings are parsed, Dates pass through.
export function toDate(v: Scalar): Date | null {
  if (v instanceof Date) return v;
  if (typeof v === 'number') {
    const d = new Date(v);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  if (typeof v === 'string') {
    const d = new Date(v);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  return null;
}
