import { describe, expect, test } from 'bun:test';
import { groupSessions, contributorSummary, SESSION_WINDOW_MS } from './sessions';
import type { HistoryEntry } from '../api';

const upd = (author: string, at: number, size = 10): HistoryEntry => ({
  kind: 'update',
  size,
  author,
  at,
});

describe('groupSessions', () => {
  test('folds contiguous same-author updates within the window into one session', () => {
    const t = 1_700_000_000_000;
    const sessions = groupSessions([
      upd('~zod', t, 5),
      upd('~zod', t + 60_000, 7),
      upd('~zod', t + 120_000, 3),
    ]);
    expect(sessions).toHaveLength(1);
    expect(sessions[0]).toMatchObject({
      author: '~zod',
      count: 3,
      bytes: 15,
      start: t,
      end: t + 120_000,
    });
  });

  test('splits when the author changes', () => {
    const t = 1_700_000_000_000;
    const sessions = groupSessions([
      upd('~zod', t),
      upd('~nec', t + 30_000),
      upd('~zod', t + 60_000),
    ]);
    // Returned newest-first.
    expect(sessions.map((s) => s.author)).toEqual(['~zod', '~nec', '~zod']);
    expect(sessions.every((s) => s.count === 1)).toBe(true);
  });

  test('splits when the gap exceeds the window', () => {
    const t = 1_700_000_000_000;
    const sessions = groupSessions([
      upd('~zod', t),
      upd('~zod', t + SESSION_WINDOW_MS + 1),
    ]);
    expect(sessions).toHaveLength(2);
  });

  test('ignores snapshot entries and orders by time regardless of input order', () => {
    const t = 1_700_000_000_000;
    const sessions = groupSessions([
      { kind: 'snapshot', size: 999, seq: 1 },
      upd('~zod', t + 120_000, 3),
      upd('~zod', t, 5),
      upd('~zod', t + 60_000, 7),
    ]);
    expect(sessions).toHaveLength(1);
    expect(sessions[0].count).toBe(3);
    expect(sessions[0].start).toBe(t);
    expect(sessions[0].end).toBe(t + 120_000);
  });

  test('newest session comes first', () => {
    const t = 1_700_000_000_000;
    const sessions = groupSessions([
      upd('~zod', t),
      upd('~nec', t + 60 * 60 * 1000),
    ]);
    expect(sessions[0].author).toBe('~nec');
    expect(sessions[1].author).toBe('~zod');
  });

  test('legacy entries without timestamps still group by author', () => {
    const sessions = groupSessions([
      { kind: 'update', size: 4, idx: 0 },
      { kind: 'update', size: 4, idx: 1 },
    ]);
    expect(sessions).toHaveLength(1);
    expect(sessions[0].author).toBe('unknown');
    expect(sessions[0].count).toBe(2);
    expect(sessions[0].start).toBeNull();
  });

  test('empty input yields no sessions', () => {
    expect(groupSessions([])).toEqual([]);
  });
});

describe('contributorSummary', () => {
  test('dedups and joins under the cap', () => {
    expect(contributorSummary(['~zod', '~zod', '~nec'])).toBe('~zod, ~nec');
  });

  test('shows +N overflow past the cap', () => {
    expect(
      contributorSummary(['~zod', '~nec', '~bud', '~wes', '~sev']),
    ).toBe('~zod, ~nec, ~bud +2');
  });

  test('empty list yields empty string', () => {
    expect(contributorSummary([])).toBe('');
  });
});
