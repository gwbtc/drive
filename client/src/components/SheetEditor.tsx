import * as Y from 'yjs';
import { useCallback, useEffect, useRef, useState } from 'preact/hooks';
import type { DocProvider } from '../providers/types';
import { CalcEngine } from '../sheets/engine/engine';
import { colToLabel } from '../sheets/engine/ast';
import {
  type CellAlign,
  type CellFormat,
  type CellStyle,
  type DateFmt,
  mergeStyle,
} from '../sheets/format';
import { parseCSV, cellsToCSV } from '../sheets/csv';
import { computeFill } from '../sheets/fill';
import { SheetModel, type SheetInfo, type GeomData } from '../sheets/model';
import {
  type Active,
  type Range,
  normRange,
  rangeCells,
  computeColOffsets,
  pointToCell,
} from '../sheets/gridmath';
import { Grid, ROW_H, HEADER_H, GUTTER_W, COL_W } from './Grid';
import { Dropdown } from './toolbar/Dropdown';
import { ColorSwatch } from './toolbar/ColorSwatch';
import { confirmDialog, promptDialog } from '../ui/dialogs';
import { toast } from '../ui/toast';

const FORMAT_LABEL: Record<CellFormat, string> = {
  auto: 'Auto', plain: 'Plain', number: 'Number',
  currency: 'Currency', percent: 'Percent', date: 'Date',
};
const FORMATS: CellFormat[] = ['auto', 'plain', 'number', 'currency', 'percent', 'date'];

// Currency picker options (ISO code + display glyph).
const CURRENCIES: Array<{ code: string; sym: string; label: string }> = [
  { code: 'USD', sym: '$', label: 'USD' },
  { code: 'EUR', sym: '€', label: 'EUR' },
  { code: 'GBP', sym: '£', label: 'GBP' },
  { code: 'JPY', sym: '¥', label: 'JPY' },
  { code: 'CAD', sym: 'CA$', label: 'CAD' },
  { code: 'AUD', sym: 'A$', label: 'AUD' },
];

// Date-format picker options (value stored in style.dateFmt).
const DATE_FORMATS: Array<{ value: DateFmt; label: string }> = [
  { value: 'yyyy-mm-dd', label: '2024-01-15' },
  { value: 'mm/dd/yyyy', label: '01/15/2024' },
  { value: 'm/d/yyyy', label: '1/15/2024' },
  { value: 'mmm d, yyyy', label: 'Jan 15, 2024' },
];

// Decimal-place count implied by a format when the cell has no explicit
// `decimals`, so the +/- decimal buttons start from a sensible base.
const impliedDecimals = (fmt: CellFormat | undefined): number =>
  fmt === 'percent' ? 1 : 2;
const DEC_MIN = 0;
const DEC_MAX = 10;

// Given a fill source and the cell under the pointer, pick the target region:
// extend down or right — whichever direction the pointer has traveled farther.
function fillDestFrom(src: NonNullable<Range>, r: number, c: number): NonNullable<Range> {
  const dRow = r - src.r2;
  const dCol = c - src.c2;
  if (dRow > 0 && (dCol <= 0 || dRow >= dCol)) return { ...src, r2: r };
  if (dCol > 0) return { ...src, c2: c };
  return src;
}

// Value equality for two selection ranges, so drag handlers can skip redundant
// setState (a mousemove within the same cell must not re-render the grid).
function sameRange(a: Range, b: Range): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return a.r1 === b.r1 && a.c1 === b.c1 && a.r2 === b.r2 && a.c2 === b.c2;
}

export function SheetEditor({
  provider,
  editable,
}: {
  provider: DocProvider;
  editable: boolean;
}) {
  const modelRef = useRef<SheetModel | null>(null);
  const engineRef = useRef<CalcEngine | null>(null);

  const [ready, setReady] = useState(false);
  const [sheets, setSheets] = useState<SheetInfo[]>([]);
  const [activeSheetId, setActiveSheetId] = useState<string>('');
  const [geom, setGeom] = useState<GeomData>({
    rows: 1000, cols: 26, frozenRows: 0, frozenCols: 0, colWidths: {}, rowHeights: {},
  });
  const [, setVersion] = useState(0);
  const bump = () => setVersion((v) => (v + 1) % 1_000_000);

  const [active, setActive] = useState<Active>(null);
  const [range, setRange] = useState<Range>(null);
  const [editing, setEditing] = useState(false);
  const [editValue, setEditValue] = useState('');

  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const draggingRef = useRef(false);
  const anchorRef = useRef<{ r: number; c: number } | null>(null);

  // Fill handle (drag-fill) state. Refs drive the drag so the window-level
  // mouseup handler sees the latest source/target without stale closures; the
  // mirrored state drives the Grid's live preview.
  const fillDragRef = useRef(false);
  const fillSrcRef = useRef<Range>(null);
  const fillDestRef = useRef<Range>(null);
  const [fillSource, setFillSource] = useState<Range>(null);
  const [fillPreview, setFillPreview] = useState<Range>(null);

  const dims = { rows: geom.rows, cols: geom.cols };
  const sheetName = modelRef.current?.name(activeSheetId) ?? 'Sheet1';

  // Mirror the latest geom / selection into refs so the window-level drag
  // handlers (mousemove + autoscroll, below) read fresh values without needing
  // to re-subscribe on every render.
  const geomRef = useRef(geom); geomRef.current = geom;
  const rangeRef = useRef<Range>(range); rangeRef.current = range;

  // --- engine seeding + observers ------------------------------------------

  useEffect(() => {
    const model = new SheetModel(provider.ydoc);
    modelRef.current = model;

    const reseed = () => {
      const e = new CalcEngine();
      for (const s of model.list()) {
        e.addSheet(s.name);
        const changes: Array<{ id: string; raw: string }> = [];
        model.cellsMap(s.id).forEach((raw, k) => changes.push({ id: `${s.name}!${k}`, raw }));
        if (changes.length) e.setCells(changes);
      }
      engineRef.current = e;
    };

    // Per-sheet cell + style observers, re-synced when the sheet set changes.
    const observers = new Map<string, () => void>();
    const feedCells = (id: string, cm: Y.Map<string>, evt: Y.YMapEvent<string>) => {
      const name = model.name(id);
      const changes: Array<{ id: string; raw: string }> = [];
      evt.changes.keys.forEach((_c, key) => {
        changes.push({ id: `${name}!${key}`, raw: cm.get(key) ?? '' });
      });
      if (changes.length && engineRef.current) {
        engineRef.current.setCells(changes);
        bump();
      }
    };
    const syncObservers = () => {
      const ids = new Set(model.order());
      for (const [id, detach] of observers) {
        if (!ids.has(id)) { detach(); observers.delete(id); }
      }
      for (const id of ids) {
        if (observers.has(id)) continue;
        const cm = model.cellsMap(id);
        const sm = model.styleMap(id);
        const onCells = (evt: Y.YMapEvent<string>) => feedCells(id, cm, evt);
        const onStyle = () => bump();
        cm.observe(onCells);
        sm.observe(onStyle);
        observers.set(id, () => { cm.unobserve(onCells); sm.unobserve(onStyle); });
      }
    };

    // A structural change (add / remove / rename sheet) — rare — rebuilds the
    // engine wholesale and re-syncs observers. Cell edits never take this path.
    const onMeta = () => {
      reseed();
      syncObservers();
      const list = model.list();
      setSheets(list);
      setActiveSheetId((prev) => (list.some((s) => s.id === prev) ? prev : list[0].id));
      bump();
    };

    reseed();
    syncObservers();
    const list = model.list();
    setSheets(list);
    setActiveSheetId(list[0].id);
    model.meta().observe(onMeta);
    setReady(true);

    return () => {
      model.meta().unobserve(onMeta);
      for (const detach of observers.values()) detach();
      observers.clear();
    };
  }, [provider]);

  // Track geom (dims + freeze) of the ACTIVE sheet.
  useEffect(() => {
    const model = modelRef.current;
    if (!model || !activeSheetId) return;
    const gm = model.geomMap(activeSheetId);
    const sync = () => setGeom(model.getGeom(activeSheetId));
    sync();
    gm.observe(sync);
    return () => gm.unobserve(sync);
  }, [activeSheetId, ready]);

  // Reset the cell selection whenever the active sheet changes (covers both a
  // tab click and the active sheet being deleted out from under us).
  useEffect(() => {
    setActive(null);
    setRange(null);
    setEditing(false);
    fillDragRef.current = false;
    setFillSource(null);
    setFillPreview(null);
  }, [activeSheetId]);

  // Volatile refresh (NOW()/TODAY()) — cheap no-op when there are none.
  useEffect(() => {
    if (!ready) return;
    const t = setInterval(() => {
      const rp = engineRef.current?.recalcVolatiles();
      if (rp && rp.size) bump();
    }, 60_000);
    return () => clearInterval(t);
  }, [ready]);

  useEffect(() => {
    const onUp = () => { draggingRef.current = false; };
    window.addEventListener('mouseup', onUp);
    return () => window.removeEventListener('mouseup', onUp);
  }, []);

  // Extend a drag-select / fill-drag BEYOND the virtualized DOM window. Only
  // rows in [win.start, win.end) are real divs; off-window rows are spacers that
  // emit no mouseenter, so onCellMouseEnter alone can't grow a selection taller
  // than the viewport. A window-level mousemove maps the pointer to a cell via
  // the pure pointToCell helper (using live scroll offsets + geometry) and
  // extends the range/fill there. When the pointer nears an edge we autoscroll
  // on requestAnimationFrame so the drag can continue into off-screen rows.
  useEffect(() => {
    const EDGE = 24; // px from an edge that arms autoscroll
    const STEP = 22; // px scrolled per frame while armed
    const last = { x: 0, y: 0 };
    let raf: number | null = null;

    const extend = (clientX: number, clientY: number) => {
      const el = scrollRef.current;
      if (!el) return;
      if (!draggingRef.current && !fillDragRef.current) return;
      const g = geomRef.current;
      const rows = g.rows, cols = g.cols;
      const rect = el.getBoundingClientRect();
      const { r, c } = pointToCell(
        clientX - rect.left,
        clientY - rect.top,
        el.scrollLeft,
        el.scrollTop,
        {
          rowH: ROW_H, headerH: HEADER_H, gutterW: GUTTER_W,
          colOffsets: computeColOffsets(cols, g.colWidths, GUTTER_W, COL_W),
          rows, cols,
          frozenRows: Math.min(g.frozenRows, rows),
          frozenCols: Math.min(g.frozenCols, cols),
        },
      );
      if (fillDragRef.current && fillSrcRef.current) {
        const dest = fillDestFrom(fillSrcRef.current, r, c);
        if (!sameRange(fillDestRef.current, dest)) {
          fillDestRef.current = dest;
          setFillPreview(dest);
        }
      } else if (draggingRef.current && anchorRef.current) {
        const a = anchorRef.current;
        const nr = { r1: a.r, c1: a.c, r2: r, c2: c };
        if (!sameRange(rangeRef.current, nr)) setRange(nr);
      }
    };

    const tick = () => {
      raf = null;
      const el = scrollRef.current;
      if (!el || (!draggingRef.current && !fillDragRef.current)) return;
      const rect = el.getBoundingClientRect();
      let dx = 0, dy = 0;
      if (last.y > rect.bottom - EDGE) dy = STEP;
      else if (last.y < rect.top + HEADER_H + EDGE) dy = -STEP;
      if (last.x > rect.right - EDGE) dx = STEP;
      else if (last.x < rect.left + GUTTER_W + EDGE) dx = -STEP;
      if (dx === 0 && dy === 0) return;
      el.scrollBy(dx, dy);
      extend(last.x, last.y); // re-extend into the newly revealed region
      raf = requestAnimationFrame(tick);
    };

    const onMove = (e: MouseEvent) => {
      if (!draggingRef.current && !fillDragRef.current) return;
      last.x = e.clientX; last.y = e.clientY;
      extend(e.clientX, e.clientY);
      if (raf == null) raf = requestAnimationFrame(tick);
    };
    const onUp = () => { if (raf != null) { cancelAnimationFrame(raf); raf = null; } };

    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      if (raf != null) cancelAnimationFrame(raf);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // --- editing helpers ------------------------------------------------------

  const model = () => modelRef.current!;
  const cellRaw = (r: number, c: number) => model().getRaw(activeSheetId, r, c);

  // Return keyboard focus to the grid container. Any startEdit() schedules an
  // input focus AFTER this (later timeout wins), so editing still grabs focus.
  // Stable identity: it feeds the memoized cell handlers below.
  const focusGrid = useCallback(() => {
    setTimeout(() => scrollRef.current?.focus(), 0);
  }, []);

  const growFor = (r: number, c: number) => {
    const patch: Partial<GeomData> = {};
    if (r >= geom.rows) patch.rows = r + 50;
    if (c >= geom.cols) patch.cols = c + 10;
    if (patch.rows || patch.cols) model().setGeom(activeSheetId, patch);
  };

  const move = (dr: number, dc: number) => {
    if (!active) return;
    const r = Math.max(0, active.r + dr);
    const c = Math.max(0, active.c + dc);
    growFor(r, c);
    setActive({ r, c });
    setRange(null);
    setEditing(false);
    focusGrid();
  };

  const startEdit = useCallback((r: number, c: number, seed?: string) => {
    if (!editable) return;
    setActive({ r, c });
    setRange(null);
    setEditValue(seed ?? modelRef.current!.getRaw(activeSheetId, r, c));
    setEditing(true);
    setTimeout(() => inputRef.current?.focus(), 0);
  }, [editable, activeSheetId]);

  const commit = () => {
    if (active) {
      provider.ydoc.transact(() => {
        model().setRaw(activeSheetId, active.r, active.c, editValue);
      });
    }
    setEditing(false);
  };

  const onGridKeyDown = (e: KeyboardEvent) => {
    if (editing) return; // the edit input handles its own keys
    if (!active) return;
    const k = e.key;
    if (k === 'Enter') { e.preventDefault(); startEdit(active.r, active.c); return; }
    if (k === 'Tab') { e.preventDefault(); move(0, e.shiftKey ? -1 : 1); return; }
    if (k === 'ArrowDown') { e.preventDefault(); move(1, 0); return; }
    if (k === 'ArrowUp') { e.preventDefault(); move(-1, 0); return; }
    if (k === 'ArrowLeft') { e.preventDefault(); move(0, -1); return; }
    if (k === 'ArrowRight') { e.preventDefault(); move(0, 1); return; }
    if (k === 'Escape') { e.preventDefault(); setRange(null); return; }
    if (k === 'Delete' || k === 'Backspace') {
      e.preventDefault();
      if (!editable) return;
      const targets = range ? rangeCells(range) : [[active.r, active.c] as [number, number]];
      provider.ydoc.transact(() => {
        for (const [r, c] of targets) model().setRaw(activeSheetId, r, c, '');
      });
      return;
    }
    if (k.length === 1 && !e.metaKey && !e.ctrlKey && !e.altKey) {
      startEdit(active.r, active.c, k);
    }
  };

  const onEditKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); commit(); move(e.shiftKey ? -1 : 1, 0); }
    else if (e.key === 'Tab') { e.preventDefault(); e.stopPropagation(); commit(); move(0, e.shiftKey ? -1 : 1); }
    else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); setEditing(false); focusGrid(); }
  };

  // Cell handlers passed to EVERY memoized cell: keep them referentially stable
  // (they read mutable state through refs) so the grid's memo bailout holds and
  // a drag / keystroke doesn't re-render every visible cell.
  const onCellMouseDown = useCallback((r: number, c: number, e: MouseEvent) => {
    if (e.button !== 0) return;
    draggingRef.current = true;
    anchorRef.current = { r, c };
    setActive({ r, c });
    setRange({ r1: r, c1: c, r2: r, c2: c });
    setEditing(false);
    focusGrid();
  }, [focusGrid]);
  const onCellMouseEnter = useCallback((r: number, c: number) => {
    // During a fill drag, hovering a cell sets the target region (down or
    // right — whichever the pointer has moved farther from the source).
    if (fillDragRef.current && fillSrcRef.current) {
      const dest = fillDestFrom(fillSrcRef.current, r, c);
      if (!sameRange(fillDestRef.current, dest)) {
        fillDestRef.current = dest;
        setFillPreview(dest);
      }
      return;
    }
    if (!draggingRef.current || !anchorRef.current) return;
    const a = anchorRef.current;
    const nr = { r1: a.r, c1: a.c, r2: r, c2: c };
    if (!sameRange(rangeRef.current, nr)) setRange(nr);
  }, []);
  const onCellDblClick = useCallback((r: number, c: number) => startEdit(r, c), [startEdit]);

  // --- fill handle (drag-fill) ----------------------------------------------

  // Bottom-right corner of the current selection (or the active cell) — where
  // the fill handle rides. Absent when nothing is selected or not editable.
  const fillAnchor = (() => {
    if (!editable) return null;
    if (range) { const n = normRange(range)!; return { r: n.r2, c: n.c2 }; }
    if (active) return { r: active.r, c: active.c };
    return null;
  })();

  const startFill = (e: MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!editable) return;
    const src: Range = range
      ? normRange(range)
      : active
        ? { r1: active.r, c1: active.c, r2: active.r, c2: active.c }
        : null;
    if (!src) return;
    fillSrcRef.current = src;
    fillDestRef.current = src;
    fillDragRef.current = true;
    draggingRef.current = false;
    setFillSource(src);
    setFillPreview(src);
  };

  // Commit the fill on mouseup (anywhere in the window). Re-subscribes when the
  // active sheet changes so writes always target the visible sheet.
  useEffect(() => {
    const onUp = () => {
      if (!fillDragRef.current) return;
      fillDragRef.current = false;
      const src = fillSrcRef.current;
      const dest = fillDestRef.current;
      setFillSource(null);
      setFillPreview(null);
      if (!src || !dest) return;
      const writes = computeFill(src, dest, (r, c) => model().getRaw(activeSheetId, r, c));
      if (writes.length) {
        provider.ydoc.transact(() => {
          for (const w of writes) model().setRaw(activeSheetId, w.r, w.c, w.raw);
        });
      }
      setRange({ r1: dest.r1, c1: dest.c1, r2: dest.r2, c2: dest.c2 });
    };
    window.addEventListener('mouseup', onUp);
    return () => window.removeEventListener('mouseup', onUp);
  }, [activeSheetId, provider]);

  // --- formatting toolbar ---------------------------------------------------

  const updateStyle = (patch: Partial<CellStyle> | ((cur: CellStyle) => CellStyle)) => {
    if (!editable) return;
    const targets = range ? rangeCells(range) : active ? [[active.r, active.c] as [number, number]] : [];
    if (targets.length === 0) return;
    provider.ydoc.transact(() => {
      for (const [r, c] of targets) {
        const cur = model().getStyle(activeSheetId, r, c);
        const next = typeof patch === 'function' ? patch(cur) : mergeStyle(cur, patch);
        model().setStyle(activeSheetId, r, c, next);
      }
    });
  };

  const toggleBool = (key: 'b' | 'i' | 'u') =>
    updateStyle((cur) => {
      const out = { ...cur };
      if (out[key]) delete out[key];
      else (out as Record<string, unknown>)[key] = 1;
      return out;
    });

  const activeStyle: CellStyle = active ? model().getStyle(activeSheetId, active.r, active.c) : {};
  const curSym = CURRENCIES.find((c) => c.code === (activeStyle.currency ?? 'USD'))?.sym ?? '$';

  // Bump the selection's decimal places (clamped 0..10). A raw/auto/plain cell
  // is promoted to Number format so the change is actually visible.
  const bumpDecimals = (delta: number) => {
    const base = activeStyle.decimals ?? impliedDecimals(activeStyle.fmt);
    const next = Math.max(DEC_MIN, Math.min(DEC_MAX, base + delta));
    updateStyle((cur) => {
      const out: CellStyle = { ...cur, decimals: next };
      if (!out.fmt || out.fmt === 'auto' || out.fmt === 'plain') out.fmt = 'number';
      return out;
    });
  };

  // --- structural edits -----------------------------------------------------

  const insertRow = (offset: number) => { if (editable && active) model().insertRows(activeSheetId, active.r + offset, 1); };
  const deleteRow = () => { if (editable && active) model().deleteRows(activeSheetId, active.r, 1); };
  const insertCol = (offset: number) => { if (editable && active) model().insertCols(activeSheetId, active.c + offset, 1); };
  const deleteCol = () => { if (editable && active) model().deleteCols(activeSheetId, active.c, 1); };

  const freezeHere = () => {
    if (!editable || !active) return;
    model().setGeom(activeSheetId, { frozenRows: active.r, frozenCols: active.c });
  };
  const unfreeze = () => {
    if (!editable) return;
    model().setGeom(activeSheetId, { frozenRows: 0, frozenCols: 0 });
  };

  // --- sort / CSV -----------------------------------------------------------

  const sortRange = () => {
    if (!range || !active) return;
    const n = normRange(range)!;
    const col = active.c;
    const rows: Array<Record<number, string>> = [];
    for (let r = n.r1; r <= n.r2; r++) {
      const vals: Record<number, string> = {};
      for (let c = n.c1; c <= n.c2; c++) vals[c] = cellRaw(r, c);
      rows.push(vals);
    }
    rows.sort((a, b) => {
      const av = a[col] ?? '', bv = b[col] ?? '';
      if (av === bv) return 0;
      if (av === '') return 1;
      if (bv === '') return -1;
      const an = Number(av), bn = Number(bv);
      if (!Number.isNaN(an) && !Number.isNaN(bn)) return an - bn;
      return av.localeCompare(bv);
    });
    provider.ydoc.transact(() => {
      let i = n.r1;
      for (const vals of rows) {
        for (let c = n.c1; c <= n.c2; c++) model().setRaw(activeSheetId, i, c, vals[c] ?? '');
        i++;
      }
    });
    toast.success(`Sorted by ${colLabel(col)}`);
  };

  const exportCsv = () => {
    const csv = cellsToCSV(model().cellRecord(activeSheetId), geom.rows, geom.cols);
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${sheetName || 'sheet'}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  const importCsv = (e: Event) => {
    const input = e.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async () => {
      const rows = parseCSV(String(reader.result || ''));
      if (rows.length === 0) return;
      const start = active ?? { r: 0, c: 0 };
      const ok = await confirmDialog({
        title: `Import ${rows.length} rows from CSV?`,
        message: `Pasting will overwrite cells starting at ${colLabel(start.c)}${start.r + 1}.`,
        confirmLabel: 'Import',
      });
      if (!ok) return;
      growFor(start.r + rows.length, start.c + Math.max(...rows.map((r) => r.length)));
      provider.ydoc.transact(() => {
        for (let r = 0; r < rows.length; r++) {
          for (let c = 0; c < rows[r].length; c++) {
            model().setRaw(activeSheetId, start.r + r, start.c + c, rows[r][c]);
          }
        }
      });
      toast.success(`Imported ${rows.length} rows`);
    };
    reader.readAsText(file);
    input.value = '';
  };

  // --- tabs -----------------------------------------------------------------

  const switchSheet = (id: string) => {
    setActiveSheetId(id);
    setActive(null);
    setRange(null);
    setEditing(false);
  };
  const addSheet = () => {
    if (!editable) return;
    const id = model().addSheet();
    switchSheet(id);
  };
  const renameSheet = async (id: string) => {
    if (!editable) return;
    const current = model().name(id);
    const name = await promptDialog({ title: 'Rename sheet', defaultValue: current, confirmLabel: 'Rename' });
    if (!name || name.trim() === current) return;
    const res = model().renameSheet(id, name.trim(), engineRef.current!);
    if (res === null) toast.error('That name is already taken.');
  };
  const deleteSheet = async (id: string) => {
    if (!editable) return;
    if (sheets.length <= 1) return;
    const ok = await confirmDialog({
      title: `Delete "${model().name(id)}"?`,
      message: 'This removes the sheet and its data.',
      confirmLabel: 'Delete',
      danger: true,
    });
    if (ok) model().removeSheet(id);
  };

  if (!ready || !engineRef.current) {
    return <div class="loading-skel">Loading…</div>;
  }

  const rangeLabel = range
    ? `${colLabel(normRange(range)!.c1)}${normRange(range)!.r1 + 1}:${colLabel(normRange(range)!.c2)}${normRange(range)!.r2 + 1}`
    : active
      ? `${colLabel(active.c)}${active.r + 1}`
      : '';

  return (
    <div class="sheet-wrap">
      <div class="sheet-toolbar">
        <button class={`tb-btn ${activeStyle.b ? 'active' : ''}`} onMouseDown={(e) => { e.preventDefault(); toggleBool('b'); }} disabled={!editable || !active} title="Bold" aria-label="Bold"><b>B</b></button>
        <button class={`tb-btn ${activeStyle.i ? 'active' : ''}`} onMouseDown={(e) => { e.preventDefault(); toggleBool('i'); }} disabled={!editable || !active} title="Italic" aria-label="Italic"><i>I</i></button>
        <button class={`tb-btn ${activeStyle.u ? 'active' : ''}`} onMouseDown={(e) => { e.preventDefault(); toggleBool('u'); }} disabled={!editable || !active} title="Underline" aria-label="Underline"><u>U</u></button>
        <span class="tb-sep" />
        <ColorSwatch
          label={<span style={activeStyle.fg ? { color: activeStyle.fg, fontWeight: 700 } : { fontWeight: 700 }}>A</span>}
          title="Text color" value={activeStyle.fg ?? null}
          onPick={(color) => updateStyle({ fg: color ?? undefined })}
        />
        <ColorSwatch
          label={<span style={activeStyle.bg ? { background: activeStyle.bg, padding: '0 4px', borderRadius: '2px' } : undefined}>▌</span>}
          title="Background color" value={activeStyle.bg ?? null}
          onPick={(color) => updateStyle({ bg: color ?? undefined })}
        />
        <Dropdown label={<span class="tb-font-label">{FORMAT_LABEL[activeStyle.fmt ?? 'auto']}</span>} title="Format">
          {(close) => (
            <ul class="tb-drop-list">
              {FORMATS.map((f) => (
                <li key={f}>
                  <button class={`tb-drop-item ${(activeStyle.fmt ?? 'auto') === f ? 'selected' : ''}`} onClick={() => { updateStyle({ fmt: f }); close(); }}>
                    {FORMAT_LABEL[f]}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Dropdown>
        <button class="tb-btn tb-dec" data-testid="dec-dec" disabled={!editable || !active} onMouseDown={(e) => { e.preventDefault(); bumpDecimals(-1); }} title="Decrease decimal places" aria-label="Decrease decimal places">.0<span class="tb-dec-arrow">←</span></button>
        <button class="tb-btn tb-dec" data-testid="dec-inc" disabled={!editable || !active} onMouseDown={(e) => { e.preventDefault(); bumpDecimals(1); }} title="Increase decimal places" aria-label="Increase decimal places">.00<span class="tb-dec-arrow">→</span></button>
        <span data-testid="currency-picker" class="tb-picker-wrap">
          <Dropdown label={<span class="tb-font-label">{curSym}</span>} title="Currency format">
            {(close) => (
              <ul class="tb-drop-list">
                {CURRENCIES.map((cu) => (
                  <li key={cu.code}>
                    <button
                      class={`tb-drop-item ${activeStyle.fmt === 'currency' && (activeStyle.currency ?? 'USD') === cu.code ? 'selected' : ''}`}
                      onClick={() => { updateStyle({ fmt: 'currency', currency: cu.code }); close(); }}
                    >
                      <span class="tb-cur-sym">{cu.sym}</span> {cu.label}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </Dropdown>
        </span>
        <span data-testid="date-format-picker" class="tb-picker-wrap">
          <Dropdown label={<span class="tb-font-label">Date</span>} title="Date format">
            {(close) => (
              <ul class="tb-drop-list">
                {DATE_FORMATS.map((df) => (
                  <li key={df.value}>
                    <button
                      class={`tb-drop-item ${activeStyle.fmt === 'date' && (activeStyle.dateFmt ?? 'mmm d, yyyy') === df.value ? 'selected' : ''}`}
                      onClick={() => { updateStyle({ fmt: 'date', dateFmt: df.value }); close(); }}
                    >
                      {df.label}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </Dropdown>
        </span>
        <span class="tb-sep" />
        <button class="tb-btn" disabled={!editable || !active} onMouseDown={(e) => { e.preventDefault(); updateStyle({ align: 'l' as CellAlign }); }} title="Align left" aria-label="Align left">⬱</button>
        <button class="tb-btn" disabled={!editable || !active} onMouseDown={(e) => { e.preventDefault(); updateStyle({ align: 'c' as CellAlign }); }} title="Align center" aria-label="Align center">≡</button>
        <button class="tb-btn" disabled={!editable || !active} onMouseDown={(e) => { e.preventDefault(); updateStyle({ align: 'r' as CellAlign }); }} title="Align right" aria-label="Align right">⬲</button>
        <span class="tb-sep" />
        <button class="tb-btn" disabled={!editable || !active} onMouseDown={(e) => { e.preventDefault(); insertRow(0); }} title="Insert row above">+ Row ↑</button>
        <button class="tb-btn" disabled={!editable || !active} onMouseDown={(e) => { e.preventDefault(); insertRow(1); }} title="Insert row below">+ Row ↓</button>
        <button class="tb-btn" disabled={!editable || !active} onMouseDown={(e) => { e.preventDefault(); deleteRow(); }} title="Delete row">− Row</button>
        <button class="tb-btn" disabled={!editable || !active} onMouseDown={(e) => { e.preventDefault(); insertCol(0); }} title="Insert column left">+ Col ←</button>
        <button class="tb-btn" disabled={!editable || !active} onMouseDown={(e) => { e.preventDefault(); insertCol(1); }} title="Insert column right">+ Col →</button>
        <button class="tb-btn" disabled={!editable || !active} onMouseDown={(e) => { e.preventDefault(); deleteCol(); }} title="Delete column">− Col</button>
        <span class="tb-sep" />
        <button class="tb-btn" data-testid="freeze" disabled={!editable || !active} onMouseDown={(e) => { e.preventDefault(); freezeHere(); }} title="Freeze up to selection">Freeze</button>
        <button class="tb-btn" data-testid="unfreeze" disabled={!editable || (!geom.frozenRows && !geom.frozenCols)} onMouseDown={(e) => { e.preventDefault(); unfreeze(); }} title="Unfreeze">Unfreeze</button>
        <span class="tb-sep" />
        <button class="tb-btn" disabled={!editable || !range} onMouseDown={(e) => { e.preventDefault(); sortRange(); }} title="Sort selection by active column">Sort</button>
        <label class="tb-btn upload-btn" title="Import CSV into selected cell">
          Import CSV
          <input type="file" accept=".csv,text/csv" onChange={importCsv} style="display:none" />
        </label>
        <button class="tb-btn" onMouseDown={(e) => { e.preventDefault(); exportCsv(); }} title="Export sheet as CSV">Export CSV</button>
        <span class="sheet-formula-bar">
          {active ? (
            <>
              <span class="sheet-cell-ref">{rangeLabel}</span>
              <span class="sheet-formula-text">{cellRaw(active.r, active.c)}</span>
            </>
          ) : <span class="muted">Select a cell</span>}
        </span>
      </div>

      <Grid
        engine={engineRef.current}
        sheetName={sheetName}
        dims={dims}
        geom={geom}
        active={active}
        range={range}
        editing={editing}
        editValue={editValue}
        editable={editable}
        styleAt={(r, c) => model().getStyle(activeSheetId, r, c)}
        scrollRef={scrollRef}
        inputRef={inputRef}
        fillAnchor={fillAnchor}
        fillSource={fillSource}
        fillPreview={fillPreview}
        onFillMouseDown={startFill}
        onGridKeyDown={onGridKeyDown}
        onCellMouseDown={onCellMouseDown}
        onCellMouseEnter={onCellMouseEnter}
        onCellDblClick={onCellDblClick}
        onEditInput={setEditValue}
        onEditKeyDown={onEditKeyDown}
        onEditBlur={commit}
      />

      <div class="sheet-tabs" role="tablist">
        {sheets.map((s) => (
          <div
            key={s.id}
            class={`sheet-tab ${s.id === activeSheetId ? 'active' : ''}`}
            role="tab"
            aria-selected={s.id === activeSheetId}
            data-testid="sheet-tab"
            onMouseDown={() => switchSheet(s.id)}
            onDblClick={() => renameSheet(s.id)}
            title="Double-click to rename"
          >
            <span class="sheet-tab-name">{s.name}</span>
            {editable && sheets.length > 1 && (
              <button
                class="sheet-tab-close"
                title="Delete sheet"
                aria-label={`Delete ${s.name}`}
                onMouseDown={(e) => { e.stopPropagation(); e.preventDefault(); void deleteSheet(s.id); }}
              >×</button>
            )}
          </div>
        ))}
        {editable && (
          <button class="sheet-tab-add" data-testid="add-sheet" title="Add sheet" aria-label="Add sheet" onMouseDown={(e) => { e.preventDefault(); addSheet(); }}>+</button>
        )}
      </div>
    </div>
  );
}

const colLabel = colToLabel;
