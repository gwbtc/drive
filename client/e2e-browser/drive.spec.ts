// Browser-level e2e for Groundwire Drive — the handful of behaviors only a real
// browser can prove: Tiptap editing round-trips, SSE live collab across
// contexts, y-indexeddb offline durability + reconcile push, the save-state
// pip, and the sheet grid. Run via scripts/e2e-browser.sh (boots ~nec).

import { test, expect } from '@playwright/test';
import {
  createDocViaUI,
  editor,
  editorContent,
  newShipContext,
  pipLabel,
  serverDocText,
  serverSheetCells,
  setSheetCell,
  sheetCell,
  uniq,
  waitForSaved,
  waitForServerText,
} from './helpers';

// -------------------------------------------------------------------- (a)

test('create a text doc from Files, type, reload — content persists', async ({
  page,
}) => {
  const title = uniq('e2e-persist');
  const docId = await createDocViaUI(page, 'text', title);

  const marker = uniq('quick-brown-fox');
  await editor(page).click();
  await page.keyboard.type(`The ${marker} jumps.`, { delay: 15 });

  await waitForSaved(page);
  // Authoritative round-trip: the ship's /drive/state rebuilds to the text.
  await waitForServerText(docId, marker);

  await page.reload();
  await expect(editorContent(page)).toContainText(marker);
  await expect(page.locator('.title-input')).toHaveValue(title);
});

// -------------------------------------------------------------------- (b)

test('SSE live collab: typing in one context appears in another', async ({
  page,
  browser,
}) => {
  const docId = await createDocViaUI(page, 'text', uniq('e2e-collab'));

  const ctxB = await newShipContext(browser);
  try {
    const pageB = await ctxB.newPage();
    await pageB.goto(`/drive/d/${docId}`);
    // Wait until B's SSE is open (Live) before A types, so the update
    // arrives as a fact rather than via B's initial state pull.
    await expect(pipLabel(pageB)).toHaveText(/Live|All changes saved/);

    const marker = uniq('from-a');
    await editor(page).click();
    await page.keyboard.type(`collab ${marker}`, { delay: 15 });

    await expect(editorContent(pageB)).toContainText(marker, {
      timeout: 20_000,
    });
  } finally {
    await ctxB.close();
  }
});

// -------------------------------------------------------------------- (c)

test('offline durability: IndexedDB keeps edits across page death; reconcile pushes them', async ({
  page,
  context,
}) => {
  const docId = await createDocViaUI(page, 'text', uniq('e2e-offline'));

  await editor(page).click();
  await page.keyboard.type('first', { delay: 15 });
  await waitForSaved(page);
  await waitForServerText(docId, 'first');

  // Go offline and keep typing. Saves fail; the Y.Doc + IndexedDB hold the
  // edit; the pip must say so.
  await context.setOffline(true);
  await editor(page).click();
  await page.keyboard.press('End');
  await page.keyboard.type(' offline', { delay: 15 });
  await expect(pipLabel(page)).toHaveText('Save failed — retrying');
  expect(await serverDocText(docId)).not.toContain('offline');

  // Give y-indexeddb a beat to flush the last update, then kill the page
  // WHILE STILL OFFLINE. From here on, ' offline' exists in exactly one
  // place: this context's IndexedDB. (A literal offline *reload* cannot
  // render — see the fixme spec below.)
  await page.waitForTimeout(1000);
  await page.close();

  // Back online, open the doc in a fresh page of the same context. The
  // server still only has 'first'; if the editor and — decisively — the
  // ship end up with the full text, it can only have come from IndexedDB
  // via the reconcile push.
  await context.setOffline(false);
  expect(await serverDocText(docId)).not.toContain('offline');
  const page2 = await context.newPage();
  await page2.goto(`/drive/d/${docId}`);
  await expect(editorContent(page2)).toContainText('first offline');
  await expect(pipLabel(page2)).toHaveText('All changes saved', {
    timeout: 45_000,
  });
  await waitForServerText(docId, 'first offline', 45_000);
});

// The literal crown-jewel step — reload the page WHILE OFFLINE and render
// from IndexedDB — cannot pass today. This is an app limitation, not a test
// problem:
//   1. The shell (/drive/d/<id> HTML, app.js, app.css) is served by schooner
//      with only a content-type header — no cache-control/ETag/Last-Modified
//      — so Chromium will not reuse it from HTTP cache while offline
//      (navigation dies with net::ERR_INTERNET_DISCONNECTED), and there is
//      no service worker to serve it.
//   2. Even if the shell loaded, app.tsx gates ALL rendering on a live
//      GET /drive/api/whoami and shows "Couldn't connect" when it fails, so
//      the editor (and its IndexedDB copy) would never mount.
// The durability property itself is covered by the page-death spec above.
// Un-fixme this once the app ships an offline-capable shell (service worker
// or cacheable assets + a whoami fallback).
test('offline reload renders the app shell and doc from cache (M4 PWA)', async ({
  page,
  context,
}) => {
  const docId = await createDocViaUI(page, 'text', uniq('e2e-offline-reload'));
  await editor(page).click();
  await page.keyboard.type('first', { delay: 15 });
  await waitForSaved(page);

  // Give the service worker a beat to install + precache the shell.
  await page.waitForFunction(
    () => navigator.serviceWorker?.controller != null,
    undefined,
    { timeout: 15_000 },
  ).catch(() => {}); // if SW isn't controlling yet, the reload below still tests the fallback

  await context.setOffline(true);
  await editor(page).click();
  await page.keyboard.press('End');
  await page.keyboard.type(' offline', { delay: 15 });
  await expect(pipLabel(page)).toHaveText('Save failed — retrying');
  await page.waitForTimeout(500);

  // The crux of the M4 PWA work: a reload WHILE OFFLINE. The service worker
  // serves the cached shell, and app.tsx boots from the cached identity
  // instead of dying with ERR_INTERNET_DISCONNECTED (the M1 fixme).
  await page.reload();
  await expect(page.getByTestId('offline-indicator')).toBeVisible({ timeout: 15_000 });
  // And the doc content survives from IndexedDB (ourShip() falls back to the
  // cached ship so the per-doc cache opens under the right key).
  await expect(editorContent(page)).toContainText('first offline', { timeout: 15_000 });
  await context.setOffline(false);
  // (The reconnect-and-push path is covered by the offline-durability spec
  // above; here we only prove the offline shell+content render.)
  void docId;
});

// -------------------------------------------------------------------- (d)

test('save-failed pip: blocked submit-update shows failure, then recovers', async ({
  page,
}) => {
  const docId = await createDocViaUI(page, 'text', uniq('e2e-savefail'));

  await editor(page).click();
  await page.keyboard.type('base ', { delay: 15 });
  await waitForSaved(page);

  // Abort exactly the update-submitting POSTs; everything else (state pulls,
  // SSE, awareness) flows normally.
  await page.route('**/drive/action', async (route) => {
    const req = route.request();
    if (req.method() === 'POST' && (req.postData() ?? '').includes('submit-update')) {
      await route.abort();
    } else {
      await route.continue();
    }
  });

  const marker = uniq('recovered');
  await editor(page).click();
  await page.keyboard.press('End');
  await page.keyboard.type(marker, { delay: 15 });
  await expect(pipLabel(page)).toHaveText('Save failed — retrying');
  expect(await serverDocText(docId)).not.toContain(marker);

  // Unblock: the reconcile loop (exponential backoff, ≤30s) must deliver
  // the edit and the pip must settle back to saved.
  await page.unroute('**/drive/action');
  await expect(pipLabel(page)).toHaveText('All changes saved', {
    timeout: 60_000,
  });
  await waitForServerText(docId, marker);
});

// -------------------------------------------------------------------- (e)

test('sheet: numbers and =SUM() compute in the grid and persist', async ({
  page,
}) => {
  const docId = await createDocViaUI(page, 'sheet', uniq('e2e-sheet'));

  await setSheetCell(page, 0, 0, '2');
  await setSheetCell(page, 1, 0, '3');
  await setSheetCell(page, 2, 0, '=SUM(A1:A2)');

  await expect(sheetCell(page, 0, 0)).toHaveText('2');
  await expect(sheetCell(page, 1, 0)).toHaveText('3');
  await expect(sheetCell(page, 2, 0)).toHaveText('5');

  await waitForSaved(page);
  await expect
    .poll(async () => (await serverSheetCells(docId))['2:0'], {
      timeout: 30_000,
      message: 'formula cell to reach the server',
    })
    .toBe('=SUM(A1:A2)');

  await page.reload();
  await expect(sheetCell(page, 0, 0)).toHaveText('2');
  await expect(sheetCell(page, 1, 0)).toHaveText('3');
  await expect(sheetCell(page, 2, 0)).toHaveText('5');
});
