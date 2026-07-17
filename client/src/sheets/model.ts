// SheetModel — the multi-sheet Yjs layout for a spreadsheet doc, plus legacy
// single-sheet migration by ALIASING (no data copy).
//
// Yjs structure
// -------------
//   ydoc.getArray('sheet-order') -> Y.Array<string>  (ordered stable ids)
//   ydoc.getMap('sheet-names')   -> Y.Map<string>    (id -> display name)
//   ydoc.getMap('sheets')        -> meta map; holds only a 'rev' counter now,
//                                   bumped on any list change so SheetEditor's
//                                   shallow observe(meta()) still fires. (It
//                                   also still carries the OLD plain-JSON
//                                   `order`/`names` on just-shipped docs — read
//                                   as a migration fallback, see below.)
//   per sheet <id>:
//     cells   -> getMap('cells:'+id)   (key "r:c" -> raw string)
//     style   -> getMap('style:'+id)   (key "r:c" -> JSON CellStyle)
//     geom    -> getMap('geom:'+id)    (col widths / row heights / freeze / dims)
//
// CRDT sheet list (why a Y.Array + Y.Map, not plain JSON)
// ------------------------------------------------------
// Plain-JSON `order`/`names` stored as opaque Y.Map values are last-writer-wins:
// two peers each adding a sheet concurrently would clobber one another's entry,
// orphaning a whole cells:<id> map. So the order lives in a top-level
// Y.Array<string> (concurrent pushes both survive, element-wise merge) and the
// names in a top-level Y.Map<string> (a rename is inherently one key -> per-key
// LWW is fine). Top-level types are convergent by NAME, avoiding the
// concurrent-creation race a nested `meta.set('order', new Y.Array())` would
// have. order() dedups defensively so a concurrent seed can never strand a
// sheet. The 'sheets' meta map keeps a 'rev' counter, bumped by touch() on every
// list mutation, purely so SheetEditor's shallow observe(meta()) keeps firing
// (Y.Array/Y.Map internal changes don't bubble to a shallow parent observe).
//
// Migration (lazy, idempotent, convergent): a just-shipped doc has plain-JSON
// `order`/`names` on the 'sheets' map and no Y.Array yet. seedList() copies them
// into the CRDT structures on the FIRST list mutation, only when the Y.Array is
// still empty. Reads fall back to the plain shape until then, so nothing writes
// on mere open (read-only viewers stay clean) and the single-sheet legacy case
// (no 'sheets' entry at all) still presents s0.
//
// Migration by aliasing (CRITICAL — never copies data across two concurrent
// clients): the very first sheet ALWAYS has the stable id `s0`, and s0's backing
// maps ARE the legacy `getMap('cells')` / `getMap('cells-style')` maps — NOT the
// suffixed `cells:s0` maps. So a legacy doc (populated `cells`, no `sheets`
// order) simply presents as sheet `s0` over its existing data, and a brand-new
// doc also starts as `s0` over the (empty) legacy maps. Legacy and new clients
// therefore converge on the same s0. Only Sheet2+ use the suffixed maps, and the
// `sheets` order entry is written lazily — only once a second sheet is added —
// so legacy data is never moved.
//
// Engine coupling
// ---------------
// The CalcEngine identifies a sheet by its *display name* (that is what a user
// types in a cross-sheet ref like `Sheet2!A1`, and what engine.renameSheet
// rewrites). The stable id (`s0`, `s-xxxx`) is only a storage key, decoupled
// from the name so a rename never moves Yjs data. The model owns the id<->name
// mapping; callers build engine CellIds as `${name}!${r}:${c}`.

import * as Y from 'yjs';
import type { CalcEngine, CellId } from './engine/engine';
import { parse, serializeFormula } from './engine/ast';
import { shiftRefs, renameSheetRefs } from './engine/refs';
import { type CellStyle, parseStyle, encodeStyle } from './format';

export const LEGACY_SHEET_ID = 's0';
export const DEFAULT_ROWS = 1000;
export const DEFAULT_COLS = 26;

// Top-level Yjs type names for the CRDT-mergeable sheet list.
const ORDER_KEY = 'sheet-order';
const NAMES_KEY = 'sheet-names';

export interface SheetInfo {
  id: string; // stable storage id (s0, s-xxxx)
  name: string; // display name / engine sheet id
}

export interface GeomData {
  rows: number;
  cols: number;
  frozenRows: number;
  frozenCols: number;
  colWidths: Record<number, number>;
  rowHeights: Record<number, number>;
}

type Axis = 'row' | 'col';

export class SheetModel {
  constructor(private doc: Y.Doc) {}

  // --- raw Y.Maps -----------------------------------------------------------

  meta(): Y.Map<unknown> {
    return this.doc.getMap('sheets');
  }

  // The CRDT sheet-list structures (top-level, convergent by name).
  private orderArr(): Y.Array<string> {
    return this.doc.getArray<string>(ORDER_KEY);
  }

  private namesMap(): Y.Map<string> {
    return this.doc.getMap<string>(NAMES_KEY);
  }

  cellsMap(id: string): Y.Map<string> {
    return id === LEGACY_SHEET_ID
      ? this.doc.getMap<string>('cells')
      : this.doc.getMap<string>('cells:' + id);
  }

  styleMap(id: string): Y.Map<string> {
    return id === LEGACY_SHEET_ID
      ? this.doc.getMap<string>('cells-style')
      : this.doc.getMap<string>('style:' + id);
  }

  geomMap(id: string): Y.Map<unknown> {
    return this.doc.getMap('geom:' + id);
  }

  // --- sheet list -----------------------------------------------------------

  // Legacy plain-JSON list shape (just-shipped docs), read as a migration
  // fallback until seedList() materializes the CRDT structures.
  private rawOrder(): string[] | undefined {
    const o = this.meta().get('order');
    return Array.isArray(o) ? (o as string[]) : undefined;
  }

  private rawNames(): Record<string, string> {
    const n = this.meta().get('names');
    return n && typeof n === 'object' ? { ...(n as Record<string, string>) } : {};
  }

  // Ordered stable ids. Prefers the CRDT Y.Array; falls back to the legacy
  // plain-JSON order; and a doc that has never grown past one sheet reports the
  // implicit [s0] without ever having materialized anything. Dedups so a
  // concurrent seed (two peers migrating at once) can never strand a sheet.
  order(): string[] {
    const arr = this.orderArr();
    if (arr.length) return dedup(arr.toArray());
    const plain = this.rawOrder();
    if (plain && plain.length) return dedup(plain);
    return [LEGACY_SHEET_ID];
  }

  name(id: string): string {
    const crdt = this.namesMap().get(id);
    if (crdt) return crdt;
    const plain = this.rawNames();
    if (plain[id]) return plain[id];
    if (id === LEGACY_SHEET_ID) return 'Sheet1';
    return id;
  }

  list(): SheetInfo[] {
    return this.order().map((id) => ({ id, name: this.name(id) }));
  }

  // Materialize the sheet list into the CRDT structures if not already done.
  // Idempotent + convergent: seeds only when the Y.Array is still empty, from
  // the legacy plain order (a just-shipped doc) or the implicit [s0]. MUST run
  // inside the caller's transaction, before any list read used for the write.
  private seedList(): void {
    const arr = this.orderArr();
    if (arr.length) return;
    const plain = this.rawOrder();
    const base = plain && plain.length ? dedup(plain) : [LEGACY_SHEET_ID];
    arr.push([...base]);
    const nm = this.namesMap();
    const plainNames = this.rawNames();
    for (const id of base) {
      if (nm.get(id) === undefined && plainNames[id] !== undefined) nm.set(id, plainNames[id]);
    }
  }

  // Bump a revision counter on the 'sheets' meta map purely to fire its shallow
  // observer. The CRDT list lives on the separate 'sheet-order'/'sheet-names'
  // types, whose internal changes do NOT bubble to a shallow observe of
  // 'sheets'; this touch bridges that so SheetEditor still rebuilds on a list
  // change (local OR merged from a peer, whose update carries this same bump).
  private touch(): void {
    const m = this.meta();
    const r = m.get('rev');
    m.set('rev', (typeof r === 'number' ? r : 0) + 1);
  }

  private genId(existing: string[]): string {
    for (;;) {
      const id = 's-' + Math.random().toString(36).slice(2, 8);
      if (id !== LEGACY_SHEET_ID && !existing.includes(id)) return id;
    }
  }

  private uniqueName(desired: string | undefined, taken: Set<string>): string {
    if (desired && !taken.has(desired)) return desired;
    for (let n = 1; ; n++) {
      const candidate = `Sheet${n}`;
      if (!taken.has(candidate)) return candidate;
    }
  }

  // Add a new sheet (never s0). Pushes onto the CRDT order Y.Array so two peers
  // adding concurrently both survive the merge. Returns the new stable id.
  addSheet(name?: string): string {
    let id = '';
    this.doc.transact(() => {
      this.seedList();
      const arr = this.orderArr();
      const existing = dedup(arr.toArray());
      const taken = new Set(existing.map((x) => this.name(x)));
      id = this.genId(existing);
      const finalName = this.uniqueName(name, taken);
      arr.push([id]);
      this.namesMap().set(id, finalName);
      this.touch();
    });
    return id;
  }

  // Remove a sheet and clear its backing maps. Refuses to remove the last
  // remaining sheet. Any cross-sheet references to it are left as typed (they
  // resolve to blank in the engine, matching engine.removeSheet semantics).
  removeSheet(id: string): void {
    const order = this.order();
    if (order.length <= 1 || !order.includes(id)) return;
    this.doc.transact(() => {
      this.seedList();
      const arr = this.orderArr();
      // Delete every occurrence (a concurrent seed may have duplicated ids).
      for (let i = arr.length - 1; i >= 0; i--) {
        if (arr.get(i) === id) arr.delete(i, 1);
      }
      this.namesMap().delete(id);
      this.cellsMap(id).clear();
      this.styleMap(id).clear();
      this.geomMap(id).clear();
      this.touch();
    });
  }

  // Rename a sheet: drives engine.renameSheet (which rewrites qualified refs and
  // moves cells to the new engine id) AND persists the rewritten formula text
  // back into the Y.Maps so it survives reloads and reaches peers. Returns the
  // engine repaint set. No-op (returns null) on an invalid or colliding name.
  renameSheet(id: string, newName: string, engine: CalcEngine): Set<CellId> | null {
    const trimmed = newName.trim();
    const oldName = this.name(id);
    if (!trimmed || trimmed === oldName) return null;
    const taken = new Set(this.order().filter((x) => x !== id).map((x) => this.name(x)));
    if (taken.has(trimmed)) return null;

    const repaint = engine.renameSheet(oldName, trimmed);

    this.doc.transact(() => {
      this.seedList();
      this.namesMap().set(id, trimmed);
      this.touch();
      // Rewrite every qualified ref (`Old!A1` -> `New!A1`) in every sheet.
      for (const sid of this.order()) {
        const m = this.cellsMap(sid);
        for (const [k, raw] of [...m.entries()]) {
          if (!raw.startsWith('=')) continue;
          try {
            const ast = parse(raw);
            const next = serializeFormula(renameSheetRefs(ast, oldName, trimmed));
            if (next !== serializeFormula(ast)) m.set(k, next);
          } catch {
            /* leave unparseable formulas untouched */
          }
        }
      }
    });
    return repaint;
  }

  // --- version restore support ---------------------------------------------
  //
  // These let history/restore.ts reconcile the LIVE doc's sheet list to a saved
  // version without re-implementing (and drifting from) this model's layout.

  // Stored display names (id -> name), preferring the CRDT names map and
  // falling back to the legacy plain-JSON names. Omits purely-defaulted names
  // (e.g. s0's implicit 'Sheet1'); restore copies these verbatim.
  nameEntries(): Record<string, string> {
    const out: Record<string, string> = {};
    const plain = this.rawNames();
    for (const [k, v] of Object.entries(plain)) out[k] = v;
    this.namesMap().forEach((v, k) => { out[k] = v; });
    return out;
  }

  // Overwrite this doc's sheet list to exactly `ids` (order) with `names`
  // (id -> display name), and fire the meta observer. Used by version restore
  // to make the live tab list/order/names match a saved version. MUST run
  // inside a transaction the caller opened on this doc.
  setList(ids: string[], names: Record<string, string>): void {
    const arr = this.orderArr();
    if (arr.length) arr.delete(0, arr.length);
    if (ids.length) arr.push(dedup(ids));
    const nm = this.namesMap();
    for (const k of Array.from(nm.keys())) {
      if (!(k in names)) nm.delete(k);
    }
    for (const [k, v] of Object.entries(names)) {
      if (nm.get(k) !== v) nm.set(k, v);
    }
    this.touch();
  }

  // --- geom -----------------------------------------------------------------

  getGeom(id: string): GeomData {
    const g = this.geomMap(id);
    const num = (k: string, d: number): number => {
      const v = g.get(k);
      return typeof v === 'number' && Number.isFinite(v) ? v : d;
    };
    const rec = (k: string): Record<number, number> => {
      const v = g.get(k);
      return v && typeof v === 'object' ? (v as Record<number, number>) : {};
    };
    return {
      rows: Math.max(1, num('rows', DEFAULT_ROWS)),
      cols: Math.max(1, num('cols', DEFAULT_COLS)),
      frozenRows: Math.max(0, num('frozenRows', 0)),
      frozenCols: Math.max(0, num('frozenCols', 0)),
      colWidths: rec('colWidths'),
      rowHeights: rec('rowHeights'),
    };
  }

  setGeom(id: string, patch: Partial<GeomData>): void {
    const g = this.geomMap(id);
    this.doc.transact(() => {
      for (const [k, v] of Object.entries(patch)) {
        if (v === undefined) continue;
        g.set(k, v as unknown);
      }
    });
  }

  // --- cell read/write ------------------------------------------------------

  getRaw(id: string, r: number, c: number): string {
    return this.cellsMap(id).get(`${r}:${c}`) ?? '';
  }

  setRaw(id: string, r: number, c: number, raw: string): void {
    const m = this.cellsMap(id);
    const k = `${r}:${c}`;
    if (raw === '') m.delete(k);
    else m.set(k, raw);
  }

  getStyle(id: string, r: number, c: number): CellStyle {
    return parseStyle(this.styleMap(id).get(`${r}:${c}`));
  }

  setStyle(id: string, r: number, c: number, style: CellStyle): void {
    const m = this.styleMap(id);
    const k = `${r}:${c}`;
    const encoded = encodeStyle(style);
    if (encoded === '{}') m.delete(k);
    else m.set(k, encoded);
  }

  // Snapshot a sheet's cells into a plain record (for CSV export, sort, etc.).
  cellRecord(id: string): Record<string, string> {
    const out: Record<string, string> = {};
    this.cellsMap(id).forEach((v, k) => {
      out[k] = v;
    });
    return out;
  }

  // --- structural edits (insert / delete rows or columns) -------------------
  //
  // Shifts cell + style KEYS in the edited sheet AND rewrites formula text in
  // EVERY sheet so `=SUM(A2:A10)` follows an inserted row. This is the headline
  // bug fix over the legacy key-only shift. `at` is the 0-based insertion /
  // deletion index; `count` rows/cols are inserted (delta>0) or removed.

  insertRows(id: string, at: number, count = 1): void {
    this.structural(id, 'row', at, count);
  }
  deleteRows(id: string, at: number, count = 1): void {
    this.structural(id, 'row', at, -count);
  }
  insertCols(id: string, at: number, count = 1): void {
    this.structural(id, 'col', at, count);
  }
  deleteCols(id: string, at: number, count = 1): void {
    this.structural(id, 'col', at, -count);
  }

  private structural(id: string, axis: Axis, at: number, delta: number): void {
    if (delta === 0) return;
    const editedName = this.name(id);
    this.doc.transact(() => {
      // 1. Rewrite formula text across all sheets (positional; independent of
      //    each formula's own key, so order vs. key-shift does not matter).
      for (const sid of this.order()) {
        const home = this.name(sid);
        const m = this.cellsMap(sid);
        for (const [k, raw] of [...m.entries()]) {
          if (!raw.startsWith('=')) continue;
          try {
            const ast = parse(raw);
            const shifted = shiftRefs(ast, { sheet: editedName, homeSheet: home, axis, at, delta });
            const next = serializeFormula(shifted);
            if (next !== serializeFormula(ast)) m.set(k, next);
          } catch {
            /* leave unparseable formulas untouched */
          }
        }
      }
      // 2. Shift the edited sheet's cell + style keys.
      shiftKeys(this.cellsMap(id), axis, at, delta);
      shiftKeys(this.styleMap(id), axis, at, delta);
      // 3. Reindex the geom map's per-index sizing + grow dims on the axis.
      this.shiftGeom(id, axis, at, delta);
    });
  }

  // Reindex the geom map's per-index sizing (rowHeights/colWidths) so it follows
  // a row/col insert or delete, and grow the axis dim on insert so shifted
  // content never lands past the sheet's edge. Mirrors shiftKeys' index math.
  private shiftGeom(id: string, axis: Axis, at: number, delta: number): void {
    const g = this.geomMap(id);
    const recKey = axis === 'row' ? 'rowHeights' : 'colWidths';
    const cur = g.get(recKey);
    const rec = cur && typeof cur === 'object' ? (cur as Record<number, number>) : {};
    if (Object.keys(rec).length) g.set(recKey, shiftIndexRecord(rec, at, delta));
    if (delta > 0) {
      const dimKey = axis === 'row' ? 'rows' : 'cols';
      const def = axis === 'row' ? DEFAULT_ROWS : DEFAULT_COLS;
      const d = g.get(dimKey);
      const dim = typeof d === 'number' && Number.isFinite(d) ? d : def;
      g.set(dimKey, dim + delta);
    }
  }
}

// Keep the first occurrence of each id (drops duplicates a concurrent seed of
// the CRDT order Y.Array can produce), preserving order.
function dedup(ids: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const id of ids) {
    if (!seen.has(id)) { seen.add(id); out.push(id); }
  }
  return out;
}

// Shift a Record keyed by row/col index along one axis, same rule as shiftKeys:
// delta>0 inserts (indices >= at move up); delta<0 deletes the band [at, at+cnt)
// then moves the rest down. Returns a fresh record.
function shiftIndexRecord(
  rec: Record<number, number>,
  at: number,
  delta: number,
): Record<number, number> {
  const out: Record<number, number> = {};
  if (delta > 0) {
    for (const [k, v] of Object.entries(rec)) {
      const i = Number(k);
      out[i >= at ? i + delta : i] = v;
    }
  } else {
    const cnt = -delta;
    const removedEnd = at + cnt - 1;
    for (const [k, v] of Object.entries(rec)) {
      const i = Number(k);
      if (i >= at && i <= removedEnd) continue; // inside the deleted band
      out[i > removedEnd ? i - cnt : i] = v;
    }
  }
  return out;
}

// Shift "r:c" keys of a Y.Map along one axis. delta>0 inserts (moves keys at
// coord>=at up); delta<0 deletes (removes the band, then moves the rest down).
function shiftKeys<T>(map: Y.Map<T>, axis: Axis, at: number, delta: number): void {
  const coordOf = (k: string): number => {
    const [r, c] = k.split(':').map(Number);
    return axis === 'row' ? r : c;
  };
  const rebuild = (k: string, next: number): string => {
    const [r, c] = k.split(':').map(Number);
    return axis === 'row' ? `${next}:${c}` : `${r}:${next}`;
  };
  const entries: Array<[string, T]> = [];
  map.forEach((v, k) => entries.push([k, v]));

  if (delta > 0) {
    // Insert: move highest coords first so shifts never overwrite live keys.
    entries
      .filter(([k]) => coordOf(k) >= at)
      .sort((a, b) => coordOf(b[0]) - coordOf(a[0]))
      .forEach(([k, v]) => {
        map.delete(k);
        map.set(rebuild(k, coordOf(k) + delta), v);
      });
  } else {
    const cnt = -delta;
    const removedEnd = at + cnt - 1;
    for (const [k] of entries) {
      const co = coordOf(k);
      if (co >= at && co <= removedEnd) map.delete(k);
    }
    entries
      .filter(([k]) => coordOf(k) > removedEnd)
      .sort((a, b) => coordOf(a[0]) - coordOf(b[0]))
      .forEach(([k, v]) => {
        map.delete(k);
        map.set(rebuild(k, coordOf(k) - cnt), v);
      });
  }
}
