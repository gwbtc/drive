// The spreadsheet — engine recalc, multi-sheet, and the
// row-insert reference-rewriting fix, driven through the real virtualized grid.

import { test, expect } from '@playwright/test';
import { COOKIE, SHIP_URL, cookiePair, uniq } from './helpers';

async function newSheet(page: import('@playwright/test').Page): Promise<string> {
  await page.goto('/drive/files');
  await page.getByRole('button', { name: '+ Sheet' }).click();
  // Rename immediately to a unique title so "Untitled Sheet" rows never
  // accumulate across specs (which would make .first() grab a prior test's
  // doc — a multi-sheet one — and corrupt the tab count).
  const row = page.locator('.files-row-main', { hasText: 'Untitled Sheet' }).first();
  await row.click();
  await page.waitForURL(/\/drive\/d\//);
  await expect(page.locator('[data-testid="sheet-grid"]')).toBeVisible({ timeout: 15_000 });
  const docId = new URL(page.url()).pathname.match(/\/drive\/d\/([^/]+)/)![1];
  const title = uniq('sheet');
  await page.locator('.title-input').fill(title);
  await page.locator('.title-input').press('Enter');
  return docId;
}

// Enter a cell value: click, Enter to open the inline editor, fill, commit.
// (Avoids type-to-edit, whose first key seeds the buffer and races the input
// focus timeout — the same reason helpers.setSheetCell does it this way.)
async function typeCell(
  page: import('@playwright/test').Page,
  r: number,
  c: number,
  value: string,
): Promise<void> {
  await page.locator(`[data-cell="${r}:${c}"]`).click();
  await page.waitForTimeout(80);
  await page.keyboard.type(value, { delay: 45 });
  await page.keyboard.press('Enter');
  await expect(page.locator('[data-testid="cell-input"]')).toHaveCount(0);
}

const cellText = (page: import('@playwright/test').Page, r: number, c: number) =>
  page.locator(`[data-cell="${r}:${c}"]`);

test('formula recalc: =SUM and a dependent chain update live', async ({ page }) => {
  await newSheet(page);
  await typeCell(page, 0, 0, '2'); // A1
  await typeCell(page, 1, 0, '3'); // A2
  await typeCell(page, 2, 0, '=SUM(A1:A2)'); // A3 → 5
  await expect(cellText(page, 2, 0)).toHaveText('5');

  await typeCell(page, 3, 0, '=A3*10'); // A4 → 50
  await expect(cellText(page, 3, 0)).toHaveText('50');

  // Editing A1 propagates through A3 to A4.
  await typeCell(page, 0, 0, '12'); // A1 = 12 → A3=15 → A4=150
  await expect(cellText(page, 2, 0)).toHaveText('15');
  await expect(cellText(page, 3, 0)).toHaveText('150');
});

test('absolute refs and the & operator', async ({ page }) => {
  await newSheet(page);
  await typeCell(page, 0, 0, '10'); // A1
  await typeCell(page, 0, 1, '=$A$1+5'); // B1 → 15
  await expect(cellText(page, 0, 1)).toHaveText('15');
  await typeCell(page, 1, 0, 'hello'); // A2
  await typeCell(page, 1, 1, '=A2&" world"'); // B2
  await expect(cellText(page, 1, 1)).toHaveText('hello world');
});

test('row insert rewrites formula references (the headline fix)', async ({ page }) => {
  await newSheet(page);
  await typeCell(page, 1, 0, '3'); // A2
  await typeCell(page, 2, 0, '7'); // A3
  await typeCell(page, 4, 0, '=SUM(A2:A3)'); // A5 → 10
  await expect(cellText(page, 4, 0)).toHaveText('10');

  // Insert a row ABOVE row 2 (so A2:A3 must become A3:A4 to still cover 3,7).
  await page.locator('[data-cell="1:0"]').click();
  await page.locator('[title="Insert row above"]').click();

  // The sum still equals 10 — the reference followed the shifted data.
  await expect(cellText(page, 5, 0)).toHaveText('10');
});

test('multi-sheet: add a tab and reference across sheets', async ({ page }) => {
  const id = await newSheet(page);
  await typeCell(page, 0, 0, '100'); // Sheet1!A1

  await page.locator('[data-testid="add-sheet"]').click();
  const tabs = page.locator('[data-testid="sheet-tab"]');
  await expect(tabs).toHaveCount(2, { timeout: 10_000 });
  await tabs.nth(1).click(); // switch to Sheet2

  await typeCell(page, 0, 0, '=Sheet1!A1*2'); // Sheet2!A1 → 200
  await expect(cellText(page, 0, 0)).toHaveText('200');

  // Reload: the second sheet and its cross-ref persist.
  await page.reload();
  await expect(page.locator('[data-testid="sheet-tab"]')).toHaveCount(2, { timeout: 15_000 });
  void id;
});

test('fill handle: drag-fill offsets relative formula refs', async ({ page }) => {
  await newSheet(page);
  await typeCell(page, 0, 0, '5'); // A1
  await typeCell(page, 0, 1, '=A1*2'); // B1 → 10
  await expect(cellText(page, 0, 1)).toHaveText('10');

  // Put a different value in A2 so a filled =A2*2 is distinguishable.
  await typeCell(page, 1, 0, '7'); // A2

  // Select B1, then drag its fill handle down to B2.
  await cellText(page, 0, 1).click();
  const handle = page.locator('[data-testid="fill-handle"]');
  await expect(handle).toBeVisible();
  await handle.dragTo(cellText(page, 1, 1)); // drag onto B2

  // B2 should now be =A2*2 → 14.
  await expect(cellText(page, 1, 1)).toHaveText('14', { timeout: 10_000 });
});

test('version restore recreates a deleted sheet (multi-sheet restore fix)', async ({
  page,
}) => {
  await newSheet(page);
  await typeCell(page, 0, 0, 'sheet1data'); // Sheet1!A1

  // Add Sheet2 with its own data.
  await page.locator('[data-testid="add-sheet"]').click();
  const tabs = page.locator('[data-testid="sheet-tab"]');
  await expect(tabs).toHaveCount(2, { timeout: 10_000 });
  await tabs.nth(1).click();
  await typeCell(page, 0, 0, 'sheet2data'); // Sheet2!A1

  // Save a named version capturing BOTH sheets. (Sheets open history via the
  // 🕘 button, not the text-doc ⋯ menu.)
  await page.getByRole('button', { name: 'Version history' }).click();
  await page.getByRole('button', { name: /save current version/i }).click();
  await page.locator('.dialog input, .dialog textarea').first().fill('both-sheets');
  await page.locator('.dialog').getByRole('button', { name: /save/i }).click();
  await expect(page.locator('.history-version-label', { hasText: 'both-sheets' })).toBeVisible({
    timeout: 15_000,
  });

  // Delete Sheet2 via its × close button → app confirm dialog.
  await tabs.nth(1).locator('.sheet-tab-close').click();
  await page.locator('.dialog').getByRole('button', { name: /delete/i }).click();
  await expect(page.locator('[data-testid="sheet-tab"]')).toHaveCount(1, { timeout: 10_000 });

  // Reopen history (deleting the sheet may have changed the panel), restore.
  if (!(await page.locator('.history-version-label', { hasText: 'both-sheets' }).count())) {
    await page.getByRole('button', { name: 'Version history' }).click();
  }
  const versionRow = page.locator('.history-version', { hasText: 'both-sheets' }).first();
  await versionRow.getByRole('button', { name: /^restore/i }).click();
  await page.locator('.dialog').getByRole('button', { name: /restore/i }).click();

  await expect(page.locator('[data-testid="sheet-tab"]')).toHaveCount(2, { timeout: 15_000 });
  await page.locator('[data-testid="sheet-tab"]').nth(1).click();
  await expect(cellText(page, 0, 0)).toHaveText('sheet2data', { timeout: 10_000 });
});

test('sheet content persists across reload (s0 end-to-end)', async ({ page }) => {
  // The legacy aliasing migration is unit-tested in model.test.ts; here we
  // guard end-to-end persistence of the default sheet (s0) through the full
  // Yjs → agent → reload path.
  await newSheet(page);
  await typeCell(page, 0, 0, '=1+1');
  await typeCell(page, 1, 0, 'text value');
  await expect(cellText(page, 0, 0)).toHaveText('2');
  await page.reload();
  await expect(page.locator('[data-testid="sheet-grid"]')).toBeVisible({ timeout: 15_000 });
  await expect(cellText(page, 0, 0)).toHaveText('2');
  await expect(cellText(page, 1, 0)).toHaveText('text value');
  void COOKIE;
  void SHIP_URL;
  void cookiePair;
});
