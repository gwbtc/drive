import { describe, expect, test } from 'bun:test';
import {
  buildSearchDocs,
  currentJoinedDocs,
  type JoinedSpaceDocs,
} from './spaceSearch';
import type { DocSummary } from '../api';

// Minimal DocSummary factory — only the fields the merge reads matter.
const doc = (id: string, title = id): DocSummary => ({
  id,
  title,
  type: 'text',
  owner: '~zod',
  role: 'owner',
  modified: 0,
  created: 0,
  parent: null,
  blob: null,
  acl: [],
});

const group = (
  name: string,
  host: string,
  docs: DocSummary[],
  id = name,
): JoinedSpaceDocs => ({
  id,
  name,
  host,
  docs,
});

describe('buildSearchDocs', () => {
  test('local docs pass through untagged', () => {
    const out = buildSearchDocs([doc('a'), doc('b')], []);
    expect(out.map((d) => d.id)).toEqual(['a', 'b']);
    expect(out.every((d) => d.remoteHost === undefined)).toBe(true);
    expect(out.every((d) => d.spaceName === undefined)).toBe(true);
  });

  test('joined-space docs are appended and tagged with host + space name', () => {
    const out = buildSearchDocs(
      [doc('a')],
      [group('Acme', '~bus', [doc('x'), doc('y')])],
    );
    expect(out.map((d) => d.id)).toEqual(['a', 'x', 'y']);
    const x = out.find((d) => d.id === 'x')!;
    expect(x.remoteHost).toBe('~bus');
    expect(x.spaceName).toBe('Acme');
  });

  test('a local doc wins over a joined-space doc with the same id', () => {
    const out = buildSearchDocs(
      [doc('shared', 'Local title')],
      [group('Acme', '~bus', [doc('shared', 'Remote title')])],
    );
    const rows = out.filter((d) => d.id === 'shared');
    expect(rows).toHaveLength(1);
    // The local (untagged) copy is kept, not the remote one.
    expect(rows[0].title).toBe('Local title');
    expect(rows[0].remoteHost).toBeUndefined();
  });

  test('a doc shared across two joined spaces is listed once (first wins)', () => {
    const out = buildSearchDocs(
      [],
      [
        group('Acme', '~bus', [doc('dup')]),
        group('Beta', '~web', [doc('dup')]),
      ],
    );
    const rows = out.filter((d) => d.id === 'dup');
    expect(rows).toHaveLength(1);
    expect(rows[0].remoteHost).toBe('~bus');
    expect(rows[0].spaceName).toBe('Acme');
  });

  test('empty inputs yield an empty set', () => {
    expect(buildSearchDocs([], [])).toEqual([]);
  });
});

describe('currentJoinedDocs', () => {
  const acme = group('Acme', '~bus', [doc('x')], 'space-acme');
  const beta = group('Beta', '~web', [doc('y')], 'space-beta');

  test('keeps only groups whose space-id is in the current joined set', () => {
    const out = currentJoinedDocs([acme, beta], new Set(['space-acme']));
    expect(out.map((g) => g.id)).toEqual(['space-acme']);
  });

  test('a space you have LEFT (id gone) contributes no docs', () => {
    // Simulate the palette's stale 30s cache still holding both groups after
    // Beta was left: only the still-joined Acme survives the intersection.
    const cached = [acme, beta];
    const afterLeaving = currentJoinedDocs(cached, new Set(['space-acme']));
    const searchable = buildSearchDocs([], afterLeaving);
    expect(searchable.map((d) => d.id)).toEqual(['x']);
    // The left space's remote doc is neither searchable nor openable.
    expect(searchable.find((d) => d.id === 'y')).toBeUndefined();
  });

  test('an empty joined set drops everything', () => {
    expect(currentJoinedDocs([acme, beta], new Set())).toEqual([]);
  });
});
