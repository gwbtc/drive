// Session lifecycle: the boot decision + the client-side data purge.
//
// This module handles two subtle session concerns:
//
//  * A logged-out-but-ONLINE user gets whoami `{auth:'none'}` (HTTP 200, no
//    ship field). That must NOT boot the app shell with an undefined ship —
//    it must show a login screen AND purge any previous user's cached data,
//    so a shared browser doesn't leave the prior user's documents readable
//    with no auth and no network (IndexedDB doc caches, the drive-search
//    plaintext index, and the recents list all persist across logout).
//
//  * The offline PWA path (initUrbit throws on a genuine network error) must
//    still fall back to the cached identity and render from IndexedDB. Only
//    an AFFIRMATIVE server `'none'` purges; an unreachable ship keeps the
//    cache. Distinguishing these two is the crux of the fix.

import { normalizeShip, type Whoami } from './api';
import { RECENTS_KEY } from './recents';

// Last successful ship identity, cached so an offline reload can boot the
// shell (and reach IndexedDB-cached docs) instead of dying on a live whoami.
// Only ship auth is cached — token sessions are deliberately ephemeral.
export const WHOAMI_KEY = 'drive:whoami';

// Must match `DB_NAME` in search/indexer.ts (that module keeps it private, so
// we can't import it — keep the two in lockstep).
const SEARCH_DB = 'drive-search';

// Prefix of the per-doc y-indexeddb databases (`drive/<ship>/<docId>`), keyed
// in providers/HttpProvider.ts.
const DOC_DB_PREFIX = 'drive/';

// ---------------------------------------------------------------------------
// Cached identity (best-effort; ship auth only)
// ---------------------------------------------------------------------------

export function loadCachedWhoami(): Whoami | null {
  try {
    const raw = localStorage.getItem(WHOAMI_KEY);
    if (!raw) return null;
    const w = JSON.parse(raw) as Whoami;
    return w && w.auth === 'ship' ? w : null;
  } catch {
    return null;
  }
}

export function saveCachedWhoami(w: Whoami): void {
  try {
    if (w.auth === 'ship') localStorage.setItem(WHOAMI_KEY, JSON.stringify(w));
  } catch {
    /* private mode / quota — cache is best-effort */
  }
}

// ---------------------------------------------------------------------------
// Boot decision (pure — no DOM, no storage; fully unit-testable)
// ---------------------------------------------------------------------------

// The outcome of the initial whoami attempt: either the server answered, or
// initUrbit threw (a genuine network error / the ship is unreachable).
export type BootResult = { ok: true; whoami: Whoami } | { ok: false };

export type BootDecision =
  // Render the app (ship or token). `purge` is set when a DIFFERENT ship just
  // logged in on this browser — wipe the prior ship's caches first.
  | { screen: 'app'; whoami: Whoami; purge: boolean }
  // Network error with a cached identity: render offline from IndexedDB.
  // Never purges — this is the PWA path and must keep working.
  | { screen: 'offline'; whoami: Whoami }
  // Server affirmatively said logged-out: show login AND purge.
  | { screen: 'login' }
  // Network error with no cache: nothing to show but "couldn't connect".
  | { screen: 'error' };

// Whether a decision requires purging the local caches BEFORE rendering.
//  - login  → always (definitive logout)
//  - app    → only when the ship changed (a different user on a shared browser)
//  - offline/error → never (offline must not wipe the cache it renders from)
export function shouldPurge(d: BootDecision): boolean {
  if (d.screen === 'login') return true;
  if (d.screen === 'app') return d.purge;
  return false;
}

// Decide what to render given the boot attempt + the cached identity:
//  - server said 'none'        → login  (purge — definitive logout)
//  - server said ship/token    → app    (purge first iff the ship changed)
//  - network error + cache     → offline (render from cache; never purge)
//  - network error, no cache   → error
export function decideBoot(result: BootResult, cached: Whoami | null): BootDecision {
  if (result.ok) {
    const w = result.whoami;
    if (w.auth === 'none') return { screen: 'login' };
    const switched =
      w.auth === 'ship' &&
      cached != null &&
      cached.auth === 'ship' &&
      normalizeShip(cached.ship) !== normalizeShip(w.ship);
    return { screen: 'app', whoami: w, purge: switched };
  }
  if (cached) return { screen: 'offline', whoami: cached };
  return { screen: 'error' };
}

// ---------------------------------------------------------------------------
// Purge (side-effecting; browser only)
// ---------------------------------------------------------------------------

function deleteDb(name: string): Promise<void> {
  return new Promise((resolve) => {
    try {
      const req = indexedDB.deleteDatabase(name);
      // Resolve on any outcome — the purge is best-effort. `blocked` fires
      // when another tab holds the DB open; we still consider it handled.
      req.onsuccess = () => resolve();
      req.onerror = () => resolve();
      req.onblocked = () => resolve();
    } catch {
      resolve();
    }
  });
}

// Wipe every client-side trace of the previous session: the cached identity,
// the recents list, the content-search plaintext index, and every per-doc
// y-indexeddb database (`drive/<ship>/<docId>`). Best-effort throughout — a
// shared browser must not keep the last user's documents readable offline.
export async function purgeLocalData(): Promise<void> {
  try {
    localStorage.removeItem(WHOAMI_KEY);
    localStorage.removeItem(RECENTS_KEY);
  } catch {
    /* storage unavailable — best-effort */
  }

  const names = new Set<string>([SEARCH_DB]);
  try {
    const idb = typeof indexedDB !== 'undefined' ? indexedDB : null;
    // indexedDB.databases() enumerates named DBs where supported (Chrome,
    // Safari). Where it isn't (Firefox), we fall back to the known search DB
    // and rely on per-doc clearData() on revoke/trash for the rest.
    if (idb && typeof idb.databases === 'function') {
      for (const info of await idb.databases()) {
        const name = info.name;
        if (name && (name === SEARCH_DB || name.startsWith(DOC_DB_PREFIX))) {
          names.add(name);
        }
      }
    }
  } catch {
    /* databases() unsupported / rejected — fall back to the known DB */
  }
  await Promise.all([...names].map(deleteDb));
}
