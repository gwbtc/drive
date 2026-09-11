import { displayName } from '../api';
import { useEffect, useMemo, useState } from 'preact/hooks';
import { listDocs, formatDate, type DocSummary } from '../api';
import { personalDocs } from '../spaces';
import { ViewError } from '../ui/ViewError';
import { listingFeed } from '../listingFeed';
import { ThumbImg } from './ThumbImg';
import { SpaceInvites } from './SpaceInvites';

type Props = { ship: string; navigate: (path: string) => void };

const TYPE_ICON: Record<string, string> = {
  text: '📄',
  sheet: '📊',
  note: '📝',
  image: '🖼️',
  file: '📎',
  folder: '📁',
};

export function HubView({ ship, navigate }: Props) {
  const [owned, setOwned] = useState<DocSummary[]>([]);
  const [shared, setShared] = useState<DocSummary[]>([]);
  const [error, setError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const refresh = async () => {
      try {
        const l = await listDocs();
        if (!cancelled) {
          setOwned(l.owned ?? []);
          // Invites + live mirrors, deduped (mirror data is fresher).
          const invites = (l.shared ?? []) as unknown as DocSummary[];
          const mirrors = (l.mirrored ?? []) as unknown as DocSummary[];
          const byId = new Map<string, DocSummary>();
          for (const d of invites) byId.set(d.id, d);
          for (const d of mirrors) byId.set(d.id, d);
          setShared([...byId.values()]);
          setError(false);
        }
      } catch {
        if (!cancelled) setError(true);
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

  // Home summarizes the PERSONAL drive; space docs live in their space views.
  const personalOwned = useMemo(() => personalDocs(owned), [owned]);
  const filesItems = useMemo(
    () =>
      personalOwned
        .filter((d) => d.type !== 'note' && d.type !== 'image')
        .slice(0, 6),
    [personalOwned],
  );
  const notesItems = useMemo(
    () => personalOwned.filter((d) => d.type === 'note').slice(0, 6),
    [personalOwned],
  );
  const photosItems = useMemo(
    () => personalOwned.filter((d) => d.type === 'image').slice(0, 6),
    [personalOwned],
  );

  const open = (item: DocSummary) => navigate(`/drive/d/${item.id}`);
  const goFolder = (item: DocSummary) =>
    item.type === 'folder' ? navigate(`/drive/files/${item.id}`) : open(item);

  return (
    <div class="hub">
      <div class="hub-greet">
        <h1>Welcome back</h1>
        <p class="muted">Signed in as <span class="patp">{displayName(ship)}</span></p>
      </div>

      {/* Pending space invitations — prominent, above the drive summary.
          Renders nothing when there are none. */}
      <SpaceInvites />

      {/* Keep stale cards visible during transient failures; only take over
          the screen when there's nothing cached to show. */}
      {error && owned.length === 0 && <ViewError onRetry={() => location.reload()} />}

      <div class="hub-cards">
        <div class="hub-card">
          <header class="hub-card-h">
            <span class="hub-card-title">Files</span>
            <a class="hub-card-link" href="/drive/files" onClick={(e) => { e.preventDefault(); navigate('/drive/files'); }}>
              View all →
            </a>
          </header>
          <ul class="hub-card-list">
            {filesItems.length === 0 && <li class="muted">No files yet</li>}
            {filesItems.map((d) => (
              <li key={d.id}>
                <button class="hub-row" onClick={() => goFolder(d)}>
                  <span class="hub-row-icon">{TYPE_ICON[d.type] ?? '📄'}</span>
                  <span class="hub-row-title">{d.title || 'Untitled'}</span>
                  <span class="hub-row-meta">{formatDate(d.modified)}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>

        <div class="hub-card">
          <header class="hub-card-h">
            <span class="hub-card-title">Notes</span>
            <a class="hub-card-link" href="/drive/notes" onClick={(e) => { e.preventDefault(); navigate('/drive/notes'); }}>
              View all →
            </a>
          </header>
          <ul class="hub-card-list">
            {notesItems.length === 0 && <li class="muted">No notes yet</li>}
            {notesItems.map((d) => (
              <li key={d.id}>
                <button class="hub-row" onClick={() => navigate('/drive/notes')}>
                  <span class="hub-row-icon">📝</span>
                  <span class="hub-row-title">{d.title || 'Untitled note'}</span>
                  <span class="hub-row-meta">{formatDate(d.modified)}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>

        <div class="hub-card">
          <header class="hub-card-h">
            <span class="hub-card-title">Photos</span>
            <a class="hub-card-link" href="/drive/photos" onClick={(e) => { e.preventDefault(); navigate('/drive/photos'); }}>
              View all →
            </a>
          </header>
          {photosItems.length === 0 ? (
            <ul class="hub-card-list"><li class="muted">No photos yet</li></ul>
          ) : (
            <div class="hub-photos">
              {photosItems.map((d) => (
                <a
                  key={d.id}
                  class="hub-photo"
                  href={`/drive/d/${d.id}`}
                  onClick={(e) => { e.preventDefault(); open(d); }}
                  title={d.title}
                >
                  <ThumbImg docId={d.id} alt={d.title || 'Untitled photo'} />
                </a>
              ))}
            </div>
          )}
        </div>

        {shared.length > 0 && (
          <div class="hub-card">
            <header class="hub-card-h">
              <span class="hub-card-title">Shared with me</span>
            </header>
            <ul class="hub-card-list">
              {shared.slice(0, 6).map((d) => (
                <li key={d.id}>
                  <button class="hub-row" onClick={() => open(d)}>
                    <span class="hub-row-icon">{TYPE_ICON[d.type] ?? '📄'}</span>
                    <span class="hub-row-title">{d.title || 'Untitled'}</span>
                    <span class="hub-row-meta patp">{displayName(d.owner)}</span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}
