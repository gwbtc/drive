import { useEffect, useState } from 'preact/hooks';
import { listDocs, getDms, type SpaceSummary, type SpaceInvite, type DmSummary } from './api';
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
    const unsubL = listingFeed.subscribe(refresh);
    // A new room message bumps a space's unread badge without a listing ping,
    // so refresh on 'space-chat' too (keeps the rail dot live).
    const unsubC = listingFeed.on('space-chat', refresh);
    const id = setInterval(refresh, 60000);
    return () => {
      cancelled = true;
      unsubL();
      unsubC();
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

// Total unread DM count (listing.dmUnread) for the Messages rail badge. Also
// re-fetches on 'dm' events so the badge reacts the moment a DM arrives.
export function useDmUnread(): number {
  const [n, setN] = useState(0);
  useEffect(() => {
    let cancelled = false;
    const refresh = async () => {
      try {
        const l = await listDocs();
        if (!cancelled) setN(l.dmUnread ?? 0);
      } catch {
        /* keep the stale count */
      }
    };
    void refresh();
    const unsubL = listingFeed.subscribe(refresh);
    const unsubD = listingFeed.on('dm', refresh);
    const id = setInterval(refresh, 60000);
    return () => {
      cancelled = true;
      unsubL();
      unsubD();
      clearInterval(id);
    };
  }, []);
  return n;
}

// Live DM inbox: one row per counterparty, most-recently-active first. Re-
// fetches on 'dm' events (and the slow poll) so new/updated threads surface.
export function useDmSummaries(): DmSummary[] {
  const [rows, setRows] = useState<DmSummary[]>([]);
  useEffect(() => {
    let cancelled = false;
    const refresh = async () => {
      try {
        const r = await getDms();
        if (!cancelled) setRows(r);
      } catch {
        /* keep the stale list */
      }
    };
    void refresh();
    const unsub = listingFeed.on('dm', refresh);
    const id = setInterval(refresh, 60000);
    return () => {
      cancelled = true;
      unsub();
      clearInterval(id);
    };
  }, []);
  return rows;
}
