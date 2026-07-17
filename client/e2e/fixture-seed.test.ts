// Seeds the state-7 fixture pier (run by scripts/make-state7-fixture.sh
// against the OLD desk). Creates the exact dataset e2e/migration.test.ts
// asserts on after an upgrade. Guarded by SEED=1 so a stray `bun test e2e`
// never seeds a normal run pier.

import { describe, test, expect } from 'bun:test';
import { FIXTURE, encodeFixtureText } from './fixture-lib';

const BASE = process.env.SHIP_URL ?? '';
const COOKIE = process.env.COOKIE ?? '';
const SEEDING = process.env.SEED === '1';

async function actionOk(body: unknown): Promise<void> {
  const r = await fetch(`${BASE}/drive/action`, {
    method: 'POST',
    headers: { cookie: COOKIE, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(`action ${JSON.stringify(body)} → ${r.status}`);
}

async function scry(path: string): Promise<any> {
  const r = await fetch(`${BASE}/~/scry/documents/${path}.json`, {
    headers: { cookie: COOKIE },
  });
  if (!r.ok) throw new Error(`scry ${path} → ${r.status}`);
  return r.json();
}

describe.if(SEEDING)('seed state-7 fixture', () => {
  test('create the fixture dataset', async () => {
    // A text doc with real Yjs content.
    await actionOk({ create: { 'doc-type': 'text', title: FIXTURE.textTitle, parent: null } });
    const listing = await scry('listing');
    const textDoc = listing.owned.find((d: any) => d.title === FIXTURE.textTitle);
    expect(textDoc).toBeDefined();
    await actionOk({ 'submit-update': { id: textDoc.id, update: encodeFixtureText() } });

    // A folder with a child note.
    await actionOk({ 'create-folder': { title: FIXTURE.folderTitle, parent: null } });
    const l2 = await scry('listing');
    const folder = l2.owned.find((d: any) => d.title === FIXTURE.folderTitle);
    await actionOk({ create: { 'doc-type': 'note', title: FIXTURE.childTitle, parent: folder.id } });

    // A comment on the text doc.
    await actionOk({
      'add-comment': {
        id: textDoc.id,
        'comment-id': FIXTURE.commentId,
        text: FIXTURE.commentText,
        anchor: FIXTURE.commentAnchor,
      },
    });

    // A share-link token (grant lives in state).
    await actionOk({ 'mint-token': { id: textDoc.id, role: FIXTURE.tokenRole } });

    // A trashed doc.
    await actionOk({ create: { 'doc-type': 'text', title: FIXTURE.trashedTitle, parent: null } });
    const l3 = await scry('listing');
    const trashed = l3.owned.find((d: any) => d.title === FIXTURE.trashedTitle);
    await actionOk({ delete: trashed.id });

    // Sanity: everything landed.
    const final = await scry('listing');
    expect(final.owned.map((d: any) => d.title)).toEqual(
      expect.arrayContaining([FIXTURE.textTitle, FIXTURE.folderTitle, FIXTURE.childTitle]),
    );
  });
});

test.if(!SEEDING)('fixture seeding skipped (SEED != 1)', () => {
  expect(true).toBe(true);
});
