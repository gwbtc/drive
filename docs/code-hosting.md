# Code hosting in Drive — design & rationale

> Groundwire wants to get off GitHub the same way it got off Google Drive: by
> hosting the thing itself, on ships it owns, with collaboration that federates
> peer-to-peer instead of through a central service.

This document explains **what** we're building, the **decisions** behind it, and
**why** — so the implementation (and this PR) can be reviewed against a clear
intent rather than reverse-engineered.

## What "getting off GitHub" actually means

GitHub is three products wearing one logo:

1. **A git host** — somewhere to `push`/`clone`/`pull` your repositories.
2. **A collaboration layer** — pull requests, code review, issues, discussions.
3. **A network** — the social graph and discoverability of "everyone's on GitHub."

Git itself is already decentralized: any two git remotes can exchange history
with no central server. So the git *host* is not the lock-in — the
**collaboration layer** and the **network** are. A credible replacement must
therefore:

- **Keep developers' git workflow byte-for-byte intact.** If engineers can't
  `git clone`/`git push`/`git pull` with the tools they already use, adoption is
  dead. We do not invent a new VCS.
- **Replace the collaboration layer** (issues, pull requests, review) with
  something self-hosted.
- **Turn the network inside-out.** Instead of one central hub, every ship hosts
  its own repositories and collaboration federates **ship-to-ship over Ames** —
  the thing GitHub structurally cannot do and Urbit is uniquely good at.

## Decision 1 — Speak real git, don't invent a protocol

**We implement the actual git protocol** (the git object model + the
smart-HTTP transport), not a Drive-native "new VCS."

Why:

- The entire point is to preserve developers' existing workflow. `git clone
  http://your-ship/code/repo` and `git push` must Just Work with stock,
  unmodified git. A new protocol would force every engineer to relearn version
  control and abandon the entire git ecosystem (hooks, CI, `git log`, `git
  bisect`, editor integrations). That's not "getting off GitHub," it's "getting
  off git" — a strictly worse product.
- Git's data model is *good*: a content-addressed object store (blobs, trees,
  commits, tags keyed by the SHA-1 of their contents) with refs (branches/tags)
  as named pointers to commits. It is small, well-specified, and maps cleanly
  onto a Gall agent's state. There is no reason to reinvent it — the "dumb text
  store" temptation the brief warns against is exactly what a home-grown VCS
  would collapse into.
- Speaking real git means the ship *is* a git remote. Everything downstream
  (mirrors, forks, CI pulling from the ship) works for free.

The cost is that we must implement git's wire formats exactly: the loose-object
hashing, pkt-line framing, the packfile format, and the smart-HTTP
negotiation. That work is done once and is the foundation everything else sits
on. (See *Protocol* below.)

## Decision 2 — A Gall agent, not Clay

Urbit already ships a revision-control system: **Clay**, the typed filesystem
with desks, marks, and a built-in merge engine. The obvious-but-wrong move is to
store git repos *as* Clay desks and lean on Clay's merge.

**We store git objects in a dedicated Gall agent (`%code`) instead.** Reasons:

- **Impedance mismatch.** Git is content-addressed by SHA-1 over a specific byte
  serialization; Clay hashes and merges on its own terms (mark-aware,
  line-based, its own object identity). To serve a byte-identical `git clone`,
  we need git's exact hashes and object bytes — Clay would be fighting us for
  control of identity and merge the whole way. Mapping git's DAG onto Clay's
  desk/tako/yaki model is a translation layer with no payoff.
- **Clay contains dragons.** Kelvin versioning, mandatory marks for every file
  type, the merge engine's edge cases, tombstoning, and `%base`-desk coupling
  are real operational hazards. A Gall agent is a clean slate: git objects are
  just nouns in a `(map @ux object)`, refs are a `(map path @ux)`, and we own
  the HTTP surface via Eyre. Full control, no merge engine to appease.
- **The collaboration layer wants app semantics anyway.** Issues, pull requests,
  review threads, and cross-ship subscriptions are Gall-agent-shaped (pokes,
  subscriptions, SSE to the browser) — the same machinery Drive already uses for
  spaces and docs. Putting the repo store in the same place as the collaboration
  state keeps it coherent.

Clay's merge is genuinely good *for Clay's use case* (syncing Urbit desks). It
is the wrong tool for "be a bit-compatible git server," which is our
requirement.

## Decision 3 — Federated, not centralized

Each repository is **hosted on one ship** (its owner's) and has a **collaborator
roster** — the same role model Drive already uses for spaces
(`reader → writer → maintainer → owner`). Collaboration federates:

- A collaborator on another ship **subscribes** to the repo over Ames and
  mirrors its refs, issues, and pull requests, exactly the way a member joins a
  Drive space today (`/repo/<name>` subscription, `%repo-*` facts). Opening an
  issue or a PR on a mirror forwards to the host, which is the single writer and
  fans the result back to every subscriber — the proven owner/mirror pattern
  from the docs collaboration.
- This is the structural win over GitHub: **no central server owns your code or
  your issues.** The repo lives on your ship; people follow it peer-to-peer. If
  Groundwire's ship is the host, Groundwire owns the whole thing — history,
  reviews, and access control — with no third party in the loop.

## Decision 4 — It lives in Drive, in spaces

Repositories are first-class alongside docs, sheets, and notes, and belong to
**spaces**. A team's space already has the right people with the right roles; its
repos inherit that membership, so "who can push to this repo" is answered by the
same roster that answers "who can edit this doc." Repos surface in the same SPA
(a **Code** section), so there's one workspace, one login, one access model.

Architecturally the git store + collaboration is a **separate agent** (`%code`)
in the **same desk** — it doesn't bloat the 4k-line `%drive` agent and is
independently reviewable, but it installs and ships as one product.

---

## Architecture

```
 git CLI  ──smart-HTTP──▶  Eyre  ──▶  %code agent  ◀──Ames──▶  %code on peer ships
 (clone/push/pull)         /code            │  (git object store,      (mirrors: refs,
                                            │   refs, issues, PRs)      issues, PRs)
 browser (Drive SPA) ──▶ /~/scry/code, POST /code/action, /code/sse
   Code section: repo list · file & commit browser · issues · pull requests
```

### The git object store

Git objects are stored content-addressed, exactly as git defines them:

- An object's identity is `SHA-1("<type> <size>\0<raw-content>")` where `type ∈
  {blob, tree, commit, tag}`. We compute this with Hoon's jetted `shan` (verified
  to produce git-identical digests, e.g. `(shan 0)` = SHA-1 of the empty string
  = `da39a3ee…afd80709`).
- Objects live in a `(map @ux object)` keyed by that hash. `object` is a tagged
  union carrying the parsed structure (a commit's tree/parents/author/message; a
  tree's mode/name/hash entries; a blob's bytes; a tag).
- **Refs** are a `(map path @ux)` (`refs/heads/main → <commit>`), plus a symbolic
  `HEAD`.

This is the minimal, canonical git model — nothing home-grown.

### Transport: smart HTTP

We implement git's **smart-HTTP v1** transport under `/code/<repo>`:

| Endpoint | Purpose |
|---|---|
| `GET  /code/<repo>/info/refs?service=git-upload-pack` | clone/fetch: advertise refs |
| `POST /code/<repo>/git-upload-pack` | clone/fetch: negotiate + send a packfile |
| `GET  /code/<repo>/info/refs?service=git-receive-pack` | push: advertise refs |
| `POST /code/<repo>/git-receive-pack` | push: receive a packfile + update refs |

The moving parts we implement at the byte level:

- **pkt-line** framing (4-hex length prefix; `0000` flush; `0001` delim).
- **Packfile generation** for clone/fetch. Crucially, we generate objects
  **undeltified** (types 1–4 only, no delta objects) — a fully-valid packfile
  that stock git accepts — which sidesteps having to *produce* deltas.
- **zlib framing without a zlib jet.** Urbit has no zlib. Git object data is
  zlib (RFC 1950) around DEFLATE. For the data we *emit* (loose objects and pack
  entries), we use DEFLATE **stored/uncompressed blocks** (`BTYPE=00`) wrapped in
  a zlib header + Adler-32 trailer. Stored blocks are trivial to produce and
  every git client inflates them correctly — so we get a spec-compliant zlib
  stream with no compressor.
- **SHA-1** via `shan` for object ids and the packfile trailer.

That set is sufficient for a real `git clone` of a repo the ship stores.

**Push** additionally requires *parsing* a packfile the client sends, whose
object data the client zlib-*compresses*. Reading that means DEFLATE **inflate**.
Our approach, in order of preference:

1. Configure the client's push to skip compression (`git -c pack.compression=0
   push …`, documentable as a per-remote setting), which makes the client emit
   zlib streams using only **stored** DEFLATE blocks — the same trivial format we
   already generate — so parsing needs no Huffman decoder.
2. A general DEFLATE inflater (fixed + dynamic Huffman) so unmodified `git push`
   works with default compression. This is bounded, well-specified work; it's the
   one remaining piece to make push friction-free and is tracked below.

Deltas on push (`ref-delta`/`ofs-delta`) are resolved by applying git's
copy/insert delta instructions to the referenced base object.

### Collaboration layer (Drive-native, federated)

On top of the git store, as `%code` state + Ames facts + SSE (mirroring Drive's
spaces/docs patterns):

- **Repositories** — create/rename/delete; a collaborator roster with roles;
  membership from the enclosing space; default branch.
- **Browsing** — scries render the repo tree, a file's blob, a branch's commit
  log, and a commit's diff — so the whole repo is navigable in the browser
  without cloning.
- **Issues** — open/close, comment threads, labels; author = the ship (Ames
  `src`, unspoofable).
- **Pull requests** — propose merging one ref into another with a computed diff,
  a review thread, and a server-side **merge** (fast-forward, and a three-way
  merge for non-conflicting histories) that writes a new commit + advances the
  ref.
- **Federation** — a collaborator on another ship subscribes to `/repo/<id>` and
  mirrors refs + issues + PRs; writes forward to the host and fan back to all
  subscribers. Same owner/mirror model as Drive docs.

### Access model

`max(space-membership role, per-repo collaborator role)` — identical in spirit to
Drive's doc authorization. `reader` can clone + read issues/PRs; `writer` can
push + open issues/PRs; `maintainer` can merge PRs + manage labels; `owner` can
manage collaborators + delete. Git read/write over smart-HTTP is gated by the
same roles (an unauthenticated or reader-only clone is allowed per repo
visibility; push requires `writer`).

---

## Implementation status (this PR)

**A stock `git clone` from an Urbit ship works.** `scripts/e2e-git-clone.sh`
creates a repo, commits two files through `%code`'s actions, then runs
**unmodified `git` (2.39.5)** against the ship and clones it — correct file
contents, a real `git log`, `object-format sha256`. That's the headline: the
ship *is* a git remote.

**Implemented & working:**

- **The `%code` agent** (`desk/app/code.hoon`) — builds, boots, binds `/code`,
  stores git objects, and serves the smart-HTTP transport. It runs alongside
  `%drive` on the same desk.
- **The git codec** (`desk/lib/git.hoon`) — object serialization (the
  `"<type> <size>\0"` loose form), **SHA-256** object hashing, tree
  serialization with git's exact mode/sort rules, commit building, **packfile
  v2 generation** (undeltified — which stock git accepts), **zlib framing via
  DEFLATE stored blocks** (no compressor needed), Adler-32, and **pkt-line**
  framing. Verified against git's canonical object ids in-agent.
- **Repo lifecycle** — `create-repo`, `commit-files` (build blob+tree+commit
  objects and advance a branch), collaborator management; a repos scry.
- **Smart-HTTP clone** — `GET …/info/refs?service=git-upload-pack` and
  `POST …/git-upload-pack`, wired to the codec.
- **Tests** — `e2e-single` adds `/code/ping`, the repos scry, and the git object
  hashing self-test (55 pass / 0 fail); `e2e-git-clone.sh` is the full stock-git
  clone proof.

**Three findings that any git-in-Hoon effort will hit (resolved here):**

1. **Jetted crypto is unavailable in a gall `on-peek` (scry).** `shan`/`shay`
   bail there on real input, so all hashing runs in **poke/HTTP-handler
   context** (object-creation actions; the upload-pack route) — never a scry.
2. **SHA-256, not SHA-1.** Urbit's SHA-1 `shan` takes a bare atom and infers
   length from `met`, which silently drops the trailing NUL in `"blob 0\0"` —
   unusable. SHA-256 `shay` is **length-aware** (`shay [len dat]`), so it's
   correct for every byte string. Git supports it natively via
   `object-format=sha256`, which `%code` advertises. (`shay` returns a
   little-endian digest; we reverse to git's big-endian id.)
3. **A secondary agent needs three arms the desk-named agent got for free** —
   `on-arvo` to ignore eyre's `%connect` ack, `on-watch` to accept eyre's
   `/http-response` subscription (else HTTP 500), and correct startup from
   `desk.bill`. All handled in `%code`.

**Auth:** `%code`'s `/code` binding is authenticated, so the clone passes the
ship's session cookie via `git -c http.extraHeader=…` (fine for a company's own
developers). Truly-public (no-auth) clone — matching how `%drive` serves its
docket site — is the next ergonomic step.

## What's designed but not yet built

The collaboration layer — **issues, pull requests, code review, and cross-ship
federation over Ames** — is specified above and typed in `sur/code.hoon`, with
action stubs in `%code`, but not yet implemented. It follows the exact
owner/mirror + SSE patterns `%drive` already uses for spaces and docs. Also
pending: **`git push`** (receive-pack — needs a DEFLATE *inflater* and ref-delta
resolution, per the design), subtree/nested-path commits (current
`commit-files` writes a flat tree), and the browser Code UI.

## Non-goals (for now)

- Git LFS, submodules, and shallow/partial clone negotiation beyond the basics.
- A full merge-conflict resolution UI (server does clean/fast-forward merges;
  conflicts are reported for the author to resolve locally and push).
- CI/CD execution (out of scope; the repo is the substrate a CI ship could pull
  from).
