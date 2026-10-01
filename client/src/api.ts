import { nymToShip, shipToNym } from './mnemonym';
// All client→server actions go through HTTP POST to /drive/action.
// (Plain HTTP posts to an Eyre-bound path — no Eyre channel pokes.)

declare global {
  interface Window {
    __SHIP__?: string;
  }
}

export type DocType = 'text' | 'sheet' | 'note' | 'image' | 'file' | 'folder';

export type DocSummary = {
  id: string;
  title: string;
  type: DocType;
  owner: string;
  role: 'owner' | 'editor' | 'commenter' | 'viewer';
  modified: number;
  created: number;
  parent: string | null;
  blob: { mime: string; size: number } | null;
  acl: Array<{ who: string; role: string }>;
  starred?: boolean;
  // Shared spaces: the space-id this owned doc belongs to, or null
  // when it's a personal doc. Present on the listing's `owned` docs and on
  // folder-contents items; absent (undefined) on shared/mirrored entries.
  space?: string | null;
};

// Shared spaces (company collaboration). A space is a named,
// singly-hosted container whose member roster grants a doc-level role to every
// doc assigned to the space at once.
export type SpaceRole = 'viewer' | 'commenter' | 'editor' | 'admin' | 'owner';

// One entry in the listing's `spaces` array — a space the caller belongs to,
// carrying the caller's own role and a member count for the switcher.
export type SpaceSummary = {
  id: string;
  name: string;
  host: string; // "~bus"
  role: SpaceRole; // MY role in this space
  members: number; // member count
  created: number;
  // false = a space I HOST (real member count + created).
  // true  = a space I JOINED elsewhere (hosted on `host`); its roster isn't
  // mirrored, so `members` and `created` are 0 placeholders and its docs come
  // from the space-docs scry rather than the listing's `owned`.
  joined: boolean;
  // unread messages in this space's chatroom (peer-authored, since last read).
  unread: number;
};

// One chat message, in a space room or a DM thread. `author` and `peer` are
// ~-prefixed ship names; `at` is unix-ms.
export type ChatMsg = {
  id: string;
  author: string; // "~bus"
  text: string;
  at: number;
};

// A space room's recent messages (oldest-first) + our last-read stamp.
export type SpaceChat = {
  messages: ChatMsg[];
  read: number;
};

// One row in the DM inbox: a counterparty + a preview of the last message.
export type DmSummary = {
  peer: string; // "~bus"
  unread: number;
  'last-at': number;
  'last-text': string;
  'last-author': string;
};

// A full DM thread with one counterparty (oldest-first) + our last-read stamp.
export type DmThread = {
  peer: string;
  read: number;
  messages: ChatMsg[];
};

export type SpaceMember = {
  who: string; // "~bus" (WITH leading ~)
  role: SpaceRole;
};

// A PENDING invitation to a space — you've been invited but haven't accepted
// or declined yet. Surfaced in the listing's `spaceInvites`; `id` is the
// space-id, `host` the inviting ship (WITH leading ~), `role` the offered role.
export type SpaceInvite = {
  id: string;
  name: string;
  host: string; // "~bus"
  role: SpaceRole;
};

// Full roster for one space (the space/<id> scry).
export type SpaceDetail = {
  id: string;
  name: string;
  host: string;
  created: number;
  members: SpaceMember[];
};

export type Mirror = {
  id: string;
  title: string;
  type: string;
  owner: string;
  role: string;
  parent: string | null;
};

export type Listing = {
  owned: DocSummary[];
  shared: DocSummary[];
  mirrored: Mirror[];
  // Shared spaces the caller belongs to.
  spaces: SpaceSummary[];
  // Pending space invitations awaiting the caller's accept/decline.
  spaceInvites: SpaceInvite[];
  // Total unread DMs across all threads (drives the Messages rail badge).
  dmUnread: number;
  // peer @p (with leading ~) → nickname, shown everywhere in place of the @p.
  nicknames: Record<string, string>;
  // this ship's own nickname ('' if unset).
  myNickname: string;
};

export type FolderContents = { items: DocSummary[] };

export type Whoami =
  // Unauthenticated: the ship returns HTTP 200 `{"auth":"none"}` (no ship
  // field) when there's no valid session. This is an AFFIRMATIVE logout —
  // distinct from a network error — so app.tsx shows a login screen (and
  // purges any prior user's cached data) rather than the app shell.
  | { auth: 'none' }
  | { ship: string; auth: 'ship' }
  | {
      ship: string;
      auth: 'token';
      doc: string;
      role: 'owner' | 'editor' | 'commenter' | 'viewer';
      type: DocType;
      title: string;
    };

export type TokenInfo = { token: string; role: string; created: number };

export type Comment = {
  id: string;
  author: string;
  text: string;
  anchor: string;
  created: number;
  resolved: boolean;
};

// Generate an Urbit @uv-format identifier (`0v...`) usable as a comment-id.
// Base32 with the urbit alphabet (0-9, a-v). slav %uv requires dot-separated
// 5-char groups from the right, e.g. `0vabc.defgh.ijklm`.
export function genCommentId(): string {
  const alpha = '0123456789abcdefghijklmnopqrstuv';
  const N = 13;
  let body = '';
  for (let i = 0; i < N; i++) body += alpha[Math.floor(Math.random() * 32)];
  let s = '0v';
  for (let i = 0; i < N; i++) {
    s += body[i];
    const remaining = N - i - 1;
    if (remaining > 0 && remaining % 5 === 0) s += '.';
  }
  return s;
}

export const BASE = '/drive';

let _ship: string | null = null;

// Canonical ship form is `~`-prefixed (the form whoami returns). ui.html seeds
// `window.__SHIP__` from the hostname (`sampel-palnet`, NO `~`), so reads of it
// MUST be normalized — otherwise ourShip() returns different strings depending
// on its source and HttpProvider keys the per-doc IndexedDB under two different
// namespaces (offline-seeded vs. online), so an offline reload can't find the
// doc's cache. Idempotent: already-prefixed input is returned unchanged.
export const normalizeShip = (ship: string): string =>
  ship.startsWith('~') ? ship : `~${ship}`;

export async function initUrbit(): Promise<Whoami> {
  const r = await fetch(`${BASE}/api/whoami`, { credentials: 'include' });
  if (!r.ok) throw new Error('whoami failed');
  const w: Whoami = await r.json();
  _ship = w.auth === 'none' ? null : normalizeShip(w.ship);
  return w;
}

// Falls back to the cached ship (app.tsx publishes it to window.__SHIP__ on an
// offline boot) so the per-doc IndexedDB key is correct even without a live
// whoami — otherwise an offline reload opens a doc's cache under the wrong key.
// Both sources are normalized to the canonical `~`-prefixed form so the two
// paths agree on the IndexedDB namespace.
export const ourShip = (): string | null => {
  if (_ship) return _ship;
  const seed = typeof window !== 'undefined' ? window.__SHIP__ : undefined;
  return seed ? normalizeShip(seed) : null;
};

// Nickname cache: populated by listDocs(), read by displayName() everywhere.
// A module singleton (like _ship) so any component can resolve a @p → nickname
// without threading the map through props.
let _nicknames: Record<string, string> = {};

// A ship's display name: its nickname if one is known, else a comet's
// mnemonym (`.word.word…`), else the ~@p itself.  Display only: the @p stays
// what is sent, stored and compared.
export const displayName = (ship: string): string => {
  const key = normalizeShip(ship);
  const nick = _nicknames[key];
  return nick && nick.length ? nick : shipToNym(key) ?? key;
};

// What a person typed where a ship is expected (share, invite, join): a @p,
// with or without its ~, or a comet's mnemonym. Returns the bare @p (no ~),
// which is what the backend's slav %p wants. Throws on a mnemonym that does
// not decode, so a typo is reported instead of becoming a wrong ship.
export const shipFromInput = (raw: string): string => {
  const t = raw.trim();
  if (t.startsWith('.')) {
    const p = nymToShip(t);
    if (!p) throw new Error(`"${t}" is not a valid name`);
    return p.slice(1);
  }
  return t.replace(/^~/, '');
};

export const setNickname = (nick: string): Promise<void> =>
  postAction({ 'set-nickname': { nick } });

// This ship's own nickname ('' if unset), from the cache.
export const myNickname = (): string => {
  const me = ourShip();
  return me ? _nicknames[me] ?? '' : '';
};

async function postAction(action: unknown): Promise<void> {
  const r = await fetch(`${BASE}/action`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(action),
  });
  if (!r.ok) {
    const text = await r.text();
    throw new Error(`action failed: ${r.status} ${text}`);
  }
}

async function postTokenAction(action: unknown): Promise<void> {
  const r = await fetch(`${BASE}/token-action`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(action),
  });
  if (!r.ok) {
    const text = await r.text();
    throw new Error(`token-action failed: ${r.status} ${text}`);
  }
}

export async function listDocs(): Promise<Listing> {
  const r = await fetch(`/~/scry/drive/listing.json`, { credentials: 'include' });
  if (!r.ok) throw new Error('list failed');
  const j = await r.json();
  // The listing scry emits pending invitations under the hyphenated wire key
  // `space-invites`; surface them on the camelCase `spaceInvites` the client
  // reads. (owned/shared/mirrored/spaces already match the wire verbatim.)
  _nicknames = j['nicknames'] ?? {};
  return {
    ...j,
    spaceInvites: j['space-invites'] ?? [],
    dmUnread: j['dm-unread'] ?? 0,
    nicknames: j['nicknames'] ?? {},
    myNickname: j['my-nickname'] ?? '',
  } as Listing;
}

export async function listFolderContents(
  folderId: string | null,
): Promise<DocSummary[]> {
  const seg = folderId ?? 'root';
  const r = await fetch(`/~/scry/drive/folder/${seg}/contents.json`, {
    credentials: 'include',
  });
  if (!r.ok) throw new Error(`folder listing failed: ${r.status}`);
  const j: FolderContents = await r.json();
  return j.items ?? [];
}

export async function getTokens(docId: string): Promise<TokenInfo[]> {
  const r = await fetch(`/~/scry/drive/tokens/for/${docId}.json`, {
    credentials: 'include',
  });
  if (!r.ok) throw new Error(`token listing failed: ${r.status}`);
  const j = await r.json();
  return j.tokens ?? [];
}

export type TrashEntry = {
  id: string;
  title: string;
  type: DocType;
  parent: string | null;
  'trashed-at': number;
  'ttl-ms': number;
};

export async function listTrashed(): Promise<TrashEntry[]> {
  const r = await fetch('/~/scry/drive/trash.json', { credentials: 'include' });
  if (!r.ok) throw new Error(`trash listing failed: ${r.status}`);
  const j = await r.json();
  return (j.items ?? []) as TrashEntry[];
}

export const restoreDoc = (id: string) => postAction({ restore: id });
export const purgeDoc = (id: string) => postAction({ purge: id });
export const starDoc = (id: string, on: boolean) => postAction({ star: { id, on } });
export const saveVersion = (id: string, label: string, blob: number[]) =>
  postAction({ 'save-version': { id, label, blob } });
export const bulkDelete = (docs: string[]) => postAction({ 'bulk-delete': { docs } });
export const bulkRestore = (docs: string[]) => postAction({ 'bulk-restore': { docs } });
export const bulkPurge = (docs: string[]) => postAction({ 'bulk-purge': { docs } });
export const bulkMove = (docs: string[], newParent: string | null) =>
  postAction({ 'bulk-move': { docs, 'new-parent': newParent } });

export type HistoryEntry = {
  kind: 'snapshot' | 'update';
  seq?: number;
  idx?: number;
  size: number;
  author?: string;
  at?: number;
};

export type VersionInfo = {
  at: number;
  author: string;
  contributors: string[];
  label: string | null;
  size: number;
};

export async function listVersionCheckpoints(docId: string): Promise<VersionInfo[]> {
  const r = await fetch(`/~/scry/drive/doc/${docId}/versions.json`, {
    credentials: 'include',
  });
  if (!r.ok) throw new Error(`versions listing failed: ${r.status}`);
  const j = await r.json();
  return (j.versions ?? []) as VersionInfo[];
}

// Full encoded Y.Doc state for one checkpoint, addressed by its unix-ms `at`.
// A dedicated HTTP route (like /state, /blob) rather than the scry gateway.
export async function getVersionBlob(docId: string, at: number): Promise<number[] | null> {
  const r = await fetch(`${BASE}/version?id=${docId}&at=${at}`, {
    credentials: 'include',
  });
  if (!r.ok) throw new Error(`version blob failed: ${r.status}`);
  const j = await r.json();
  return (j?.blob ?? null) as number[] | null;
}

export type Usage = {
  docs: number;
  blobs: number;
  'update-bytes': number;
  'snapshot-bytes': number;
  'version-bytes': number;
  'blob-bytes': number;
  'total-bytes': number;
};

export async function getUsage(): Promise<Usage> {
  const r = await fetch('/~/scry/drive/usage.json', { credentials: 'include' });
  if (!r.ok) throw new Error(`usage failed: ${r.status}`);
  return r.json();
}

export async function listVersions(docId: string): Promise<HistoryEntry[]> {
  const r = await fetch(`/~/scry/drive/doc/${docId}/history.json`, {
    credentials: 'include',
  });
  if (!r.ok) throw new Error(`history listing failed: ${r.status}`);
  const j = await r.json();
  return (j.entries ?? []) as HistoryEntry[];
}

export const createDoc = (
  type: 'text' | 'sheet' | 'note',
  title: string,
  parent: string | null = null,
) => postAction({ create: { 'doc-type': type, title, parent } });

export const createFolder = (title: string, parent: string | null = null) =>
  postAction({ 'create-folder': { title, parent } });

export const renameDoc = (id: string, title: string) =>
  postAction({ rename: { id, title } });

export const deleteDoc = (id: string) => postAction({ delete: id });

export const moveItem = (id: string, newParent: string | null) =>
  postAction({ move: { id, parent: newParent } });

export const copyDoc = (id: string) => postAction({ copy: id });

export const shareDoc = (id: string, who: string, role: string) =>
  postAction({ share: { id, who, role } });

export const revokeShare = (id: string, who: string) =>
  postAction({ revoke: { id, who } });

export const mintToken = (id: string, role: string) =>
  postAction({ 'mint-token': { id, role } });

export const revokeToken = (token: string) =>
  postAction({ 'revoke-token': token });

export const subscribeRemote = (owner: string, id: string) =>
  // Strip a leading ~ — the backend's ship parser wants a bare @p. Callers
  // pass a display host like "~nec" (straight from the listing), which would
  // otherwise fail the action silently and open an empty doc.
  postAction({ 'subscribe-remote': { owner: owner.replace(/^~/, ''), id } });

export const addComment = (
  id: string,
  commentId: string,
  text: string,
  anchor: string,
) => postAction({ 'add-comment': { id, 'comment-id': commentId, text, anchor } });

export const resolveComment = (id: string, commentId: string) =>
  postAction({ 'resolve-comment': { id, 'comment-id': commentId } });

export const deleteComment = (id: string, commentId: string) =>
  postAction({ 'delete-comment': { id, 'comment-id': commentId } });

export async function listComments(docId: string): Promise<Comment[]> {
  const r = await fetch(`/~/scry/drive/comments/for/${docId}.json`, {
    credentials: 'include',
  });
  if (!r.ok) throw new Error(`comment listing failed: ${r.status}`);
  const j = await r.json();
  return (j.comments ?? []) as Comment[];
}

export const unsubscribeRemote = (id: string) =>
  postAction({ 'unsubscribe-remote': id });

// === Shared spaces ===============================================
//
// Roster scry for one space. Returns null when the space doesn't exist.
export async function getSpace(id: string): Promise<SpaceDetail | null> {
  const r = await fetch(`/~/scry/drive/space/${id}.json`, {
    credentials: 'include',
  });
  if (!r.ok) throw new Error(`space roster failed: ${r.status}`);
  const j = await r.json();
  // The scry emits JSON null when the space is unknown.
  return (j ?? null) as SpaceDetail | null;
}

export const createSpace = (name: string) =>
  postAction({ 'create-space': { name } });

export const renameSpace = (space: string, name: string) =>
  postAction({ 'rename-space': { space, name } });

// delete-space takes a BARE space-id string, not a wrapping object.
export const deleteSpace = (space: string) =>
  postAction({ 'delete-space': space });

// Join a space hosted on ANOTHER ship. Subscribes to the host's space channel;
// the joined space then shows up in the listing's `spaces` with `joined:true`.
// `host` MUST be sent bare (no leading ~) — strip it like the member wrappers.
export const joinSpace = (host: string, space: string) =>
  postAction({ 'join-space': { host: host.replace(/^~/, ''), space } });

// leave-space takes a BARE space-id string, like delete-space.
export const leaveSpace = (space: string) =>
  postAction({ 'leave-space': space });

// Doc rows for a JOINED (remote) space. Its docs live on the host, so they are
// NOT in the listing's `owned`; this scry returns them directly as a JSON array
// (each row's `owner` is the host ship). Empty until the host's burst lands.
export async function getSpaceDocs(space: string): Promise<DocSummary[]> {
  const r = await fetch(`/~/scry/drive/space-docs/${space}.json`, {
    credentials: 'include',
  });
  if (!r.ok) throw new Error(`space docs failed: ${r.status}`);
  const j = await r.json();
  return (j ?? []) as DocSummary[];
}

// Invite a ship to a space: the host adds it to the roster AND notifies it, so
// the invitee sees a pending invitation (vs. add-member's silent roster add).
// `who` MUST be sent bare (no leading ~) like the other member wrappers.
export const inviteToSpace = (space: string, who: string, role: SpaceRole) =>
  postAction({ 'invite-to-space': { space, who: who.replace(/^~/, ''), role } });

// Accept / decline a pending invitation. Both take a BARE space-id string
// (like delete-space / leave-space), not a wrapping object. Accept turns the
// space into a joined space; decline clears it and the host un-rosters you.
export const acceptSpaceInvite = (space: string) =>
  postAction({ 'accept-space-invite': space });

export const declineSpaceInvite = (space: string) =>
  postAction({ 'decline-space-invite': space });

// Member management. `who` MUST be sent bare (no leading ~) — the backend's
// ship parser rejects the tilde. Roster responses come back WITH the ~.
// Superseded in the members UI by inviteToSpace (silent add, no notify), but
// kept for programmatic/back-compat use.
export const addMember = (space: string, who: string, role: SpaceRole) =>
  postAction({ 'add-member': { space, who: who.replace(/^~/, ''), role } });

export const removeMember = (space: string, who: string) =>
  postAction({ 'remove-member': { space, who: who.replace(/^~/, '') } });

export const setMemberRole = (space: string, who: string, role: SpaceRole) =>
  postAction({ 'set-member-role': { space, who: who.replace(/^~/, ''), role } });

// Assign a doc to a space, or pass null to make it personal again.
export const setDocSpace = (id: string, space: string | null) =>
  postAction({ 'set-doc-space': { id, space } });

// === Chat: per-space rooms + 1:1 DMs =============================
//
// Post a message to a space's room. Works whether we host the space or joined
// it (the backend routes to the host, which is the single writer). `space` is
// a space-id (0v…). The message shows up when the room's fan-out lands.
export const postMessage = (space: string, text: string) =>
  postAction({ 'post-message': { space, text } });

// Delete a room message (author or space admin/owner). `id` is a msg-id.
export const deleteMessage = (space: string, id: string) =>
  postAction({ 'delete-message': { space, id } });

// Mark a space's room read (clears its unread badge). Takes a BARE space-id.
export const readSpace = (space: string) =>
  postAction({ 'read-space': space });

// Recent messages in a space room (oldest-first) + our last-read stamp.
export async function getSpaceChat(space: string): Promise<SpaceChat> {
  const r = await fetch(`/~/scry/drive/chat/${space}.json`, {
    credentials: 'include',
  });
  if (!r.ok) throw new Error(`space chat failed: ${r.status}`);
  const j = await r.json();
  return { messages: j?.messages ?? [], read: j?.read ?? 0 };
}

// Send a 1:1 DM. `to` is a ship; sent bare (the backend's ship parser rejects
// the ~). Delivered to the peer's ship + echoed to our own browsers.
export const sendDm = (to: string, text: string) =>
  postAction({ 'send-dm': { who: to.replace(/^~/, ''), text } });

// Delete a DM from OUR copy of the thread only (local). `id` is a msg-id.
export const deleteDm = (peer: string, id: string) =>
  postAction({ 'delete-dm': { who: peer.replace(/^~/, ''), id } });

// Mark a DM thread read (clears its share of the unread badge). Bare ship.
export const readDm = (peer: string) =>
  postAction({ 'read-dm': peer.replace(/^~/, '') });

// The DM inbox: one row per counterparty, most-recently-active first.
export async function getDms(): Promise<DmSummary[]> {
  const r = await fetch(`/~/scry/drive/dms.json`, { credentials: 'include' });
  if (!r.ok) throw new Error(`dms failed: ${r.status}`);
  const j = await r.json();
  return (j ?? []) as DmSummary[];
}

// The full DM thread with one counterparty (oldest-first). `peer` sent bare.
export async function getDmThread(peer: string): Promise<DmThread> {
  const seg = peer.replace(/^~/, '');
  const r = await fetch(`/~/scry/drive/dm/${seg}.json`, {
    credentials: 'include',
  });
  if (!r.ok) throw new Error(`dm thread failed: ${r.status}`);
  const j = await r.json();
  return { peer: j?.peer ?? peer, read: j?.read ?? 0, messages: j?.messages ?? [] };
}

export async function uploadFile(
  file: File,
  parent: string | null = null,
): Promise<string> {
  const title = file.name.replace(/\.[^.]+$/, '');
  const params = new URLSearchParams({ title });
  if (parent) params.set('parent', parent);
  const r = await fetch(`${BASE}/upload?${params.toString()}`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'content-type': file.type || 'application/octet-stream' },
    body: file,
  });
  if (!r.ok) throw new Error(`upload failed: ${r.status}`);
  const j = await r.json();
  return j.id;
}

// Create a doc inside a space. For a space we HOST it exists when this
// returns (it's in the next listing's `owned`). For a space we JOINED the
// host makes it, and it shows up in our space-docs when the host's
// %space-doc fact lands — so the id isn't returned here; SpaceView waits
// for the new id either way.
export async function createInSpace(
  space: string,
  type: 'text' | 'sheet' | 'note',
  title: string,
): Promise<void> {
  await postAction({ 'space-create': { space, 'doc-type': type, title } });
}

// Upload a file into a space. A hosted space stores it here and returns the
// id. A joined space cannot hold it (every space doc lives on the host), so
// the agent forwards the bytes to the host and answers 202 with no id; the
// doc appears in space-docs when the host announces it.
export async function uploadToSpace(file: File, space: string): Promise<string | null> {
  const title = file.name.replace(/\.[^.]+$/, '');
  const params = new URLSearchParams({ title, space });
  const r = await fetch(`${BASE}/upload?${params.toString()}`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'content-type': file.type || 'application/octet-stream' },
    body: file,
  });
  if (!r.ok) throw new Error(`upload failed: ${r.status}`);
  const j = await r.json();
  return typeof j.id === 'string' ? j.id : null;
}

// Store a client-generated image thumbnail (raw JPEG bytes) for a doc.
// Best-effort — grids fall back to /drive/blob when no thumb exists.
export async function uploadThumb(docId: string, jpegBytes: Uint8Array): Promise<void> {
  const r = await fetch(`${BASE}/thumb?id=${docId}`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'content-type': 'image/jpeg' },
    // fetch accepts a Uint8Array at runtime; the cast sidesteps the strict
    // lib's SharedArrayBuffer/ArrayBuffer BodyInit narrowing.
    body: jpegBytes as unknown as BodyInit,
  });
  if (!r.ok) throw new Error(`thumb upload failed: ${r.status}`);
}

// Live edits — split between ship-authed (postAction) and token-authed
// (postTokenAction). The provider chooses which based on auth mode.
export const submitUpdate = (
  id: string,
  update: number[],
  authMode: 'ship' | 'token',
) => {
  const body = { 'submit-update': { id, update } };
  return authMode === 'ship' ? postAction(body) : postTokenAction(body);
};

export const submitAwareness = (
  id: string,
  blob: number[],
  authMode: 'ship' | 'token',
) => {
  const body = { 'submit-awareness': { id, blob } };
  return authMode === 'ship' ? postAction(body) : postTokenAction(body);
};

export const submitSnapshot = (
  id: string,
  gen: number,
  covered: number,
  blob: number[],
  authMode: 'ship' | 'token',
) => {
  const body = { 'submit-snapshot': { id, gen, covered, blob } };
  return authMode === 'ship' ? postAction(body) : postTokenAction(body);
};

// Date helper — backend now sends unix-ms as plain numbers.
export const parseDocDate = (modifiedMs: number): Date | null => {
  if (!modifiedMs || !Number.isFinite(modifiedMs)) return null;
  const d = new Date(modifiedMs);
  return Number.isNaN(d.getTime()) ? null : d;
};

export const formatDate = (modifiedMs: number): string => {
  const d = parseDocDate(modifiedMs);
  if (!d) return '—';
  const now = new Date();
  const sameDay =
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate();
  if (sameDay) {
    return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  }
  const sameYear = d.getFullYear() === now.getFullYear();
  return d.toLocaleDateString([], {
    month: 'short',
    day: 'numeric',
    year: sameYear ? undefined : 'numeric',
  });
};
