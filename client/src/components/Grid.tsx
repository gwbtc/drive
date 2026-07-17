// Virtualized spreadsheet grid. Rows (the "many" axis) are windowed: only the
// visible span ±overscan is rendered, so 1000+ rows stay smooth. Columns are
// bounded (default 26) and rendered in full. Freeze is four-quadrant, built
// from nested CSS `position: sticky`:
//   * the column-letter header row is sticky-top,
//   * the row-number gutter is sticky-left,
//   * user-frozen data rows (geom.frozenRows) are always rendered and sticky-top,
//   * user-frozen data cols (geom.frozenCols) are sticky-left,
//   * their intersections pin in both axes (the corner quadrant).
// Windowing preserves screen-reader correctness via aria-rowindex/colindex on
// the (virtual) grid, so a row scrolled out of the DOM still reports its true
// position, and aria-activedescendant on the grid tracks the active cell for
// keyboard navigation.
//
// Perf: the per-cell view is a `memo`-ized GridCell so a drag or keystroke that
// re-renders the sheet only re-renders the cells whose state actually changed
// (the selection edge, the edited cell) instead of every visible cell. Range
// membership is normalized once per render (not once per cell) via inNormRange.

import type { RefObject } from 'preact';
import { memo } from 'preact/compat';
import { useLayoutEffect, useRef, useState } from 'preact/hooks';
import type { CalcEngine } from '../sheets/engine/engine';
import { colToLabel } from '../sheets/engine/ast';
import { applyFormat, type CellStyle } from '../sheets/format';
import type { GeomData } from '../sheets/model';
import {
  type Active,
  type Range,
  inNormRange,
  normRange,
  windowRange,
  scrollToShow,
} from '../sheets/gridmath';

export const HEADER_H = 28;
export const GUTTER_W = 48;
export const ROW_H = 28;
export const COL_W = 100;
const OVERSCAN = 5;

export interface GridProps {
  engine: CalcEngine;
  sheetName: string;
  dims: { rows: number; cols: number };
  geom: GeomData;
  active: Active;
  range: Range;
  editing: boolean;
  editValue: string;
  editable: boolean;
  styleAt: (r: number, c: number) => CellStyle;
  scrollRef: RefObject<HTMLDivElement>;
  inputRef: RefObject<HTMLInputElement>;
  // Fill handle (drag-fill). `fillAnchor` is the cell that shows the handle
  // (bottom-right of the selection); `fillSource`/`fillPreview` outline the
  // source and target regions while a drag is in progress.
  fillAnchor: { r: number; c: number } | null;
  fillSource: Range;
  fillPreview: Range;
  onFillMouseDown: (e: MouseEvent) => void;
  onGridKeyDown: (e: KeyboardEvent) => void;
  onCellMouseDown: (r: number, c: number, e: MouseEvent) => void;
  onCellMouseEnter: (r: number, c: number) => void;
  onCellDblClick: (r: number, c: number) => void;
  onEditInput: (v: string) => void;
  onEditKeyDown: (e: KeyboardEvent) => void;
  onEditBlur: () => void;
}

export function Grid(props: GridProps) {
  const {
    engine, sheetName, dims, geom, active, range, editing, editValue, editable,
    styleAt, scrollRef, inputRef, fillAnchor, fillSource, fillPreview,
  } = props;

  const [scrollTop, setScrollTop] = useState(0);
  const [viewport, setViewport] = useState({ h: 600, w: 800 });
  const sizeRef = useRef({ h: 600, w: 800 });

  const frozenRows = Math.min(geom.frozenRows, dims.rows);
  const frozenCols = Math.min(geom.frozenCols, dims.cols);

  // Column geometry (all columns rendered; per-column widths supported).
  const colW = (c: number): number => geom.colWidths[c] ?? COL_W;
  const colOffsets: number[] = [];
  let x = GUTTER_W;
  for (let c = 0; c < dims.cols; c++) { colOffsets[c] = x; x += colW(c); }
  const totalW = x;
  const totalH = HEADER_H + dims.rows * ROW_H;

  // Normalize selection / fill ranges ONCE per render; each cell then does a
  // cheap bounds test (inNormRange) instead of allocating a fresh normRange.
  const nRange = normRange(range);
  const nFillPreview = normRange(fillPreview);
  const nFillSource = normRange(fillSource);

  // Keep the viewport size current for the windowing math.
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const measure = () => {
      const h = el.clientHeight, w = el.clientWidth;
      if (h !== sizeRef.current.h || w !== sizeRef.current.w) {
        sizeRef.current = { h, w };
        setViewport({ h, w });
      }
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [scrollRef]);

  // Scroll the active cell into view on navigation / edit start. A cell inside
  // the freeze band is always on screen along its frozen axis, so we must NOT
  // scroll that axis — doing so yanks the sheet back to the frozen edge (a jump
  // when you click a frozen cell). Only scroll axes where the cell lives in the
  // scrollable region.
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el || !active) return;
    const rFrozen = active.r < frozenRows;
    const cFrozen = active.c < frozenCols;
    if (!rFrozen) {
      const nextTop = scrollToShow(active.r, el.scrollTop, el.clientHeight - HEADER_H, ROW_H, frozenRows);
      if (nextTop !== el.scrollTop) el.scrollTop = nextTop;
    }
    if (!cFrozen) {
      const cellLeft = colOffsets[active.c] - GUTTER_W;
      const cW = colW(active.c);
      const frozenPx = frozenCols === 0 ? 0 : colOffsets[frozenCols - 1] + colW(frozenCols - 1) - GUTTER_W;
      const viewW = el.clientWidth - GUTTER_W - frozenPx;
      let nextLeft = el.scrollLeft;
      if (cellLeft - frozenPx < el.scrollLeft) nextLeft = Math.max(0, cellLeft - frozenPx);
      else if (cellLeft + cW - frozenPx > el.scrollLeft + viewW) nextLeft = cellLeft + cW - frozenPx - viewW;
      if (nextLeft !== el.scrollLeft) el.scrollLeft = nextLeft;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active?.r, active?.c, editing, frozenRows, frozenCols]);

  const win = windowRange(scrollTop, viewport.h - HEADER_H, ROW_H, dims.rows, OVERSCAN, frozenRows);
  const spacerTop = (win.start - frozenRows) * ROW_H;
  const spacerBottom = (dims.rows - win.end) * ROW_H;

  const onScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    // Only scrollTop feeds a render computation (row windowing). Horizontal
    // pinning is pure CSS sticky, so scrollLeft is read live where needed.
    if (el.scrollTop !== scrollTop) setScrollTop(el.scrollTop);
  };

  // Render one data row (used for both frozen rows and body rows).
  const renderRow = (r: number, frozen: boolean) => {
    const activeRow = active?.r === r;
    return (
      <div
        key={`row-${r}`}
        class={`grid-row${frozen ? ' grid-row-frozen' : ''}`}
        role="row"
        aria-rowindex={r + 2}
        style={{
          height: `${ROW_H}px`,
          width: `${totalW}px`,
          ...(frozen ? { position: 'sticky', top: `${HEADER_H + (r) * ROW_H}px`, zIndex: 20 } : null),
        }}
      >
        <div
          class={`grid-gutter${activeRow ? ' active' : ''}`}
          role="rowheader"
          aria-colindex={1}
          style={{ width: `${GUTTER_W}px`, height: `${ROW_H}px`, zIndex: frozen ? 25 : 12 }}
        >
          {r + 1}
        </div>
        {Array.from({ length: dims.cols }, (_, c) => renderCell(r, c, frozen))}
      </div>
    );
  };

  const renderCell = (r: number, c: number, frozenRow: boolean) => {
    const isActive = active?.r === r && active?.c === c;
    const sel = inNormRange(r, c, nRange) && !isActive;
    const frozenCol = c < frozenCols;
    const style = styleAt(r, c);
    const cellId = `${sheetName}!${r}:${c}`;
    const display = isActive && editing ? '' : applyFormat(engine.getDisplay(cellId), style);
    // Fill-handle affordance + drag preview. The handle rides the bottom-right
    // of the selection; the preview tints the newly covered cells during a drag.
    const isFillAnchor = !!(editable && !editing && fillAnchor?.r === r && fillAnchor?.c === c);
    const inFillTarget = inNormRange(r, c, nFillPreview) && !inNormRange(r, c, nFillSource);
    return (
      <GridCell
        key={`cell-${r}-${c}`}
        r={r}
        c={c}
        id={`cell-${r}-${c}`}
        frozenRow={frozenRow}
        frozenCol={frozenCol}
        leftOffset={colOffsets[c]}
        width={colW(c)}
        rowH={ROW_H}
        isActive={isActive}
        sel={sel}
        inFillTarget={inFillTarget}
        isFillAnchor={isFillAnchor}
        display={display}
        style={style}
        editing={editing}
        editValue={editValue}
        editable={editable}
        inputRef={inputRef}
        onCellMouseDown={props.onCellMouseDown}
        onCellMouseEnter={props.onCellMouseEnter}
        onCellDblClick={props.onCellDblClick}
        onFillMouseDown={props.onFillMouseDown}
        onEditInput={props.onEditInput}
        onEditKeyDown={props.onEditKeyDown}
        onEditBlur={props.onEditBlur}
      />
    );
  };

  const bodyRows: number[] = [];
  for (let r = win.start; r < win.end; r++) bodyRows.push(r);
  const frozenRowList: number[] = [];
  for (let r = 0; r < frozenRows; r++) frozenRowList.push(r);

  return (
    <div
      class="grid-scroll"
      data-testid="sheet-grid"
      ref={scrollRef}
      tabIndex={0}
      role="grid"
      aria-rowcount={dims.rows + 1}
      aria-colcount={dims.cols + 1}
      aria-activedescendant={active ? `cell-${active.r}-${active.c}` : undefined}
      onScroll={onScroll}
      onKeyDown={(e) => props.onGridKeyDown(e as unknown as KeyboardEvent)}
    >
      <div class="grid-inner" style={{ width: `${totalW}px`, height: `${totalH}px`, position: 'relative' }}>
        {/* Column header row (sticky top). */}
        <div
          class="grid-row grid-head"
          role="row"
          aria-rowindex={1}
          style={{ position: 'sticky', top: 0, zIndex: 30, height: `${HEADER_H}px`, width: `${totalW}px` }}
        >
          <div class="grid-corner" role="columnheader" aria-colindex={1} style={{ width: `${GUTTER_W}px`, height: `${HEADER_H}px`, zIndex: 40 }} />
          {Array.from({ length: dims.cols }, (_, c) => {
            const frozenCol = c < frozenCols;
            const css: Record<string, string | number> = { width: `${colW(c)}px`, height: `${HEADER_H}px` };
            if (frozenCol) { css.position = 'sticky'; css.left = `${colOffsets[c]}px`; css.zIndex = 35; }
            return (
              <div
                key={`h-${c}`}
                class={`grid-colhead${active?.c === c ? ' active' : ''}`}
                role="columnheader"
                aria-colindex={c + 2}
                style={css}
              >
                {colToLabel(c)}
              </div>
            );
          })}
        </div>

        {/* Frozen data rows (always rendered, sticky top). */}
        {frozenRowList.map((r) => renderRow(r, true))}

        {/* Windowed body. */}
        {spacerTop > 0 && <div style={{ height: `${spacerTop}px` }} aria-hidden="true" />}
        {bodyRows.map((r) => renderRow(r, false))}
        {spacerBottom > 0 && <div style={{ height: `${spacerBottom}px` }} aria-hidden="true" />}
      </div>
    </div>
  );
}

// --- memoized cell --------------------------------------------------------

interface GridCellProps {
  r: number;
  c: number;
  id: string;
  frozenRow: boolean;
  frozenCol: boolean;
  leftOffset: number; // colOffsets[c] — sticky-left position when frozenCol
  width: number;
  rowH: number;
  isActive: boolean;
  sel: boolean;
  inFillTarget: boolean;
  isFillAnchor: boolean;
  display: string;
  style: CellStyle;
  editing: boolean;
  editValue: string;
  editable: boolean;
  inputRef: RefObject<HTMLInputElement>;
  onCellMouseDown: (r: number, c: number, e: MouseEvent) => void;
  onCellMouseEnter: (r: number, c: number) => void;
  onCellDblClick: (r: number, c: number) => void;
  onFillMouseDown: (e: MouseEvent) => void;
  onEditInput: (v: string) => void;
  onEditKeyDown: (e: KeyboardEvent) => void;
  onEditBlur: () => void;
}

function GridCellImpl(p: GridCellProps) {
  const { r, c, frozenRow, frozenCol, style } = p;
  const css: Record<string, string | number> = {
    width: `${p.width}px`,
    height: `${p.rowH}px`,
  };
  if (style.bg) css.background = style.bg;
  if (style.fg) css.color = style.fg;
  if (style.align) css.textAlign = style.align === 'l' ? 'left' : style.align === 'r' ? 'right' : 'center';
  if (frozenCol) {
    css.position = 'sticky';
    css.left = `${p.leftOffset}px`;
    css.zIndex = frozenRow ? 22 : 8;
    if (!style.bg) css.background = 'var(--bg)';
  }
  const cls =
    'grid-cell' +
    (p.isActive ? ' active' : '') +
    (p.sel ? ' in-range' : '') +
    (p.inFillTarget ? ' fill-target' : '') +
    (p.isFillAnchor ? ' has-fill-handle' : '') +
    (style.b ? ' b' : '') +
    (style.i ? ' i' : '') +
    (style.u ? ' u' : '');
  return (
    <div
      id={p.id}
      class={cls}
      role="gridcell"
      aria-colindex={c + 2}
      data-cell={`${r}:${c}`}
      style={css}
      onMouseDown={(e) => p.onCellMouseDown(r, c, e as unknown as MouseEvent)}
      onMouseEnter={() => p.onCellMouseEnter(r, c)}
      onDblClick={() => p.onCellDblClick(r, c)}
    >
      {p.isFillAnchor && (
        <div
          class="grid-fill-handle"
          data-testid="fill-handle"
          role="button"
          aria-label="Fill handle — drag to fill adjacent cells"
          onMouseDown={(e) => p.onFillMouseDown(e as unknown as MouseEvent)}
        />
      )}
      {p.isActive && p.editing ? (
        <input
          ref={p.inputRef}
          class="grid-cell-input"
          data-testid="cell-input"
          value={p.editValue}
          disabled={!p.editable}
          onInput={(e) => p.onEditInput((e.target as HTMLInputElement).value)}
          onKeyDown={(e) => p.onEditKeyDown(e as unknown as KeyboardEvent)}
          onBlur={p.onEditBlur}
        />
      ) : (
        <span class="grid-cell-text">{p.display}</span>
      )}
    </div>
  );
}

// Skip re-rendering a cell whose observable state is unchanged. During a drag
// only the cells crossing the selection edge change `sel`; during typing only
// the active cell changes — everything else bails here. Edit-input and
// fill-handle props are compared only for the cell that actually uses them, so a
// per-keystroke editValue / per-move fill handler change doesn't invalidate the
// whole viewport. The three always-present cell handlers must be referentially
// stable (SheetEditor keeps them so via useCallback).
function cellPropsEqual(a: GridCellProps, b: GridCellProps): boolean {
  if (
    a.r !== b.r || a.c !== b.c ||
    a.frozenRow !== b.frozenRow || a.frozenCol !== b.frozenCol ||
    a.leftOffset !== b.leftOffset || a.width !== b.width || a.rowH !== b.rowH ||
    a.isActive !== b.isActive || a.sel !== b.sel ||
    a.inFillTarget !== b.inFillTarget || a.isFillAnchor !== b.isFillAnchor ||
    a.display !== b.display || a.editable !== b.editable
  ) return false;
  if (
    a.onCellMouseDown !== b.onCellMouseDown ||
    a.onCellMouseEnter !== b.onCellMouseEnter ||
    a.onCellDblClick !== b.onCellDblClick
  ) return false;
  // Appearance-affecting style fields (value compare; the object is fresh each
  // render). Format/decimals/etc. are already baked into `display`.
  const sa = a.style, sb = b.style;
  if (
    sa.bg !== sb.bg || sa.fg !== sb.fg || sa.align !== sb.align ||
    sa.b !== sb.b || sa.i !== sb.i || sa.u !== sb.u
  ) return false;
  // Edit-input props only matter for the active cell.
  if (a.isActive) {
    if (
      a.editing !== b.editing || a.editValue !== b.editValue ||
      a.onEditKeyDown !== b.onEditKeyDown || a.onEditBlur !== b.onEditBlur ||
      a.onEditInput !== b.onEditInput || a.inputRef !== b.inputRef
    ) return false;
  }
  // The fill handle + its handler only matter for the fill anchor cell.
  if (a.isFillAnchor && a.onFillMouseDown !== b.onFillMouseDown) return false;
  return true;
}

const GridCell = memo(GridCellImpl, cellPropsEqual);
