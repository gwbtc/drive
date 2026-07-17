import { defineConfig, devices } from '@playwright/test';

// Browser-level e2e against a live fakeship. Launched by
// scripts/e2e-browser.sh, which boots ~nec and exports:
//   SHIP_URL   e.g. http://localhost:18110
//   COOKIE     urbauth-~nec=0v...   (already-authed session cookie)
//   SHIP_CODE  the +code, in case a spec wants to drive /~/login itself
const SHIP_URL = process.env.SHIP_URL ?? 'http://localhost:18110';
const COOKIE = process.env.COOKIE ?? '';

// Pre-auth every default context by injecting the harness's urbauth cookie —
// more reliable than driving the /~/login form in each spec.
const eq = COOKIE.indexOf('=');
const storageState =
  eq > 0
    ? {
        cookies: [
          {
            name: COOKIE.slice(0, eq),
            value: COOKIE.slice(eq + 1),
            domain: new URL(SHIP_URL).hostname,
            path: '/',
            expires: -1,
            httpOnly: true,
            secure: false,
            sameSite: 'Lax' as const,
          },
        ],
        origins: [],
      }
    : undefined;

export default defineConfig({
  testDir: '.',
  outputDir: 'test-results',
  // One shared ship — specs create their own docs but must not run in
  // parallel against the single-threaded arvo event loop.
  workers: 1,
  fullyParallel: false,
  retries: 0,
  // SSE fact fan-out and reconcile backoff are multi-second affairs.
  timeout: 120_000,
  expect: { timeout: 20_000 },
  forbidOnly: !!process.env.CI,
  reporter: [['list']],
  use: {
    baseURL: SHIP_URL,
    storageState,
    headless: true,
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
    // Actions like click/type get a generous ceiling; the app re-renders
    // its file list on a 5s poll.
    actionTimeout: 20_000,
    navigationTimeout: 30_000,
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
