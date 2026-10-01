(() => {
  var __defProp = Object.defineProperty;
  var __getOwnPropNames = Object.getOwnPropertyNames;
  var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
  var __hasOwnProp = Object.prototype.hasOwnProperty;
  var __moduleCache = /* @__PURE__ */ new WeakMap;
  var __toCommonJS = (from) => {
    var entry = __moduleCache.get(from), desc;
    if (entry)
      return entry;
    entry = __defProp({}, "__esModule", { value: true });
    if (from && typeof from === "object" || typeof from === "function")
      __getOwnPropNames(from).map((key) => !__hasOwnProp.call(entry, key) && __defProp(entry, key, {
        get: () => from[key],
        enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable
      }));
    __moduleCache.set(from, entry);
    return entry;
  };

  // src/sw.ts
  var exports_sw = {};
  var sw = self;
  var SHELL_VERSION = "v17";
  var CACHE = `drive-shell-${SHELL_VERSION}`;
  var SHELL_URLS = ["/drive", "/drive/app.js", "/drive/app.css"];
  var SHELL_KEY = "/drive";
  function isDynamic(pathname) {
    return pathname === "/drive/sse" || pathname.startsWith("/drive/api/") || pathname === "/drive/state" || pathname === "/drive/action" || pathname === "/drive/token-action" || pathname === "/drive/blob" || pathname === "/drive/thumb" || pathname === "/drive/version" || pathname === "/drive/upload" || pathname === "/drive/manifest.json" || pathname === "/drive/sw.js";
  }
  sw.addEventListener("install", (event) => {
    event.waitUntil((async () => {
      const cache = await caches.open(CACHE);
      await cache.addAll(SHELL_URLS);
      await sw.skipWaiting();
    })());
  });
  sw.addEventListener("activate", (event) => {
    event.waitUntil((async () => {
      const keys = await caches.keys();
      await Promise.all(keys.filter((k) => k.startsWith("drive-shell-") && k !== CACHE).map((k) => caches.delete(k)));
      await sw.clients.claim();
    })());
  });
  sw.addEventListener("fetch", (event) => {
    const req = event.request;
    if (req.method !== "GET")
      return;
    const url = new URL(req.url);
    if (url.origin !== self.location.origin)
      return;
    const p = url.pathname;
    if (p !== "/drive" && !p.startsWith("/drive/"))
      return;
    if (isDynamic(p))
      return;
    if (p === "/drive/app.js" || p === "/drive/app.css") {
      event.respondWith(staleWhileRevalidate(req));
      return;
    }
    if (req.mode === "navigate") {
      event.respondWith(navigate(req));
      return;
    }
  });
  async function staleWhileRevalidate(req) {
    const cache = await caches.open(CACHE);
    const cached = await cache.match(req, { ignoreSearch: true });
    const network = fetch(req).then((res) => {
      if (res.ok)
        cache.put(req, res.clone());
      return res;
    }).catch(() => cached);
    return cached ?? await network ?? fetch(req);
  }
  async function navigate(req) {
    try {
      const res = await fetch(req);
      if (res.ok) {
        const cache = await caches.open(CACHE);
        await cache.put(SHELL_KEY, res.clone());
      }
      return res;
    } catch (err) {
      const cache = await caches.open(CACHE);
      const shell = await cache.match(SHELL_KEY);
      if (shell)
        return shell;
      throw err;
    }
  }
})();
