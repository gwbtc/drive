// Service worker for Groundwire Drive — the offline shell for /drive/.
//
// Built as a standalone, dependency-free bundle:
//   bun build src/sw.ts → ../desk/app/drive/sw.js
// The ship serves whatever is at that path from GET /drive/sw.js (with
// Service-Worker-Allowed: /drive/, so this /drive-scoped worker is allowed).
//
// Strategy: cache-first for the versioned shell, network-first for
// navigations (fall back to the cached shell so an offline reload still
// renders the app), and network-only / pass-through for everything dynamic
// (data, blobs, thumbs, the SSE stream). When unsure, we do NOT call
// respondWith — the request goes straight to the network untouched.
//
// This file is typechecked under the app's DOM lib (no WebWorker lib), so the
// worker-only globals and events we touch are declared as minimal local types.

export {};

// --- Minimal worker-global typing (DOM lib types `self` as a Window) --------

interface ExtendableEvt extends Event {
  waitUntil(p: Promise<unknown>): void;
}
interface FetchEvt extends Event {
  readonly request: Request;
  respondWith(r: Response | Promise<Response>): void;
}
interface SwGlobalScope {
  addEventListener(type: 'install', listener: (e: ExtendableEvt) => void): void;
  addEventListener(type: 'activate', listener: (e: ExtendableEvt) => void): void;
  addEventListener(type: 'fetch', listener: (e: FetchEvt) => void): void;
  skipWaiting(): Promise<void>;
  readonly clients: { claim(): Promise<void> };
}

const sw = self as unknown as SwGlobalScope;

// --- Versioning -------------------------------------------------------------
//
// Bump SHELL_VERSION in lockstep with the ?v= cache-bust in desk/app/drive/
// ui.html whenever the app.js / app.css bundle changes. A new version installs
// a fresh cache and re-precaches the current shell; activate() drops the old.
const SHELL_VERSION = 'v16';
const CACHE = `drive-shell-${SHELL_VERSION}`;

// Precache the shell by bare pathname; the backend serves app.js / app.css
// regardless of the ?v= query, and we match with ignoreSearch below.
const SHELL_URLS = ['/drive', '/drive/app.js', '/drive/app.css'];
const SHELL_KEY = '/drive'; // the SPA HTML — fallback for every navigation

// Same-origin /drive paths that are dynamic/data: never cache, never buffer.
// Anything matching passes straight through to the network.
function isDynamic(pathname: string): boolean {
  return (
    pathname === '/drive/sse' ||
    pathname.startsWith('/drive/api/') ||
    pathname === '/drive/state' ||
    pathname === '/drive/action' ||
    pathname === '/drive/token-action' ||
    pathname === '/drive/blob' ||
    pathname === '/drive/thumb' ||
    pathname === '/drive/version' ||
    pathname === '/drive/upload' ||
    pathname === '/drive/manifest.json' ||
    pathname === '/drive/sw.js'
  );
}

sw.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE);
      await cache.addAll(SHELL_URLS);
      await sw.skipWaiting();
    })(),
  );
});

sw.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys
          .filter((k) => k.startsWith('drive-shell-') && k !== CACHE)
          .map((k) => caches.delete(k)),
      );
      await sw.clients.claim();
    })(),
  );
});

sw.addEventListener('fetch', (event) => {
  const req = event.request;

  // Only ever touch same-origin GETs under /drive. Everything else — POSTs,
  // cross-origin (fonts), scries (/~/...) — is left entirely to the network.
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  const p = url.pathname;
  if (p !== '/drive' && !p.startsWith('/drive/')) return;

  // Dynamic/data + the SSE stream: pass through untouched (no respondWith).
  if (isDynamic(p)) return;

  // Shell assets — stale-while-revalidate: serve the cached copy instantly
  // (offline-capable) but refresh it from the network in the background, so a
  // deploy is picked up on the next load WITHOUT needing a SHELL_VERSION bump
  // (bumping only ui.html's ?v= is inert here — we match with ignoreSearch).
  if (p === '/drive/app.js' || p === '/drive/app.css') {
    event.respondWith(staleWhileRevalidate(req));
    return;
  }

  // Navigations (the shell HTML for /drive, /drive/d/..., /drive/files, ...):
  // network-first so online users get fresh HTML, falling back to the cached
  // shell so an offline reload still boots the app.
  if (req.mode === 'navigate') {
    event.respondWith(navigate(req));
    return;
  }

  // Anything else under /drive we don't explicitly handle → network.
});

async function staleWhileRevalidate(req: Request): Promise<Response> {
  const cache = await caches.open(CACHE);
  const cached = await cache.match(req, { ignoreSearch: true });
  // Kick off a background refresh regardless (updates the cache for next time).
  const network = fetch(req)
    .then((res) => {
      if (res.ok) void cache.put(req, res.clone());
      return res;
    })
    .catch(() => cached);
  // Serve cache immediately when present; otherwise wait for the network.
  return cached ?? (await network) ?? fetch(req);
}

async function navigate(req: Request): Promise<Response> {
  try {
    const res = await fetch(req);
    // Keep the cached shell fresh: every /drive navigation returns the same
    // SPA HTML, so store it under the canonical shell key.
    if (res.ok) {
      const cache = await caches.open(CACHE);
      await cache.put(SHELL_KEY, res.clone());
    }
    return res;
  } catch (err) {
    const cache = await caches.open(CACHE);
    const shell = await cache.match(SHELL_KEY);
    if (shell) return shell;
    throw err;
  }
}
