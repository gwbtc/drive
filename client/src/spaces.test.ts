import { describe, expect, test } from 'bun:test';
import {
  isPersonal,
  personalDocs,
  spaceDocs,
  isJoinedSpace,
  visibleInvites,
  reconcileHiddenInvites,
} from './spaces';

const doc = (id: string, space?: string | null) => ({ id, space });

describe('isPersonal', () => {
  test('null space is personal', () => {
    expect(isPersonal({ space: null })).toBe(true);
  });
  test('absent space is personal', () => {
    expect(isPersonal({})).toBe(true);
  });
  test('a space-id is not personal', () => {
    expect(isPersonal({ space: '0vabc' })).toBe(false);
  });
});

describe('personalDocs / spaceDocs partition', () => {
  const docs = [
    doc('a', null),
    doc('b', '0vteam'),
    doc('c'), // absent → personal
    doc('d', '0vteam'),
    doc('e', '0vother'),
  ];

  test('personalDocs keeps only null/absent space', () => {
    expect(personalDocs(docs).map((d) => d.id)).toEqual(['a', 'c']);
  });

  test('spaceDocs keeps only the matching space', () => {
    expect(spaceDocs(docs, '0vteam').map((d) => d.id)).toEqual(['b', 'd']);
    expect(spaceDocs(docs, '0vother').map((d) => d.id)).toEqual(['e']);
  });

  test('personal and a given space are disjoint and cover their union', () => {
    const personal = personalDocs(docs).length;
    const team = spaceDocs(docs, '0vteam').length;
    const other = spaceDocs(docs, '0vother').length;
    expect(personal + team + other).toBe(docs.length);
  });
});

describe('isJoinedSpace', () => {
  test('joined:true is a joined (remote) space', () => {
    expect(isJoinedSpace({ joined: true })).toBe(true);
  });
  test('joined:false is a hosted space', () => {
    expect(isJoinedSpace({ joined: false })).toBe(false);
  });
  test('absent joined flag defaults to hosted', () => {
    expect(isJoinedSpace({})).toBe(false);
  });
});

describe('space-invite optimistic-hide', () => {
  const inv = (id: string) => ({ id });

  test('visibleInvites hides only ids in the hidden set', () => {
    const invites = [inv('a'), inv('b'), inv('c')];
    expect(visibleInvites(invites, new Set(['b'])).map((i) => i.id)).toEqual([
      'a',
      'c',
    ]);
  });

  test('an id NOT hidden is always shown (never swallowed)', () => {
    const invites = [inv('a')];
    // Whatever else is in the hidden set, an invite whose id is absent from it
    // must appear — the core invariant.
    expect(visibleInvites(invites, new Set(['x', 'y'])).map((i) => i.id)).toEqual([
      'a',
    ]);
  });

  test('reconcile keeps ids still present in invites (optimistic hold)', () => {
    const next = reconcileHiddenInvites(new Set(['a', 'b']), [inv('a'), inv('b')]);
    expect([...next].sort()).toEqual(['a', 'b']);
  });

  test('reconcile drops ids the backend has processed out of invites', () => {
    // `a` is gone from the listing → self-heal removes it; `b` still pending.
    const next = reconcileHiddenInvites(new Set(['a', 'b']), [inv('b')]);
    expect([...next]).toEqual(['b']);
  });

  test('re-invitation with a stable id is shown again, not permanently hidden', () => {
    // 1. Invite arrives, user accepts → optimistically hidden.
    let hidden = new Set(['space-1']);
    let invites = [inv('space-1')];
    expect(visibleInvites(invites, hidden)).toHaveLength(0); // vanishes at once

    // 2. Backend processes the accept → invite leaves the listing.
    invites = [];
    hidden = reconcileHiddenInvites(hidden, invites);
    expect(hidden.size).toBe(0);

    // 3. The SAME space re-invites (same stable id) while still mounted.
    invites = [inv('space-1')];
    hidden = reconcileHiddenInvites(hidden, invites);
    expect(visibleInvites(invites, hidden).map((i) => i.id)).toEqual(['space-1']);
  });
});
