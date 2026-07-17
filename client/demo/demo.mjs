// Two-ship live demo of Groundwire Drive, recorded to video.
// Drives ~nec and ~bus in parallel browser contexts; ffmpeg stitches the two
// viewports side by side afterward (see scripts/demo-record.sh).
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

// self-healing narration overlay (survives SPA route changes)
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

// Leave the full-screen editor (if in it) and open the Design space via the rail.
async function toSpace(page){
  const back = page.locator('[aria-label="Back to files"]');
  if (await back.count()) { await back.first().click().catch(()=>{}); await sleep(700); }
  await page.locator('[data-testid="space-switcher"]').first().waitFor({ timeout:15000 });
  await page.locator('[data-testid="space-nav-item"]:has-text("Design")').first().click({ timeout:15000 });
  await sleep(1000);
}

async function ready(page){
  await page.goto('/drive', { waitUntil:'domcontentloaded' });
  await page.locator('[data-testid="space-switcher"]').first().waitFor({ timeout:30000 });
  await sleep(400);
}

(async () => {
  const browser = await chromium.launch({ headless:true, slowMo:120 });
  const necCtx = await mkContext(browser, A);
  const busCtx = await mkContext(browser, B);
  const nec = await necCtx.newPage();
  const bus = await busCtx.newPage();

  const step = async (t, ms=1600) => { console.log('· '+t); await sleep(ms); };

  try {
    // ---- open on both ships ----
    await ready(nec); await ready(bus);
    await badge(nec, `~${A.name}  ·  Design lead`);
    await badge(bus, `~${B.name}  ·  teammate`);
    await both(nec, bus, 'Two people, two servers — ~nec and ~bus each run their own Urbit ship.');
    await step('intro', 3200);

    // ---- 1. nec creates a space ----
    await caption(bus, 'Waiting for an invitation…');
    await caption(nec, '~nec creates a shared space for the team.');
    await nec.locator('[data-testid="space-switcher"] button[title="New space"]').click();
    await sleep(500);
    const spName = nec.locator('.modal input, [role="dialog"] input').first();
    await spName.fill('Design');
    await sleep(400);
    // confirm (Enter, or a confirm button)
    const confirm = nec.locator('.modal button.primary, [role="dialog"] button.primary, .modal button:has-text("Create")').first();
    if (await confirm.count()) await confirm.click(); else await nec.keyboard.press('Enter');
    await nec.locator('[data-testid="space-nav-item"]:has-text("Design")').first().waitFor({ timeout:15000 });
    await step('space created', 1800);

    // open the space
    await nec.locator('[data-testid="space-nav-item"]:has-text("Design")').first().click();
    await sleep(1200);

    // ---- 2. nec invites ~bus ----
    await caption(nec, '~nec invites ~bus to the space, as an editor.');
    await nec.locator('[data-testid="space-members-button"]').click();
    await nec.locator('[data-testid="space-add-member"]').waitFor({ timeout:8000 });
    await sleep(500);
    await nec.locator('[data-testid="space-add-member"] input').first().fill('~bus');
    await sleep(300);
    const roleSel = nec.locator('[data-testid="space-role-select"]');
    if (await roleSel.count()) await roleSel.selectOption({ label:'Editor' }).catch(()=>{});
    await sleep(300);
    await nec.locator('[data-testid="space-add-member"] button[type="submit"]').click();
    await step('invited', 1600);
    // close the dialog
    await nec.locator('[data-testid="space-members-dialog"] button[aria-label="Close"]').click().catch(()=>{});
    await sleep(600);

    // ---- 3. bus accepts ----
    await caption(bus, '~bus gets the invitation on their own ship — and accepts.');
    await bus.locator('[data-testid="space-invite-row"]').first().waitFor({ timeout:30000 });
    await sleep(1400);
    await bus.locator('[data-testid="space-invite-accept"]').first().click();
    await bus.locator('[data-testid="space-nav-item"]:has-text("Design")').first().waitFor({ timeout:20000 });
    await step('accepted — space now in bus\'s sidebar', 2200);

    // ---- 4. nec creates a doc; both open it BEFORE typing so the live
    //         stream (not the initial burst) carries the words ----
    await caption(nec, '~nec adds a document to the space.');
    await caption(bus, 'The space is now shared with ~bus.');
    await nec.locator('button:has-text("+ Document")').first().click();
    await nec.locator('.ProseMirror, [contenteditable="true"]').first().waitFor({ timeout:15000 });
    await sleep(1200);
    const title = nec.locator('input.title-input, input[placeholder*="Untitled"]').first();
    if (await title.count()) { await title.click(); await title.fill('Launch plan'); await nec.keyboard.press('Tab'); await sleep(700); }
    await step('doc created', 1400);

    // bus opens the same (still-empty) doc → establishes the live mirror
    await caption(bus, '~bus opens the same document on their own ship.');
    await bus.locator('[data-testid="space-nav-item"]:has-text("Design")').first().click();
    await sleep(1300);
    await bus.locator('[data-testid="files-row"]').first().click();
    await bus.locator('.ProseMirror, [contenteditable="true"]').first().waitFor({ timeout:20000 });
    await sleep(3200);
    await both(nec, bus, 'Both are now in the same document — live.');
    await step('both in the doc', 2400);

    // ---- 5. nec types — watch it stream onto bus ----
    await caption(nec, '~nec types the plan…');
    await caption(bus, '…and it appears here on ~bus, in real time.');
    const body = nec.locator('.ProseMirror, [contenteditable="true"]').first();
    await body.click();
    await body.type('Kickoff is Monday. Owners: design, eng, docs.', { delay:60 });
    await sleep(4000);
    await step('nec typed — streamed to bus', 2200);

    // ---- 6. bus types back — appears on nec ----
    await caption(bus, '~bus adds a line…');
    await caption(nec, '…and ~nec sees it instantly. No “final_v3”.');
    const busBody = bus.locator('.ProseMirror, [contenteditable="true"]').first();
    await busBody.click();
    await bus.keyboard.press('Control+End');
    await busBody.type('  — bus: I will own the checklist.', { delay:60 });
    await sleep(4000);
    await both(nec, bus, 'Two people, two servers, one live document.');
    await step('two-way live edit', 2600);

    // ---- 7. apps tour: a sheet ----
    await caption(bus, 'Meanwhile — the other apps.');
    await caption(nec, 'Sheets: a real spreadsheet, shared the same way.');
    await toSpace(nec);
    await nec.locator('button:has-text("+ Sheet")').first().click();
    await nec.locator('[data-testid="sheet-grid"]').waitFor({ timeout:15000 });
    await sleep(800);
    const typeCell = async (r,c,val) => {
      await nec.locator(`[data-cell="${r}:${c}"]`).first().click();
      await sleep(180);
      await nec.keyboard.type(String(val), { delay:45 });
      await nec.keyboard.press('Enter');
      await sleep(220);
    };
    await typeCell(0,0,'Design'); await typeCell(0,1,'12');
    await typeCell(1,0,'Eng');    await typeCell(1,1,'30');
    await typeCell(2,0,'Total');  await typeCell(2,1,'=SUM(B1:B2)');
    await step('sheet with a formula', 2600);

    // ---- 8. a note ----
    await caption(nec, 'Notes: quick, colorful, pinnable.');
    await toSpace(nec);
    await nec.locator('button:has-text("+ Note")').first().click();
    await sleep(1200);
    const noteBody = nec.locator('.note-card .ProseMirror, .note-card [contenteditable="true"], .ProseMirror').first();
    if (await noteBody.count()) { await noteBody.click(); await noteBody.type('Ship the demo 🎬', { delay:40 }); }
    await nec.locator('[data-testid="note-pin"]').first().click().catch(()=>{});
    await step('note pinned', 2200);

    // ---- 9. share outside the team ----
    await caption(nec, 'Share with someone who isn\'t on Urbit — a revocable link.');
    await toSpace(nec);
    await nec.locator('[data-testid="files-row"]:has-text("Launch plan")').first().click();
    await nec.locator('.ProseMirror, [contenteditable="true"]').first().waitFor({ timeout:15000 });
    await sleep(700);
    const shareBtn = nec.locator('button:has-text("Share"), [aria-label="Share"]').first();
    if (await shareBtn.count()) {
      await shareBtn.click(); await sleep(900);
      const mint = nec.locator('button:has-text("view link"), button:has-text("+ view")').first();
      if (await mint.count()) { await mint.click(); await sleep(1200); }
      await step('share link minted', 2600);
      await nec.locator('button[aria-label="Close"]').first().click().catch(()=>{});
    } else { await step('share (skipped — no button)', 400); }

    // ---- 10. directory + outro ----
    await caption(bus, 'Everyone can see who\'s in the space.');
    await toSpace(bus);
    await bus.locator('[data-testid="space-directory-button"]').first().click().catch(()=>{});
    await sleep(400);
    await bus.locator('[data-testid="space-directory"]').waitFor({ timeout:8000 }).catch(()=>{});
    await step('member directory', 2600);
    await bus.locator('button[aria-label="Close"]').first().click().catch(()=>{});

    await both(nec, bus, 'Groundwire Drive — your team\'s drive, on servers you own.');
    await step('outro', 4200);
  } catch (e) {
    console.error('DEMO ERROR:', e.message);
    await caption(nec, 'Groundwire Drive').catch(()=>{});
  } finally {
    await necCtx.close(); await busCtx.close(); await browser.close();
    console.log('videos in', OUT);
  }
})();
