import { describe, expect, test } from 'bun:test';
import { addRecent, type RecentEntry } from './recents';

describe('addRecent', () => {
  test('prepends a new entry', () => {
    expect(addRecent([], 'a', 1)).toEqual([{ id: 'a', at: 1 }]);
    expect(addRecent([{ id: 'a', at: 1 }], 'b', 2)).toEqual([
      { id: 'b', at: 2 },
      { id: 'a', at: 1 },
    ]);
  });

  test('dedupes by id, keeping the newer timestamp and moving it to front', () => {
    const list: RecentEntry[] = [
      { id: 'b', at: 5 },
      { id: 'a', at: 1 },
    ];
    expect(addRecent(list, 'a', 9)).toEqual([
      { id: 'a', at: 9 },
      { id: 'b', at: 5 },
    ]);
    // Only one entry per id.
    const ids = addRecent(list, 'a', 9).map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  test('sorts most-recent-first regardless of input order', () => {
    const list: RecentEntry[] = [
      { id: 'a', at: 1 },
      { id: 'c', at: 30 },
    ];
    expect(addRecent(list, 'b', 20)).toEqual([
      { id: 'c', at: 30 },
      { id: 'b', at: 20 },
      { id: 'a', at: 1 },
    ]);
  });

  test('caps the list length, dropping the oldest', () => {
    let list: RecentEntry[] = [];
    for (let i = 0; i < 10; i++) list = addRecent(list, `d${i}`, i, 3);
    expect(list.length).toBe(3);
    expect(list.map((e) => e.id)).toEqual(['d9', 'd8', 'd7']);
  });

  test('re-opening an existing id does not grow the list past the cap', () => {
    let list: RecentEntry[] = [];
    for (let i = 0; i < 5; i++) list = addRecent(list, `d${i}`, i, 3);
    expect(list.map((e) => e.id)).toEqual(['d4', 'd3', 'd2']);
    list = addRecent(list, 'd3', 100, 3);
    expect(list.length).toBe(3);
    expect(list[0]).toEqual({ id: 'd3', at: 100 });
  });
});
