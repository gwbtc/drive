// Pure helpers for splitting a doc listing into personal vs. shared-space
// content. Kept free of Preact/DOM so they're unit-testable — the personal-vs-
// space partition is the load-bearing rule that keeps company and personal
// content separated across the Files view and each space view.

// A doc with no `space` assignment (null OR absent) is a personal doc. The
// backend emits `space: null` for personal owned/folder docs and omits the key
// entirely on shared/mirrored entries; both mean "personal".
export const isPersonal = (d: { space?: string | null }): boolean => !d.space;

// Personal drive contents: everything not assigned to a shared space.
export const personalDocs = <T extends { space?: string | null }>(docs: T[]): T[] =>
  docs.filter(isPersonal);

// Docs belonging to one specific space.
export const spaceDocs = <T extends { space?: string | null }>(
  docs: T[],
  spaceId: string,
): T[] => docs.filter((d) => d.space === spaceId);

// A space you HOST (joined:false) vs. one you JOINED elsewhere (joined:true).
// This is the load-bearing branch for the space view: a hosted space draws its
// docs from the listing's `owned` (filtered by space), while a joined space has
// no local owned docs and must fetch them from the space-docs scry instead. An
// absent flag means hosted (the default when the flag is absent).
export const isJoinedSpace = (s: { joined?: boolean }): boolean => s.joined === true;

// === Space-invite optimistic-hide bookkeeping ===============================
//
// The invites inbox optimistically hides an invite the moment you accept/decline
// it, so the card doesn't linger until the listing round-trip lands. The hidden
// set is keyed by the (stable) space-id.

// The invites still shown: the freshly-fetched invites minus the optimistically
// hidden ones. Never filters by anything but membership in `hidden`, so any id
// NOT in `hidden` is always shown — that's the guarantee against swallowing a
// re-invitation.
export const visibleInvites = <T extends { id: string }>(
  invites: T[],
  hidden: ReadonlySet<string>,
): T[] => invites.filter((i) => !hidden.has(i.id));

// Prune the optimistic-hide set to only ids still present in the freshly-fetched
// invites. Once the backend has processed an accept/decline the id leaves
// `invites`, so we drop it here — which is what makes the hide self-healing: if
// the SAME space re-invites you later (same stable id) it's no longer hidden, so
// its card reappears instead of being permanently swallowed. The result only
// ever shrinks or stays the same size, so a caller can compare sizes to skip a
// needless state update.
export const reconcileHiddenInvites = (
  hidden: ReadonlySet<string>,
  invites: ReadonlyArray<{ id: string }>,
): Set<string> => {
  const present = new Set(invites.map((i) => i.id));
  const next = new Set<string>();
  for (const id of hidden) if (present.has(id)) next.add(id);
  return next;
};
