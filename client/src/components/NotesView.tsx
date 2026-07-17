import { useCallback, useEffect, useMemo, useState } from 'preact/hooks';
import { listDocs, createDoc, type DocSummary } from '../api';
import { personalDocs } from '../spaces';
import { NoteCard } from './NoteCard';
import { ViewError } from '../ui/ViewError';
import { listingFeed } from '../listingFeed';
import {
  type NoteEntry,
  type NoteMeta,
  collectLabels,
  loadCachedNoteMeta,
  metaEqual,
  partitionNotes,
} from '../notes/meta';

type Props = {
  ship: string;
  navigate: (path: string) => void;
};

export function NotesView({ ship }: Props) {
  const [notes, setNotes] = useState<DocSummary[]>([]);
  // Metadata each NoteCard reports up (keyed by note id). Persists across a
  // card unmounting (e.g. when a note is archived out of the active grid), so
  // an archived note stays out of the main view without needing a live card.
  const [metaById, setMetaById] = useState<Record<string, NoteMeta>>({});
  const [activeLabel, setActiveLabel] = useState<string | null>(null);
  const [showArchive, setShowArchive] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  const refresh = async () => {
    try {
      const l = await listDocs();
      // Personal notes only — notes assigned to a shared space live in that
      // space's view, not the personal Notes grid.
      const noteDocs = personalDocs(l.owned ?? []).filter((d) => d.type === 'note');
      setNotes(noteDocs);
      // Seed from the local cache so archived/pinned partitioning is correct
      // immediately — without this, an archived note flashes into the main
      // grid until its card mounts and reports its meta. Live cards overwrite
      // these as they sync.
      setMetaById((prev) => {
        const next = { ...prev };
        for (const n of noteDocs) {
          if (next[n.id]) continue;
          const cached = loadCachedNoteMeta(n.id);
          if (cached) next[n.id] = cached;
        }
        return next;
      });
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

  const onNew = async () => {
    await createDoc('note', '');
    await refresh();
  };

  // Stable callback: cards report meta here. Skip the state churn when a card
  // re-reports an unchanged meta (Yjs observers fire on any map key change).
  const onMeta = useCallback((id: string, meta: NoteMeta) => {
    setMetaById((prev) => {
      const cur = prev[id];
      if (cur && metaEqual(cur, meta)) return prev;
      return { ...prev, [id]: meta };
    });
  }, []);

  const entries: NoteEntry<DocSummary>[] = useMemo(
    () => notes.map((n) => ({ note: n, meta: metaById[n.id] ?? null })),
    [notes, metaById],
  );

  const labels = useMemo(() => collectLabels(entries), [entries]);
  const { pinned, others, archived } = useMemo(
    () => partitionNotes(entries, activeLabel),
    [entries, activeLabel],
  );

  // If the active filter label vanishes (its last note lost the label or was
  // deleted), fall back to showing everything.
  useEffect(() => {
    if (activeLabel && !labels.includes(activeLabel)) setActiveLabel(null);
  }, [labels, activeLabel]);

  const renderCard = (n: DocSummary) => (
    <NoteCard
      key={n.id}
      note={n}
      ship={ship}
      onDeleted={refresh}
      onMeta={onMeta}
      onSelectLabel={setActiveLabel}
    />
  );

  const activeEmpty = pinned.length === 0 && others.length === 0;

  return (
    <div class="notes">
      <header class="notes-header">
        <h1>{showArchive ? 'Archive' : 'Notes'}</h1>
        <div class="notes-header-actions">
          <button
            class={`btn ${showArchive ? 'primary' : ''}`}
            data-testid="notes-archive-toggle"
            aria-pressed={showArchive}
            onClick={() => setShowArchive((v) => !v)}
          >
            {showArchive ? '← Notes' : `Archive${archived.length ? ` (${archived.length})` : ''}`}
          </button>
          {!showArchive && (
            <button class="btn primary" onClick={onNew}>
              + Note
            </button>
          )}
        </div>
      </header>

      {labels.length > 0 && (
        <div class="notes-filter" data-testid="note-filters" role="toolbar" aria-label="Filter by label">
          <button
            type="button"
            class={`note-filter-chip ${activeLabel === null ? 'active' : ''}`}
            onClick={() => setActiveLabel(null)}
          >
            All
          </button>
          {labels.map((l) => (
            <button
              key={l}
              type="button"
              data-testid="note-filter-label"
              class={`note-filter-chip ${activeLabel === l ? 'active' : ''}`}
              aria-pressed={activeLabel === l}
              onClick={() => setActiveLabel((cur) => (cur === l ? null : l))}
            >
              🏷 {l}
            </button>
          ))}
        </div>
      )}

      {loading && <div class="muted" role="status">Loading…</div>}
      {!loading && error && <ViewError onRetry={refresh} />}

      {!loading && !error && notes.length === 0 && (
        <div class="empty">
          <p>No notes yet.</p>
          <p class="muted">Click + Note to start one.</p>
        </div>
      )}

      {/* Archive view: a flat grid of archived notes (still label-filterable). */}
      {!loading && !error && showArchive && (
        <>
          {archived.length === 0 ? (
            <div class="empty">
              <p>Nothing archived.</p>
              <p class="muted">Archived notes land here.</p>
            </div>
          ) : (
            <div class="notes-grid" data-testid="notes-archive-grid">
              {archived.map(renderCard)}
            </div>
          )}
        </>
      )}

      {/* Main view: Pinned section floats above Others (Keep layout). */}
      {!loading && !error && !showArchive && (
        <>
          {pinned.length > 0 && (
            <>
              <div class="notes-section-label">Pinned</div>
              <div class="notes-grid" data-testid="notes-pinned-grid">
                {pinned.map(renderCard)}
              </div>
            </>
          )}
          {others.length > 0 && (
            <>
              {pinned.length > 0 && <div class="notes-section-label">Others</div>}
              <div class="notes-grid" data-testid="notes-others-grid">
                {others.map(renderCard)}
              </div>
            </>
          )}
          {notes.length > 0 && activeEmpty && (
            <div class="empty">
              <p class="muted">
                {activeLabel
                  ? `No notes labelled “${activeLabel}”.`
                  : 'No notes here — check the Archive.'}
              </p>
            </div>
          )}
        </>
      )}
    </div>
  );
}
