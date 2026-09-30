# Groundwire Drive

A collaborative productivity suite for a whole company — shared docs, sheets,
and notes with real-time editing, self-hosted on Urbit. Conflict-free and
source-available. Internal desk/agent codename: `%drive`.

- **Documents** — Tiptap rich text with B/I/U/S, font family + size + color,
  highlight, headings, lists, task lists, indent/outdent, alignment, tables,
  inline images (drag/drop), blockquote, code, anchored comments, find &
  replace, a live outline pane, word/character count, paste-from-Word/Docs
  cleanup, a templates gallery, @-mention doc-to-doc links, and DOCX / HTML /
  Markdown / PDF export. Version history you can preview and restore.
- **Sheets** — virtualized 1000×26 grid (grows on demand), multiple sheet
  tabs with cross-sheet references, an incremental dependency-graph recalc
  engine (only dirty cells recompute), absolute refs (`$A$1`), fill-handle
  drag (formula-offset + numeric/date series), freeze rows/cols, number
  formatting (decimals, currency picker, date patterns), range selection,
  sort, CSV import/export, and 40+ functions incl. SUM/AVG/IF/IFERROR/
  VLOOKUP (exact + approximate)/XLOOKUP/INDEX/MATCH/SUMIF/SUMPRODUCT/
  COUNTA/TEXT/… Inserting or deleting a row/column rewrites formula
  references correctly.
- **Notes** — masonry cards with per-note color, labels (with filtering),
  pin, and archive; lazy-mounted per card.
- **Photos** — gallery with generated thumbnails (fast grid, full image on
  open).
- **Files** — folders + arbitrary uploads (image thumbnails) + sort/filter +
  bulk select + drag-and-drop move + right-click context menu + download a
  folder (and its subtree) as a ZIP.
- **Installable PWA** — service-worker offline shell (the app and your
  cached docs load with no network), manifest, add-to-home-screen.
- **Trash** — soft delete with 30-day auto-purge.
- **Live collab** — Yjs CRDT, peer cursors with names + ship labels,
  presence stack in the editor header, SSE auto-reconnect with exp backoff.
- **Sharing** — per-ship roles (viewer/commenter/editor/owner) + revocable
  share-link tokens for collaborators without a ship.
- **Chat** — a built-in chatroom per space (Files/**Chat** tabs) plus 1:1
  direct messages (the **Messages** view), with unread badges, live over SSE.
- **A11y + mobile** — keyboard nav, focus traps + focus-visible rings,
  truthful ARIA roles/labels, screen-reader live regions, responsive
  layout down to phones, Cmd+K command palette, `?` shortcuts help.

## Shared spaces (company collaboration)

Drive's headline idea: content can belong to a **space** — a named,
org-owned container — instead of a single person. That is what makes it a
*company* drive rather than a personal one.

- **Spaces** — a space is hosted on one ship (the company/team-lead ship) and
  has a **member roster** mapping each member `@p` to a role
  (`viewer` → `commenter` → `editor` → `admin` → `owner`). Membership grants
  access to **every** document in the space at once — no per-doc shares for
  team content. A doc is either in a space or personal; personal docs behave
  exactly the same.
- **Cross-ship, live** — a member on their own ship *joins* a space and sees
  its whole document list over a dedicated `/space/<id>` subscription; opening
  any doc streams it live and edits flow back, all authorized by space
  membership (not a per-doc grant). Adding/removing docs and roster changes
  propagate to members in real time.
- **Members add content too** — any `editor`+ member creates documents,
  sheets and notes in the space, or uploads files into it, from their own
  ship. The host makes and holds the doc (every doc in a space lives on the
  host) and announces it to the whole space, so the member sees their own
  addition arrive the same way everyone else does. `viewer`/`commenter`
  members read and comment only.
- **Invitations** — an owner/admin invites a `@p`; the invite lands in that
  person's inbox to **accept** (join) or **decline**. No out-of-band ids.
- **Roles & safety** — only `owner`/`admin` manage members or rename/delete a
  space; the last owner can't be removed; removing a member (or deleting the
  space) immediately revokes their access — including on documents they had
  open — and drops the space from their sidebar. A member's effective doc
  role is the *greater* of any personal share and their space role, so a
  space never weakens an explicit share.
- **Directory** — every member can see the roster (who's on the team and their
  role), on both hosted and joined spaces.

## Chat & messaging

The whole team already works in Drive, so conversation lives there too — no
second app to run.

- **Space rooms** — every space has a built-in chatroom, opened from the
  **Chat** tab next to Files. Any member can post; the host ship is the single
  writer and ordering authority, so everyone sees the same thread in the same
  order, with named authors. Messages fan out live to all members over the
  space's existing `/space/<id>` channel. An unread badge (on the space in the
  sidebar and on the tab) counts messages since you last looked; a message's
  author or a space admin can delete it.
- **Direct messages** — 1:1 DMs with any ship, from the **Messages** view in
  the sidebar. DMs are peer-to-peer: each side stores its own copy and messages
  are delivered ship-to-ship (no host, no membership — message anyone). The
  inbox lists every conversation with a preview and unread count, and a rail
  badge totals your unread DMs. On a phone it's a single pane at a time (inbox →
  thread → back).
- **Live + trustworthy** — new messages arrive over the same SSE stream as the
  rest of the app (auto-reconnect, catch-up on reconnect). Authors are
  cryptographic ship identities stamped by the receiving ship, so a sender
  can't be spoofed.

### Running Drive for a company

Because a space is hosted on one ship, that ship is your company's Drive:

1. **Pick a host ship** to hold the company's shared spaces — ideally an
   always-on ship (a hosted planet, or a moon under the company's star), since
   the space is reachable only while its host ship is online.
2. On the host, install Drive (see *Install* below) and create a space
   per team/department (Files → the **Spaces** switcher → **New space**).
3. **Invite members** by `@p` from the space's *Members* dialog. Each member
   installs Drive on their own ship, accepts the invite from their inbox,
   and the space appears in their sidebar. They edit from their own ship, and
   editors add their own documents and uploads to the space; the host holds
   the authoritative copy of all of it.
4. **Availability** mirrors the host ship's uptime — there is no third-party
   cloud. Owners keep an offline cache of docs they've opened (the PWA shell +
   IndexedDB); a space is otherwise reachable whenever its host is online.
   Run the host on reliable hosting for a company deployment.

Personal files, personal sharing, and share-links for people without a ship
all keep working alongside spaces — a member's own ship is still their
personal Drive.

## Install

```sh
# On your ship's dojo:
|new-desk %drive
|mount %drive
```

Then drop the contents of `desk/` into `~/path/to/your/ship/drive/` and
commit:

```sh
|commit %drive
|install our %drive
```

Visit `http://your-ship/drive` and log in with your `+code`.

To change the URL path the app binds to (default `/drive`), edit `site+/...`
in `desk/desk.docket-0` and the `%connect` card in `desk/app/drive.hoon`'s
`++ init`. Cache-bust strings in `desk/app/drive/ui.html` (`?v=...`) also
need bumping when you ship JS/CSS changes.

## Layout

```
drive/
  desk/                     Urbit desk: agent, marks, libs
    app/drive.hoon      The gall agent
    app/drive/          ui.html, js.js, css.css (compiled assets)
    sur/drive.hoon      Type definitions
    mar/drive/          Mark files (action, fact, pokes, notices)
    lib/                    Reused libs (server, schooner, ...)
    desk.bill, desk.docket-0, sys.kelvin
  client/                   JS frontend (Preact + Tiptap + Yjs)
    src/
      providers/            HttpProvider (ship-authed) and token provider (link)
      components/           Editor, SpaceView, ShareDialog, SpaceMembersDialog, ...
      api.ts, app.tsx, index.tsx
      styles/app.css
  scripts/                  fakeship harness + e2e drivers
  Makefile
```

## Dev workflow

```sh
# 1. Install JS deps and build the bundles
make install
make build           # typecheck + bundle into desk/app/drive/{js.js,css.css}
make watch           # watch mode

# 2. Boot a fakeship (foreground, with dojo)
./scripts/setup-fakeship.sh bus 8091

# 3. From a separate terminal, install the desk into the running ship.
#    (Or use ./scripts/smoke-test.sh to do it headlessly.)
```

## Testing

```sh
make check           # tsc --noEmit + bun unit tests (~1s, no ship needed)
make e2e             # single-ship API e2e against a cloned golden pier (~40s warm)
make e2e2            # two-ship cross-ship e2e (~nec host + ~bus member)
make e2e-migration   # prove state migrations against a frozen pre-upgrade pier
make e2e-browser     # Playwright layer: offline durability, save-failed UI,
                     # live collab, sheet formulas — things only a browser proves
make golden          # (re)build the cached golden piers in .piers/golden/
```

- **Unit tests** are colocated `client/src/**/*.test.ts` (bun test); they cover
  the sheets formula engine, cell formats, CSV, markdown export, routing, the
  spaces logic, and the Yjs reconcile helpers.
- **e2e** boots real fakeships: golden piers are booted+installed once, then
  APFS-cloned per run, so warm runs are fast and hermetic. The harness uses
  ~nec/~bus (never ~zod — a fake ~zod binds UDP 31337 and collides with any
  other fake ~zod on the machine). Never pass `-p`/an ames port to a fakeship
  you want other fakeships to reach.

## Architecture

```
┌──────────────────┐                     ┌──────────────────┐
│  Alice's browser │                     │   Bob's browser  │
│   Tiptap + Yjs   │                     │   Tiptap + Yjs   │
└────────┬─────────┘                     └────────┬─────────┘
         │ Eyre / HTTP + SSE                      │ Eyre / HTTP + SSE
         ▼                                        ▼
┌──────────────────┐         Ames           ┌──────────────────┐
│  ~alice  %docs   │ ───── pokes ──────►    │  ~bob   %docs    │
│  (member/mirror) │ ◄── subscriptions ──── │  (host/canonical)│
└──────────────────┘                        └──────────────────┘

Link-token user (no ship):
   browser → host ship over HTTPS, SSE for live updates, POST for edits.
```

Yjs binary updates flow opaquely through the ship as sized octs; the agent
never inspects them. Compaction: past 500 buffered updates the agent asks a
connected client (at submit time, at SSE connect, and on /state reads) to
encode the merged Y.Doc and post it back as `%submit-snapshot [gen covered
blob]` — stale generations are dropped and only the `covered` oldest updates
are truncated, so edits that race the encode survive. Member-ship edits ride
a sequenced outbox: nacks retry with backoff, then surface "save failed" in
the browser, and the outbox replays when access returns. Browsers keep every
doc in IndexedDB and push a precise state-vector diff on reconnect, so
offline edits are never lost.

## License

Source-available. See [LICENSE](desk/LICENSE).
