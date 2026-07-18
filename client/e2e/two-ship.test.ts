// Cross-ship e2e: ~nec (ship A, owner) and ~bus (ship B, collaborator)
// talking over fake ames on loopback. Run via scripts/e2e-two-ship.sh,
// which supplies SHIP_A_URL/SHIP_B_URL/SHIP_A_NAME/SHIP_B_NAME/
// COOKIE_A/COOKIE_B.

import { describe, test, expect } from 'bun:test';
import * as Y from 'yjs';
import { SseReader, waitFor } from './sse';

const A = { base: process.env.SHIP_A_URL ?? '', cookie: process.env.COOKIE_A ?? '' };
const B = { base: process.env.SHIP_B_URL ?? '', cookie: process.env.COOKIE_B ?? '' };
const SHIP_A = process.env.SHIP_A_NAME ?? 'nec';
const SHIP_B = process.env.SHIP_B_NAME ?? 'bus';
if (!A.base || !B.base || !A.cookie || !B.cookie) {
  throw new Error('two-ship env missing (use scripts/e2e-two-ship.sh)');
}

const RUN = Math.random().toString(36).slice(2, 8);
type Ship = { base: string; cookie: string };

async function action(s: Ship, body: unknown): Promise<void> {
  const r = await fetch(`${s.base}/drive/action`, {
    method: 'POST',
    headers: { cookie: s.cookie, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(`action ${JSON.stringify(body)} → ${r.status} ${await r.text()}`);
}

async function scry(s: Ship, path: string): Promise<any> {
  const r = await fetch(`${s.base}/~/scry/drive/${path}.json`, {
    headers: { cookie: s.cookie },
  });
  if (!r.ok) throw new Error(`scry ${path} → ${r.status}`);
  return r.json();
}

async function docState(s: Ship, id: string): Promise<any> {
  const r = await fetch(`${s.base}/drive/state?id=${id}`, { headers: { cookie: s.cookie } });
  if (!r.ok) throw new Error(`/state ${id} → ${r.status}`);
  return r.json();
}

async function createDoc(
  s: Ship,
  type: 'text' | 'sheet' | 'note',
  title: string,
): Promise<string> {
  await action(s, { create: { 'doc-type': type, title, parent: null } });
  const listing = await scry(s, 'listing');
  const doc = (listing.owned as any[]).find((d) => d.title === title);
  if (!doc) throw new Error(`created doc "${title}" not in listing`);
  return doc.id;
}

const rebuildText = (state: any): string => {
  if (!state) return ''; // /state returns JSON null when no doc/mirror exists
  const d = new Y.Doc();
  if (state.snapshot?.length) Y.applyUpdate(d, new Uint8Array(state.snapshot));
  for (const u of state.updates ?? []) {
    if (u?.length) Y.applyUpdate(d, new Uint8Array(u));
  }
  return d.getText('t').toString();
};

const encodeInsert = (base: Y.Doc | null, pos: number, text: string) => {
  const d = base ?? new Y.Doc();
  const sv = Y.encodeStateVector(d);
  d.getText('t').insert(pos, text);
  return { doc: d, update: Array.from(Y.encodeStateAsUpdate(d, sv)) };
};

// Owner shares a doc with ~bus and bus mirrors it: the canonical setup.
async function shareAndMirror(
  type: 'text' | 'sheet',
  title: string,
  role: string,
): Promise<string> {
  const id = await createDoc(A, type, title);
  await action(A, { share: { id, who: SHIP_B, role } });
  await action(B, { 'subscribe-remote': { owner: SHIP_A, id } });
  // Mirror is live once /state on B returns the doc.
  await waitFor(async () => {
    try {
      const s = await docState(B, id);
      return s ? true : undefined;
    } catch {
      return undefined;
    }
  }, 60000);
  return id;
}

describe('shared-with-me (invites)', () => {
  test('share pushes an invite into B listing; revoke retracts it', async () => {
    const id = await createDoc(A, 'text', `ts-invite-${RUN}`);
    await action(A, { share: { id, who: SHIP_B, role: 'editor' } });

    // B sees the share WITHOUT doing anything.
    const inv = await waitFor(async () => {
      const l = await scry(B, 'listing');
      return (l.shared as any[]).find((d) => d.id === id);
    }, 60000);
    expect(inv.title).toBe(`ts-invite-${RUN}`);
    expect(inv.type).toBe('text');
    expect(inv.role).toBe('editor');
    expect(inv.owner).toBe(`~${SHIP_A}`);

    await action(A, { revoke: { id, who: SHIP_B } });
    await waitFor(async () => {
      const l = await scry(B, 'listing');
      return (l.shared as any[]).some((d) => d.id === id) ? undefined : true;
    }, 60000);
  });
});

describe('mirror metadata', () => {
  test('a shared SHEET mirrors with correct doc-type and role', async () => {
    const id = await shareAndMirror('sheet', `ts-sheet-${RUN}`, 'editor');
    const entry = await waitFor(async () => {
      const l = await scry(B, 'listing');
      const m = (l.mirrored as any[]).find((d) => d.id === id);
      // doc-type arrives with the initial %meta fact; wait until it's real.
      return m && m.type === 'sheet' ? m : undefined;
    }, 60000);
    expect(entry.role).toBe('editor');
    expect(entry.title).toBe(`ts-sheet-${RUN}`);
  });
});

describe('bidirectional edits', () => {
  test('A→B and B→A updates converge', async () => {
    const id = await shareAndMirror('text', `ts-edits-${RUN}`, 'editor');

    // Owner writes...
    const a1 = encodeInsert(null, 0, 'from-A ');
    await action(A, { 'submit-update': { id, update: a1.update } });

    // ...B sees it via its mirror.
    await waitFor(async () => {
      const s = await docState(B, id);
      return rebuildText(s) === 'from-A ' ? true : undefined;
    }, 60000);

    // B (editor) writes on top...
    const b1 = encodeInsert(a1.doc, 7, 'from-B');
    await action(B, { 'submit-update': { id, update: b1.update } });

    // ...the owner converges...
    await waitFor(async () => {
      const s = await docState(A, id);
      return rebuildText(s) === 'from-A from-B' ? true : undefined;
    }, 60000);

    // ...and B's own mirror does too (owner fans it back).
    await waitFor(async () => {
      const s = await docState(B, id);
      return rebuildText(s) === 'from-A from-B' ? true : undefined;
    }, 60000);
  });
});

describe('comments cross-ship', () => {
  const cid = (n: number) => `0v${n}.00000.00002`;

  test('B comments on a mirror; A sees it; A resolves; B sees resolution', async () => {
    const id = await shareAndMirror('text', `ts-comments-${RUN}`, 'editor');

    // B comments through its own ship.
    await action(B, {
      'add-comment': { id, 'comment-id': cid(1), text: 'hello from B', anchor: 'anchor-b' },
    });

    // Owner has it...
    const onA = await waitFor(async () => {
      const c = (await scry(A, `comments/for/${id}`)).comments as any[];
      return c.find((x) => x.text === 'hello from B');
    }, 60000);
    expect(onA.author).toBe(`~${SHIP_B}`);

    // ...and it's fanned back into B's mirror copy.
    await waitFor(async () => {
      const c = (await scry(B, `comments/for/${id}`)).comments as any[];
      return c.find((x) => x.text === 'hello from B');
    }, 60000);

    // A resolves; B observes.
    await action(A, { 'resolve-comment': { id, 'comment-id': onA.id } });
    await waitFor(async () => {
      const c = (await scry(B, `comments/for/${id}`)).comments as any[];
      const found = c.find((x) => x.id === onA.id);
      return found?.resolved === true ? true : undefined;
    }, 60000);
  });
});

describe('blob sync', () => {
  const PNG = Uint8Array.from(
    atob(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
    ),
    (c) => c.charCodeAt(0),
  );

  test('a mirrored image doc serves bytes from B', async () => {
    const up = await fetch(`${A.base}/drive/upload?title=ts-img-${RUN}`, {
      method: 'POST',
      headers: { cookie: A.cookie, 'content-type': 'image/png' },
      body: PNG,
    });
    const { id } = await up.json();
    await action(A, { share: { id, who: SHIP_B, role: 'viewer' } });
    await action(B, { 'subscribe-remote': { owner: SHIP_A, id } });

    const bytes = await waitFor(async () => {
      const r = await fetch(`${B.base}/drive/blob?id=${id}`, {
        headers: { cookie: B.cookie },
      });
      if (r.status !== 200) return undefined;
      return new Uint8Array(await r.arrayBuffer());
    }, 60000);
    expect(bytes.length).toBe(PNG.length);
    expect(Array.from(bytes)).toEqual(Array.from(PNG));
  });
});

describe('rejected forwarded edits (nack outbox)', () => {
  test('demoted editor gets %save-failed; re-promotion lets new edits through', async () => {
    const id = await shareAndMirror('text', `ts-nack-${RUN}`, 'editor');

    // Baseline edit lands.
    const e1 = encodeInsert(null, 0, 'ok ');
    await action(B, { 'submit-update': { id, update: e1.update } });
    await waitFor(async () => {
      const s = await docState(A, id);
      return rebuildText(s) === 'ok ' ? true : undefined;
    }, 60000);

    // Demote B to viewer (mirror survives; forwarded edits now get nacked).
    await action(A, { share: { id, who: SHIP_B, role: 'viewer' } });
    // Wait for B to learn its new role so the state change has propagated.
    await waitFor(async () => {
      const l = await scry(B, 'listing');
      const m = (l.mirrored as any[]).find((d) => d.id === id);
      return m?.role === 'viewer' ? true : undefined;
    }, 60000);

    // B keeps an SSE stream open to catch %save-failed.
    const sse = new SseReader(`${B.base}/drive/sse?id=${id}`, B.cookie);
    try {
      const e2 = encodeInsert(e1.doc, 3, 'rejected');
      await action(B, { 'submit-update': { id, update: e2.update } });

      // 3 retries with 5/10/20s backoff before the failure surfaces.
      await waitFor(() => (sse.facts('save-failed').length > 0 ? true : undefined), 90000, 1000);

      // The rejected edit never reached the owner.
      expect(rebuildText(await docState(A, id))).toBe('ok ');

      // Re-promote; a NEW edit goes through.
      await action(A, { share: { id, who: SHIP_B, role: 'editor' } });
      await waitFor(async () => {
        const l = await scry(B, 'listing');
        const m = (l.mirrored as any[]).find((d) => d.id === id);
        return m?.role === 'editor' ? true : undefined;
      }, 60000);
      const e3 = encodeInsert(null, 0, 'back!');
      await action(B, { 'submit-update': { id, update: e3.update } });
      await waitFor(async () => {
        const s = await docState(A, id);
        return rebuildText(s).includes('back!') ? true : undefined;
      }, 60000);
    } finally {
      await sse.close();
    }
  }, 300000);
});

describe('revocation & trash teardown', () => {
  test('revoking B tears down only B; A keeps working', async () => {
    const id = await shareAndMirror('text', `ts-revoke-${RUN}`, 'editor');
    const sseB = new SseReader(`${B.base}/drive/sse?id=${id}`, B.cookie);
    try {
      await action(A, { revoke: { id, who: SHIP_B } });

      // B's agent gets kicked, fails its re-watch, drops the mirror, and
      // tells B's browsers.
      await waitFor(() => (sseB.facts('revoked').length > 0 ? true : undefined), 90000, 1000);
      await waitFor(async () => {
        const l = await scry(B, 'listing');
        return (l.mirrored as any[]).some((d) => d.id === id) ? undefined : true;
      }, 60000);

      // The owner's doc is untouched and still writable.
      const e = encodeInsert(null, 0, 'still-mine');
      await action(A, { 'submit-update': { id, update: e.update } });
      expect(rebuildText(await docState(A, id))).toContain('still-mine');
    } finally {
      await sseB.close();
    }
  }, 300000);

  test('A trashing the doc drops B mirror', async () => {
    const id = await shareAndMirror('text', `ts-trash-${RUN}`, 'editor');
    await action(A, { delete: id });
    await waitFor(async () => {
      const l = await scry(B, 'listing');
      return (l.mirrored as any[]).some((d) => d.id === id) ? undefined : true;
    }, 60000);
  });
});

// ---------- Groundwire cross-ship spaces ----------

async function createSpaceA(name: string): Promise<string> {
  await action(A, { 'create-space': { name } });
  const l = await scry(A, 'listing');
  const s = (l.spaces as any[]).find((x) => x.name === name);
  if (!s) throw new Error(`space "${name}" not created on A`);
  return s.id;
}

describe('cross-ship spaces', () => {
  test('membership (not a per-doc share) grants doc access across ships', async () => {
    // A hosts a space with B as an editor member, and puts a doc in it.
    const sid = await createSpaceA(`ts-space-${RUN}`);
    await action(A, { 'add-member': { space: sid, who: SHIP_B, role: 'editor' } });
    const docId = await createDoc(A, 'text', `ts-space-doc-${RUN}`);
    await action(A, { 'set-doc-space': { id: docId, space: sid } });

    // B joins the space (subscribes to A's /space channel).
    await action(B, { 'join-space': { host: SHIP_A, space: sid } });

    // B's listing shows the joined space; wait until the host's %space-meta
    // fact has propagated B's real role (it starts at the join-time default).
    const joined = await waitFor(async () => {
      const l = await scry(B, 'listing');
      const s = (l.spaces as any[]).find((x) => x.id === sid && x.joined);
      return s && s.role === 'editor' ? s : undefined;
    }, 60000);
    expect(joined.role).toBe('editor');
    expect(joined.host).toBe(`~${SHIP_A}`);

    // B sees the space's doc list over the channel (no per-doc share existed).
    const seenDoc = await waitFor(async () => {
      const docs = await scry(B, `space-docs/${sid}`);
      return (docs as any[]).find((d) => d.id === docId);
    }, 60000);
    expect(seenDoc.title).toBe(`ts-space-doc-${RUN}`);
    expect(seenDoc.owner).toBe(`~${SHIP_A}`);

    // Seed content on A, then B opens the doc via space membership ALONE —
    // B is not in the doc's acl; access comes from the space. This is the
    // core cross-ship authorization proof.
    const { doc: seededA } = encodeInsert(null, 0, 'from the host');
    await action(A, { 'submit-update': { id: docId, update: Array.from(Y.encodeStateAsUpdate(seededA)) } });
    await action(B, { 'subscribe-remote': { owner: SHIP_A, id: docId } });
    const gotContent = await waitFor(async () => {
      const s = await docState(B, docId);
      const t = rebuildText(s);
      return t.includes('from the host') ? t : undefined;
    }, 60000);
    expect(gotContent).toContain('from the host');

    // B (space editor) edits; the forwarded edit is accepted by A via the
    // space-aware role check and lands in A's authoritative state.
    const { update: bEdit } = encodeInsert(seededA, seededA.getText('t').length, ' + guest edit');
    await action(B, { 'submit-update': { id: docId, update: bEdit } });
    await waitFor(async () => {
      const t = rebuildText(await docState(A, docId));
      return t.includes('guest edit') ? true : undefined;
    }, 60000);

    // A adds a NEW doc to the space → it appears live in B's space-docs
    // (the %space-doc fact over the channel, no re-join).
    const doc2 = await createDoc(A, 'note', `ts-space-doc2-${RUN}`);
    await action(A, { 'set-doc-space': { id: doc2, space: sid } });
    await waitFor(async () => {
      const docs = await scry(B, `space-docs/${sid}`);
      return (docs as any[]).some((d) => d.id === doc2) ? true : undefined;
    }, 60000);

    // A removes B → B is kicked off the space channel and the joined space
    // disappears from B's listing.
    await action(A, { 'remove-member': { space: sid, who: SHIP_B } });
    await waitFor(async () => {
      const l = await scry(B, 'listing');
      return (l.spaces as any[]).some((x) => x.id === sid) ? undefined : true;
    }, 60000);
  }, 180000);
});

describe('space invitations', () => {
  test('invite → accept: pending invite becomes a joined space + roster', async () => {
    const sid = await createSpaceA(`ts-inv-${RUN}`);
    const docId = await createDoc(A, 'text', `ts-invdoc-${RUN}`);
    await action(A, { 'set-doc-space': { id: docId, space: sid } });

    // A invites B — B doesn't need the space id out-of-band.
    await action(A, { 'invite-to-space': { space: sid, who: SHIP_B, role: 'editor' } });

    // B sees a pending invitation in its inbox.
    const pending = await waitFor(async () => {
      const l = await scry(B, 'listing');
      return (l['space-invites'] as any[]).find((s) => s.id === sid);
    }, 60000);
    expect(pending.name).toBe(`ts-inv-${RUN}`);
    expect(pending.host).toBe(`~${SHIP_A}`);
    expect(pending.role).toBe('editor');

    // B accepts → joins; the pending invite clears.
    await action(B, { 'accept-space-invite': sid });
    await waitFor(async () => {
      const l = await scry(B, 'listing');
      const joined = (l.spaces as any[]).find((s) => s.id === sid && s.joined && s.role === 'editor');
      const stillPending = (l['space-invites'] as any[]).some((s) => s.id === sid);
      return joined && !stillPending ? true : undefined;
    }, 60000);

    // B sees the space's doc and the full roster (propagated from the host).
    await waitFor(async () => {
      const docs = await scry(B, `space-docs/${sid}`);
      return (docs as any[]).some((d) => d.id === docId) ? true : undefined;
    }, 60000);
    const roster = await waitFor(async () => {
      const s = await scry(B, `space/${sid}`);
      const whos = (s.members as any[]).map((m) => m.who);
      return whos.includes(`~${SHIP_A}`) && whos.includes(`~${SHIP_B}`) ? s : undefined;
    }, 60000);
    expect((roster.members as any[]).length).toBe(2);
  }, 180000);

  test('decline: pending invite clears on B and the host un-rosters B', async () => {
    const sid = await createSpaceA(`ts-dec-${RUN}`);
    await action(A, { 'invite-to-space': { space: sid, who: SHIP_B, role: 'viewer' } });
    await waitFor(async () => {
      const l = await scry(B, 'listing');
      return (l['space-invites'] as any[]).find((s) => s.id === sid);
    }, 60000);

    await action(B, { 'decline-space-invite': sid });
    await waitFor(async () => {
      const l = await scry(B, 'listing');
      return (l['space-invites'] as any[]).some((s) => s.id === sid) ? undefined : true;
    }, 60000);
    // The host's roster drops B (only the owner remains).
    await waitFor(async () => {
      const s = await scry(A, `space/${sid}`);
      return (s.members as any[]).some((m) => m.who === `~${SHIP_B}`) ? undefined : true;
    }, 60000);
  }, 120000);
});

describe('space revocation & freshness', () => {
  test('removing a member severs their already-open doc stream', async () => {
    const sid = await createSpaceA(`ts-rev-${RUN}`);
    await action(A, { 'add-member': { space: sid, who: SHIP_B, role: 'editor' } });
    const docId = await createDoc(A, 'text', `ts-rev-doc-${RUN}`);
    await action(A, { 'set-doc-space': { id: docId, space: sid } });
    const { doc: seed } = encodeInsert(null, 0, 'confidential');
    await action(A, { 'submit-update': { id: docId, update: Array.from(Y.encodeStateAsUpdate(seed)) } });

    // B joins and OPENS the doc (establishes a /doc mirror on A).
    await action(B, { 'join-space': { host: SHIP_A, space: sid } });
    await action(B, { 'subscribe-remote': { owner: SHIP_A, id: docId } });
    await waitFor(async () => {
      const l = await scry(B, 'listing');
      return (l.mirrored as any[]).some((d) => d.id === docId) ? true : undefined;
    }, 60000);

    // A removes B → B's open /doc mirror must be torn down (not just /space).
    await action(A, { 'remove-member': { space: sid, who: SHIP_B } });
    await waitFor(async () => {
      const l = await scry(B, 'listing');
      return (l.mirrored as any[]).some((d) => d.id === docId) ? undefined : true;
    }, 60000);
    // And B can no longer re-open it (a fresh watch is nacked → no mirror).
    await action(B, { 'subscribe-remote': { owner: SHIP_A, id: docId } });
    await new Promise((r) => setTimeout(r, 4000));
    const l = await scry(B, 'listing');
    expect((l.mirrored as any[]).some((d) => d.id === docId)).toBe(false);
  }, 180000);

  test('rename/trash of a space doc updates members’ doc lists live', async () => {
    const sid = await createSpaceA(`ts-fresh-${RUN}`);
    await action(A, { 'add-member': { space: sid, who: SHIP_B, role: 'viewer' } });
    const docId = await createDoc(A, 'text', `ts-fresh-doc-${RUN}`);
    await action(A, { 'set-doc-space': { id: docId, space: sid } });
    await action(B, { 'join-space': { host: SHIP_A, space: sid } });
    await waitFor(async () => {
      const docs = await scry(B, `space-docs/${sid}`);
      return (docs as any[]).some((d) => d.id === docId) ? true : undefined;
    }, 60000);

    // Rename on A → B sees the new title (no re-join).
    await action(A, { rename: { id: docId, title: `ts-fresh-renamed-${RUN}` } });
    await waitFor(async () => {
      const docs = await scry(B, `space-docs/${sid}`);
      const d = (docs as any[]).find((x) => x.id === docId);
      return d && d.title === `ts-fresh-renamed-${RUN}` ? true : undefined;
    }, 60000);

    // Trash on A → the doc leaves B's space list (no ghost).
    await action(A, { delete: docId });
    await waitFor(async () => {
      const docs = await scry(B, `space-docs/${sid}`);
      return (docs as any[]).some((d) => d.id === docId) ? undefined : true;
    }, 60000);
  }, 180000);

  test('leaving a joined space relinquishes membership on the host', async () => {
    const sid = await createSpaceA(`ts-leave-${RUN}`);
    await action(A, { 'add-member': { space: sid, who: SHIP_B, role: 'editor' } });
    await action(B, { 'join-space': { host: SHIP_A, space: sid } });
    await waitFor(async () => {
      const l = await scry(B, 'listing');
      return (l.spaces as any[]).some((s) => s.id === sid && s.joined) ? true : undefined;
    }, 60000);

    // B leaves → the host must drop B from the roster (not just B's local view).
    await action(B, { 'leave-space': sid });
    await waitFor(async () => {
      const s = await scry(A, `space/${sid}`);
      return (s.members as any[]).some((m) => m.who === `~${SHIP_B}`) ? undefined : true;
    }, 60000);
  }, 120000);
});

// ---------- chat: cross-ship rooms + DMs ----------

describe('cross-ship space chat', () => {
  test('a member on B posts to A-hosted room; both ships see it, ordered', async () => {
    const sid = await createSpaceA(`chat-space-${RUN}`);
    await action(A, { 'add-member': { space: sid, who: SHIP_B, role: 'editor' } });
    await action(B, { 'join-space': { host: SHIP_A, space: sid } });

    // Wait for B's membership to settle (real role propagated).
    await waitFor(async () => {
      const l = await scry(B, 'listing');
      const s = (l.spaces as any[]).find((x) => x.id === sid && x.joined);
      return s && s.role === 'editor' ? s : undefined;
    }, 60000);

    // A posts, then B posts. Host A is the single writer + ordering authority.
    await action(A, { 'post-message': { space: sid, text: 'from host' } });
    await action(B, { 'post-message': { space: sid, text: 'from member' } });

    // A's own room (authoritative) has both, oldest-first.
    const onA = await waitFor(async () => {
      const c = await scry(A, `chat/${sid}`);
      const t = (c.messages as any[]).map((m) => m.text);
      return t.includes('from host') && t.includes('from member') ? t : undefined;
    }, 60000);
    expect(onA).toEqual(['from host', 'from member']);

    // B's mirror of the room (fanned over the /space channel) has both too, and
    // the member's own message shows the correct (B) author.
    const onB = await waitFor(async () => {
      const c = await scry(B, `chat/${sid}`);
      const texts = (c.messages as any[]).map((m) => m.text);
      return texts.includes('from host') && texts.includes('from member')
        ? (c.messages as any[])
        : undefined;
    }, 60000);
    expect(onB.map((m: any) => m.text)).toEqual(['from host', 'from member']);
    const memberMsg = onB.find((m: any) => m.text === 'from member');
    expect(memberMsg.author).toBe(`~${SHIP_B}`);

    // A hasn't read the room; the member's message counts as unread for A.
    const unreadA = await waitFor(async () => {
      const l = await scry(A, 'listing');
      const s = (l.spaces as any[]).find((x) => x.id === sid);
      return s && s.unread >= 1 ? s.unread : undefined;
    }, 60000);
    expect(unreadA).toBeGreaterThanOrEqual(1);

    // A reads → unread clears.
    await action(A, { 'read-space': sid });
    await waitFor(async () => {
      const l = await scry(A, 'listing');
      const s = (l.spaces as any[]).find((x) => x.id === sid);
      return s && s.unread === 0 ? true : undefined;
    }, 60000);
  }, 120000);

  test('deleting a room message fans the removal to members', async () => {
    const sid = await createSpaceA(`chat-del-${RUN}`);
    await action(A, { 'add-member': { space: sid, who: SHIP_B, role: 'editor' } });
    await action(B, { 'join-space': { host: SHIP_A, space: sid } });
    await waitFor(async () => {
      const l = await scry(B, 'listing');
      return (l.spaces as any[]).some((s) => s.id === sid && s.joined) ? true : undefined;
    }, 60000);

    await action(A, { 'post-message': { space: sid, text: 'delete me' } });
    const seen = await waitFor(async () => {
      const c = await scry(B, `chat/${sid}`);
      return (c.messages as any[]).find((m) => m.text === 'delete me');
    }, 60000);
    await action(A, { 'delete-message': { space: sid, id: seen.id } });

    // B's mirror loses the message via the %space-chat-del fan-out.
    await waitFor(async () => {
      const c = await scry(B, `chat/${sid}`);
      return (c.messages as any[]).some((m) => m.text === 'delete me') ? undefined : true;
    }, 60000);
  }, 120000);
});

describe('cross-ship DMs', () => {
  test('A DMs B; B sees it (unread); B replies; A sees the reply', async () => {
    // A → B.
    await action(A, { 'send-dm': { who: SHIP_B, text: `hi bus ${RUN}` } });

    // B receives it (peer-to-peer poke), stored under ~nec, and unread.
    const onB = await waitFor(async () => {
      const t = await scry(B, `dm/${SHIP_A}`);
      return (t.messages as any[]).some((m) => m.text === `hi bus ${RUN}`)
        ? t
        : undefined;
    }, 60000);
    const fromA = (onB.messages as any[]).find((m) => m.text === `hi bus ${RUN}`);
    expect(fromA.author).toBe(`~${SHIP_A}`);

    // B's inbox lists ~nec with unread >= 1 and the right preview.
    const inboxB = await waitFor(async () => {
      const dms = (await scry(B, 'dms')) as any[];
      const row = dms.find((d) => d.peer === `~${SHIP_A}`);
      return row && row.unread >= 1 ? row : undefined;
    }, 60000);
    expect(inboxB['last-text']).toBe(`hi bus ${RUN}`);

    // B replies.
    await action(B, { 'send-dm': { who: SHIP_A, text: `hi nec ${RUN}` } });
    const onA = await waitFor(async () => {
      const t = await scry(A, `dm/${SHIP_B}`);
      return (t.messages as any[]).some((m) => m.text === `hi nec ${RUN}`)
        ? t
        : undefined;
    }, 60000);
    // A's thread has both directions.
    const texts = (onA.messages as any[]).map((m) => m.text);
    expect(texts).toContain(`hi bus ${RUN}`);
    expect(texts).toContain(`hi nec ${RUN}`);

    // A reading the thread clears its unread.
    await action(A, { 'read-dm': SHIP_B });
    await waitFor(async () => {
      const l = await scry(A, 'listing');
      return l.dmUnread === 0 || l['dm-unread'] === 0 ? true : undefined;
    }, 60000);
  }, 120000);
});
