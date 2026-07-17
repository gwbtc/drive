// Pure helpers for the Version-history panel: grouping the raw per-update
// history into human-readable "edit sessions", and summarising contributor
// patps. Kept side-effect-free so they can be unit-tested without a DOM.

import type { HistoryEntry } from '../api';

export type EditSession = {
  author: string;
  count: number; // number of updates folded into this session
  bytes: number; // total encoded bytes across those updates
  start: number | null; // unix-ms of the first update (null for legacy entries)
  end: number | null; // unix-ms of the last update
};

// Contiguous updates by the same author within this window collapse into one
// session row (Google-Docs-style "~sampel · 14 changes · 3:02 PM").
export const SESSION_WINDOW_MS = 10 * 60 * 1000;

export function groupSessions(
  entries: HistoryEntry[],
  windowMs: number = SESSION_WINDOW_MS,
): EditSession[] {
  const updates = entries.filter((e) => e.kind === 'update');
  // Order oldest → newest so runs are chronological. Prefer the authored
  // timestamp; fall back to the monotonic idx for legacy pre-authorship rows.
  const ordered = [...updates].sort((a, b) => {
    const at = (a.at ?? 0) - (b.at ?? 0);
    if (at !== 0) return at;
    return (a.idx ?? 0) - (b.idx ?? 0);
  });

  const sessions: EditSession[] = [];
  for (const u of ordered) {
    const author = u.author ?? 'unknown';
    const at = typeof u.at === 'number' ? u.at : null;
    const last = sessions[sessions.length - 1];
    const withinWindow =
      last == null || last.end == null || at == null || at - last.end <= windowMs;
    if (last != null && last.author === author && withinWindow) {
      last.count += 1;
      last.bytes += u.size;
      if (at != null) {
        last.end = at;
        if (last.start == null) last.start = at;
      }
    } else {
      sessions.push({ author, count: 1, bytes: u.size, start: at, end: at });
    }
  }
  // Newest session first for display.
  return sessions.reverse();
}

// Dedup contributor patps, show up to `max`, then a "+N" overflow marker.
export function contributorSummary(contributors: string[], max = 3): string {
  const uniq: string[] = [];
  for (const c of contributors) {
    if (c && !uniq.includes(c)) uniq.push(c);
  }
  if (uniq.length === 0) return '';
  if (uniq.length <= max) return uniq.join(', ');
  return `${uniq.slice(0, max).join(', ')} +${uniq.length - max}`;
}
