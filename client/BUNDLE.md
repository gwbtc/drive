# Bundle size notes

Current: **~731 KB raw / ~229 KB gzip** (`desk/app/documents/js.js`).

Weight is almost entirely the productivity stack: Tiptap + ProseMirror
(rich-text editor, ~25 extensions, all used), Yjs + y-protocols +
y-indexeddb (the CRDT + offline persistence), the sheets engine, and Preact.
Every dependency in `package.json` is imported (verified by grep — no unused
Tiptap extensions, no unused libs), and the lockfile has no duplicate major
versions. There is no safe dead-weight to remove.

## Why the bundle isn't code-split

The build is a **single-file IIFE**:

    bun build src/index.tsx --outfile=../desk/app/documents/js.js --format=iife

The ship serves that one file via a build-time Clay import in
`desk/app/documents.hoon` (`/* documents-js %js /app/documents/js/js`), and
the service worker (`src/sw.ts`) precaches it by that one path. In IIFE
format a dynamic `import()` is **inlined** into the single file — so
`import()` reduces *parse-on-first-use* cost (as we do for the DOCX exporter)
but does **not** split the served bytes.

True multi-chunk code-splitting would require, together:
1. switching the build to ESM with multiple output chunks,
2. serving each chunk from the ship (a Clay import + HTTP route per chunk, or
   a generic `/drive/chunks/*` static route reading built files),
3. teaching the service worker to precache/cache the chunk set, and
4. bumping the cache-bust discipline to cover N files.

That's a real architecture change, not a config flip. Given the gzip size
(~229 KB) is well within range for a full Docs/Sheets/Notes/Drive suite —
Google Docs' own initial JS is several times larger — it was deliberately
left as a single file. Revisit if the bundle grows materially or if
initial-load latency becomes a measured problem.
