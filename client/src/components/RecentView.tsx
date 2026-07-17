import { useEffect, useMemo, useState } from 'preact/hooks';
import { listDocs, starDoc, deleteDoc, type DocSummary } from '../api';
import { FilesRow } from './FilesRow';
import { listingFeed } from '../listingFeed';
import { loadRecents, type RecentEntry } from '../recents';
import { toast } from '../ui/toast';
import { confirmDialog } from '../ui/dialogs';
import { ViewError } from '../ui/ViewError';

type Props = { navigate: (path: string) => void };

// Docs opened recently (tracked in localStorage), most-recent-first. Titles
// are resolved from the live listing; ids no longer in the listing are dropped.
export function RecentView({ navigate }: Props) {
  const [docs, setDocs] = useState<DocSummary[]>([]);
  const [recents, setRecents] = useState<RecentEntry[]>(() => loadRecents());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  const refresh = async () => {
    setRecents(loadRecents());
    try {
      const l = await listDocs();
      setDocs([...(l.owned ?? []), ...(l.shared ?? [])]);
      setError(false);
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void refresh();
    const unsub = listingFeed.subscribe(refresh);
    const id = setInterval(refresh, 60000);
    return () => {
      unsub();
      clearInterval(id);
    };
  }, []);

  const ordered = useMemo(() => {
    const byId = new Map(docs.map((d) => [d.id, d]));
    return recents
      .map((r) => byId.get(r.id))
      .filter((d): d is DocSummary => !!d);
  }, [docs, recents]);

  const onOpen = (item: DocSummary) =>
    item.type === 'folder'
      ? navigate(`/drive/files/${item.id}`)
      : navigate(`/drive/d/${item.id}`);

  const onStar = async (item: DocSummary) => {
    const on = !item.starred;
    setDocs((prev) => prev.map((d) => (d.id === item.id ? { ...d, starred: on } : d)));
    try {
      await starDoc(item.id, on);
    } catch (e) {
      toast.error(e);
    }
    void refresh();
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

  return (
    <div class="files">
      <header class="files-header">
        <h1 class="view-title">Recent</h1>
      </header>

      {loading && <div class="muted" role="status">Loading…</div>}
      {!loading && error && <ViewError onRetry={refresh} />}
      {!loading && !error && ordered.length === 0 && (
        <div class="empty">
          <p>Nothing here yet.</p>
          <p class="muted">Documents you open will show up here.</p>
        </div>
      )}

      {ordered.length > 0 && (
        <ul class="files-list">
          {ordered.map((item) => (
            <FilesRow
              key={item.id}
              item={item}
              onOpen={onOpen}
              onStar={onStar}
              onDelete={onDelete}
            />
          ))}
        </ul>
      )}
    </div>
  );
}
