// Shared plumbing for the browser-level specs. Node-side: talks to the ship
// with the harness cookie (COOKIE env) and rebuilds Y.Docs from
// GET /drive/state to make authoritative server-side assertions.

import { expect, type Browser, type BrowserContext, type Page } from '@playwright/test';
import * as Y from 'yjs';

export const SHIP_URL = process.env.SHIP_URL ?? 'http://localhost:18110';
export const COOKIE = process.env.COOKIE ?? '';

export function cookiePair(): { name: string; value: string } {
  const i = COOKIE.indexOf('=');
  if (i <= 0) {
    throw new Error('COOKIE env missing/malformed — run via scripts/e2e-browser.sh');
  }
  return { name: COOKIE.slice(0, i), value: COOKIE.slice(i + 1) };
}

// A second, independently-storaged browser context that shares the ship
// session (cookie injection — the harness already logged in via curl).
export async function newShipContext(browser: Browser): Promise<BrowserContext> {
  const ctx = await browser.newContext({ baseURL: SHIP_URL });
  const { name, value } = cookiePair();
  await ctx.addCookies([
    { name, value, domain: new URL(SHIP_URL).hostname, path: '/' },
  ]);
  return ctx;
}

// ---------------------------------------------------------------- server API

// Shape of GET /drive/state (see client/src/providers/reconcile.ts).
export type ServerDocState = {
  snapshot?: number[] | null;
  updates?: Array<number[] | null> | null;
  meta?: { title: string; modified: number };
};

export async function fetchServerState(docId: string): Promise<ServerDocState> {
  const r = await fetch(`${SHIP_URL}/drive/state?id=${docId}`, {
    headers: { cookie: COOKIE },
  });
  if (!r.ok) throw new Error(`GET /drive/state?id=${docId} → ${r.status}`);
  return (await r.json()) as ServerDocState;
}

function buildYDoc(state: ServerDocState): Y.Doc {
  const d = new Y.Doc();
  if (state.snapshot && state.snapshot.length > 0) {
    Y.applyUpdate(d, new Uint8Array(state.snapshot));
  }
  for (const u of state.updates ?? []) {
    if (u && u.length > 0) Y.applyUpdate(d, new Uint8Array(u));
  }
  return d;
}

// Rebuild the server's copy of a TEXT doc and render its Tiptap fragment as
// an XML string, e.g. "<paragraph>hello</paragraph>".
export async function serverDocText(docId: string): Promise<string> {
  const d = buildYDoc(await fetchServerState(docId));
  const text = d.getXmlFragment('default').toString();
  d.destroy();
  return text;
}

// Rebuild the server's copy of a SHEET doc as { "r:c": raw } cells.
export async function serverSheetCells(docId: string): Promise<Record<string, string>> {
  const d = buildYDoc(await fetchServerState(docId));
  const out: Record<string, string> = {};
  d.getMap<string>('cells').forEach((v, k) => {
    out[k] = v;
  });
  d.destroy();
  return out;
}

export async function waitForServerText(
  docId: string,
  needle: string,
  timeoutMs = 45_000,
): Promise<void> {
  await expect
    .poll(() => serverDocText(docId), {
      timeout: timeoutMs,
      message: `server /drive/state for ${docId} to contain ${JSON.stringify(needle)}`,
    })
    .toContain(needle);
}

// ------------------------------------------------------------------- UI bits

// The ProseMirror root inside the text editor. contenteditable flips to
// "true" only once meta/role load says we may edit — waiting on this
// selector therefore also waits for editability.
export const editor = (page: Page) =>
  page.locator('.prose div[contenteditable="true"]');

// Same node without the editability requirement (offline reloads render the
// doc read-only because whoami/meta fetches fail).
export const editorContent = (page: Page) => page.locator('.prose .tiptap');

export const pipLabel = (page: Page) => page.locator('.pip-label');

export async function waitForSaved(page: Page, timeoutMs = 30_000): Promise<void> {
  await expect(pipLabel(page)).toHaveText('All changes saved', { timeout: timeoutMs });
}

// Create a doc/sheet through the Files view UI, open it by clicking its row,
// give it a unique title, and return its docId (from /drive/d/<id>).
export async function createDocViaUI(
  page: Page,
  kind: 'text' | 'sheet',
  title: string,
): Promise<string> {
  const button = kind === 'sheet' ? '+ Sheet' : '+ Document';
  const defaultTitle = kind === 'sheet' ? 'Untitled Sheet' : 'Untitled Document';

  await page.goto('/drive/files');
  await page.getByRole('button', { name: button }).click();

  // The list re-renders after the create action; newest-first sort puts the
  // fresh doc on top. (Each spec renames its doc, so at most one row carries
  // the default title.)
  const row = page.locator('.files-row-main', { hasText: defaultTitle }).first();
  await row.click();
  await page.waitForURL(/\/drive\/d\//);
  const m = new URL(page.url()).pathname.match(/\/drive\/d\/([^/]+)/);
  if (!m) throw new Error(`not on a doc URL: ${page.url()}`);
  const docId = m[1];

  // The Share button appears once listDocs meta arrives with role=owner —
  // the same gate that makes the editor editable.
  await expect(page.getByRole('button', { name: 'Share' })).toBeVisible();

  // Unique title so later specs' default-titled rows are unambiguous.
  await page.locator('.title-input').fill(title);
  await page.locator('.title-input').press('Enter');
  await expect
    .poll(async () => (await fetchServerState(docId)).meta?.title, {
      timeout: 15_000,
      message: 'rename to land on the server',
    })
    .toBe(title);

  return docId;
}

// --------------------------------------------------------------- sheet bits

// The virtualized grid cell at row r / col c (0-based).
export const sheetCell = (page: Page, r: number, c: number) =>
  page.locator(`[data-cell="${r}:${c}"]`);

// Click the cell, Enter to open the inline editor, fill, Enter to commit.
// (Deliberately avoids type-to-edit: the first printable key seeds the edit
// buffer via wrap-level keydown and races the input's focus timeout.)
export async function setSheetCell(
  page: Page,
  r: number,
  c: number,
  value: string,
): Promise<void> {
  // Type-to-edit like a human: select the cell, let focusGrid settle, then
  // type with per-key spacing so the first key opens the editor (startEdit)
  // and the input focuses before the rest arrive. Commit with Enter.
  // (fill()/blur()/dblclick on the controlled cell input all raced the
  // input's focus/state lifecycle under machine speed; paced typing doesn't.)
  await sheetCell(page, r, c).click();
  await page.waitForTimeout(80);
  await page.keyboard.type(value, { delay: 45 });
  await page.keyboard.press('Enter');
  await expect(page.locator('[data-testid="cell-input"]')).toHaveCount(0);
}

export const uniq = (prefix: string) =>
  `${prefix}-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
