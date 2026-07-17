import { useEffect, useRef, useState } from 'preact/hooks';
import { getSpace, type SpaceSummary, type SpaceMember } from '../api';
import { toast } from '../ui/toast';
import { useFocusTrap } from '../ui/useFocusTrap';

type Props = {
  space: SpaceSummary;
  ship: string;
  onClose: () => void;
};

// Read-only member directory for a space. Works for BOTH hosted and joined
// spaces — the roster scry (getSpace) is propagated to joined-space members, so
// a non-admin can still see who's in the space and their role. The current user
// is marked. Management (add/remove/role) lives in SpaceMembersDialog and is
// only offered to a hosted space's owner/admin.
export function SpaceDirectory({ space, ship, onClose }: Props) {
  const [roster, setRoster] = useState<SpaceMember[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    getSpace(space.id)
      .then((detail) => {
        if (!cancelled && detail) setRoster(detail.members);
      })
      .catch(() => {
        if (!cancelled) toast.error("Couldn't load members");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [space.id]);

  const modalRef = useRef<HTMLDivElement>(null);
  useFocusTrap(modalRef);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div class="modal-backdrop" onClick={onClose}>
      <div
        class="modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="space-directory-title"
        data-testid="space-directory"
        ref={modalRef}
        onClick={(e) => e.stopPropagation()}
      >
        <header class="modal-header">
          <h2 id="space-directory-title">
            Members of “{space.name || 'Untitled space'}”
          </h2>
          <button class="btn-icon" aria-label="Close" onClick={onClose}>
            ×
          </button>
        </header>

        <section>
          {loading && (
            <p class="muted" role="status">
              Loading…
            </p>
          )}
          <ul class="acl-list">
            {roster.map((member) => {
              const isSelf = member.who === ship;
              return (
                <li key={member.who} class="acl-item" data-testid="space-directory-row">
                  <span class="acl-who patp">
                    {member.who}
                    {isSelf && <span class="space-directory-you"> (you)</span>}
                  </span>
                  <span class="acl-role">{member.role}</span>
                </li>
              );
            })}
            {!loading && roster.length === 0 && <li class="muted">No members yet</li>}
          </ul>
        </section>
      </div>
    </div>
  );
}
