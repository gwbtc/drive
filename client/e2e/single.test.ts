// Single-ship API-level e2e suite. Requires a live fakeship with the
// %drive desk installed; run via scripts/e2e-single.sh, which supplies:
//   SHIP_URL  http://localhost:<port>
//   SHIP_NAME zod
//   COOKIE    urbauth-~zod=<...>   (ship-auth cookie header value)
//
// These tests speak the same HTTP protocol as client/src/api.ts and use the
// real Yjs library to produce genuine update blobs, so they exercise the
// full Eyre → agent → state → JSON path without a browser.

import { describe, test, expect } from 'bun:test';
import * as Y from 'yjs';
import { SseReader, waitFor } from './sse';

const BASE = process.env.SHIP_URL ?? '';
const SHIP_NAME = process.env.SHIP_NAME ?? 'nec';
const COOKIE = process.env.COOKIE ?? '';
if (!BASE || !COOKIE) {
  throw new Error('SHIP_URL and COOKIE env vars required (use scripts/e2e-single.sh)');
}

// Unique suffix per run so specs never collide with leftovers on a reused pier.
const RUN = Math.random().toString(36).slice(2, 8);

// ---------- HTTP helpers ----------

const authed = (extra: HeadersInit = {}): HeadersInit => ({
  cookie: COOKIE,
  ...extra,
});

async function action(body: unknown): Promise<Response> {
  return fetch(`${BASE}/drive/action`, {
    method: 'POST',
    headers: authed({ 'content-type': 'application/json' }),
    body: JSON.stringify(body),
  });
}

async function actionOk(body: unknown): Promise<void> {
  const r = await action(body);
  if (!r.ok) throw new Error(`action ${JSON.stringify(body)} → ${r.status} ${await r.text()}`);
}

async function scry(path: string): Promise<any> {
  const r = await fetch(`${BASE}/~/scry/drive/${path}.json`, { headers: authed() });
  if (!r.ok) throw new Error(`scry ${path} → ${r.status}`);
  return r.json();
}

async function docState(id: string, cookie: string = COOKIE): Promise<any> {
  const r = await fetch(`${BASE}/drive/state?id=${id}`, { headers: { cookie } });
  if (!r.ok) throw new Error(`/state ${id} → ${r.status}`);
  return r.json();
}

async function createDoc(
  type: 'text' | 'sheet' | 'note',
  title: string,
  parent: string | null = null,
): Promise<string> {
  await actionOk({ create: { 'doc-type': type, title, parent } });
  const listing = await scry('listing');
  const doc = (listing.owned as any[]).find((d) => d.title === title);
  if (!doc) throw new Error(`created doc "${title}" not in listing`);
  return doc.id;
}

async function createFolder(title: string, parent: string | null = null): Promise<string> {
  await actionOk({ 'create-folder': { title, parent } });
  const listing = await scry('listing');
  const doc = (listing.owned as any[]).find((d) => d.title === title);
  if (!doc) throw new Error(`created folder "${title}" not in listing`);
  return doc.id;
}

const encodeText = (text: string): number[] => {
  const d = new Y.Doc();
  d.getText('t').insert(0, text);
  return Array.from(Y.encodeStateAsUpdate(d));
};

const rebuildText = (state: any): string => {
  const d = new Y.Doc();
  if (state.snapshot?.length) Y.applyUpdate(d, new Uint8Array(state.snapshot));
  for (const u of state.updates ?? []) {
    if (u?.length) Y.applyUpdate(d, new Uint8Array(u));
  }
  return d.getText('t').toString();
};

// ---------- specs ----------

describe('health & identity', () => {
  test('health reports agent + state version', async () => {
    const r = await fetch(`${BASE}/drive/api/health`, { headers: authed() });
    expect(r.ok).toBe(true);
    const j = await r.json();
    expect(j.agent ?? j.ok ?? j.version).toBeDefined();
  });

  test('whoami sees ship auth', async () => {
    const r = await fetch(`${BASE}/drive/api/whoami`, { headers: authed() });
    expect(r.ok).toBe(true);
    const j = await r.json();
    expect(j.auth).toBe('ship');
    expect(typeof j.ship).toBe('string');
  });

  test('unauthenticated action is rejected', async () => {
    const r = await fetch(`${BASE}/drive/action`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ create: { 'doc-type': 'text', title: 'nope', parent: null } }),
    });
    expect(r.status).toBe(401);
  });
});

describe('documents CRUD + listing', () => {
  test('create appears in listing with correct type', async () => {
    const id = await createDoc('text', `e2e-crud-${RUN}`);
    const listing = await scry('listing');
    const doc = (listing.owned as any[]).find((d) => d.id === id);
    expect(doc.type).toBe('text');
    expect(doc.parent).toBeNull();
  });

  test('rename is reflected in listing', async () => {
    const id = await createDoc('text', `e2e-rename-${RUN}`);
    await actionOk({ rename: { id, title: `e2e-renamed-${RUN}` } });
    const listing = await scry('listing');
    const doc = (listing.owned as any[]).find((d) => d.id === id);
    expect(doc.title).toBe(`e2e-renamed-${RUN}`);
  });

  test('folders: create, move into, folder-contents scry', async () => {
    const folder = await createFolder(`e2e-folder-${RUN}`);
    const doc = await createDoc('note', `e2e-infolder-${RUN}`);
    await actionOk({ move: { id: doc, parent: folder } });

    const contents = await scry(`folder/${folder}/contents`);
    const ids = (contents.items as any[]).map((d) => d.id);
    expect(ids).toContain(doc);

    // Root no longer contains the moved doc.
    const root = await scry('folder/root/contents');
    expect((root.items as any[]).map((d) => d.id)).not.toContain(doc);
  });
});

describe('Yjs update round-trip', () => {
  test('submitted update is replayed intact from /state', async () => {
    const id = await createDoc('text', `e2e-yjs-${RUN}`);
    const text = `hello from e2e ${RUN}`;
    await actionOk({ 'submit-update': { id, update: encodeText(text) } });

    const state = await docState(id);
    expect(rebuildText(state)).toBe(text);
  });

  test('sequential updates from two docs converge', async () => {
    const id = await createDoc('text', `e2e-yjs2-${RUN}`);

    // Two independent clients build on each other's state, like real collab.
    const a = new Y.Doc();
    a.getText('t').insert(0, 'alpha ');
    const upA = Y.encodeStateAsUpdate(a);
    await actionOk({ 'submit-update': { id, update: Array.from(upA) } });

    const b = new Y.Doc();
    Y.applyUpdate(b, upA);
    b.getText('t').insert(6, 'beta');
    const upB = Y.encodeStateAsUpdate(b, Y.encodeStateVector(a));
    await actionOk({ 'submit-update': { id, update: Array.from(upB) } });

    const state = await docState(id);
    expect(rebuildText(state)).toBe('alpha beta');
  });
});

describe('SSE live facts', () => {
  test('update fact is delivered to an open stream', async () => {
    const id = await createDoc('text', `e2e-sse-${RUN}`);
    const sse = new SseReader(`${BASE}/drive/sse?id=${id}`, COOKIE);
    try {
      // Give the subscription a moment to register server-side.
      await new Promise((r) => setTimeout(r, 2000));
      await actionOk({ 'submit-update': { id, update: encodeText('live!') } });
      const fact = await waitFor(() => sse.facts('update')[0], 25000);
      const d = new Y.Doc();
      Y.applyUpdate(d, new Uint8Array(fact.update));
      expect(d.getText('t').toString()).toBe('live!');
    } finally {
      await sse.close();
    }
  });

  test('unauthenticated SSE is rejected', async () => {
    const id = await createDoc('text', `e2e-sse-auth-${RUN}`);
    const r = await fetch(`${BASE}/drive/sse?id=${id}`, {
      headers: { accept: 'text/event-stream' },
    });
    expect(r.status).toBe(401);
    // Drain/cancel body so the connection doesn't linger.
    await r.body?.cancel();
  });
});

describe('comments', () => {
  const cid = (n: number) => `0v${n}.00000.00000`;

  test('add, list, resolve, delete', async () => {
    const id = await createDoc('text', `e2e-comments-${RUN}`);
    await actionOk({
      'add-comment': { id, 'comment-id': cid(1), text: 'first!', anchor: 'hello' },
    });
    await actionOk({
      'add-comment': { id, 'comment-id': cid(2), text: 'second', anchor: '' },
    });

    let comments = (await scry(`comments/for/${id}`)).comments as any[];
    expect(comments.length).toBe(2);
    const first = comments.find((c) => c.text === 'first!');
    expect(first.anchor).toBe('hello');
    expect(first.resolved).toBe(false);

    await actionOk({ 'resolve-comment': { id, 'comment-id': first.id } });
    comments = (await scry(`comments/for/${id}`)).comments as any[];
    expect(comments.find((c) => c.id === first.id).resolved).toBe(true);

    await actionOk({ 'delete-comment': { id, 'comment-id': first.id } });
    comments = (await scry(`comments/for/${id}`)).comments as any[];
    expect(comments.length).toBe(1);
  });
});

describe('share-link tokens', () => {
  async function mintAndOpen(id: string, role: string) {
    await actionOk({ 'mint-token': { id, role } });
    const tokens = (await scry(`tokens/for/${id}`)).tokens as any[];
    const token = tokens[tokens.length - 1].token as string;

    const r = await fetch(`${BASE}/drive/t?k=${token}`, { redirect: 'manual' });
    expect(r.status).toBe(302);
    const setCookie = r.headers.get('set-cookie') ?? '';
    const m = setCookie.match(/drive-session=[^;]+/);
    expect(m).not.toBeNull();
    return { token, session: m![0] };
  }

  test('editor token: entry, state read, live edit', async () => {
    const id = await createDoc('text', `e2e-tok-ed-${RUN}`);
    const { session } = await mintAndOpen(id, 'editor');

    // Token session can read state…
    const state = await docState(id, session);
    expect(state).toBeDefined();

    // …and submit edits through /token-action.
    const r = await fetch(`${BASE}/drive/token-action`, {
      method: 'POST',
      headers: { cookie: session, 'content-type': 'application/json' },
      body: JSON.stringify({ 'submit-update': { id, update: encodeText('via token') } }),
    });
    expect(r.ok).toBe(true);
    expect(rebuildText(await docState(id))).toBe('via token');
  });

  test('viewer token cannot edit', async () => {
    const id = await createDoc('text', `e2e-tok-view-${RUN}`);
    const { session } = await mintAndOpen(id, 'viewer');
    const r = await fetch(`${BASE}/drive/token-action`, {
      method: 'POST',
      headers: { cookie: session, 'content-type': 'application/json' },
      body: JSON.stringify({ 'submit-update': { id, update: encodeText('nope') } }),
    });
    expect(r.status).toBe(403);
  });

  test('token session cannot touch a different doc', async () => {
    const a = await createDoc('text', `e2e-tok-a-${RUN}`);
    const b = await createDoc('text', `e2e-tok-b-${RUN}`);
    const { session } = await mintAndOpen(a, 'editor');
    const r = await fetch(`${BASE}/drive/token-action`, {
      method: 'POST',
      headers: { cookie: session, 'content-type': 'application/json' },
      body: JSON.stringify({ 'submit-update': { id: b, update: encodeText('sneaky') } }),
    });
    expect(r.status).toBe(403);
    // And /state for the other doc is denied too.
    const s = await fetch(`${BASE}/drive/state?id=${b}`, { headers: { cookie: session } });
    expect(s.status).toBe(401);
  });

  test('revoked token: link dead, sessions killed', async () => {
    const id = await createDoc('text', `e2e-tok-rev-${RUN}`);
    const { token, session } = await mintAndOpen(id, 'editor');

    await actionOk({ 'revoke-token': token });

    const entry = await fetch(`${BASE}/drive/t?k=${token}`, { redirect: 'manual' });
    expect(entry.status).toBe(404);
    const s = await fetch(`${BASE}/drive/state?id=${id}`, { headers: { cookie: session } });
    expect(s.status).toBe(401);
  });
});

describe('trash lifecycle', () => {
  test('delete → trash listing → restore', async () => {
    const id = await createDoc('text', `e2e-trash-${RUN}`);
    await actionOk({ delete: id });

    let trash = (await scry('trash')).items as any[];
    expect(trash.map((t) => t.id)).toContain(id);
    // Gone from the live listing.
    let listing = await scry('listing');
    expect((listing.owned as any[]).map((d) => d.id)).not.toContain(id);

    await actionOk({ restore: id });
    trash = (await scry('trash')).items as any[];
    expect(trash.map((t) => t.id)).not.toContain(id);
    listing = await scry('listing');
    expect((listing.owned as any[]).map((d) => d.id)).toContain(id);
  });

  test('purge is permanent', async () => {
    const id = await createDoc('text', `e2e-purge-${RUN}`);
    await actionOk({ delete: id });
    await actionOk({ purge: id });
    const trash = (await scry('trash')).items as any[];
    expect(trash.map((t) => t.id)).not.toContain(id);
    const listing = await scry('listing');
    expect((listing.owned as any[]).map((d) => d.id)).not.toContain(id);
  });
});

describe('listing feed', () => {
  test('a create fires a listing fact on the feed stream', async () => {
    const sse = new SseReader(`${BASE}/drive/sse?feed=listing`, COOKIE);
    try {
      await new Promise((r) => setTimeout(r, 2000)); // let it register
      await createDoc('text', `e2e-feed-${RUN}`);
      const fact = await waitFor(
        () => (sse.facts('listing').length > 0 ? true : undefined),
        25000,
      );
      expect(fact).toBe(true);
    } finally {
      await sse.close();
    }
  });

  test('unauthenticated listing feed is rejected', async () => {
    const r = await fetch(`${BASE}/drive/sse?feed=listing`, {
      headers: { accept: 'text/event-stream' },
    });
    expect(r.status).toBe(401);
    await r.body?.cancel();
  });
});

describe('starring', () => {
  test('star round-trips in the listing', async () => {
    const id = await createDoc('text', `e2e-star-${RUN}`);
    let doc = ((await scry('listing')).owned as any[]).find((d) => d.id === id);
    expect(doc.starred).toBe(false);

    await actionOk({ star: { id, on: true } });
    doc = ((await scry('listing')).owned as any[]).find((d) => d.id === id);
    expect(doc.starred).toBe(true);

    await actionOk({ star: { id, on: false } });
    doc = ((await scry('listing')).owned as any[]).find((d) => d.id === id);
    expect(doc.starred).toBe(false);
  });
});

describe('make a copy', () => {
  test('copy duplicates content but not comments', async () => {
    const id = await createDoc('text', `e2e-copysrc-${RUN}`);
    await actionOk({ 'submit-update': { id, update: encodeText('copy my content') } });
    await actionOk({
      'add-comment': {
        id,
        'comment-id': '0v5.00000.00003',
        text: 'not copied',
        anchor: '',
      },
    });

    await actionOk({ copy: id });
    const listing = await scry('listing');
    const copy = (listing.owned as any[]).find(
      (d) => d.title === `Copy of e2e-copysrc-${RUN}`,
    );
    expect(copy).toBeDefined();
    expect(rebuildText(await docState(copy.id))).toBe('copy my content');
    // Comments do not travel with a copy.
    const comments = (await scry(`comments/for/${copy.id}`)).comments as any[];
    expect(comments.length).toBe(0);
    // A copy carries no borrowed authorship: every history entry is the
    // copier (~nec here), not any prior author.
    const hist = (await scry(`doc/${copy.id}/history`)).entries as any[];
    for (const e of hist.filter((x) => x.kind === 'update')) {
      expect(e.author).toBe(`~${SHIP_NAME}`);
    }
  });
});

describe('version history authorship', () => {
  test('history entries carry author and timestamp', async () => {
    const id = await createDoc('text', `e2e-hist-${RUN}`);
    await actionOk({ 'submit-update': { id, update: encodeText('v1') } });
    const hist = (await scry(`doc/${id}/history`)).entries as any[];
    const upd = hist.find((e) => e.kind === 'update');
    expect(upd).toBeDefined();
    expect(typeof upd.author).toBe('string');
    expect(upd.author.startsWith('~')).toBe(true);
    expect(typeof upd.at).toBe('number');
    expect(upd.at).toBeGreaterThan(0);
  });

  test('save-version stores a named checkpoint fetchable by timestamp', async () => {
    const id = await createDoc('text', `e2e-ver-${RUN}`);
    const d = new Y.Doc();
    d.getText('t').insert(0, 'checkpoint me');
    const blob = Array.from(Y.encodeStateAsUpdate(d));
    await actionOk({ 'save-version': { id, label: 'My Milestone', blob } });

    const versions = (await scry(`doc/${id}/versions`)).versions as any[];
    expect(versions.length).toBe(1);
    expect(versions[0].label).toBe('My Milestone');
    const at = versions[0].at as number;

    const vbr = await fetch(`${BASE}/drive/version?id=${id}&at=${at}`, {
      headers: authed(),
    });
    expect(vbr.ok).toBe(true);
    const vb = await vbr.json();
    const rebuilt = new Y.Doc();
    Y.applyUpdate(rebuilt, new Uint8Array(vb.blob));
    expect(rebuilt.getText('t').toString()).toBe('checkpoint me');
  });

  test('compaction creates an auto version checkpoint', async () => {
    const id = await createDoc('text', `e2e-autover-${RUN}`);
    // Flood past the threshold and perform the snapshot protocol.
    const d = new Y.Doc();
    for (let i = 0; i < 501; i++) {
      const sv = Y.encodeStateVector(d);
      d.getText('t').insert(i, 'x');
      await actionOk({
        'submit-update': { id, update: Array.from(Y.encodeStateAsUpdate(d, sv)) },
      });
    }
    const s = await docState(id);
    await actionOk({
      'submit-snapshot': {
        id,
        gen: s.seq,
        covered: s.updates.length,
        blob: Array.from(Y.encodeStateAsUpdate(d)),
      },
    });
    const versions = (await scry(`doc/${id}/versions`)).versions as any[];
    expect(versions.length).toBeGreaterThanOrEqual(1);
    // Auto checkpoints are unnamed.
    expect(versions.some((v) => v.label === null)).toBe(true);
  });
});

describe('usage dashboard & upload cap', () => {
  test('usage totals are non-negative and reflect content', async () => {
    const id = await createDoc('text', `e2e-usage-${RUN}`);
    await actionOk({ 'submit-update': { id, update: encodeText('some bytes here') } });
    const usage = await scry('usage');
    expect(usage.docs).toBeGreaterThan(0);
    expect(usage['update-bytes']).toBeGreaterThan(0);
    expect(usage['total-bytes']).toBeGreaterThanOrEqual(usage['update-bytes']);
  });

  test('upload over 20 MiB is rejected with 413', async () => {
    // 21 MiB of zeros.
    const big = new Uint8Array(21 * 1024 * 1024);
    const r = await fetch(`${BASE}/drive/upload?title=e2e-big-${RUN}`, {
      method: 'POST',
      headers: authed({ 'content-type': 'application/octet-stream' }),
      body: big,
    });
    expect(r.status).toBe(413);
  });

  // NOTE: the submit-update/token-action size cap (action-oversized in the
  // agent) is verified by code review, not e2e: triggering it needs a >20 MiB
  // JSON array whose parse alone wedges the shared test ship past the 60s
  // timeout. The cap bounds STORED state (the loom-exhaustion finding); a
  // transient large-parse spike is a separate Eyre-body-limit concern.
});

describe('token /state does not leak the owner ACL', () => {
  test('a viewer link session cannot see collaborator patps', async () => {
    const id = await createDoc('text', `e2e-aclleak-${RUN}`);
    // Owner shares with a fictional third ship — that patp must not leak.
    await actionOk({ share: { id, who: 'bus', role: 'commenter' } });

    await actionOk({ 'mint-token': { id, role: 'viewer' } });
    const tokens = (await scry(`tokens/for/${id}`)).tokens as any[];
    const token = tokens[tokens.length - 1].token as string;
    const entry = await fetch(`${BASE}/drive/t?k=${token}`, { redirect: 'manual' });
    const session = (entry.headers.get('set-cookie') ?? '').match(
      /drive-session=[^;]+/,
    )![0];

    const state = await docState(id, session);
    // The token session gets content + title, but no acl field at all.
    expect(state.meta).toBeDefined();
    expect(state.meta.acl).toBeUndefined();
    expect(JSON.stringify(state)).not.toContain('bus');
  });
});

describe('thumbnails', () => {
  const PNG = Uint8Array.from(
    atob(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
    ),
    (c) => c.charCodeAt(0),
  );

  test('store and serve a thumbnail; 404 before it exists', async () => {
    const up = await fetch(`${BASE}/drive/upload?title=e2e-thumb-${RUN}`, {
      method: 'POST',
      headers: authed({ 'content-type': 'image/png' }),
      body: PNG,
    });
    const { id } = await up.json();

    // No thumb yet → 404 (client falls back to /blob).
    const before = await fetch(`${BASE}/drive/thumb?id=${id}`, { headers: authed() });
    expect(before.status).toBe(404);

    // Store one.
    const store = await fetch(`${BASE}/drive/thumb?id=${id}`, {
      method: 'POST',
      headers: authed({ 'content-type': 'image/jpeg' }),
      body: PNG,
    });
    expect(store.ok).toBe(true);

    // Now it serves.
    const after = await fetch(`${BASE}/drive/thumb?id=${id}`, { headers: authed() });
    expect(after.status).toBe(200);
    expect(after.headers.get('content-type')).toBe('image/jpeg');
    expect((await after.arrayBuffer()).byteLength).toBe(PNG.length);
  });

  test('storing a thumb for a nonexistent doc is rejected', async () => {
    const bogus = '0v9.99999.99999';
    const r = await fetch(`${BASE}/drive/thumb?id=${bogus}`, {
      method: 'POST',
      headers: authed({ 'content-type': 'image/jpeg' }),
      body: PNG,
    });
    expect(r.status).toBe(404);
  });

  test('thumb requires auth', async () => {
    const up = await fetch(`${BASE}/drive/upload?title=e2e-thumbauth-${RUN}`, {
      method: 'POST',
      headers: authed({ 'content-type': 'image/png' }),
      body: PNG,
    });
    const { id } = await up.json();
    await fetch(`${BASE}/drive/thumb?id=${id}`, {
      method: 'POST',
      headers: authed({ 'content-type': 'image/jpeg' }),
      body: PNG,
    });
    const anon = await fetch(`${BASE}/drive/thumb?id=${id}`);
    expect(anon.status).toBe(401);
  });
});

describe('PWA + SPA routes', () => {
  test('manifest and service worker are served', async () => {
    const man = await fetch(`${BASE}/drive/manifest.json`);
    expect(man.ok).toBe(true);
    const j = await man.json();
    expect(j.name).toBe('Groundwire Drive');
    expect(j.start_url).toBe('/drive');

    const sw = await fetch(`${BASE}/drive/sw.js`);
    expect(sw.ok).toBe(true);
    expect(sw.headers.get('content-type')).toContain('javascript');
    expect(sw.headers.get('service-worker-allowed')).toBe('/drive/');
  });

  test('SPA fallback serves HTML for /drive/starred and /drive/recent (hard refresh)', async () => {
    for (const path of ['starred', 'recent', 'files', 'notes']) {
      const r = await fetch(`${BASE}/drive/${path}`, { headers: authed() });
      expect(r.status).toBe(200);
      expect((await r.text()).toLowerCase()).toContain('<!doctype html');
    }
  });
});

describe('trash cascade', () => {
  test('folder trash/restore cascades; independently-trashed child stays', async () => {
    const folder = await createFolder(`e2e-casc-f-${RUN}`);
    const sub = await createFolder(`e2e-casc-s-${RUN}`);
    await actionOk({ move: { id: sub, parent: folder } });
    const c1 = await createDoc('note', `e2e-casc-c1-${RUN}`);
    await actionOk({ move: { id: c1, parent: folder } });
    const c2 = await createDoc('note', `e2e-casc-c2-${RUN}`);
    await actionOk({ move: { id: c2, parent: sub } });

    // c1 goes to the trash on its own first (its own cascade stamp).
    await actionOk({ delete: c1 });
    // Then the whole folder.
    await actionOk({ delete: folder });

    const trashIds = ((await scry('trash')).items as any[]).map((t) => t.id);
    for (const id of [folder, sub, c1, c2]) expect(trashIds).toContain(id);
    const owned = ((await scry('listing')).owned as any[]).map((d) => d.id);
    for (const id of [folder, sub, c1, c2]) expect(owned).not.toContain(id);

    // Restoring the folder brings back its cascade — but NOT c1, which was
    // trashed separately before.
    await actionOk({ restore: folder });
    const trash2 = ((await scry('trash')).items as any[]).map((t) => t.id);
    expect(trash2).toContain(c1);
    for (const id of [folder, sub, c2]) expect(trash2).not.toContain(id);
    const owned2 = ((await scry('listing')).owned as any[]).map((d) => d.id);
    for (const id of [folder, sub, c2]) expect(owned2).toContain(id);
  });

  test('purge removes the subtree with its blobs, tokens, and sessions', async () => {
    const folder = await createFolder(`e2e-purgec-f-${RUN}`);
    const up = await fetch(
      `${BASE}/drive/upload?title=e2e-purgec-img-${RUN}&parent=${folder}`,
      {
        method: 'POST',
        headers: authed({ 'content-type': 'image/png' }),
        body: Uint8Array.from([137, 80, 78, 71]),
      },
    );
    const { id: img } = await up.json();

    // A live share-link session on the child, to prove purge kills it.
    await actionOk({ 'mint-token': { id: img, role: 'viewer' } });
    const tok = ((await scry(`tokens/for/${img}`)).tokens as any[])[0].token;
    const entry = await fetch(`${BASE}/drive/t?k=${tok}`, { redirect: 'manual' });
    const session = (entry.headers.get('set-cookie') ?? '').match(
      /drive-session=[^;]+/,
    )![0];

    await actionOk({ delete: folder });
    await actionOk({ purge: folder });

    const listing = await scry('listing');
    expect((listing.owned as any[]).map((d) => d.id)).not.toContain(img);
    expect(((await scry('trash')).items as any[]).map((t) => t.id)).not.toContain(img);
    // Blob bytes gone.
    const blob = await fetch(`${BASE}/drive/blob?id=${img}`, { headers: authed() });
    expect(blob.status).toBe(404);
    // Token grant gone; session dead.
    const reentry = await fetch(`${BASE}/drive/t?k=${tok}`, { redirect: 'manual' });
    expect(reentry.status).toBe(404);
    const s = await fetch(`${BASE}/drive/state?id=${img}`, {
      headers: { cookie: session },
    });
    expect(s.status).toBe(401);
  });
});

describe('precise token revocation', () => {
  test('revoking one token kills only its own sessions', async () => {
    const id = await createDoc('text', `e2e-tokprec-${RUN}`);
    const open = async () => {
      // Identify the newly-minted token by diffing (the scry returns map
      // order, not insertion order, so "the last one" is unreliable).
      const before = new Set(
        ((await scry(`tokens/for/${id}`)).tokens as any[]).map((t) => t.token),
      );
      await actionOk({ 'mint-token': { id, role: 'viewer' } });
      const after = (await scry(`tokens/for/${id}`)).tokens as any[];
      const token = after.find((t) => !before.has(t.token)).token as string;
      const r = await fetch(`${BASE}/drive/t?k=${token}`, { redirect: 'manual' });
      const session = (r.headers.get('set-cookie') ?? '').match(
        /drive-session=[^;]+/,
      )![0];
      return { token, session };
    };
    const a = await open();
    const b = await open();

    await actionOk({ 'revoke-token': a.token });

    const sa = await fetch(`${BASE}/drive/state?id=${id}`, {
      headers: { cookie: a.session },
    });
    expect(sa.status).toBe(401);
    // The sibling token's session is untouched.
    const sb = await fetch(`${BASE}/drive/state?id=${id}`, {
      headers: { cookie: b.session },
    });
    expect(sb.status).toBe(200);
  });
});

describe('compaction (gen/covered protocol)', () => {
  // Push `n` incremental one-char updates from one continuously-edited doc.
  async function floodUpdates(id: string, n: number): Promise<Y.Doc> {
    const d = new Y.Doc();
    for (let i = 0; i < n; i++) {
      const sv = Y.encodeStateVector(d);
      d.getText('t').insert(i, 'x');
      const diff = Y.encodeStateAsUpdate(d, sv);
      await actionOk({ 'submit-update': { id, update: Array.from(diff) } });
    }
    return d;
  }

  test('over-threshold doc asks a new subscriber to compact; snapshot truncates covered updates', async () => {
    const id = await createDoc('text', `e2e-compact-${RUN}`);
    await floodUpdates(id, 501);

    // A fresh SSE subscriber over a deep backlog gets %request-snapshot.
    const sse = new SseReader(`${BASE}/drive/sse?id=${id}`, COOKIE);
    try {
      await waitFor(() => (sse.facts('request-snapshot').length > 0 ? true : undefined), 30000);
    } finally {
      await sse.close();
    }

    // Perform the protocol exactly like the client does.
    const s = await docState(id);
    expect(s.updates.length).toBe(501);
    const gen = s.seq as number;
    const covered = s.updates.length as number;
    const merged = new Y.Doc();
    if (s.snapshot?.length) Y.applyUpdate(merged, new Uint8Array(s.snapshot));
    for (const u of s.updates) Y.applyUpdate(merged, new Uint8Array(u));
    await actionOk({
      'submit-snapshot': {
        id,
        gen,
        covered,
        blob: Array.from(Y.encodeStateAsUpdate(merged)),
      },
    });

    const after = await docState(id);
    expect(after.updates.length).toBe(0);
    expect(after.seq).toBe(gen + 1);
    expect(rebuildText(after)).toBe('x'.repeat(501));
  });

  test('update racing a snapshot encode survives truncation', async () => {
    const id = await createDoc('text', `e2e-race-${RUN}`);
    const d = await floodUpdates(id, 5);

    // Client pulls state to encode a snapshot…
    const s = await docState(id);
    const gen = s.seq as number;
    const covered = s.updates.length as number;
    const merged = new Y.Doc();
    if (s.snapshot?.length) Y.applyUpdate(merged, new Uint8Array(s.snapshot));
    for (const u of s.updates) Y.applyUpdate(merged, new Uint8Array(u));

    // …meanwhile another editor lands an update the encode can't include.
    const sv = Y.encodeStateVector(d);
    d.getText('t').insert(5, 'R');
    await actionOk({
      'submit-update': { id, update: Array.from(Y.encodeStateAsUpdate(d, sv)) },
    });

    await actionOk({
      'submit-snapshot': {
        id,
        gen,
        covered,
        blob: Array.from(Y.encodeStateAsUpdate(merged)),
      },
    });

    const after = await docState(id);
    // The raced update survived the truncation…
    expect(after.updates.length).toBe(1);
    // …and the doc content includes it.
    expect(rebuildText(after)).toBe('xxxxxR');
  });

  test('stale-generation snapshot is dropped', async () => {
    const id = await createDoc('text', `e2e-stalegen-${RUN}`);
    await floodUpdates(id, 3);

    const s = await docState(id);
    const bogus = new Y.Doc();
    bogus.getText('t').insert(0, 'CLOBBER');
    await actionOk({
      'submit-snapshot': {
        id,
        gen: (s.seq as number) + 7, // wrong generation
        covered: 3,
        blob: Array.from(Y.encodeStateAsUpdate(bogus)),
      },
    });

    const after = await docState(id);
    expect(after.seq).toBe(s.seq);
    expect(after.updates.length).toBe(3);
    expect(rebuildText(after)).toBe('xxx');
  });
});

describe('uploads & blobs', () => {
  // 1x1 transparent PNG.
  const PNG = Uint8Array.from(
    atob(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
    ),
    (c) => c.charCodeAt(0),
  );

  test('upload png → image doc + byte-identical blob', async () => {
    const r = await fetch(`${BASE}/drive/upload?title=e2e-img-${RUN}`, {
      method: 'POST',
      headers: authed({ 'content-type': 'image/png' }),
      body: PNG,
    });
    expect(r.ok).toBe(true);
    const { id } = await r.json();

    const listing = await scry('listing');
    const doc = (listing.owned as any[]).find((d) => d.id === id);
    expect(doc.type).toBe('image');

    const blob = await fetch(`${BASE}/drive/blob?id=${id}`, { headers: authed() });
    expect(blob.ok).toBe(true);
    expect(blob.headers.get('content-type')).toBe('image/png');
    const bytes = new Uint8Array(await blob.arrayBuffer());
    expect(bytes.length).toBe(PNG.length);
    expect(Array.from(bytes)).toEqual(Array.from(PNG));
  });

  test('blob requires auth', async () => {
    const r = await fetch(`${BASE}/drive/upload?title=e2e-authblob-${RUN}`, {
      method: 'POST',
      headers: authed({ 'content-type': 'image/png' }),
      body: PNG,
    });
    const { id } = await r.json();

    const anon = await fetch(`${BASE}/drive/blob?id=${id}`);
    expect(anon.status).toBe(401);
  });

  test('token session reads blobs only for its doc or inline children', async () => {
    // An image doc parented under a text doc (the inline-image shape)…
    const textDoc = await createDoc('text', `e2e-blobdoc-${RUN}`);
    const up = await fetch(
      `${BASE}/drive/upload?title=e2e-inline-${RUN}&parent=${textDoc}`,
      { method: 'POST', headers: authed({ 'content-type': 'image/png' }), body: PNG },
    );
    const { id: inlineImg } = await up.json();
    // …and an unrelated image.
    const up2 = await fetch(`${BASE}/drive/upload?title=e2e-other-${RUN}`, {
      method: 'POST',
      headers: authed({ 'content-type': 'image/png' }),
      body: PNG,
    });
    const { id: otherImg } = await up2.json();

    await actionOk({ 'mint-token': { id: textDoc, role: 'viewer' } });
    const tokens = (await scry(`tokens/for/${textDoc}`)).tokens as any[];
    const token = tokens[tokens.length - 1].token as string;
    const entry = await fetch(`${BASE}/drive/t?k=${token}`, { redirect: 'manual' });
    const session = (entry.headers.get('set-cookie') ?? '').match(
      /drive-session=[^;]+/,
    )![0];

    // Inline child image: allowed.
    const okBlob = await fetch(`${BASE}/drive/blob?id=${inlineImg}`, {
      headers: { cookie: session },
    });
    expect(okBlob.status).toBe(200);

    // Unrelated blob: denied.
    const denied = await fetch(`${BASE}/drive/blob?id=${otherImg}`, {
      headers: { cookie: session },
    });
    expect(denied.status).toBe(401);
  });
});

// ---------- Groundwire: shared spaces + membership ----------

async function createSpace(name: string): Promise<string> {
  await actionOk({ 'create-space': { name } });
  const listing = await scry('listing');
  const spc = (listing.spaces as any[]).find((s) => s.name === name);
  if (!spc) throw new Error(`created space "${name}" not in listing.spaces`);
  return spc.id;
}

describe('spaces & membership', () => {
  test('create a space → appears in listing with owner role', async () => {
    const name = `Eng ${RUN}`;
    const sid = await createSpace(name);
    const listing = await scry('listing');
    const spc = (listing.spaces as any[]).find((s) => s.id === sid);
    expect(spc).toBeDefined();
    expect(spc.role).toBe('owner');
    expect(spc.members).toBe(1); // just the host
    expect(spc.host).toBe(`~${SHIP_NAME}`);
  });

  test('add / re-role / remove a member; roster scry reflects it', async () => {
    const sid = await createSpace(`Design ${RUN}`);
    // Add ~bus as editor.
    await actionOk({ 'add-member': { space: sid, who: 'bus', role: 'editor' } });
    let roster = await scry(`space/${sid}`);
    let bus = (roster.members as any[]).find((m) => m.who === '~bus');
    expect(bus?.role).toBe('editor');
    expect((roster.members as any[]).length).toBe(2);

    // Promote to admin.
    await actionOk({ 'set-member-role': { space: sid, who: 'bus', role: 'admin' } });
    roster = await scry(`space/${sid}`);
    bus = (roster.members as any[]).find((m) => m.who === '~bus');
    expect(bus?.role).toBe('admin');

    // Remove.
    await actionOk({ 'remove-member': { space: sid, who: 'bus' } });
    roster = await scry(`space/${sid}`);
    expect((roster.members as any[]).find((m) => m.who === '~bus')).toBeUndefined();
  });

  test('assign a doc to a space and back to personal', async () => {
    const sid = await createSpace(`Docs ${RUN}`);
    const did = await createDoc('text', `spaced-${RUN}`);
    // Initially personal.
    let listing = await scry('listing');
    let d = (listing.owned as any[]).find((x) => x.id === did);
    expect(d.space == null).toBe(true);

    // Move into the space.
    await actionOk({ 'set-doc-space': { id: did, space: sid } });
    listing = await scry('listing');
    d = (listing.owned as any[]).find((x) => x.id === did);
    expect(d.space).toBe(sid);

    // Back to personal (space: null).
    await actionOk({ 'set-doc-space': { id: did, space: null } });
    listing = await scry('listing');
    d = (listing.owned as any[]).find((x) => x.id === did);
    expect(d.space == null).toBe(true);
  });

  test('rename a space', async () => {
    const sid = await createSpace(`OldName ${RUN}`);
    const newName = `NewName ${RUN}`;
    await actionOk({ 'rename-space': { space: sid, name: newName } });
    const listing = await scry('listing');
    const spc = (listing.spaces as any[]).find((s) => s.id === sid);
    expect(spc.name).toBe(newName);
  });

  test('delete a space → space gone, its docs revert to personal', async () => {
    const sid = await createSpace(`Temp ${RUN}`);
    const did = await createDoc('text', `temp-doc-${RUN}`);
    await actionOk({ 'set-doc-space': { id: did, space: sid } });

    // Delete takes a bare string id.
    await actionOk({ 'delete-space': sid });

    const listing = await scry('listing');
    expect((listing.spaces as any[]).find((s) => s.id === sid)).toBeUndefined();
    // The doc still exists but is personal again.
    const d = (listing.owned as any[]).find((x) => x.id === did);
    expect(d).toBeDefined();
    expect(d.space == null).toBe(true);
  });

  test('health reports gw state-version 11', async () => {
    const j = await scry('health');
    expect(j['state-version']).toBe(11);
  });
});
