// Shared vocabulary between the state-7 fixture seeder and the migration
// spec. The seeder (run against the OLD desk) creates exactly this data;
// the migration spec (run against the NEW desk on the upgraded pier)
// asserts every piece survived on-load.

import * as Y from 'yjs';

export const FIXTURE = {
  textTitle: 'fixture-text',
  textContent: 'written under state-7',
  folderTitle: 'fixture-folder',
  childTitle: 'fixture-child-note',
  trashedTitle: 'fixture-trashed',
  commentText: 'fixture comment survives migration',
  commentAnchor: 'state-7',
  commentId: '0v3.00000.00001',
  tokenRole: 'editor',
} as const;

export const encodeFixtureText = (): number[] => {
  const d = new Y.Doc();
  d.getText('t').insert(0, FIXTURE.textContent);
  return Array.from(Y.encodeStateAsUpdate(d));
};

export const rebuildText = (state: any): string => {
  const d = new Y.Doc();
  if (state.snapshot?.length) Y.applyUpdate(d, new Uint8Array(state.snapshot));
  for (const u of state.updates ?? []) {
    if (u?.length) Y.applyUpdate(d, new Uint8Array(u));
  }
  return d.getText('t').toString();
};
