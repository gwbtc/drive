import { describe, expect, test } from 'bun:test';
import * as Y from 'yjs';
import {
  buildServerDoc,
  applyServerState,
  encodeMissingUpdate,
  type ServerDocState,
} from './reconcile';

const stateOf = (d: Y.Doc): ServerDocState => ({
  snapshot: Array.from(Y.encodeStateAsUpdate(d)),
  updates: [],
});

describe('buildServerDoc', () => {
  test('rebuilds from snapshot + updates', () => {
    const a = new Y.Doc();
    a.getText('t').insert(0, 'snap');
    const snapshot = Array.from(Y.encodeStateAsUpdate(a));
    const sv = Y.encodeStateVector(a);
    a.getText('t').insert(4, ' + tail');
    const tail = Array.from(Y.encodeStateAsUpdate(a, sv));

    const rebuilt = buildServerDoc({ snapshot, updates: [tail] });
    expect(rebuilt.getText('t').toString()).toBe('snap + tail');
  });

  test('tolerates empty/null fields', () => {
    expect(buildServerDoc({}).getText('t').toString()).toBe('');
    expect(buildServerDoc({ snapshot: [], updates: [null, []] }).getText('t').toString()).toBe('');
  });
});

describe('encodeMissingUpdate', () => {
  test('returns null when the server has everything', () => {
    const local = new Y.Doc();
    local.getText('t').insert(0, 'same');
    expect(encodeMissingUpdate(local, stateOf(local))).toBeNull();
  });

  test('returns null for two empty docs', () => {
    expect(encodeMissingUpdate(new Y.Doc(), {})).toBeNull();
  });

  test('offline edits produce exactly the missing diff', () => {
    // Server knows the first sentence.
    const local = new Y.Doc();
    local.getText('t').insert(0, 'first.');
    const serverState = stateOf(local);

    // User keeps typing while offline.
    local.getText('t').insert(6, ' offline!');

    const diff = encodeMissingUpdate(local, serverState);
    expect(diff).not.toBeNull();

    // Applying the diff to the server's doc converges it with local…
    const server = buildServerDoc(serverState);
    Y.applyUpdate(server, new Uint8Array(diff!));
    expect(server.getText('t').toString()).toBe('first. offline!');

    // …and the diff is smaller than a full re-send of local state.
    expect(diff!.length).toBeLessThan(Y.encodeStateAsUpdate(local).length);
  });

  test('diff covers divergence in both directions safely', () => {
    // Local and server each saw a different concurrent edit.
    const base = new Y.Doc();
    base.getText('t').insert(0, 'base');
    const baseUpdate = Y.encodeStateAsUpdate(base);

    const local = new Y.Doc();
    Y.applyUpdate(local, baseUpdate);
    local.getText('t').insert(4, ' +local');

    const remote = new Y.Doc();
    Y.applyUpdate(remote, baseUpdate);
    remote.getText('t').insert(4, ' +remote');
    const serverState = stateOf(remote);

    // Pull first (like reconcile() does), then push the missing diff.
    applyServerState(local, serverState);
    const diff = encodeMissingUpdate(local, serverState);
    expect(diff).not.toBeNull();

    const server = buildServerDoc(serverState);
    Y.applyUpdate(server, new Uint8Array(diff!));
    expect(server.getText('t').toString()).toBe(local.getText('t').toString());
  });
});

describe('applyServerState', () => {
  test('is idempotent', () => {
    const src = new Y.Doc();
    src.getText('t').insert(0, 'once');
    const state = stateOf(src);

    const local = new Y.Doc();
    applyServerState(local, state);
    applyServerState(local, state);
    applyServerState(local, state);
    expect(local.getText('t').toString()).toBe('once');
  });

  test('passes origin through to update handlers', () => {
    const src = new Y.Doc();
    src.getText('t').insert(0, 'x');
    const state = stateOf(src);

    const local = new Y.Doc();
    const origins: unknown[] = [];
    local.on('update', (_u: Uint8Array, origin: unknown) => origins.push(origin));
    applyServerState(local, state, 'remote');
    expect(origins).toEqual(['remote']);
  });
});
