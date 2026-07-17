import { describe, expect, test } from 'bun:test';
import { decideBoot, shouldPurge, type BootResult } from './session';
import type { Whoami } from './api';

const ship = (s: string): Whoami => ({ ship: s, auth: 'ship' });
const token: Whoami = {
  ship: '~sampel-palnet',
  auth: 'token',
  doc: '0v1',
  role: 'editor',
  type: 'text',
  title: 'Doc',
};
const none: Whoami = { auth: 'none' };
const ok = (w: Whoami): BootResult => ({ ok: true, whoami: w });
const netErr: BootResult = { ok: false };

describe('decideBoot — the four boot branches', () => {
  // --- app ------------------------------------------------------------------
  test('ship auth, no cache → app without purge', () => {
    const d = decideBoot(ok(ship('~sampel-palnet')), null);
    expect(d).toEqual({ screen: 'app', whoami: ship('~sampel-palnet'), purge: false });
    expect(shouldPurge(d)).toBe(false);
  });

  test('ship auth, same ship cached → app without purge', () => {
    const d = decideBoot(ok(ship('~sampel-palnet')), ship('~sampel-palnet'));
    expect(d).toEqual({ screen: 'app', whoami: ship('~sampel-palnet'), purge: false });
    expect(shouldPurge(d)).toBe(false);
  });

  test('token session → straight to app, never purges', () => {
    const d = decideBoot(ok(token), ship('~sampel-palnet'));
    expect(d).toEqual({ screen: 'app', whoami: token, purge: false });
    expect(shouldPurge(d)).toBe(false);
  });

  // --- app + purge (a different user logged in on a shared browser) ---------
  test('ship auth, DIFFERENT ship cached → app WITH purge', () => {
    const d = decideBoot(ok(ship('~ridlur-figbud')), ship('~sampel-palnet'));
    expect(d).toEqual({ screen: 'app', whoami: ship('~ridlur-figbud'), purge: true });
    expect(shouldPurge(d)).toBe(true);
  });

  test('ship comparison is ~-normalized (hostname-seeded cache still matches)', () => {
    // A cache written from window.__SHIP__ (`sampel-palnet`, no ~) must NOT be
    // treated as a different ship from whoami's `~sampel-palnet`.
    const d = decideBoot(ok(ship('~sampel-palnet')), ship('sampel-palnet'));
    expect(d.screen === 'app' && d.purge).toBe(false);
  });

  // --- login (affirmative logout) ------------------------------------------
  test("server 'none' → login, purge required", () => {
    const d = decideBoot(ok(none), ship('~sampel-palnet'));
    expect(d).toEqual({ screen: 'login' });
    expect(shouldPurge(d)).toBe(true);
  });

  test("server 'none' with no cache still → login + purge", () => {
    const d = decideBoot(ok(none), null);
    expect(d).toEqual({ screen: 'login' });
    expect(shouldPurge(d)).toBe(true);
  });

  // --- offline (network error, cache present) ------------------------------
  test('network error + cached ship → offline, no purge (PWA path)', () => {
    const d = decideBoot(netErr, ship('~sampel-palnet'));
    expect(d).toEqual({ screen: 'offline', whoami: ship('~sampel-palnet') });
    expect(shouldPurge(d)).toBe(false);
  });

  // --- error (network error, no cache) -------------------------------------
  test('network error + no cache → error, no purge', () => {
    const d = decideBoot(netErr, null);
    expect(d).toEqual({ screen: 'error' });
    expect(shouldPurge(d)).toBe(false);
  });
});
