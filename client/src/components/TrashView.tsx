import { useEffect, useState } from 'preact/hooks';
import {
  listTrashed,
  restoreDoc,
  purgeDoc,
  bulkPurge,
  type TrashEntry,
} from '../api';
import { toast } from '../ui/toast';
import { confirmDialog } from '../ui/dialogs';
import { ViewError } from '../ui/ViewError';
import { listingFeed } from '../listingFeed';

const TYPE_LABEL: Record<string, string> = {
  text: 'Document',
  sheet: 'Sheet',
  note: 'Note',
  image: 'Image',
  file: 'File',
  folder: 'Folder',
};

const TYPE_ICON: Record<string, string> = {
  text: '📄',
  sheet: '📊',
  note: '📝',
  image: '🖼',
  file: '📎',
  folder: '📁',
};

function relativeTime(ms: number): string {
  const diff = Date.now() - ms;
  const sec = Math.round(diff / 1000);
  if (sec < 60) return 'just now';
  const min = Math.round(sec / 60);
  if (min < 60) return `${min} min ago`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr} hr ago`;
  const day = Math.round(hr / 24);
  return `${day} day${day === 1 ? '' : 's'} ago`;
}

function ttlText(ms: number): string {
  if (ms <= 0) return 'purges soon';
  const day = Math.ceil(ms / (24 * 60 * 60 * 1000));
  return `Auto-deletes in ${day} day${day === 1 ? '' : 's'}`;
}

export function TrashView() {
  const [items, setItems] = useState<TrashEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  const refresh = async () => {
    try {
      setItems(await listTrashed());
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

  const onRestore = async (item: TrashEntry) => {
    try {
      await restoreDoc(item.id);
      toast.success('Restored');
      await refresh();
    } catch (e) {
      toast.error(e);
    }
  };

  const onPurge = async (item: TrashEntry) => {
    const ok = await confirmDialog({
      title: `Permanently delete "${item.title || 'Untitled'}"?`,
      message: 'This cannot be undone.',
      confirmLabel: 'Delete permanently',
      danger: true,
    });
    if (!ok) return;
    try {
      await purgeDoc(item.id);
      toast.success('Deleted permanently');
      await refresh();
    } catch (e) {
      toast.error(e);
    }
  };

  const onEmptyTrash = async () => {
    if (items.length === 0) return;
    const ok = await confirmDialog({
      title: `Empty trash?`,
      message: `This will permanently delete all ${items.length} item${items.length === 1 ? '' : 's'}. Cannot be undone.`,
      confirmLabel: 'Empty trash',
      danger: true,
    });
    if (!ok) return;
    try {
      await bulkPurge(items.map((i) => i.id));
      toast.success('Trash emptied');
      await refresh();
    } catch (e) {
      toast.error(e);
    }
  };

  return (
    <div class="trash">
      <header class="trash-header">
        <h1>Trash</h1>
        {items.length > 0 && (
          <button class="btn danger" onClick={onEmptyTrash}>
            Empty trash
          </button>
        )}
      </header>
      <p class="trash-hint muted">
        Items in trash are auto-deleted after 30 days.
      </p>
      {loading && <div class="muted" role="status">Loading…</div>}
      {!loading && error && <ViewError onRetry={refresh} />}
      {!loading && !error && items.length === 0 && (
        <div class="empty">
          <p>Trash is empty.</p>
          <p class="muted">Deleted items live here for 30 days before auto-deletion.</p>
        </div>
      )}
      {items.length > 0 && (
        <ul class="files-list">
          {items.map((item) => (
            <li class="files-row" key={item.id}>
              <div class="files-row-main" style="cursor: default">
                <span class="files-row-icon">{TYPE_ICON[item.type] ?? '📄'}</span>
                <span class="files-row-info">
                  <span class="files-row-title">{item.title || 'Untitled'}</span>
                  <span class="files-row-meta">
                    {TYPE_LABEL[item.type] ?? item.type} · deleted {relativeTime(item['trashed-at'])} · {ttlText(item['ttl-ms'])}
                  </span>
                </span>
              </div>
              <button
                class="btn"
                onClick={() => onRestore(item)}
                aria-label={`Restore ${item.title || 'Untitled'}`}
              >
                Restore
              </button>
              <button
                class="btn danger"
                onClick={() => onPurge(item)}
                aria-label={`Delete ${item.title || 'Untitled'} permanently`}
              >
                Delete
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
