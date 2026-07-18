// Migration spec: runs against the frozen state-7 fixture pier AFTER the
// current desk (with newer state) has been committed into it, and asserts
// the on-load upgrade preserved every piece of seeded data.
// Run via scripts/e2e-migration.sh.

import { describe, test, expect } from 'bun:test';
import { FIXTURE, rebuildText } from './fixture-lib';

const BASE = process.env.SHIP_URL ?? '';
const COOKIE = process.env.COOKIE ?? '';
if (!BASE || !COOKIE) {
  throw new Error('SHIP_URL and COOKIE env vars required (use scripts/e2e-migration.sh)');
}

const EXPECTED_STATE_VERSION = Number(process.env.EXPECTED_STATE_VERSION ?? '8');

async function scry(path: string): Promise<any> {
  const r = await fetch(`${BASE}/~/scry/drive/${path}.json`, {
    headers: { cookie: COOKIE },
  });
  if (!r.ok) throw new Error(`scry ${path} → ${r.status}`);
  return r.json();
}

describe('state migration preserves data', () => {
  test('health reports the upgraded state version', async () => {
    const r = await fetch(`${BASE}/drive/api/health`, { headers: { cookie: COOKIE } });
    expect(r.ok).toBe(true);
    const j = await r.json();
    expect(j['state-version']).toBe(EXPECTED_STATE_VERSION);
  });

  test('docs, folder tree, and Yjs content are intact', async () => {
    const listing = await scry('listing');
    const byTitle = (t: string) => listing.owned.find((d: any) => d.title === t);

    const textDoc = byTitle(FIXTURE.textTitle);
    expect(textDoc).toBeDefined();
    const folder = byTitle(FIXTURE.folderTitle);
    expect(folder.type).toBe('folder');
    const child = byTitle(FIXTURE.childTitle);
    expect(child.parent).toBe(folder.id);

    const contents = await scry(`folder/${folder.id}/contents`);
    expect(contents.items.map((d: any) => d.id)).toContain(child.id);

    const r = await fetch(`${BASE}/drive/state?id=${textDoc.id}`, {
      headers: { cookie: COOKIE },
    });
    expect(r.ok).toBe(true);
    expect(rebuildText(await r.json())).toBe(FIXTURE.textContent);
  });

  test('comments survived', async () => {
    const listing = await scry('listing');
    const textDoc = listing.owned.find((d: any) => d.title === FIXTURE.textTitle);
    const comments = (await scry(`comments/for/${textDoc.id}`)).comments;
    expect(comments.length).toBe(1);
    expect(comments[0].text).toBe(FIXTURE.commentText);
    expect(comments[0].anchor).toBe(FIXTURE.commentAnchor);
  });

  test('token grants survived and still mint sessions', async () => {
    const listing = await scry('listing');
    const textDoc = listing.owned.find((d: any) => d.title === FIXTURE.textTitle);
    const tokens = (await scry(`tokens/for/${textDoc.id}`)).tokens;
    expect(tokens.length).toBe(1);
    expect(tokens[0].role).toBe(FIXTURE.tokenRole);

    const entry = await fetch(`${BASE}/drive/t?k=${tokens[0].token}`, {
      redirect: 'manual',
    });
    expect(entry.status).toBe(302);
  });

  test('trash entries survived', async () => {
    const trash = (await scry('trash')).items;
    expect(trash.map((t: any) => t.title)).toContain(FIXTURE.trashedTitle);
  });
});
