// Recently-opened docs, tracked client-side in localStorage. A capped,
// deduped, most-recent-first list of {id, at}. The pure list transform is
// split out (and unit-tested) from the storage side effects.

export type RecentEntry = { id: string; at: number };

export const RECENTS_KEY = 'drive:recents';
export const RECENTS_CAP = 50;

// Pure: record that `id` was opened at `at`. Any prior entry for the same id
// is dropped (newest wins), the result is sorted most-recent-first, and the
// list is capped to `cap`.
export function addRecent(
  list: RecentEntry[],
  id: string,
  at: number,
  cap: number = RECENTS_CAP,
): RecentEntry[] {
  const rest = list.filter((e) => e.id !== id);
  const next = [{ id, at }, ...rest];
  next.sort((a, b) => b.at - a.at);
  return next.slice(0, Math.max(0, cap));
}

export function loadRecents(): RecentEntry[] {
  try {
    const raw = localStorage.getItem(RECENTS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (e): e is RecentEntry =>
        !!e && typeof e.id === 'string' && typeof e.at === 'number',
    );
  } catch {
    return [];
  }
}

export function recordRecent(id: string, at: number = Date.now()): void {
  try {
    const next = addRecent(loadRecents(), id, at);
    localStorage.setItem(RECENTS_KEY, JSON.stringify(next));
  } catch {
    /* storage unavailable (private mode, quota) — recents are best-effort */
  }
}
