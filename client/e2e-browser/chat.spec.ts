// Browser-level e2e for chat: the per-space room UI and 1:1 DMs, plus the
// mobile master-detail behavior. Cross-ship fan-out is proven by the API
// two-ship suite; here we prove the real SPA renders + drives it, single-ship
// (a room we host, and a note-to-self DM thread). Run via scripts/e2e-browser.sh.

import { test, expect } from '@playwright/test';
import { SHIP_URL, COOKIE, uniq } from './helpers';

async function apiAction(body: unknown): Promise<void> {
  const r = await fetch(`${SHIP_URL}/drive/action`, {
    method: 'POST',
    headers: { cookie: COOKIE, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(`action ${JSON.stringify(body)} → ${r.status}`);
}

async function apiScry(path: string): Promise<any> {
  const r = await fetch(`${SHIP_URL}/~/scry/drive/${path}.json`, {
    headers: { cookie: COOKIE },
  });
  if (!r.ok) throw new Error(`scry ${path} → ${r.status}`);
  return r.json();
}

async function createSpace(name: string): Promise<string> {
  await apiAction({ 'create-space': { name } });
  const l = await apiScry('listing');
  const s = (l.spaces as any[]).find((x: any) => x.name === name);
  if (!s) throw new Error(`space "${name}" not created`);
  return s.id;
}

// Our own ship (~nec) as displayed in the rail foot.
async function ownShip(page: import('@playwright/test').Page): Promise<string> {
  await page.goto('/drive');
  const t = (await page.locator('.rail-ship').textContent())?.trim() ?? '';
  if (!t.startsWith('~')) throw new Error(`unexpected ship label: "${t}"`);
  return t;
}

// -------------------------------------------------------------------- (a)

test('space room: post a message via the Chat tab', async ({ page }) => {
  const sid = await createSpace(uniq('BrowserChat'));
  await page.goto(`/drive/space/${sid}/chat`);

  const input = page.locator('.chat-input');
  await expect(input).toBeVisible();

  const marker = uniq('hello-room');
  await input.fill(marker);
  await page.getByRole('button', { name: 'Send' }).click();

  // Renders in the thread…
  await expect(page.locator('.chat-msg-text', { hasText: marker })).toBeVisible();
  // …and landed on the server.
  await expect
    .poll(async () => {
      const c = await apiScry(`chat/${sid}`);
      return (c.messages as any[]).some((m: any) => m.text === marker);
    })
    .toBe(true);
});

// -------------------------------------------------------------------- (b)

test('space view: Files/Chat tabs switch and deep-link', async ({ page }) => {
  const sid = await createSpace(uniq('TabsSpace'));
  await page.goto(`/drive/space/${sid}`);
  await expect(page.locator('.space-tab.active')).toHaveText('Files');

  await page.getByTestId('space-chat-tab').click();
  await page.waitForURL(/\/space\/[^/]+\/chat/);
  await expect(page.locator('.chat')).toBeVisible();
  await expect(page.locator('.space-tab.active')).toHaveText('Chat');
});

// -------------------------------------------------------------------- (c)

test('DM: send a message and see it in the inbox', async ({ page }) => {
  const ship = await ownShip(page);
  await page.goto(`/drive/dm/${ship}`); // a note-to-self thread is valid

  const input = page.locator('.chat-input');
  await expect(input).toBeVisible();
  const marker = uniq('dm-hi');
  await input.fill(marker);
  await page.getByRole('button', { name: 'Send' }).click();
  await expect(page.locator('.chat-msg-text', { hasText: marker })).toBeVisible();

  // The conversation shows up in the inbox with the right preview.
  await page.goto('/drive/messages');
  const row = page.locator('.dm-list-item', { hasText: ship });
  await expect(row).toBeVisible();
  await expect(row.locator('.dm-list-preview')).toContainText(marker);
});

// -------------------------------------------------------------------- (d)

test('Messages rail entry opens the inbox', async ({ page }) => {
  await page.goto('/drive');
  await page.getByRole('link', { name: 'Messages' }).click();
  await page.waitForURL(/\/drive\/messages/);
  await expect(page.locator('.dm-sidebar-head h1')).toHaveText('Messages');
});

// ------------------------------------------------------------------ mobile

test.describe('mobile layout', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('space room composer is reachable on a phone', async ({ page }) => {
    const sid = await createSpace(uniq('MobileChat'));
    await apiAction({ 'post-message': { space: sid, text: 'mobile hi' } });
    await page.goto(`/drive/space/${sid}/chat`);

    await expect(page.locator('.chat-msg-text', { hasText: 'mobile hi' })).toBeVisible();
    const composer = page.locator('.chat-composer');
    await expect(composer).toBeVisible();
    // The composer sits within the viewport (not pushed below the fold).
    const box = await composer.boundingBox();
    expect(box).not.toBeNull();
    if (box) expect(box.y + box.height).toBeLessThanOrEqual(844 + 1);
  });

  test('DM inbox is single-pane; tapping opens the thread with a Back button', async ({
    page,
  }) => {
    const ship = await ownShip(page);
    await apiAction({ 'send-dm': { who: ship.replace(/^~/, ''), text: 'seed' } });

    await page.goto('/drive/messages');
    // List pane shown, detail pane hidden.
    await expect(page.locator('.dm-layout')).toHaveAttribute('data-has-peer', 'false');
    await expect(page.locator('.dm-sidebar')).toBeVisible();

    await page.locator('.dm-list-item').first().click();
    await page.waitForURL(/\/drive\/dm\//);
    await expect(page.locator('.dm-layout')).toHaveAttribute('data-has-peer', 'true');
    await expect(page.locator('.dm-back')).toBeVisible();
    await expect(page.locator('.chat-input')).toBeVisible();

    // Back returns to the list.
    await page.locator('.dm-back').click();
    await page.waitForURL(/\/drive\/messages/);
    await expect(page.locator('.dm-sidebar')).toBeVisible();
  });
});
