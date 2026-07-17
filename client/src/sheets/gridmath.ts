// Pure coordinate / windowing math for the virtualized grid. No Preact / DOM /
// Yjs — just arithmetic, so it can be unit-tested in isolation. The Grid
// component and SheetEditor both build on these helpers.

export type Active = { r: number; c: number } | null;
export type Range = { r1: number; c1: number; r2: number; c2: number } | null;

// Yjs cell keys are "row:col" (0-based). CellId (engine) is "sheetName!row:col".
export const cellKey = (r: number, c: number): string => `${r}:${c}`;

export function parseCellKey(k: string): { r: number; c: number } {
  const i = k.indexOf(':');
  return { r: parseInt(k.slice(0, i), 10), c: parseInt(k.slice(i + 1), 10) };
}

export function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

// Normalize a possibly-inverted drag range so r1<=r2 and c1<=c2.
export function normRange(r: Range): Range {
  if (!r) return null;
  return {
    r1: Math.min(r.r1, r.r2),
    c1: Math.min(r.c1, r.c2),
    r2: Math.max(r.r1, r.r2),
    c2: Math.max(r.c1, r.c2),
  };
}

export function inRange(r: number, c: number, range: Range): boolean {
  if (!range) return false;
  const n = normRange(range)!;
  return r >= n.r1 && r <= n.r2 && c >= n.c1 && c <= n.c2;
}

// Bounds test against an ALREADY-normalized range (or null). Lets a caller
// hoist the normRange() out of a per-cell loop — computing it once per render
// instead of once per cell — so a full-viewport repaint during a drag stops
// allocating thousands of throwaway range objects.
export function inNormRange(r: number, c: number, n: Range): boolean {
  if (!n) return false;
  return r >= n.r1 && r <= n.r2 && c >= n.c1 && c <= n.c2;
}

export function rangeCells(range: Range): Array<[number, number]> {
  if (!range) return [];
  const n = normRange(range)!;
  const out: Array<[number, number]> = [];
  for (let r = n.r1; r <= n.r2; r++) {
    for (let c = n.c1; c <= n.c2; c++) out.push([r, c]);
  }
  return out;
}

// The half-open [start, end) index window to render for a scrollable axis.
//
//   scroll    — the container's scrollTop / scrollLeft (px)
//   viewport  — the container's clientHeight / clientWidth (px)
//   size      — uniform cell size along this axis (px)
//   total     — total number of cells (dims.rows / dims.cols)
//   overscan  — extra cells rendered on each side to hide scroll seams
//   frozen    — count of pinned (always-rendered) leading cells; the window
//               never dips below `frozen` because those are drawn separately.
//
// Returns data indices; `start >= frozen` and `end <= total`.
export function windowRange(
  scroll: number,
  viewport: number,
  size: number,
  total: number,
  overscan = 5,
  frozen = 0,
): { start: number; end: number } {
  if (size <= 0 || total <= frozen) return { start: frozen, end: Math.max(frozen, total) };
  const s = Math.max(0, scroll);
  const firstVisible = frozen + Math.floor(s / size);
  const visibleCount = Math.ceil(viewport / size) + 1;
  const start = clamp(firstVisible - overscan, frozen, total);
  const end = clamp(firstVisible + visibleCount + overscan, start, total);
  return { start, end };
}

// Desired scroll offset so a target index is fully visible within the
// scrollable region (below/right of any frozen band). Returns the new scroll
// value; unchanged if already visible.
export function scrollToShow(
  index: number,
  scroll: number,
  viewport: number,
  size: number,
  frozen: number,
): number {
  const frozenPx = frozen * size;
  // Position of the cell relative to the start of the scrollable content.
  const cellStart = (index - frozen) * size;
  const cellEnd = cellStart + size;
  const viewStart = scroll;
  const viewEnd = scroll + (viewport - frozenPx);
  if (cellStart < viewStart) return Math.max(0, cellStart);
  if (cellEnd > viewEnd) return cellEnd - (viewport - frozenPx);
  return scroll;
}

// Content-space left edges of every column, length `cols + 1`: entry `c` is the
// left px of column c (the first column starts after the row-number gutter) and
// entry `cols` is the right edge of the last column (total content width). This
// is the column geometry `pointToCell` consumes; the grid renders from the same
// numbers so hit-testing matches layout exactly, including per-column widths.
export function computeColOffsets(
  cols: number,
  colWidths: Record<number, number>,
  gutterW: number,
  defaultW: number,
): number[] {
  const offsets: number[] = new Array(cols + 1);
  let x = gutterW;
  for (let c = 0; c < cols; c++) {
    offsets[c] = x;
    x += colWidths[c] ?? defaultW;
  }
  offsets[cols] = x;
  return offsets;
}

// Geometry describing the virtualized grid's fixed chrome and column layout,
// for mapping a pointer position to a cell.
export interface CellGeom {
  rowH: number; // uniform row height (px)
  headerH: number; // sticky column-header height (px)
  gutterW: number; // sticky row-number gutter width (px)
  colOffsets: number[]; // from computeColOffsets (length cols + 1)
  rows: number; // total row count
  cols: number; // total column count
  frozenRows: number; // pinned leading rows (always on screen)
  frozenCols: number; // pinned leading columns (always on screen)
}

// Map a pointer offset — measured from the scroll container's top-left, i.e.
// (clientX - rect.left, clientY - rect.top) — to a cell coordinate, accounting
// for the sticky header/gutter and the frozen (pinned) row/column bands plus the
// current scroll offset. This is what lets a drag-select or fill-drag keep
// extending past the virtualized DOM window, where off-screen rows are spacer
// divs that emit no mouseenter. Result is clamped to the sheet bounds.
export function pointToCell(
  offsetX: number,
  offsetY: number,
  scrollLeft: number,
  scrollTop: number,
  geom: CellGeom,
): { r: number; c: number } {
  return {
    r: pointToRow(offsetY, scrollTop, geom),
    c: pointToCol(offsetX, scrollLeft, geom),
  };
}

function pointToRow(offsetY: number, scrollTop: number, geom: CellGeom): number {
  const { rowH, headerH, frozenRows, rows } = geom;
  // Screen y where the scrollable region begins (below header + frozen rows).
  const frozenBandBottom = headerH + frozenRows * rowH;
  let contentY: number;
  if (offsetY >= frozenBandBottom) {
    contentY = offsetY + scrollTop; // scrollable region
  } else if (offsetY >= headerH) {
    contentY = offsetY; // frozen (pinned) row band — content == screen here
  } else {
    // Over the header: snap to the top of the scrollable region so an upward
    // drag keeps extending (autoscroll then reveals the rows above).
    contentY = frozenBandBottom + scrollTop;
  }
  const r = Math.floor((contentY - headerH) / rowH);
  return clamp(r, 0, Math.max(0, rows - 1));
}

function pointToCol(offsetX: number, scrollLeft: number, geom: CellGeom): number {
  const { gutterW, colOffsets, frozenCols, cols } = geom;
  // Screen x where the scrollable region begins (right of gutter + frozen cols).
  const frozenBandRight = frozenCols === 0 ? gutterW : colOffsets[frozenCols];
  let contentX: number;
  if (offsetX >= frozenBandRight) {
    contentX = offsetX + scrollLeft; // scrollable region
  } else if (offsetX >= gutterW) {
    contentX = offsetX; // frozen (pinned) col band — content == screen here
  } else {
    // Over the gutter: snap to the leftmost scrollable column.
    contentX = frozenBandRight + scrollLeft;
  }
  return colAt(contentX, colOffsets, cols);
}

function colAt(contentX: number, colOffsets: number[], cols: number): number {
  if (cols <= 0) return 0;
  if (contentX < colOffsets[0]) return 0;
  for (let c = 0; c < cols; c++) {
    if (contentX < colOffsets[c + 1]) return c;
  }
  return cols - 1;
}
