// Pure helper for the command palette's cross-space TITLE search.
//
// The palette already searches the caller's local docs (owned + mirrored). A
// HOSTED space's docs are in `owned`, but a JOINED space's docs live on the
// host and aren't in the listing — they come from the space-docs scry. This
// merges those joined-space docs into one searchable set, tagging each with the
// host to subscribe-remote to (so the palette can open it) and the space name
// for labeling. Kept DOM-free so bun can unit-test the merge.

import type { DocSummary } from '../api';

// One joined space's docs plus the metadata needed to open + label them.
export type JoinedSpaceDocs = {
  // Space-id — lets a stale cache be intersected with the current joined set
  // (so a space you've LEFT stops contributing docs immediately).
  id: string;
  // Space name, for the "Open in <space>" hint.
  name: string;
  // Host ship (WITH leading ~) to subscribe-remote to before navigating.
  host: string;
  docs: DocSummary[];
};

// A searchable doc: a plain DocSummary for a local doc, or one carrying the
// host/space it must be mirrored from when it's a joined-space doc.
export type SearchDoc = DocSummary & {
  // Present only for joined-space docs: the host to subscribe-remote to and the
  // space name for labeling. Absent for local (owned/mirrored) docs.
  remoteHost?: string;
  spaceName?: string;
};

// Merge local docs with joined-space docs into one title-search set.
//   - Local docs (owned + mirrored) come first and take precedence.
//   - A joined-space doc is appended only when its id isn't already present
//     locally (a doc mirrored into `owned` shouldn't double as a remote entry).
//   - Within the joined groups the first occurrence of an id wins, so a doc
//     that somehow appears in two joined spaces is listed once.
export function buildSearchDocs(
  local: DocSummary[],
  joined: JoinedSpaceDocs[],
): SearchDoc[] {
  const byId = new Map<string, SearchDoc>();
  for (const d of local) if (!byId.has(d.id)) byId.set(d.id, d);
  for (const group of joined) {
    for (const d of group.docs) {
      if (byId.has(d.id)) continue;
      byId.set(d.id, { ...d, remoteHost: group.host, spaceName: group.name });
    }
  }
  return [...byId.values()];
}

// Keep only the joined-space groups whose space-id is still in the CURRENT
// joined set (from the latest listing). The palette caches joined-space docs for
// up to 30s; without this filter a space you LEAVE would keep contributing
// searchable — and subscribe-remote-openable — docs until the cache expired.
export function currentJoinedDocs(
  joined: JoinedSpaceDocs[],
  joinedIds: ReadonlySet<string>,
): JoinedSpaceDocs[] {
  return joined.filter((g) => joinedIds.has(g.id));
}
