// Browser specs: version restore, starring, make-a-copy, live
// listings, full-text search, drag-and-drop move. Run via
// scripts/e2e-browser.sh (SHIP_URL + COOKIE injected).

import { test, expect } from '@playwright/test';
import {
  createDocViaUI,
  waitForSaved,
  serverDocText,
  newShipContext,
  uniq,
} from './helpers';

test('version restore: edit, save a version, edit again, restore brings the old text back', async ({
  page,
}) => {
  const docId = await createDocViaUI(page, 'text', uniq('ver'));
  const body = page.locator('.ProseMirror');

  await body.click();
  await page.keyboard.type('first version');
  await waitForSaved(page);

  // Open history (text docs reach it via the ⋯ More actions menu), save a
  // named version.
  await page.getByRole('button', { name: 'More actions' }).click();
  await page.locator('.tb-drop-item', { hasText: 'Version history' }).click();
  await page.getByRole('button', { name: /save current version/i }).click();
  await page.locator('.dialog input, .dialog textarea').first().fill('v1');
  await page.locator('.dialog').getByRole('button', { name: /save/i }).click();
  await expect(page.locator('.history-version-label', { hasText: 'v1' })).toBeVisible({
    timeout: 15_000,
  });

  // Change the content.
  await body.click();
  await page.keyboard.press('Control+A');
  await page.keyboard.press('Delete');
  await page.keyboard.type('second version');
  await waitForSaved(page);
  await expect
    .poll(() => serverDocText(docId), { timeout: 15_000 })
    .toContain('second version');

  // Restore v1.
  const versionRow = page
    .locator('.history-version', { hasText: 'v1' })
    .first();
  await versionRow.getByRole('button', { name: /^restore/i }).click();
  await page.locator('.dialog').getByRole('button', { name: /restore/i }).click();

  // Content reverts to v1, and the server converges to it.
  await expect(body).toContainText('first version', { timeout: 15_000 });
  await expect
    .poll(() => serverDocText(docId), { timeout: 15_000 })
    .toContain('first version');
});

test('star toggle reflects in the Starred view', async ({ page }) => {
  const title = uniq('star');
  await createDocViaUI(page, 'text', title);

  await page.goto('/drive/files');
  const row = page
    .locator('[data-testid="files-row"]', { hasText: title })
    .first();
  await expect(row).toBeVisible();
  await row.locator('[data-testid="star-toggle"]').click();

  await page.getByRole('link', { name: 'Starred' }).click();
  await page.waitForURL(/\/drive\/starred/);
  await expect(
    page.locator('[data-testid="files-row"]', { hasText: title }),
  ).toBeVisible({ timeout: 15_000 });
});

test('make a copy creates "Copy of …"', async ({ page }) => {
  const title = uniq('copy');
  await createDocViaUI(page, 'text', title);

  await page.goto('/drive/files');
  const row = page
    .locator('[data-testid="files-row"]', { hasText: title })
    .first();
  await row.click({ button: 'right' });
  await page.locator('.ctx-menu-item', { hasText: 'Make a copy' }).click();

  await expect(
    page.locator('[data-testid="files-row"]', { hasText: `Copy of ${title}` }),
  ).toBeVisible({ timeout: 15_000 });
});

test('live listings: a doc created in one context appears in another without reload', async ({
  page,
  browser,
}) => {
  await page.goto('/drive/files');
  const title = uniq('live');

  const ctx2 = await newShipContext(browser);
  const page2 = await ctx2.newPage();
  await page2.goto('/drive/files');
  await expect(page2.locator('.files-row-main').first()).toBeVisible({
    timeout: 15_000,
  });

  // Create in page 1.
  await page.getByRole('button', { name: '+ Document' }).click();

  // page 2 (never reloaded) shows it via the listing feed.
  await expect(
    page2.locator('.files-row-main', { hasText: 'Untitled Document' }),
  ).toBeVisible({ timeout: 20_000 });

  await ctx2.close();
  // (touch title so the created doc doesn't collide with other specs)
  void title;
});

test('full-text search finds a phrase in a doc body', async ({ page }) => {
  const phrase = `xyzzy-${Date.now()}`;
  const docId = await createDocViaUI(page, 'text', uniq('search'));
  await page.locator('.ProseMirror').click();
  await page.keyboard.type(`a document containing ${phrase} deep inside`);
  await waitForSaved(page);
  await expect.poll(() => serverDocText(docId), { timeout: 15_000 }).toContain(phrase);

  await page.goto('/drive/files');
  // Open the command palette and search the phrase (content, not title).
  await page.keyboard.press('Control+k');
  const input = page.locator('.cmdk input, input.cmdk-input').first();
  await input.fill(phrase);

  // A content hit with a snippet should appear and navigate to the doc.
  const hit = page.locator('.cmdk-content-main', { hasText: phrase }).first();
  await expect(hit).toBeVisible({ timeout: 20_000 });
  await hit.click();
  await expect(page).toHaveURL(new RegExp(`/drive/d/${docId}`));
});

test('drag a doc onto a folder moves it', async ({ page }) => {
  const folderName = uniq('folder');
  const docTitle = uniq('draggable');

  // Make a folder.
  await page.goto('/drive/files');
  await page.getByRole('button', { name: '+ Folder' }).click();
  await page.locator('.dialog input').first().fill(folderName);
  await page.locator('.dialog').getByRole('button', { name: /create/i }).click();
  await expect(
    page.locator('[data-testid="files-row"]', { hasText: folderName }),
  ).toBeVisible({ timeout: 15_000 });

  // Make a doc at root.
  await createDocViaUI(page, 'text', docTitle);
  await page.goto('/drive/files');

  const docRow = page
    .locator('[data-testid="files-row"]', { hasText: docTitle })
    .first();
  const folderRow = page
    .locator('[data-testid="files-row"]', { hasText: folderName })
    .first();
  await expect(docRow).toBeVisible();

  // Native HTML5 DnD: Playwright's dragTo synthesizes mouse events that
  // don't reliably fire dragstart/drop, so dispatch the drag events with a
  // shared DataTransfer explicitly.
  await page.evaluate(
    ({ dragSel, dropSel, dragText }) => {
      const src = document.evaluate(
        `//li[@data-testid='files-row'][.//*[contains(text(),${JSON.stringify(dragText)})]]`,
        document,
        null,
        XPathResult.FIRST_ORDERED_NODE_TYPE,
        null,
      ).singleNodeValue as HTMLElement;
      const dst = document.evaluate(
        `//li[@data-testid='files-row'][.//*[contains(text(),${JSON.stringify(dropSel)})]]`,
        document,
        null,
        XPathResult.FIRST_ORDERED_NODE_TYPE,
        null,
      ).singleNodeValue as HTMLElement;
      if (!src || !dst) throw new Error('drag/drop nodes not found');
      const dt = new DataTransfer();
      const fire = (el: HTMLElement, type: string) =>
        el.dispatchEvent(
          new DragEvent(type, { bubbles: true, cancelable: true, dataTransfer: dt }),
        );
      fire(src, 'dragstart');
      fire(dst, 'dragenter');
      fire(dst, 'dragover');
      fire(dst, 'drop');
      fire(src, 'dragend');
      void dragSel;
    },
    { dragSel: docTitle, dropSel: folderName, dragText: docTitle },
  );

  // The doc leaves the root listing…
  await expect(
    page.locator('[data-testid="files-row"]', { hasText: docTitle }),
  ).toHaveCount(0, { timeout: 15_000 });

  // …and appears inside the folder.
  await folderRow.click();
  await page.waitForURL(/\/drive\/files\//);
  await expect(
    page.locator('[data-testid="files-row"]', { hasText: docTitle }),
  ).toBeVisible({ timeout: 15_000 });
});
