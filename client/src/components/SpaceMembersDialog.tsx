import { displayName, shipFromInput } from '../api';
import { useEffect, useRef, useState } from 'preact/hooks';
import {
  getSpace,
  inviteToSpace,
  removeMember,
  setMemberRole,
  renameSpace,
  deleteSpace,
  type SpaceSummary,
  type SpaceMember,
  type SpaceRole,
} from '../api';
import { toast } from '../ui/toast';
import { confirmDialog, promptDialog } from '../ui/dialogs';
import { useFocusTrap } from '../ui/useFocusTrap';

type Props = {
  space: SpaceSummary;
  ship: string;
  onClose: () => void;
  // Navigate away after the space is deleted (it no longer exists).
  navigate: (path: string) => void;
};

// Assignable roles, least → most privileged. `owner`/`admin` may manage the
// space; the rest are content roles that map to per-doc access.
const ROLES: SpaceRole[] = ['viewer', 'commenter', 'editor', 'admin', 'owner'];

export function SpaceMembersDialog({ space, ship, onClose, navigate }: Props) {
  const [name, setName] = useState(space.name);
  const [roster, setRoster] = useState<SpaceMember[]>([]);
  const [who, setWho] = useState('');
  const [role, setRole] = useState<SpaceRole>('editor');

  // Only an owner/admin may manage members or rename; only an owner may delete.
  const canManage = space.role === 'owner' || space.role === 'admin';
  const canDelete = space.role === 'owner';

  const reload = async () => {
    try {
      const detail = await getSpace(space.id);
      if (detail) setRoster(detail.members);
    } catch {
      toast.error("Couldn't load members");
    }
  };

  useEffect(() => {
    void reload();
  }, [space.id]);

  const onAdd = async (e: Event) => {
    e.preventDefault();
    const trimmed = (who || '').trim();
    if (!trimmed) return;
    // Backend wants a bare ship name; the api wrapper strips the ~. Roster
    // entries carry the ~, so build the display form for the optimistic update.
    // A comet's mnemonym is accepted too and decoded to its @p here.
    let bare: string;
    try {
      bare = shipFromInput(trimmed);
    } catch (err) {
      toast.error(err);
      return;
    }
    if (!bare) return;
    const display = '~' + bare;
    try {
      // Invite (not silent add): the host rosters the ship AND notifies it, so
      // the invitee gets a pending invitation to accept. The host's roster
      // reflects the member immediately, so the optimistic add still holds.
      await inviteToSpace(space.id, bare, role);
      setRoster((r) => [...r.filter((m) => m.who !== display), { who: display, role }]);
      setWho('');
      toast.success(`Invited ${displayName(display)}`);
    } catch {
      toast.error('Could not invite member — check the ship name.');
    }
  };

  const onChangeRole = async (member: SpaceMember, next: SpaceRole) => {
    const prev = member.role;
    setRoster((r) => r.map((m) => (m.who === member.who ? { ...m, role: next } : m)));
    try {
      await setMemberRole(space.id, member.who, next);
    } catch (err) {
      setRoster((r) => r.map((m) => (m.who === member.who ? { ...m, role: prev } : m)));
      toast.error(err);
    }
  };

  const onRemove = async (member: SpaceMember) => {
    const snapshot = roster;
    setRoster((r) => r.filter((m) => m.who !== member.who));
    try {
      await removeMember(space.id, member.who);
    } catch (err) {
      setRoster(snapshot);
      toast.error(err);
    }
  };

  const onRename = async () => {
    const next = await promptDialog({
      title: 'Rename space',
      defaultValue: name,
      placeholder: 'Space name',
      confirmLabel: 'Rename',
    });
    if (next === null || !next.trim() || next.trim() === name) return;
    try {
      await renameSpace(space.id, next.trim());
      setName(next.trim());
      toast.success('Space renamed');
    } catch (err) {
      toast.error(err);
    }
  };

  const onDelete = async () => {
    const ok = await confirmDialog({
      title: `Delete “${name || 'space'}”?`,
      message:
        'The space is removed and every doc in it becomes personal again. This cannot be undone.',
      confirmLabel: 'Delete space',
      danger: true,
    });
    if (!ok) return;
    try {
      await deleteSpace(space.id);
      toast.success('Space deleted');
      onClose();
      navigate('/drive/files');
    } catch (err) {
      toast.error(err);
    }
  };

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
        aria-labelledby="space-members-title"
        data-testid="space-members-dialog"
        ref={modalRef}
        onClick={(e) => e.stopPropagation()}
      >
        <header class="modal-header">
          <h2 id="space-members-title">Members of “{name || 'Untitled space'}”</h2>
          <button class="btn-icon" aria-label="Close" onClick={onClose}>
            ×
          </button>
        </header>

        <section>
          <h3>People</h3>
          <ul class="acl-list">
            {roster.map((member) => {
              const isSelf = member.who === ship;
              return (
                <li key={member.who} class="acl-item" data-testid="space-member-row">
                  <span class="acl-who patp">{displayName(member.who)}</span>
                  {canManage && !isSelf ? (
                    <select
                      class="select space-role-select"
                      aria-label={`Role for ${member.who}`}
                      data-testid="space-role-select"
                      value={member.role}
                      onChange={(e) =>
                        void onChangeRole(
                          member,
                          (e.target as HTMLSelectElement).value as SpaceRole,
                        )
                      }
                    >
                      {ROLES.map((r) => (
                        <option key={r} value={r}>
                          {r}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <span class="acl-role">{member.role}</span>
                  )}
                  {canManage && !isSelf && (
                    <button
                      class="btn-icon"
                      aria-label={`Remove ${member.who}`}
                      onClick={() => void onRemove(member)}
                    >
                      ×
                    </button>
                  )}
                </li>
              );
            })}
            {roster.length === 0 && <li class="muted">No members yet</li>}
          </ul>

          {canManage && (
            <form class="share-form" onSubmit={onAdd} data-testid="space-add-member">
              <input
                class="input"
                aria-label="Ship name to invite"
                placeholder="~sampel-palnet or .its.mnemonym"
                value={who}
                onInput={(e) => setWho((e.target as HTMLInputElement).value)}
              />
              <select
                class="select"
                aria-label="Member role"
                value={role}
                onChange={(e) =>
                  setRole((e.target as HTMLSelectElement).value as SpaceRole)
                }
              >
                {ROLES.map((r) => (
                  <option key={r} value={r}>
                    {r}
                  </option>
                ))}
              </select>
              <button class="btn primary" type="submit">
                Invite
              </button>
            </form>
          )}
        </section>

        {(canManage || canDelete) && (
          <section>
            <h3>Space settings</h3>
            <div class="space-settings">
              {canManage && (
                <button class="btn" onClick={onRename}>
                  Rename space
                </button>
              )}
              {canDelete && (
                <button
                  class="btn danger"
                  data-testid="space-delete"
                  onClick={onDelete}
                >
                  Delete space
                </button>
              )}
            </div>
            {!canDelete && canManage && (
              <p class="muted small">Only the space owner can delete it.</p>
            )}
          </section>
        )}
      </div>
    </div>
  );
}
