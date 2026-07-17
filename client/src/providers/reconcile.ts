// Pure Yjs reconciliation helpers for the push/pull sync path. No DOM, no
// network — HttpProvider feeds these; unit tests exercise them directly.

import * as Y from 'yjs';

// Shape of GET /drive/state responses (and %request-snapshot pulls).
export type ServerDocState = {
  snapshot?: number[] | null;
  updates?: Array<number[] | null> | null;
  meta?: { title: string; modified: number };
};

// Materialize the server's view of a doc into a fresh Y.Doc.
export function buildServerDoc(state: ServerDocState): Y.Doc {
  const d = new Y.Doc();
  if (state.snapshot && state.snapshot.length > 0) {
    Y.applyUpdate(d, new Uint8Array(state.snapshot));
  }
  for (const u of state.updates ?? []) {
    if (u && u.length > 0) Y.applyUpdate(d, new Uint8Array(u));
  }
  return d;
}

// Apply everything the server has into `local` (idempotent — Yjs drops
// already-known updates). `origin` lets callers suppress echo submission.
export function applyServerState(local: Y.Doc, state: ServerDocState, origin: unknown = 'remote'): void {
  if (state.snapshot && state.snapshot.length > 0) {
    Y.applyUpdate(local, new Uint8Array(state.snapshot), origin);
  }
  for (const u of state.updates ?? []) {
    if (u && u.length > 0) Y.applyUpdate(local, new Uint8Array(u), origin);
  }
}

// The single update blob that carries exactly what `local` knows and the
// server doesn't, or null when the server is already caught up. This is how
// offline/failed edits reach the server without re-sending history: blind
// per-keystroke retries are replaced by one precise diff.
export function encodeMissingUpdate(local: Y.Doc, state: ServerDocState): number[] | null {
  const server = buildServerDoc(state);
  const diff = Y.encodeStateAsUpdate(local, Y.encodeStateVector(server));
  server.destroy();
  // A no-op update encodes as [0, 0] (zero structs, zero delete-sets).
  if (diff.length <= 2) return null;
  return Array.from(diff);
}
