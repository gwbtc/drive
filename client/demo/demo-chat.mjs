// Two-ship live demo of Groundwire Drive CHAT — per-space rooms + 1:1 DMs.
// Drives ~nec and ~bus in parallel browser contexts; ffmpeg stitches the two
// viewports side by side afterward (see scripts/demo-record-chat.sh).
import { chromium } from '@playwright/test';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const OUT = join(dirname(fileURLToPath(import.meta.url)), 'out');
const A = { url: process.env.SHIP_A_URL, cookie: process.env.COOKIE_A, name: process.env.SHIP_A_NAME };
const B = { url: process.env.SHIP_B_URL, cookie: process.env.COOKIE_B, name: process.env.SHIP_B_NAME };
const VW = 1180, VH = 780;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function pair(c){ const i=c.indexOf('='); return { name:c.slice(0,i), value:c.slice(i+1) }; }

async function mkContext(browser, ship){
  const ctx = await browser.newContext({
    baseURL: ship.url, viewport:{width:VW,height:VH}, deviceScaleFactor:1,
    recordVideo:{ dir: join(OUT, ship.name), size:{width:VW,height:VH} },
  });
  const { name, value } = pair(ship.cookie);
  await ctx.addCookies([{ name, value, domain:new URL(ship.url).hostname, path:'/' }]);
  return ctx;
}

async function caption(page, text){
  await page.evaluate((t)=>{
    let el=document.getElementById('__democap');
    if(!el){ el=document.createElement('div'); el.id='__democap';
      el.style.cssText='position:fixed;left:0;right:0;bottom:0;z-index:2147483647;padding:16px 22px;'
        +'font:600 19px/1.4 system-ui,-apple-system,sans-serif;color:#fff;'
        +'background:linear-gradient(0deg,rgba(9,11,13,.96),rgba(9,11,13,.72));'
        +'border-top:2px solid #d98a58;pointer-events:none;';
      document.body.appendChild(el);
    }
    el.textContent=t;
  }, text);
}
async function badge(page, ship){
  await page.evaluate((s)=>{
    let el=document.getElementById('__demoship');
    if(!el){ el=document.createElement('div'); el.id='__demoship';
      el.style.cssText='position:fixed;left:50%;top:14px;transform:translateX(-50%);z-index:2147483647;pointer-events:none;'
        +'font:700 13px ui-monospace,monospace;color:#12100e;background:#d98a58;'
        +'padding:6px 13px;border-radius:20px;box-shadow:0 3px 12px rgba(0,0,0,.35);';
      document.body.appendChild(el);
    }
    el.textContent=s;
  }, ship);
}
async function both(nec, bus, text){ await caption(nec, text); await caption(bus, text); }

async function ready(page){
  await page.goto('/drive', { waitUntil:'domcontentloaded' });
  await page.locator('[data-testid="space-switcher"]').first().waitFor({ timeout:30000 });
  await sleep(400);
}

// Open the Engineering space via the rail and switch to its Chat tab.
async function toRoom(page){
  await page.locator('[data-testid="space-nav-item"]:has-text("Engineering")').first().click({ timeout:15000 });
  await sleep(700);
  await page.locator('[data-testid="space-chat-tab"]').first().click({ timeout:15000 });
  await page.locator('.chat-input').first().waitFor({ timeout:15000 });
  await sleep(500);
}

// Type a message into the visible chat composer and send it (Enter submits).
async function say(page, text){
  const input = page.locator('.chat-input').first();
  await input.click();
  await input.type(text, { delay:32 });
  await sleep(250);
  await input.press('Enter');
  await sleep(1400);
}

(async () => {
  const browser = await chromium.launch({ headless:true, slowMo:110 });
  const necCtx = await mkContext(browser, A);
  const busCtx = await mkContext(browser, B);
  const nec = await necCtx.newPage();
  const bus = await busCtx.newPage();
  const step = async (t, ms=1600) => { console.log('· '+t); await sleep(ms); };

  try {
    await ready(nec); await ready(bus);
    await badge(nec, `~${A.name}  ·  eng lead`);
    await badge(bus, `~${B.name}  ·  teammate`);
    await both(nec, bus, 'Two people, two Urbit ships. Chat is built right into Drive — no second app.');
    await step('intro', 3200);

    // ---- 1. nec creates a space + invites bus ----
    await caption(bus, 'Waiting for an invitation…');
    await caption(nec, '~nec spins up an Engineering space for the team.');
    await nec.locator('[data-testid="space-switcher"] button[title="New space"]').click();
    await sleep(500);
    await nec.locator('.modal input, [role="dialog"] input').first().fill('Engineering');
    await sleep(400);
    const mk = nec.locator('.modal button.primary, [role="dialog"] button.primary, .modal button:has-text("Create")').first();
    if (await mk.count()) await mk.click(); else await nec.keyboard.press('Enter');
    await nec.locator('[data-testid="space-nav-item"]:has-text("Engineering")').first().waitFor({ timeout:15000 });
    await nec.locator('[data-testid="space-nav-item"]:has-text("Engineering")').first().click();
    await sleep(900);

    await caption(nec, '…and invites ~bus as an editor.');
    await nec.locator('[data-testid="space-members-button"]').click();
    await nec.locator('[data-testid="space-add-member"]').waitFor({ timeout:8000 });
    await sleep(400);
    await nec.locator('[data-testid="space-add-member"] input').first().fill('~bus');
    await sleep(300);
    const roleSel = nec.locator('[data-testid="space-role-select"]');
    if (await roleSel.count()) await roleSel.selectOption({ label:'Editor' }).catch(()=>{});
    await nec.locator('[data-testid="space-add-member"] button[type="submit"]').click();
    await sleep(1200);
    await nec.locator('[data-testid="space-members-dialog"] button[aria-label="Close"]').click().catch(()=>{});
    await step('space + invite', 1200);

    // ---- 2. bus accepts ----
    await caption(bus, '~bus gets the invite on their own ship — and accepts.');
    await bus.locator('[data-testid="space-invite-row"]').first().waitFor({ timeout:30000 });
    await sleep(1200);
    await bus.locator('[data-testid="space-invite-accept"]').first().click();
    await bus.locator('[data-testid="space-nav-item"]:has-text("Engineering")').first().waitFor({ timeout:20000 });
    await step('accepted', 1800);

    // ---- 3. both open the room's Chat tab ----
    await both(nec, bus, 'Every space has a built-in chatroom. Both open the Chat tab.');
    await toRoom(nec); await toRoom(bus);
    await step('both in the room', 1800);

    // ---- 4. a live conversation across two ships ----
    await caption(nec, '~nec posts to the room…');
    await caption(bus, '…and it lands here on ~bus, live.');
    await say(nec, 'Morning! Did the API spec land?');
    await step('nec posted → streamed to bus', 1600);

    await caption(bus, '~bus replies from their own ship.');
    await caption(nec, 'Replies stream straight back to ~nec.');
    await say(bus, 'Yep — merged last night. Reviewing your PR now 👀');
    await step('bus replied', 1600);

    await caption(nec, 'Same thread, same order, on both servers.');
    await caption(bus, 'The host ship keeps everyone in sync.');
    await say(nec, 'Nice. Ship it when green ✅');
    await both(nec, bus, 'One room, two ships, everyone on the same page — no Slack required.');
    await step('conversation', 2600);

    // ---- 5. unread badge ----
    await caption(bus, '~bus steps away to Files…');
    await caption(nec, '~nec drops one more note.');
    await bus.locator('.rail-item:has-text("Files")').first().click();
    await sleep(1200);
    await say(nec, 'Standup moved to 11.');
    await sleep(1200);
    await caption(bus, 'An unread badge appears on the space — nothing missed.');
    await bus.locator('[data-testid="space-nav-item"]:has-text("Engineering")').first().waitFor({ timeout:8000 });
    await step('unread badge on bus', 2600);

    // ---- 6. direct messages ----
    await caption(nec, 'Need a private word? Direct messages, ship to ship.');
    await caption(bus, 'DMs are peer-to-peer — no host, no space needed.');
    await nec.locator('.rail-item:has-text("Messages")').first().click();
    await nec.locator('.dm-sidebar-head').waitFor({ timeout:15000 });
    await sleep(700);
    await nec.locator('.dm-sidebar-head button:has-text("New")').first().click();
    await sleep(600);
    await nec.locator('.modal input, [role="dialog"] input').first().fill('~bus');
    await sleep(400);
    await nec.keyboard.press('Enter');
    await nec.locator('.chat-input').first().waitFor({ timeout:15000 });
    await sleep(500);
    await say(nec, 'quick 1:1 before standup?');
    await step('nec DMs bus', 1400);

    await caption(bus, '~bus sees the Messages badge light up.');
    await sleep(1600);
    await bus.locator('.rail-item:has-text("Messages")').first().click();
    await bus.locator('.dm-list-item').first().waitFor({ timeout:15000 });
    await sleep(900);
    await bus.locator('.dm-list-item').first().click();
    await bus.locator('.chat-input').first().waitFor({ timeout:15000 });
    await sleep(800);
    await caption(bus, '~bus opens the thread and replies.');
    await caption(nec, 'And it arrives on ~nec, instantly.');
    await say(bus, 'sure — omw ☕');
    await both(nec, bus, 'Docs, sheets, notes, rooms, and DMs — one workspace, on servers you own.');
    await step('dm round-trip', 3000);

    await both(nec, bus, 'Groundwire Drive — chat included.');
    await step('outro', 3600);
  } catch (e) {
    console.error('DEMO ERROR:', e.message);
    await caption(nec, 'Groundwire Drive — chat').catch(()=>{});
    await sleep(1500);
  } finally {
    await necCtx.close(); await busCtx.close(); await browser.close();
    console.log('videos in', OUT);
  }
})();
