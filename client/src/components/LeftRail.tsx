import { useState } from 'preact/hooks';
import { dropOnto, isDragging } from '../ui/dragState';
import { createSpace } from '../api';
import { useSpaces, useSpaceInvites } from '../useSpaces';
import { isJoinedSpace } from '../spaces';
import { promptDialog } from '../ui/dialogs';
import { toast } from '../ui/toast';
import { JoinSpaceDialog } from './JoinSpaceDialog';

export type RailKey =
  | 'hub'
  | 'files'
  | 'starred'
  | 'recent'
  | 'notes'
  | 'photos'
  | 'trash';

type Props = {
  // 'space' isn't a rail-nav item — it highlights the space switcher instead.
  active: RailKey | 'space';
  // The active space-id when on a space route, so the switcher can highlight it.
  activeSpaceId?: string | null;
  ship: string;
  navigate: (path: string) => void;
};

const items: Array<{
  key: RailKey;
  label: string;
  href: string;
  icon: preact.JSX.Element;
}> = [
  {
    key: 'hub',
    label: 'Home',
    href: '/drive',
    icon: (
      <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor">
        <path d="M12 3 2 12h3v8h6v-6h2v6h6v-8h3z" />
      </svg>
    ),
  },
  {
    key: 'files',
    label: 'Files',
    href: '/drive/files',
    icon: (
      <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor">
        <path d="M10 4H4c-1.1 0-2 .9-2 2v12a2 2 0 0 0 2 2h16c1.1 0 2-.9 2-2V8a2 2 0 0 0-2-2h-8l-2-2z" />
      </svg>
    ),
  },
  {
    key: 'starred',
    label: 'Starred',
    href: '/drive/starred',
    icon: (
      <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor">
        <path d="M12 2l2.9 6.3 6.9.6-5.2 4.6 1.6 6.7L12 17.3 5.8 20.8l1.6-6.7L2.2 8.9l6.9-.6z" />
      </svg>
    ),
  },
  {
    key: 'recent',
    label: 'Recent',
    href: '/drive/recent',
    icon: (
      <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor">
        <path d="M13 3a9 9 0 1 0 8.5 12h-2.1A7 7 0 1 1 13 5v5l4.3 2.5.7-1.2-3.5-2V3z" />
      </svg>
    ),
  },
  {
    key: 'notes',
    label: 'Notes',
    href: '/drive/notes',
    icon: (
      <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor">
        <path d="M3 3h18v14H7l-4 4z" />
      </svg>
    ),
  },
  {
    key: 'photos',
    label: 'Photos',
    href: '/drive/photos',
    icon: (
      <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor">
        <path d="M21 19V5c0-1.1-.9-2-2-2H5c-1.1 0-2 .9-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2zM8.5 13.5 11 16.5l3.5-4.5 4.5 6H5z" />
      </svg>
    ),
  },
  {
    key: 'trash',
    label: 'Trash',
    href: '/drive/trash',
    icon: (
      <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor">
        <path d="M9 3v1H4v2h16V4h-5V3zM6 8v12a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2V8zm3 2h2v9H9zm4 0h2v9h-2z" />
      </svg>
    ),
  },
];

export function LeftRail({ active, activeSpaceId, ship, navigate }: Props) {
  // Dropping docs on the Files rail item moves them to the Drive root.
  const [dropTarget, setDropTarget] = useState(false);
  const [showJoin, setShowJoin] = useState(false);
  const spaces = useSpaces();
  const invites = useSpaceInvites();
  const go = (href: string) => (e: Event) => {
    e.preventDefault();
    navigate(href);
  };

  // "Personal" is the active space entry whenever we're not inside a space.
  const inSpace = active === 'space';

  const onNewSpace = async () => {
    const name = await promptDialog({
      title: 'New space',
      message: 'A shared space is a company drive whose members all get access.',
      placeholder: 'Space name',
      defaultValue: '',
      confirmLabel: 'Create',
    });
    if (!name?.trim()) return;
    try {
      await createSpace(name.trim());
      toast.success(`Created “${name.trim()}”`);
    } catch (e) {
      toast.error(e);
    }
  };
  return (
    <>
    <aside class="rail" aria-label="Main navigation">
      <a class="rail-brand" href="/drive" onClick={go('/drive')} aria-label="Groundwire Drive home">
        <div class="rail-brand-mark" aria-hidden="true">
          <svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor">
            <rect x="3" y="3" width="14" height="14" rx="2" opacity="0.35" />
            <rect x="7" y="7" width="14" height="14" rx="2" />
          </svg>
        </div>
        <span class="rail-brand-name">Drive</span>
      </a>
      <nav class="rail-nav" aria-label="Sections">
        {items.map((it) => {
          const isFiles = it.key === 'files';
          return (
            <a
              key={it.key}
              href={it.href}
              class={`rail-item ${active === it.key ? 'active' : ''} ${
                isFiles && dropTarget ? 'drop-hover' : ''
              }`}
              aria-current={active === it.key ? 'page' : undefined}
              onClick={go(it.href)}
              onDragOver={
                isFiles
                  ? (e: DragEvent) => {
                      if (!isDragging()) return;
                      e.preventDefault();
                      if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
                      setDropTarget(true);
                    }
                  : undefined
              }
              onDragLeave={isFiles ? () => setDropTarget(false) : undefined}
              onDrop={
                isFiles
                  ? async (e: DragEvent) => {
                      e.preventDefault();
                      setDropTarget(false);
                      await dropOnto(null);
                    }
                  : undefined
              }
            >
              <span class="rail-icon" aria-hidden="true">{it.icon}</span>
              <span class="rail-label">{it.label}</span>
            </a>
          );
        })}
      </nav>

      <nav class="rail-spaces" aria-label="Spaces" data-testid="space-switcher">
        <div class="rail-spaces-head">
          <span class="rail-spaces-title">
            Spaces
            {invites.length > 0 && (
              <span
                class="rail-badge"
                data-testid="space-invites-badge"
                title={`${invites.length} pending invitation${invites.length === 1 ? '' : 's'}`}
                aria-label={`${invites.length} pending invitation${invites.length === 1 ? '' : 's'}`}
              >
                {invites.length}
              </span>
            )}
          </span>
          <div class="rail-spaces-actions">
            <button
              type="button"
              class="rail-spaces-add"
              data-testid="join-space"
              title="Join a space"
              aria-label="Join a space"
              onClick={() => setShowJoin(true)}
            >
              <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor" aria-hidden="true">
                <path d="M11 7 9.6 8.4 12.2 11H3v2h9.2l-2.6 2.6L11 17l5-5zM19 3H5a2 2 0 0 0-2 2v3h2V5h14v14H5v-3H3v3a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V5a2 2 0 0 0-2-2z" />
              </svg>
            </button>
            <button
              type="button"
              class="rail-spaces-add"
              title="New space"
              aria-label="New space"
              onClick={onNewSpace}
            >
              ＋
            </button>
          </div>
        </div>
        <a
          href="/drive/files"
          class={`rail-item rail-space-item ${!inSpace ? 'active' : ''}`}
          data-testid="space-nav-item"
          aria-current={!inSpace ? 'page' : undefined}
          onClick={go('/drive/files')}
        >
          <span class="rail-icon" aria-hidden="true">
            <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor">
              <path d="M12 12a5 5 0 1 0 0-10 5 5 0 0 0 0 10zm0 2c-4 0-8 2-8 5v1h16v-1c0-3-4-5-8-5z" />
            </svg>
          </span>
          <span class="rail-label">Personal</span>
        </a>
        {spaces.map((s) => {
          const activeSpace = inSpace && activeSpaceId === s.id;
          const label = s.name || 'Untitled space';
          // A JOINED space's roster isn't in the summary — the backend sends
          // `members: 0` as a placeholder, so only show the count for spaces we
          // HOST (where it's real) rather than a misleading "0 members".
          const title = isJoinedSpace(s)
            ? label
            : `${label} · ${s.members} member${s.members === 1 ? '' : 's'}`;
          return (
            <a
              key={s.id}
              href={`/drive/space/${s.id}`}
              class={`rail-item rail-space-item ${activeSpace ? 'active' : ''}`}
              data-testid="space-nav-item"
              aria-current={activeSpace ? 'page' : undefined}
              title={title}
              onClick={go(`/drive/space/${s.id}`)}
            >
              <span class="rail-icon" aria-hidden="true">
                <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor">
                  <path d="M3 21V7l7-4 7 4v14h-5v-5h-4v5zM19 21V9l2 1.2V21z" />
                </svg>
              </span>
              <span class="rail-label">{label}</span>
            </a>
          );
        })}
      </nav>

      <div class="rail-foot">
        <div class="rail-ship">{ship}</div>
      </div>
    </aside>
    {showJoin && <JoinSpaceDialog onClose={() => setShowJoin(false)} />}
    </>
  );
}
