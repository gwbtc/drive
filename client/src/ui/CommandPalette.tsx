import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { listDocs, getSpaceDocs, subscribeRemote, type DocSummary } from '../api';
import { ensureIndex, searchContent, type ContentHit } from '../search/indexer';
import {
  buildSearchDocs,
  currentJoinedDocs,
  type JoinedSpaceDocs,
  type SearchDoc,
} from '../search/spaceSearch';
import { isJoinedSpace } from '../spaces';
import { useSpaces } from '../useSpaces';
import { useFocusTrap } from './useFocusTrap';

type Cmd = {
  id: string;
  label: string;
  hint?: string;
  action: () => void;
};

type Props = {
  navigate: (path: string) => void;
  onClose: () => void;
};

// In-memory cache for doc-title search; refreshed lazily. `cachedDocs` are the
// LOCAL docs (owned + mirrored) that also feed the content index; `cachedJoined`
// are each joined space's docs (fetched once per open so we don't hammer the
// space-docs scry), merged into the TITLE search only.
let cachedAt = 0;
let cachedDocs: DocSummary[] = [];
let cachedJoined: JoinedSpaceDocs[] = [];

export function CommandPalette({ navigate, onClose }: Props) {
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const [docs, setDocs] = useState<DocSummary[]>(cachedDocs);
  const [joined, setJoined] = useState<JoinedSpaceDocs[]>(cachedJoined);
  const [contentHits, setContentHits] = useState<ContentHit[]>([]);
  const [indexing, setIndexing] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  // Trap Tab within the palette and restore focus to the trigger on close.
  useFocusTrap(dialogRef);

  // The CURRENT joined-space ids from the live listing. Used to prune the (up to
  // 30s) doc cache: a space you've LEFT must stop contributing searchable docs
  // immediately, not linger until the cache expires and let you subscribe-remote
  // back into it.
  const spaces = useSpaces();
  const joinedIds = useMemo(
    () => new Set(spaces.filter(isJoinedSpace).map((s) => s.id)),
    [spaces],
  );

  useEffect(() => {
    inputRef.current?.focus();
    if (Date.now() - cachedAt < 30_000 && cachedDocs.length > 0) return;
    listDocs()
      .then(async (l) => {
        const all = [...(l.owned ?? []), ...((l.mirrored as unknown as DocSummary[]) ?? [])];
        cachedDocs = all;
        cachedAt = Date.now();
        setDocs(all);
        // Joined-space docs aren't in the listing — fetch each once so their
        // titles are searchable too. Best-effort and gentle on the ship: a
        // space that fails (e.g. its burst hasn't landed) just contributes no
        // titles this open. Content indexing stays local-only (these remote
        // docs aren't fetched into the /state index).
        const joinedSpaces = (l.spaces ?? []).filter(isJoinedSpace);
        const groups = await Promise.all(
          joinedSpaces.map(async (s): Promise<JoinedSpaceDocs> => {
            try {
              return { id: s.id, name: s.name, host: s.host, docs: await getSpaceDocs(s.id) };
            } catch {
              return { id: s.id, name: s.name, host: s.host, docs: [] };
            }
          }),
        );
        cachedJoined = groups;
        setJoined(groups);
      })
      .catch(() => {});
  }, []);

  // Content index: fire-and-forget on open (and again when the fresh
  // listing lands). While it runs, content results may be partial — the
  // `indexing` flag drives the hint in the "In documents" section.
  useEffect(() => {
    if (docs.length === 0) return;
    let gone = false;
    setIndexing(true);
    ensureIndex(docs).finally(() => {
      if (!gone) setIndexing(false);
    });
    return () => {
      gone = true;
    };
  }, [docs]);

  // Debounced content search over the index (min 2 chars). Re-runs when
  // indexing finishes so late-indexed docs surface without retyping.
  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) {
      setContentHits([]);
      return;
    }
    let gone = false;
    const t = setTimeout(() => {
      searchContent(q)
        .then((hits) => {
          if (!gone) setContentHits(hits);
        })
        .catch(() => {});
    }, 200);
    return () => {
      gone = true;
      clearTimeout(t);
    };
  }, [query, indexing]);

  const staticActions: Cmd[] = [
    { id: 'new-doc', label: 'New document', hint: 'Files → +', action: () => navigate('/drive/files') },
    { id: 'go-files', label: 'Go to Files', action: () => navigate('/drive/files') },
    { id: 'go-notes', label: 'Go to Notes', action: () => navigate('/drive/notes') },
    { id: 'go-photos', label: 'Go to Photos', action: () => navigate('/drive/photos') },
    { id: 'go-trash', label: 'Go to Trash', action: () => navigate('/drive/trash') },
    { id: 'go-home', label: 'Go to Home', action: () => navigate('/drive') },
  ];

  // Local docs + joined-space docs, merged for title search. The cached joined
  // groups are first intersected with the current joined set so a left space's
  // docs drop out at once. Memoized so the merge only re-runs when a source
  // changes, not on every keystroke.
  const searchDocs = useMemo(
    () => buildSearchDocs(docs, currentJoinedDocs(joined, joinedIds)),
    [docs, joined, joinedIds],
  );

  // Open a doc from the palette. A joined-space doc lives on the host and isn't
  // in our listing yet, so mirror it first (subscribe-remote to the host) BEFORE
  // navigating — the same flow SpaceView uses. subscribe-remote is idempotent,
  // and we navigate regardless so a failed mirror still opens (the Editor's own
  // bootstrap retries). Local docs just navigate.
  const openSearchDoc = (d: SearchDoc) => {
    if (!d.remoteHost) {
      navigate(`/drive/d/${d.id}`);
      return;
    }
    void (async () => {
      try {
        await subscribeRemote(d.remoteHost!, d.id);
      } catch {
        /* the Editor's mirror bootstrap will retry; navigate regardless */
      }
      navigate(`/drive/d/${d.id}`);
    })();
  };

  const q = query.trim().toLowerCase();
  const titleMatched = q
    ? searchDocs.filter((d) => (d.title || '').toLowerCase().includes(q)).slice(0, 8)
    : [];
  const docMatches: Cmd[] = titleMatched.map((d) => ({
    id: 'doc:' + d.id,
    label: d.title || 'Untitled',
    hint: d.spaceName ? 'Open in ' + d.spaceName : 'Open ' + (d.type || 'doc'),
    action: () => openSearchDoc(d),
  }));

  const actionMatches = q
    ? staticActions.filter((a) => a.label.toLowerCase().includes(q))
    : staticActions;

  const items: Cmd[] = [...actionMatches, ...docMatches];

  // Content hits, minus docs already shown as title matches. Rendered in
  // their own "In documents" section but sharing one keyboard-nav index
  // space with `items` (content indices start at items.length).
  const titleIds = new Set(titleMatched.map((d) => d.id));
  const contentSection: ContentHit[] =
    q.length >= 2 ? contentHits.filter((h) => !titleIds.has(h.id)) : [];
  const allItems: Cmd[] = [
    ...items,
    ...contentSection.map((h) => ({
      id: 'content:' + h.id,
      label: h.title || 'Untitled',
      action: () => navigate(`/drive/d/${h.id}`),
    })),
  ];

  // The results list changes as the user types and as async content hits
  // land, but `active` isn't reset on every such change — clamp it to the
  // current range so Enter and the highlight never point past the end.
  const safeActive = allItems.length === 0 ? 0 : Math.min(Math.max(active, 0), allItems.length - 1);

  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      onClose();
      return;
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive(Math.min(allItems.length - 1, safeActive + 1));
      return;
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive(Math.max(0, safeActive - 1));
      return;
    }
    if (e.key === 'Enter') {
      e.preventDefault();
      const sel = allItems[safeActive];
      if (sel) {
        sel.action();
        onClose();
      }
    }
  };

  const activeId = allItems.length > 0 ? `cmdk-opt-${safeActive}` : undefined;

  return (
    <div class="modal-backdrop" onClick={onClose}>
      <div
        class="cmdk"
        role="dialog"
        aria-modal="true"
        aria-label="Command palette"
        ref={dialogRef}
        onClick={(e) => e.stopPropagation()}
      >
        <input
          ref={inputRef}
          class="cmdk-input"
          type="text"
          role="combobox"
          aria-label="Search documents and actions"
          aria-expanded={allItems.length > 0}
          aria-controls="cmdk-listbox"
          aria-activedescendant={activeId}
          aria-autocomplete="list"
          placeholder="Search…"
          value={query}
          onInput={(e) => {
            setQuery((e.target as HTMLInputElement).value);
            setActive(0);
          }}
          onKeyDown={onKey}
        />
        <ul class="cmdk-list" id="cmdk-listbox" role="listbox" aria-label="Results">
          {allItems.length === 0 && !(indexing && q.length >= 2) && (
            <li class="cmdk-empty muted" role="presentation">No matches</li>
          )}
          {items.map((c, i) => (
            <li
              key={c.id}
              id={`cmdk-opt-${i}`}
              class={`cmdk-item ${i === safeActive ? 'active' : ''}`}
              role="option"
              aria-selected={i === safeActive}
              onMouseEnter={() => setActive(i)}
              onClick={() => {
                c.action();
                onClose();
              }}
            >
              <span class="cmdk-label">{c.label}</span>
              {c.hint && <span class="cmdk-hint">{c.hint}</span>}
            </li>
          ))}
          {q.length >= 2 && (contentSection.length > 0 || indexing) && (
            <li class="cmdk-section" role="presentation">
              In documents
              {indexing && <span class="cmdk-indexing">indexing…</span>}
            </li>
          )}
          {contentSection.map((h, j) => {
            const i = items.length + j;
            return (
              <li
                key={'content:' + h.id}
                id={`cmdk-opt-${i}`}
                class={`cmdk-item cmdk-content ${i === safeActive ? 'active' : ''}`}
                role="option"
                aria-selected={i === safeActive}
                onMouseEnter={() => setActive(i)}
                onClick={() => {
                  navigate(`/drive/d/${h.id}`);
                  onClose();
                }}
              >
                <div class="cmdk-content-main">
                  <span class="cmdk-label">{h.title || 'Untitled'}</span>
                  {/* Bold the matched range via offsets — spans only, no HTML strings. */}
                  <span class="cmdk-snippet">
                    {h.snippet.slice(0, h.matchStart)}
                    <b>{h.snippet.slice(h.matchStart, h.matchEnd)}</b>
                    {h.snippet.slice(h.matchEnd)}
                  </span>
                </div>
                <span class="cmdk-hint">Open {h.type}</span>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}
