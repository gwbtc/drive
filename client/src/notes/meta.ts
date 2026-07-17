// Note metadata (Google-Keep-style depth) lives on each note's OWN Y.Doc, in a
// top-level Y.Map named `note-meta`. Because it rides the note's existing Yjs
// update pipeline (HttpProvider), color / labels / pin / archive sync
// collaboratively for free — no agent or api.ts change.
//
//   ydoc.getMap('note-meta') -> Y.Map<unknown>
//     'color'    -> NoteColor            (background swatch)
//     'labels'   -> string[]             (freeform tags)
//     'pinned'   -> boolean              (floats to the "Pinned" section)
//     'archived' -> boolean             (hidden from the main grid)
//
// The note-meta map is a distinct top-level type from the prose content
// (Collaboration uses `getXmlFragment('default')`), so the two never collide.
//
// This module is the seam between the CRDT and the UI: `readNoteMeta` /
// `metaFromRecord` normalize whatever is on the map into a strict `NoteMeta`,
// and the `partitionNotes` / `collectLabels` helpers are the PURE layout logic
// NotesView drives (sort pinned-first, filter by label, split off archived).
// Everything here is side-effect free and unit-tested in meta.test.ts.

import type * as Y from 'yjs';

// Keep's palette (default + 9 colors). `default` means "no override" — the card
// falls back to the app's --bg-elev.
export type NoteColor =
  | 'default'
  | 'red'
  | 'orange'
  | 'yellow'
  | 'green'
  | 'teal'
  | 'blue'
  | 'purple'
  | 'pink'
  | 'gray';

export const NOTE_COLORS: readonly NoteColor[] = [
  'default',
  'red',
  'orange',
  'yellow',
  'green',
  'teal',
  'blue',
  'purple',
  'pink',
  'gray',
] as const;

const COLOR_SET: ReadonlySet<string> = new Set(NOTE_COLORS);

export type NoteMeta = {
  color: NoteColor;
  labels: string[];
  pinned: boolean;
  archived: boolean;
};

export const DEFAULT_META: NoteMeta = {
  color: 'default',
  labels: [],
  pinned: false,
  archived: false,
};

// Top-level Y.Map name on the note's ydoc.
export const NOTE_META_KEY = 'note-meta';

// --- normalization --------------------------------------------------------

// Coerce an arbitrary stored value to a known NoteColor (unknown -> 'default').
export function normColor(v: unknown): NoteColor {
  return typeof v === 'string' && COLOR_SET.has(v) ? (v as NoteColor) : 'default';
}

// Coerce an arbitrary stored value to a labels array: trimmed, non-empty,
// deduped, input order preserved.
export function normLabels(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const item of v) {
    if (typeof item !== 'string') continue;
    const t = item.trim();
    if (!t || seen.has(t)) continue;
    seen.add(t);
    out.push(t);
  }
  return out;
}

// Build a strict NoteMeta from a loose record (the shape read off a Y.Map).
export function metaFromRecord(rec: {
  color?: unknown;
  labels?: unknown;
  pinned?: unknown;
  archived?: unknown;
}): NoteMeta {
  return {
    color: normColor(rec.color),
    labels: normLabels(rec.labels),
    pinned: rec.pinned === true,
    archived: rec.archived === true,
  };
}

// Read a normalized NoteMeta off a note's `note-meta` Y.Map.
export function readNoteMeta(map: Y.Map<unknown>): NoteMeta {
  return metaFromRecord({
    color: map.get('color'),
    labels: map.get('labels'),
    pinned: map.get('pinned'),
    archived: map.get('archived'),
  });
}

// A local cache of each note's meta, so NotesView can partition (archived out
// of the main view, pinned on top) INSTANTLY on load — without waiting for
// every note's provider to sync, which would flash an archived note into the
// main grid until its card mounted and reported. Cards write it as meta
// changes; NotesView seeds from it.
const META_CACHE_PREFIX = 'drive:note-meta:';

export function cacheNoteMeta(id: string, meta: NoteMeta): void {
  try {
    localStorage.setItem(META_CACHE_PREFIX + id, JSON.stringify(meta));
  } catch {
    /* private mode / quota — the live card path still works */
  }
}

export function loadCachedNoteMeta(id: string): NoteMeta | null {
  try {
    const s = localStorage.getItem(META_CACHE_PREFIX + id);
    return s ? metaFromRecord(JSON.parse(s)) : null;
  } catch {
    return null;
  }
}

// Value equality — lets NotesView skip a state update when a card re-reports the
// same meta (Yjs observers can fire for unrelated key changes).
export function metaEqual(a: NoteMeta, b: NoteMeta): boolean {
  return (
    a.color === b.color &&
    a.pinned === b.pinned &&
    a.archived === b.archived &&
    a.labels.length === b.labels.length &&
    a.labels.every((l, i) => l === b.labels[i])
  );
}

// --- label edits (pure) ---------------------------------------------------

// Add `raw` (trimmed) to `labels` unless blank or already present.
export function addLabel(labels: string[], raw: string): string[] {
  const t = raw.trim();
  if (!t || labels.includes(t)) return labels;
  return [...labels, t];
}

export function removeLabel(labels: string[], label: string): string[] {
  return labels.filter((l) => l !== label);
}

// --- grid layout (pure) ---------------------------------------------------

// A note paired with its meta. `meta: null` means "not loaded yet" — the note's
// provider hasn't synced, so it's treated as DEFAULT_META (unpinned, unarchived,
// no labels) and lands in "Others" until its real meta arrives.
export type NoteEntry<T> = { note: T; meta: NoteMeta | null };

export function effectiveMeta<T>(e: NoteEntry<T>): NoteMeta {
  return e.meta ?? DEFAULT_META;
}

// Every distinct label across the entries, sorted case-insensitively — the
// source for NotesView's filter chips.
export function collectLabels<T>(entries: NoteEntry<T>[]): string[] {
  const set = new Set<string>();
  for (const e of entries) {
    for (const l of effectiveMeta(e).labels) set.add(l);
  }
  return [...set].sort((a, b) =>
    a.localeCompare(b, undefined, { sensitivity: 'base' }),
  );
}

export type Partitioned<T> = { pinned: T[]; others: T[]; archived: T[] };

// Split notes into pinned / others / archived, applying an optional label
// filter first. Order WITHIN each bucket preserves input order, so the caller
// (NotesView) controls the base sort (e.g. most-recently-modified first).
//
// `archived` is exclusive: an archived note never appears in pinned/others,
// even if also pinned — archiving removes it from the main grid entirely.
export function partitionNotes<T>(
  entries: NoteEntry<T>[],
  label: string | null,
): Partitioned<T> {
  const pinned: T[] = [];
  const others: T[] = [];
  const archived: T[] = [];
  for (const e of entries) {
    const m = effectiveMeta(e);
    if (label && !m.labels.includes(label)) continue;
    if (m.archived) archived.push(e.note);
    else if (m.pinned) pinned.push(e.note);
    else others.push(e.note);
  }
  return { pinned, others, archived };
}
