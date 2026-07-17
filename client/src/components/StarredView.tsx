import { useEffect, useMemo, useState } from 'preact/hooks';
import { listDocs, starDoc, deleteDoc, type DocSummary } from '../api';
import { FilesRow } from './FilesRow';
import { listingFeed } from '../listingFeed';
import { toast } from '../ui/toast';
import { confirmDialog } from '../ui/dialogs';
import { ViewError } from '../ui/ViewError';

type Props = { navigate: (path: string) => void };

// All owned + shared docs the user has starred, newest-modified first.
export function StarredView({ navigate }: Props) {
  const [docs, setDocs] = useState<DocSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  const refresh = async () => {
    try {
      const l = await listDocs();
      const all = [...(l.owned ?? []), ...(l.shared ?? [])];
      setDocs(all.filter((d) => d.starred));
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

  const sorted = useMemo(
    () => [...docs].sort((a, b) => b.modified - a.modified),
    [docs],
  );

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
        <h1 class="view-title">Starred</h1>
      </header>

      {loading && <div class="muted" role="status">Loading…</div>}
      {!loading && error && <ViewError onRetry={refresh} />}
      {!loading && !error && sorted.length === 0 && (
        <div class="empty">
          <p>Nothing starred yet.</p>
          <p class="muted">Tap the ☆ on any file to keep it here.</p>
        </div>
      )}

      {sorted.length > 0 && (
        <ul class="files-list">
          {sorted.map((item) => (
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
