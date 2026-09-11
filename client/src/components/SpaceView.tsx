import { displayName } from '../api';
import { useEffect, useMemo, useState } from 'preact/hooks';
import {
  listDocs,
  createDoc,
  setDocSpace,
  renameDoc,
  copyDoc,
  deleteDoc,
  starDoc,
  getSpaceDocs,
  leaveSpace,
  subscribeRemote,
  type DocSummary,
  type SpaceSummary,
} from '../api';
import { FilesRow } from './FilesRow';
import { SpaceMembersDialog } from './SpaceMembersDialog';
import { SpaceDirectory } from './SpaceDirectory';
import { SpaceChat } from './SpaceChat';
import { listingFeed } from '../listingFeed';
import { toast } from '../ui/toast';
import { confirmDialog, promptDialog } from '../ui/dialogs';
import { openContextMenu } from '../ui/contextMenu';
import { moveToSpaceItems } from '../ui/moveToSpace';
import { ViewError } from '../ui/ViewError';
import { spaceDocs, isJoinedSpace } from '../spaces';

type Props = {
  spaceId: string;
  tab: 'files' | 'chat';
  ship: string;
  navigate: (path: string) => void;
};

// A shared-space view, shown with the same row UX as the personal Files view.
// Two flavors, branched on the SpaceSummary `joined` flag:
//   - HOSTED (joined:false): docs come from the listing's `owned` filtered by
//     `space === spaceId` (a space is NOT a folder). Full owner controls.
//   - JOINED (joined:true): the space is hosted elsewhere, so its docs aren't
//     in our `owned` — we fetch them from the space-docs scry, open them as
//     remote/mirrored docs, and offer "Leave" instead of member management.
export function SpaceView({ spaceId, tab, ship, navigate }: Props) {
  const [owned, setOwned] = useState<DocSummary[]>([]);
  const [spaces, setSpaces] = useState<SpaceSummary[]>([]);
  // Docs of a JOINED space (from the space-docs scry). Empty for hosted spaces.
  const [joinedDocs, setJoinedDocs] = useState<DocSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [showMembers, setShowMembers] = useState(false);
  const [showDirectory, setShowDirectory] = useState(false);

  const refresh = async () => {
    try {
      const l = await listDocs();
      setOwned(l.owned ?? []);
      setSpaces(l.spaces ?? []);
      const s = (l.spaces ?? []).find((x) => x.id === spaceId);
      if (s && isJoinedSpace(s)) {
        // A joined space's grid is a separate scry. Keep any stale docs on a
        // transient failure — a just-joined space may 404 until its burst lands.
        try {
          setJoinedDocs(await getSpaceDocs(spaceId));
        } catch {
          /* keep the stale joined-doc list */
        }
      } else {
        setJoinedDocs([]);
      }
      setError(false);
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    setLoading(true);
    void refresh();
    // The listing feed bumps when the host adds/removes docs too, so this same
    // refresh re-fetches space-docs for a joined space — live updates for free.
    const unsub = listingFeed.subscribe(refresh);
    const id = setInterval(refresh, 60000);
    return () => {
      unsub();
      clearInterval(id);
    };
  }, [spaceId]);

  const space = spaces.find((s) => s.id === spaceId);
  const joined = !!space && isJoinedSpace(space);
  // Only a HOSTED space's owner/admin manages members; you're never the admin
  // of a space you merely joined.
  const canManage =
    !!space && !joined && (space.role === 'owner' || space.role === 'admin');

  const docs = useMemo(
    () =>
      // spaceDocs already returns a fresh array; copy joinedDocs so the sort
      // doesn't mutate the state array in place.
      (joined ? [...joinedDocs] : spaceDocs(owned, spaceId)).sort(
        (a, b) => b.modified - a.modified,
      ),
    [joined, joinedDocs, owned, spaceId],
  );

  // Create a doc, then move it into this space. `create` doesn't return the new
  // id, so diff the owned-id set before/after to find it (robust to title
  // collisions), then assign it and open it.
  const onNewDoc = async (type: 'text' | 'sheet' | 'note') => {
    const title =
      type === 'sheet'
        ? 'Untitled Sheet'
        : type === 'note'
          ? 'Untitled Note'
          : 'Untitled Document';
    try {
      const beforeIds = new Set(owned.map((d) => d.id));
      await createDoc(type, title);
      const l = await listDocs();
      setOwned(l.owned ?? []);
      setSpaces(l.spaces ?? []);
      const created = (l.owned ?? [])
        .filter((d) => !beforeIds.has(d.id))
        .sort((a, b) => b.created - a.created);
      const target = created[0];
      if (!target) {
        toast.error("Couldn't find the new document");
        return;
      }
      await setDocSpace(target.id, spaceId);
      navigate(`/drive/d/${target.id}`);
    } catch (e) {
      toast.error(e);
    }
  };

  // Opening a doc. A HOSTED space's docs are local, so we just navigate. A
  // JOINED space's docs live on the host — this is the same flow the app uses
  // for a "Shared with me" doc: ask our agent to mirror it (subscribe-remote to
  // the host) BEFORE navigating, since it isn't in our listing yet and the
  // Editor's own subscribe path only fires once meta resolves. subscribe-remote
  // is idempotent, so the Editor re-issuing it later is harmless.
  const onOpen = async (item: DocSummary) => {
    if (item.type === 'folder') {
      navigate(`/drive/files/${item.id}`);
      return;
    }
    if (joined && space) {
      try {
        await subscribeRemote(space.host, item.id);
      } catch {
        /* the Editor's mirror bootstrap will retry; navigate regardless */
      }
    }
    navigate(`/drive/d/${item.id}`);
  };

  // Leave a JOINED space: stop syncing it, then fall back to the personal Files
  // view (the space is gone from the switcher on the next listing refresh).
  const onLeave = async () => {
    const ok = await confirmDialog({
      title: `Leave "${space?.name || 'this space'}"?`,
      message:
        "You'll stop syncing this space's documents. You can re-join later with the host's space id.",
      confirmLabel: 'Leave space',
      danger: true,
    });
    if (!ok) return;
    try {
      await leaveSpace(spaceId);
      toast.success('Left space');
      navigate('/drive/files');
    } catch (e) {
      toast.error(e);
    }
  };

  const onStar = async (item: DocSummary) => {
    const on = !item.starred;
    setOwned((prev) => prev.map((d) => (d.id === item.id ? { ...d, starred: on } : d)));
    try {
      await starDoc(item.id, on);
    } catch (e) {
      toast.error(e);
    }
    void refresh();
  };

  const onRename = async (item: DocSummary) => {
    const next = await promptDialog({
      title: 'Rename',
      defaultValue: item.title || '',
      placeholder: 'Name',
      confirmLabel: 'Rename',
    });
    if (next === null || next === item.title) return;
    try {
      await renameDoc(item.id, next || 'Untitled');
      await refresh();
    } catch (e) {
      toast.error(e);
    }
  };

  const onCopy = async (item: DocSummary) => {
    try {
      // A copy inherits nothing about the space; put it in this space too so it
      // stays alongside the original.
      const beforeIds = new Set(owned.map((d) => d.id));
      await copyDoc(item.id);
      const l = await listDocs();
      setOwned(l.owned ?? []);
      setSpaces(l.spaces ?? []);
      const made = (l.owned ?? [])
        .filter((d) => !beforeIds.has(d.id))
        .sort((a, b) => b.created - a.created)[0];
      if (made) await setDocSpace(made.id, spaceId);
      toast.success('Copy created');
      await refresh();
    } catch (e) {
      toast.error(e);
    }
  };

  const onDelete = async (item: DocSummary) => {
    const ok = await confirmDialog({
      title: `Delete "${item.title || 'Untitled'}"?`,
      message: 'This item will be moved to the trash.',
      confirmLabel: 'Delete',
      danger: true,
    });
    if (!ok) return;
    try {
      await deleteDoc(item.id);
      toast.success('Moved to trash');
      await refresh();
    } catch (e) {
      toast.error(e);
    }
  };

  const onRowContextMenu = (item: DocSummary) => (e: MouseEvent) => {
    e.preventDefault();
    // A joined space's docs are someone else's — the only local action is Open.
    // (Rename/copy/delete/move-across-spaces are host-side.)
    if (joined) {
      openContextMenu(e.clientX, e.clientY, [
        { label: 'Open', onSelect: () => void onOpen(item) },
      ]);
      return;
    }
    const menu: Parameters<typeof openContextMenu>[2] = [
      { label: 'Open', onSelect: () => void onOpen(item) },
      { label: item.starred ? 'Unstar' : 'Star', onSelect: () => void onStar(item) },
      { label: 'Rename', onSelect: () => void onRename(item) },
      { label: 'Make a copy', onSelect: () => void onCopy(item) },
      { label: 'Delete', danger: true, onSelect: () => void onDelete(item) },
    ];
    // Move out to Personal or across to another space.
    const moveItems = moveToSpaceItems(item, spaces, spaceId, () => void refresh());
    if (moveItems.length > 0) menu.push(...moveItems);
    openContextMenu(e.clientX, e.clientY, menu);
  };

  const title = space?.name || 'Space';

  return (
    <div class={`files${tab === 'chat' ? ' files-chat' : ''}`}>
      <header class="files-header">
        <div class="space-head">
          <h1 class="view-title">{title}</h1>
          {space && (
            <p class="muted small">
              <span class="patp">{displayName(space.host)}</span>
              {joined ? (
                // members/created are placeholders for a joined space — the
                // roster isn't mirrored — so show host + role only.
                <> · joined · your role: {space.role}</>
              ) : (
                <>
                  {' '}
                  · {space.members} member{space.members === 1 ? '' : 's'} · your
                  role: {space.role}
                </>
              )}
            </p>
          )}
        </div>
        {space && (
          <div class="files-actions">
            {joined ? (
              // You can't create docs in a space you don't host, and
              // you're not its admin — so you get a read-only member directory
              // plus Leave.
              <>
                <button
                  class="btn"
                  data-testid="space-directory-button"
                  onClick={() => setShowDirectory(true)}
                >
                  Members
                </button>
                <button
                  class="btn danger"
                  data-testid="leave-space"
                  onClick={() => void onLeave()}
                >
                  Leave space
                </button>
              </>
            ) : (
              <>
                {tab === 'files' && (
                  <>
                    <button class="btn" onClick={() => void onNewDoc('text')}>
                      + Document
                    </button>
                    <button class="btn" onClick={() => void onNewDoc('sheet')}>
                      + Sheet
                    </button>
                    <button class="btn" onClick={() => void onNewDoc('note')}>
                      + Note
                    </button>
                  </>
                )}
                {canManage ? (
                  // Owner/admin: the full management dialog (edit roles, invite,
                  // remove). It doubles as the member directory for them.
                  <button
                    class="btn"
                    data-testid="space-members-button"
                    onClick={() => setShowMembers(true)}
                  >
                    ⚙ Members
                  </button>
                ) : (
                  // Everyone else still gets a read-only directory.
                  <button
                    class="btn"
                    data-testid="space-directory-button"
                    onClick={() => setShowDirectory(true)}
                  >
                    Members
                  </button>
                )}
              </>
            )}
          </div>
        )}
      </header>

      {space && (
        <nav class="space-tabs" aria-label="Space sections">
          <a
            class={`space-tab ${tab === 'files' ? 'active' : ''}`}
            href={`/drive/space/${spaceId}`}
            aria-current={tab === 'files' ? 'page' : undefined}
            onClick={(e: MouseEvent) => {
              e.preventDefault();
              navigate(`/drive/space/${spaceId}`);
            }}
          >
            Files
          </a>
          <a
            class={`space-tab ${tab === 'chat' ? 'active' : ''}`}
            href={`/drive/space/${spaceId}/chat`}
            data-testid="space-chat-tab"
            aria-current={tab === 'chat' ? 'page' : undefined}
            onClick={(e: MouseEvent) => {
              e.preventDefault();
              navigate(`/drive/space/${spaceId}/chat`);
            }}
          >
            Chat
            {space.unread > 0 && tab !== 'chat' && (
              <span class="tab-dot" aria-label={`${space.unread} unread`}>
                {space.unread > 9 ? '9+' : space.unread}
              </span>
            )}
          </a>
        </nav>
      )}

      {tab === 'chat' && space && (
        <SpaceChat spaceId={spaceId} me={ship} canPost={true} />
      )}

      {tab === 'files' && (
        <>
      {loading && <div class="muted" role="status">Loading…</div>}
      {!loading && error && <ViewError onRetry={refresh} />}
      {!loading && !error && !space && (
        <div class="empty">
          <p>This space isn't available.</p>
          <p class="muted">It may have been deleted, or you're no longer a member.</p>
        </div>
      )}
      {!loading && !error && space && docs.length === 0 && (
        <div class="empty">
          {joined ? (
            <>
              <p>No documents in this space yet.</p>
              <p class="muted">
                Syncing… documents the host shares will appear here.
              </p>
            </>
          ) : (
            <>
              <p>Nothing here yet.</p>
              <p class="muted">
                Create a document, sheet, or note above to share it with the space.
              </p>
            </>
          )}
        </div>
      )}

      {docs.length > 0 && (
        <ul class="files-list">
          {docs.map((item) => (
            <FilesRow
              key={item.id}
              item={item}
              onOpen={onOpen}
              // A joined space's docs are the host's: no local star/delete.
              onStar={joined ? undefined : onStar}
              onDelete={joined ? undefined : onDelete}
              onContextMenu={onRowContextMenu(item)}
            />
          ))}
        </ul>
      )}
        </>
      )}

      {showMembers && space && (
        <SpaceMembersDialog
          space={space}
          ship={ship}
          navigate={navigate}
          onClose={() => setShowMembers(false)}
        />
      )}

      {showDirectory && space && (
        <SpaceDirectory
          space={space}
          ship={ship}
          onClose={() => setShowDirectory(false)}
        />
      )}
    </div>
  );
}
