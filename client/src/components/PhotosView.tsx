import { useEffect, useState } from 'preact/hooks';
import { listDocs, deleteDoc, starDoc, uploadFile, type DocSummary } from '../api';
import { toast } from '../ui/toast';
import { confirmDialog } from '../ui/dialogs';
import { ViewError } from '../ui/ViewError';
import { listingFeed } from '../listingFeed';
import { personalDocs } from '../spaces';
import { ThumbImg, generateAndUploadThumb } from './ThumbImg';

type Props = { navigate: (path: string) => void };

export function PhotosView({ navigate }: Props) {
  const [photos, setPhotos] = useState<DocSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [uploading, setUploading] = useState(false);

  const refresh = async () => {
    try {
      const l = await listDocs();
      // Personal photos only — space images live in their space view.
      setPhotos(personalDocs(l.owned ?? []).filter((d) => d.type === 'image'));
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

  const onStar = async (photo: DocSummary) => {
    const on = !photo.starred;
    setPhotos((prev) => prev.map((p) => (p.id === photo.id ? { ...p, starred: on } : p)));
    try {
      await starDoc(photo.id, on);
    } catch (e) {
      toast.error(e);
    }
    void refresh();
  };

  const onUpload = (e: Event) => {
    const input = e.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    setUploading(true);
    toast
      .promise(uploadFile(file, null), {
        loading: `Uploading ${file.name}…`,
        success: 'Uploaded',
      })
      .then(async (docId) => {
        // Best-effort image thumbnail so the gallery loads light next time.
        await generateAndUploadThumb(docId, file);
        await refresh();
      })
      .catch(() => {})
      .finally(() => {
        setUploading(false);
        input.value = '';
      });
  };

  const onDelete = async (id: string) => {
    const ok = await confirmDialog({
      title: 'Delete this photo?',
      message: 'It will be moved to the trash.',
      confirmLabel: 'Delete',
      danger: true,
    });
    if (!ok) return;
    try {
      await deleteDoc(id);
      toast.success('Moved to trash');
      await refresh();
    } catch (e) {
      toast.error(e);
    }
  };

  return (
    <div class="photos">
      <header class="photos-header">
        <h1>Photos</h1>
        <label class="btn primary upload-btn">
          {uploading ? 'Uploading…' : '⬆ Upload'}
          <input
            type="file"
            accept="image/*"
            disabled={uploading}
            onChange={onUpload}
            style="display:none"
          />
        </label>
      </header>

      {loading && <div class="muted" role="status">Loading…</div>}
      {!loading && error && <ViewError onRetry={refresh} />}
      {!loading && !error && photos.length === 0 && (
        <div class="empty">
          <p>No photos yet.</p>
          <p class="muted">Upload one above to get started.</p>
        </div>
      )}

      <div class="gallery">
        {photos.map((p) => (
          <a
            key={p.id}
            class="gallery-tile"
            href={`/drive/d/${p.id}`}
            onClick={(e) => {
              e.preventDefault();
              navigate(`/drive/d/${p.id}`);
            }}
            title={p.title}
          >
            <ThumbImg docId={p.id} alt={p.title || 'Untitled photo'} />
            <button
              class={`gallery-star ${p.starred ? 'starred' : ''}`}
              title={p.starred ? 'Unstar' : 'Star'}
              aria-label={p.starred ? 'Unstar photo' : 'Star photo'}
              aria-pressed={!!p.starred}
              data-testid="star-toggle"
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                void onStar(p);
              }}
            >
              {p.starred ? '★' : '☆'}
            </button>
            <button
              class="gallery-delete"
              title="Delete"
              aria-label="Delete photo"
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                onDelete(p.id);
              }}
            >
              ×
            </button>
          </a>
        ))}
      </div>
    </div>
  );
}
