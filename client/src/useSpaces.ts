import { useEffect, useState } from 'preact/hooks';
import { listDocs, type SpaceSummary, type SpaceInvite } from './api';
import { listingFeed } from './listingFeed';

// Live list of the shared spaces the caller belongs to. Mirrors the listing-
// feed + slow-poll pattern the listing views use, so a newly created/renamed/
// deleted space shows up everywhere the switcher and move-menus render without
// a manual reload. Keeps the last-known list on a transient fetch failure.
export function useSpaces(): SpaceSummary[] {
  const [spaces, setSpaces] = useState<SpaceSummary[]>([]);
  useEffect(() => {
    let cancelled = false;
    const refresh = async () => {
      try {
        const l = await listDocs();
        if (!cancelled) setSpaces(l.spaces ?? []);
      } catch {
        /* keep the stale list */
      }
    };
    void refresh();
    const unsub = listingFeed.subscribe(refresh);
    const id = setInterval(refresh, 60000);
    return () => {
      cancelled = true;
      unsub();
      clearInterval(id);
    };
  }, []);
  return spaces;
}

// Live list of PENDING space invitations (listing.spaceInvites). Same feed +
// slow-poll pattern as useSpaces, so an invite that arrives (or that you
// accept/decline) shows up / disappears in the inbox and the rail badge
// without a manual reload. Keeps the last-known list on a transient failure.
export function useSpaceInvites(): SpaceInvite[] {
  const [invites, setInvites] = useState<SpaceInvite[]>([]);
  useEffect(() => {
    let cancelled = false;
    const refresh = async () => {
      try {
        const l = await listDocs();
        if (!cancelled) setInvites(l.spaceInvites ?? []);
      } catch {
        /* keep the stale list */
      }
    };
    void refresh();
    const unsub = listingFeed.subscribe(refresh);
    const id = setInterval(refresh, 60000);
    return () => {
      cancelled = true;
      unsub();
      clearInterval(id);
    };
  }, []);
  return invites;
}
