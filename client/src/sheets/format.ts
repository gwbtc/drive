// Cell style + formatting helpers. The shape stored in the `cells-style`
// Y.Map is JSON-encoded so it can evolve without a schema bump. Legacy
// single-letter strings ('b', 'i', 'bi') from earlier versions are still
// understood by `parseStyle`.

export type CellFormat = 'auto' | 'plain' | 'number' | 'currency' | 'percent' | 'date';
export type CellAlign = 'l' | 'c' | 'r';

// Supported explicit date patterns. `undefined` keeps the legacy locale-medium
// rendering ("Jan 15, 2024"), which is what old encoded styles carry.
export type DateFmt = 'yyyy-mm-dd' | 'mm/dd/yyyy' | 'm/d/yyyy' | 'mmm d, yyyy';

export type CellStyle = {
  b?: 1;
  i?: 1;
  u?: 1;
  bg?: string;
  fg?: string;
  fmt?: CellFormat;
  decimals?: number;
  align?: CellAlign;
  // ISO 4217 code (or a common symbol) for `fmt: 'currency'`. Unset => USD, so
  // styles encoded before this field render exactly as before.
  currency?: string;
  // Explicit pattern for `fmt: 'date'`. Unset => legacy "Jan 15, 2024".
  dateFmt?: DateFmt;
};

export function parseStyle(raw: string | undefined): CellStyle {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object') return parsed as CellStyle;
  } catch {
    // Legacy: 'b', 'i', 'bi' single-letter format.
    const s: CellStyle = {};
    if (raw.includes('b')) s.b = 1;
    if (raw.includes('i')) s.i = 1;
    return s;
  }
  return {};
}

export function encodeStyle(style: CellStyle): string {
  // Drop empty fields so equality comparisons stay clean.
  const out: Record<string, unknown> = {};
  for (const k of Object.keys(style) as Array<keyof CellStyle>) {
    const v = style[k];
    if (v === undefined || v === null) continue;
    if (v === '' || (typeof v === 'number' && Number.isNaN(v))) continue;
    out[k] = v;
  }
  return JSON.stringify(out);
}

export function mergeStyle(a: CellStyle, b: CellStyle): CellStyle {
  return { ...a, ...b };
}

// Format a raw cell value for display. `raw` may be a formula's evaluated
// string or a plain user-typed value. We never alter formula-source display;
// the caller passes the evaluated string when relevant.
export function applyFormat(value: string, style: CellStyle): string {
  if (!value) return value;
  const fmt = style.fmt ?? 'auto';
  if (fmt === 'plain' || fmt === 'auto') return value;
  const decimals = style.decimals;

  if (fmt === 'number') {
    const n = Number(value);
    if (!Number.isFinite(n)) return value;
    return decimals == null
      ? n.toLocaleString(undefined, { maximumFractionDigits: 6 })
      : n.toLocaleString(undefined, {
          minimumFractionDigits: decimals,
          maximumFractionDigits: decimals,
        });
  }
  if (fmt === 'currency') {
    const n = Number(value);
    if (!Number.isFinite(n)) return value;
    const currency = currencyCode(style.currency);
    // When decimals is unset, let Intl pick the currency's natural precision
    // (USD/EUR -> 2, JPY -> 0). This keeps legacy USD styles at 2 decimals.
    const opts: Intl.NumberFormatOptions = { style: 'currency', currency };
    if (decimals != null) {
      opts.minimumFractionDigits = decimals;
      opts.maximumFractionDigits = decimals;
    }
    try {
      return n.toLocaleString(undefined, opts);
    } catch {
      // Bad ISO code: fall back to USD so a cell never renders raw.
      return n.toLocaleString(undefined, {
        style: 'currency',
        currency: 'USD',
        minimumFractionDigits: decimals ?? 2,
        maximumFractionDigits: decimals ?? 2,
      });
    }
  }
  if (fmt === 'percent') {
    const n = Number(value);
    if (!Number.isFinite(n)) return value;
    return (n * 100).toLocaleString(undefined, {
      minimumFractionDigits: decimals ?? 1,
      maximumFractionDigits: decimals ?? 1,
    }) + '%';
  }
  if (fmt === 'date') {
    const ms =
      /^\d+$/.test(value) && Number(value) > 1e10
        ? Number(value)
        : Date.parse(value);
    if (Number.isNaN(ms)) return value;
    return formatDate(ms, style.dateFmt);
  }
  return value;
}

// Map a stored currency (ISO code or common symbol) to an ISO 4217 code.
// Unset / blank => USD. Unknown non-symbol input is upper-cased and handed to
// Intl, which throws on a malformed code (caught by the caller).
function currencyCode(c: string | undefined): string {
  if (!c || !c.trim()) return 'USD';
  const t = c.trim();
  const bySymbol: Record<string, string> = { '$': 'USD', '€': 'EUR', '£': 'GBP', '¥': 'JPY' };
  return bySymbol[t] ?? t.toUpperCase();
}

// Render an epoch-ms instant per an explicit pattern, extracting fields in the
// local zone so it matches the legacy toLocaleDateString rendering. `undefined`
// (and 'mmm d, yyyy') keep that legacy "Jan 15, 2024" form.
function formatDate(ms: number, dateFmt: DateFmt | undefined): string {
  const d = new Date(ms);
  if (dateFmt === undefined || dateFmt === 'mmm d, yyyy') {
    return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
  }
  const y = d.getFullYear();
  const m = d.getMonth() + 1;
  const day = d.getDate();
  const pad = (n: number) => String(n).padStart(2, '0');
  switch (dateFmt) {
    case 'yyyy-mm-dd': return `${y}-${pad(m)}-${pad(day)}`;
    case 'mm/dd/yyyy': return `${pad(m)}/${pad(day)}/${y}`;
    case 'm/d/yyyy': return `${m}/${day}/${y}`;
    default: return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
  }
}
