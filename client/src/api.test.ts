import { describe, expect, test } from 'bun:test';
import { genCommentId, parseDocDate, formatDate } from './api';

describe('genCommentId', () => {
  // slav %uv requires: `0v` prefix, urbit base-32 alphabet (0-9 a-v), and
  // dot-separated groups of exactly 5 chars counted from the RIGHT; the
  // leftmost group may be 1-5 chars and must not be '0'-padded oddly.
  const UV = /^0v[0-9a-v]{1,5}(\.[0-9a-v]{5})*$/;

  test('200 random samples parse as @uv', () => {
    for (let i = 0; i < 200; i++) {
      const id = genCommentId();
      expect(id).toMatch(UV);
    }
  });

  test('ids are 13 base-32 chars → shape 0vXXX.XXXXX.XXXXX', () => {
    const id = genCommentId();
    const body = id.slice(2).split('.');
    expect(body.map((g) => g.length)).toEqual([3, 5, 5]);
  });

  test('collision-free across a small sample', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 1000; i++) seen.add(genCommentId());
    expect(seen.size).toBe(1000);
  });
});

describe('parseDocDate', () => {
  test('valid unix-ms round-trips', () => {
    const ms = Date.UTC(2026, 0, 15, 12, 30);
    expect(parseDocDate(ms)?.getTime()).toBe(ms);
  });

  test('zero and non-finite yield null', () => {
    expect(parseDocDate(0)).toBeNull();
    expect(parseDocDate(NaN)).toBeNull();
    expect(parseDocDate(Infinity)).toBeNull();
  });
});

describe('formatDate', () => {
  test('unparseable date renders em dash', () => {
    expect(formatDate(0)).toBe('—');
    expect(formatDate(NaN)).toBe('—');
  });

  test('today renders as a time (contains :)', () => {
    expect(formatDate(Date.now())).toContain(':');
  });

  test('a past date renders as a non-empty date string', () => {
    const s = formatDate(Date.UTC(2020, 5, 1));
    expect(s).not.toBe('—');
    expect(s.length).toBeGreaterThan(0);
  });
});

import { displayName, shipFromInput } from './api';

describe('mnemonym names', () => {
  const P = '~ponnyd-toblun-libmex-tacsut--lanmus-tilrys-sattes-daplyd';
  const NYM =
    '.untrained.exhort.admire.decrease.depraved.abstruse.milieu.perform.confer.chastise.defames.kebab';

  test('a comet with no nickname shows its mnemonym; others keep the @p', () => {
    expect(displayName(P)).toBe(NYM);
    expect(displayName(P.slice(1))).toBe(NYM);
    expect(displayName('~zod')).toBe('~zod');
    expect(displayName('sampel-palnet')).toBe('~sampel-palnet');
  });

  test('ship inputs take a @p or a mnemonym and yield the bare @p', () => {
    expect(shipFromInput(P)).toBe(P.slice(1));
    expect(shipFromInput(` ${P.slice(1)} `)).toBe(P.slice(1));
    expect(shipFromInput(NYM)).toBe(P.slice(1));
    expect(shipFromInput('~zod')).toBe('zod');
    expect(() => shipFromInput('.untrained.exhort')).toThrow();
  });
});
