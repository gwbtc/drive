// Client-side full-text search index for Drive documents.
//
// The ship stores Yjs state as opaque bytes, so content indexing has to
// happen in the browser: pull GET /drive/state?id=<id>, materialize a
// scratch Y.Doc, extract plain text, and persist {id, title, type, text,
// modified, indexedAt} rows in IndexedDB (db `drive-search`, store `docs`).
// Search is a normalized substring scan over the stored rows — at
// personal-ship scale (hundreds of docs) that beats an inverted index.
//
// Layout: pure functions (extraction / snippet / scan) live at the top so
// bun tests can exercise them without IndexedDB; the thin IDB + fetch glue
// is at the bottom and is only reached from browser callers.

import * as Y from 'yjs';
import { BASE, type DocSummary, type DocType } from '../api';

export type ContentHit = {
  id: string;
  title: string;
  type: DocType;
  snippet: string;
  // Offsets of the matched range *within snippet*, so the UI can bold the
  // match by building spans — no HTML strings involved.
  matchStart: number;
  matchEnd: number;
  modified: number;
};

// A row in the `docs` object store.
export type IndexEntry = {
  id: string;
  title: string;
  type: DocType;
  text: string;
  modified: number;
  indexedAt: number;
};

// ---------------------------------------------------------------------------
// Pure: text extraction
// ---------------------------------------------------------------------------

const normalizeWs = (s: string): string => s.replace(/\s+/g, ' ').trim();

// Collect the plain text of an XmlFragment. We deliberately avoid
// `.toString()`: Y.XmlText.toString() serializes formatting attributes as
// markup (`<bold>…</bold>`), which would pollute the index. Instead we walk
// the tree — elements recurse into children (with a block separator),
// XmlText nodes contribute their delta's string inserts.
export function xmlFragmentText(frag: Y.XmlFragment): string {
  const parts: string[] = [];
  const walk = (node: unknown): void => {
    if (node instanceof Y.XmlText) {
      const delta = node.toDelta() as Array<{ insert?: unknown }>;
      for (const op of delta) {
        if (typeof op.insert === 'string') parts.push(op.insert);
      }
    } else if (node instanceof Y.XmlElement || node instanceof Y.XmlFragment) {
      for (const child of node.toArray()) walk(child);
      // Block boundary (paragraph, heading, listItem, table cell, …) —
      // keeps "…end.Start…" from fusing into one token.
      parts.push('\n');
    }
  };
  for (const child of frag.toArray()) walk(child);
  return normalizeWs(parts.join(''));
}

// Sheet cells: Y.Map 'cells' of cell-ref → raw string (formulas included,
// `=SUM(…)` and all — users search formulas too). Keys are sorted so the
// output is deterministic regardless of Y.Map iteration order.
export function sheetText(cells: Y.Map<unknown>): string {
  const keys = Array.from(cells.keys()).sort();
  const parts: string[] = [];
  for (const k of keys) {
    const v = cells.get(k);
    if (typeof v === 'string' && v.length > 0) parts.push(v);
  }
  return normalizeWs(parts.join(' '));
}

// Extract the searchable text of a doc. Text/note docs live in the Y.Doc's
// XmlFragment named 'default' (Tiptap Collaboration's default field — see
// Editor.tsx: Collaboration.configure({ document }) with no field override).
// Some docs (e2e fixtures) instead write Y.Text 't'; extract both and
// concatenate. Sheets use the 'cells' Y.Map.
export function extractText(ydoc: Y.Doc, type: DocType): string {
  if (type === 'sheet') return sheetText(ydoc.getMap('cells'));
  const parts: string[] = [];
  const rich = xmlFragmentText(ydoc.getXmlFragment('default'));
  if (rich) parts.push(rich);
  const plain = ydoc.getText('t').toString();
  if (plain.trim()) parts.push(plain);
  return normalizeWs(parts.join(' '));
}

// ---------------------------------------------------------------------------
// Pure: snippet + scan
// ---------------------------------------------------------------------------

// ~80 chars of context around a match at [index, index+len), with the match
// position re-expressed as offsets into the returned snippet (ellipses
// included), so callers can split-and-bold without any HTML.
export function makeSnippet(
  text: string,
  index: number,
  len: number,
  radius = 40,
): { snippet: string; matchStart: number; matchEnd: number } {
  const start = Math.max(0, index - radius);
  const end = Math.min(text.length, index + len + radius);
  let snippet = text.slice(start, end);
  let matchStart = index - start;
  if (start > 0) {
    snippet = '…' + snippet;
    matchStart += 1;
  }
  if (end < text.length) snippet = snippet + '…';
  return { snippet, matchStart, matchEnd: matchStart + len };
}

// Case-insensitive substring scan over index rows, most-recently-modified
// first. (Offsets come from the lowercased haystack; toLowerCase() is
// length-preserving for all but exotic locale cases, which we accept.)
export function scanEntries(
  entries: IndexEntry[],
  query: string,
  limit: number,
): ContentHit[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const hits: ContentHit[] = [];
  const sorted = [...entries].sort((a, b) => b.modified - a.modified);
  for (const e of sorted) {
    const idx = e.text.toLowerCase().indexOf(q);
    if (idx < 0) continue;
    const { snippet, matchStart, matchEnd } = makeSnippet(e.text, idx, q.length);
    hits.push({
      id: e.id,
      title: e.title,
      type: e.type,
      snippet,
      matchStart,
      matchEnd,
      modified: e.modified,
    });
    if (hits.length >= limit) break;
  }
  return hits;
}

// ---------------------------------------------------------------------------
// IndexedDB glue (browser only — never touched at import time, so the pure
// half stays testable under bun where `indexedDB` is absent)
// ---------------------------------------------------------------------------

const DB_NAME = 'drive-search'; // NOT a y-indexeddb database — do not reuse those.
const STORE = 'docs';

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE)) {
          db.createObjectStore(STORE, { keyPath: 'id' });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => {
        dbPromise = null;
        reject(req.error);
      };
    });
  }
  return dbPromise;
}

async function withStore<T>(
  mode: IDBTransactionMode,
  fn: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  const db = await openDb();
  return new Promise<T>((resolve, reject) => {
    const req = fn(db.transaction(STORE, mode).objectStore(STORE));
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

const idbGetAll = (): Promise<IndexEntry[]> =>
  withStore('readonly', (s) => s.getAll() as IDBRequest<IndexEntry[]>);

// ---------------------------------------------------------------------------
// Public API: ensureIndex / searchContent / invalidate
// ---------------------------------------------------------------------------

const INDEXABLE: ReadonlySet<DocType> = new Set(['text', 'note', 'sheet']);

// Same shape /drive/state returns (see providers/reconcile.ts). Defined
// locally so this module doesn't couple to the provider workstream.
type ServerState = {
  snapshot?: number[] | null;
  updates?: Array<number[] | null> | null;
};

async function indexOne(doc: DocSummary): Promise<void> {
  const r = await fetch(`${BASE}/state?id=${doc.id}`, { credentials: 'include' });
  if (!r.ok) throw new Error(`state ${r.status}`);
  const s: ServerState = await r.json();
  const ydoc = new Y.Doc();
  try {
    if (s.snapshot && s.snapshot.length > 0) {
      Y.applyUpdate(ydoc, new Uint8Array(s.snapshot));
    }
    for (const u of s.updates ?? []) {
      if (u && u.length > 0) Y.applyUpdate(ydoc, new Uint8Array(u));
    }
    const text = extractText(ydoc, doc.type);
    await withStore('readwrite', (st) =>
      st.put({
        id: doc.id,
        title: doc.title,
        type: doc.type,
        text,
        modified: doc.modified,
        indexedAt: Date.now(),
      } satisfies IndexEntry),
    );
  } finally {
    ydoc.destroy();
  }
}

async function runIndex(docs: DocSummary[]): Promise<void> {
  const candidates = docs.filter((d) => INDEXABLE.has(d.type));
  if (candidates.length === 0) return;
  let existing: IndexEntry[];
  try {
    existing = await idbGetAll();
  } catch {
    return; // no IndexedDB (private mode, etc.) — content search degrades to nothing
  }
  const byId = new Map(existing.map((e) => [e.id, e]));
  const stale = candidates.filter((d) => {
    const cur = byId.get(d.id);
    // Compare doc.modified (ship clock) against the modified we STORED
    // (also ship clock) — NOT indexedAt (browser Date.now()). Cross-clock
    // comparison would miss re-indexing whenever the browser runs ahead of
    // the ship, which is the common remote-access case.
    return !cur || d.modified > cur.modified;
  });
  // Drop rows for docs that vanished from the listing (deleted/trashed), so
  // content search doesn't surface ghosts. Runs on every pass — the passive
  // counterpart to an explicit invalidate(id).
  const liveIds = new Set(docs.map((d) => d.id));
  for (const e of existing) {
    if (!liveIds.has(e.id)) await invalidate(e.id);
  }
  // Two-way concurrency: fast enough for hundreds of docs, gentle on the ship.
  let next = 0;
  const worker = async () => {
    while (next < stale.length) {
      const doc = stale[next++];
      try {
        await indexOne(doc);
      } catch {
        // Skip — a stale/missing row just means this doc won't surface in
        // content search until the next ensureIndex pass retries it.
      }
    }
  };
  await Promise.all([worker(), worker()]);
}

let inFlight: Promise<void> | null = null;

// (Re)index every text/note/sheet doc whose `modified` postdates its last
// indexing. Re-entrant-safe: concurrent calls share the in-flight run.
// Await the returned promise (or .finally()) to know when results are
// complete — that's the "indexing…" signal for the UI.
export function ensureIndex(docs: DocSummary[]): Promise<void> {
  if (inFlight) return inFlight;
  inFlight = runIndex(docs).finally(() => {
    inFlight = null;
  });
  return inFlight;
}

export async function searchContent(query: string, limit = 8): Promise<ContentHit[]> {
  const q = query.trim();
  if (!q) return [];
  let entries: IndexEntry[];
  try {
    entries = await idbGetAll();
  } catch {
    return [];
  }
  return scanEntries(entries, q, limit);
}

// Drop one doc's row (call on delete/trash or live-feed change events; the
// next ensureIndex pass re-fetches it if it still exists in the listing).
export async function invalidate(id: string): Promise<void> {
  try {
    await withStore('readwrite', (s) => s.delete(id));
  } catch {
    // Index absent or unwritable — nothing to drop.
  }
}
