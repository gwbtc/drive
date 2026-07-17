import { useEffect, useState } from 'preact/hooks';
import { acceptSpaceInvite, declineSpaceInvite, type SpaceInvite } from '../api';
import { useSpaceInvites } from '../useSpaces';
import { reconcileHiddenInvites, visibleInvites } from '../spaces';
import { toast } from '../ui/toast';

// The invites inbox: pending "company space" invitations surfaced as cards with
// Accept / Decline. Self-fetching (via useSpaceInvites) so it can drop into the
// Home view without prop plumbing; renders nothing when there are no invites.
//
// Accept/decline both mutate the listing on the ship, which pings the listing
// feed and refreshes useSpaceInvites — the row then drops on its own. To avoid
// a flash of the row lingering until that round-trip lands, we optimistically
// hide the acted-on invite locally, and un-hide it if the action fails.
export function SpaceInvites() {
  const invites = useSpaceInvites();
  const [acting, setActing] = useState<Set<string>>(new Set());

  // Self-heal the optimistic-hide set against the live listing: once an accepted/
  // declined invite leaves `invites` (backend processed it), drop its id so a
  // later re-invitation with the same stable id isn't permanently swallowed.
  // Bail out (same reference) when nothing was pruned to avoid a render loop.
  useEffect(() => {
    setActing((s) => {
      const next = reconcileHiddenInvites(s, invites);
      return next.size === s.size ? s : next;
    });
  }, [invites]);

  const visible = visibleInvites(invites, acting);
  if (visible.length === 0) return null;

  const hide = (id: string) => setActing((s) => new Set(s).add(id));
  const unhide = (id: string) =>
    setActing((s) => {
      const next = new Set(s);
      next.delete(id);
      return next;
    });

  const onAccept = async (inv: SpaceInvite) => {
    hide(inv.id);
    try {
      await acceptSpaceInvite(inv.id);
      toast.success(`Joined “${inv.name || 'space'}”`);
    } catch (e) {
      unhide(inv.id);
      toast.error(e);
    }
  };

  const onDecline = async (inv: SpaceInvite) => {
    hide(inv.id);
    try {
      await declineSpaceInvite(inv.id);
      toast.success('Invitation declined');
    } catch (e) {
      unhide(inv.id);
      toast.error(e);
    }
  };

  return (
    <section
      class="space-invites"
      data-testid="space-invites"
      aria-label="Company space invitations"
    >
      <h2 class="space-invites-title">Company space invitations</h2>
      <ul class="space-invites-list">
        {visible.map((inv) => (
          <li key={inv.id} class="space-invite-card" data-testid="space-invite-row">
            <div class="space-invite-body">
              <p class="space-invite-text">
                <span class="patp">{inv.host}</span> invited you to{' '}
                <strong>{inv.name || 'Untitled space'}</strong> as {inv.role}
              </p>
            </div>
            <div class="space-invite-actions">
              <button
                class="btn primary"
                data-testid="space-invite-accept"
                onClick={() => void onAccept(inv)}
              >
                Accept
              </button>
              <button
                class="btn"
                data-testid="space-invite-decline"
                onClick={() => void onDecline(inv)}
              >
                Decline
              </button>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
