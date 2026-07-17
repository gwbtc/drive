import type { Editor } from '@tiptap/core';
import { useEffect, useRef, useState } from 'preact/hooks';
import { listDocs, type DocSummary } from '../api';
import type { DocLinkState, DocLinkKeyRef } from '../extensions/DocLink';

type Props = {
  editor: Editor;
  state: DocLinkState;
  keyHandler: DocLinkKeyRef;
  onClose: () => void;
};

// In-memory cache of the user's docs, shared across popup opens.
let cachedDocs: DocSummary[] = [];
let cachedAt = 0;

const DOC_ICON: Record<string, string> = {
  text: '📄',
  sheet: '📊',
  note: '🗒️',
  image: '🖼️',
  file: '📎',
  folder: '📁',
};

export function DocLinkPicker({ editor, state, keyHandler, onClose }: Props) {
  const [docs, setDocs] = useState<DocSummary[]>(cachedDocs);
  const [active, setActive] = useState(0);
  const listRef = useRef<HTMLUListElement>(null);

  useEffect(() => {
    if (Date.now() - cachedAt < 30_000 && cachedDocs.length > 0) return;
    listDocs()
      .then((l) => {
        const all = [
          ...(l.owned ?? []),
          ...((l.mirrored as unknown as DocSummary[]) ?? []),
          ...(l.shared ?? []),
        ];
        cachedDocs = all;
        cachedAt = Date.now();
        setDocs(all);
      })
      .catch(() => {});
  }, []);

  const q = state.query.trim().toLowerCase();
  const matches = (
    q
      ? docs
          .map((d) => ({ d, i: (d.title || '').toLowerCase().indexOf(q) }))
          .filter((x) => x.i >= 0)
          .sort((a, b) => a.i - b.i)
          .map((x) => x.d)
      : docs
  ).slice(0, 8);

  // Reset the highlighted row whenever the query changes.
  useEffect(() => {
    setActive(0);
  }, [q]);

  const choose = (d: DocSummary) => {
    editor.commands.insertDocLink({
      range: state.range,
      id: d.id,
      title: d.title || 'Untitled',
    });
    onClose();
  };

  // Register the keyboard handler the ProseMirror plugin delegates to while a
  // trigger is active. Assigned every render so it closes over fresh state.
  keyHandler.current = (e: KeyboardEvent): boolean => {
    if (e.key === 'ArrowDown') {
      setActive((i) => Math.min(matches.length - 1, i + 1));
      return true;
    }
    if (e.key === 'ArrowUp') {
      setActive((i) => Math.max(0, i - 1));
      return true;
    }
    if (e.key === 'Enter' || e.key === 'Tab') {
      const d = matches[active];
      if (d) {
        choose(d);
        return true;
      }
      return false;
    }
    if (e.key === 'Escape') {
      editor.commands.dismissDocLink();
      onClose();
      return true;
    }
    return false;
  };
  useEffect(() => {
    return () => {
      keyHandler.current = null;
    };
  }, [keyHandler]);

  const rect = state.rect;
  const style = rect
    ? { left: `${rect.left}px`, top: `${rect.bottom + 4}px` }
    : { left: '50%', top: '80px' };

  return (
    <div class="doc-link-popup" data-testid="doc-link-picker" style={style} role="listbox">
      {matches.length === 0 ? (
        <div class="doc-link-empty muted">
          {docs.length === 0 ? 'Loading documents…' : 'No documents match'}
        </div>
      ) : (
        <ul class="doc-link-list" ref={listRef}>
          {matches.map((d, i) => (
            <li
              key={d.id}
              class={`doc-link-item ${i === active ? 'active' : ''}`}
              role="option"
              aria-selected={i === active}
              onMouseEnter={() => setActive(i)}
              onMouseDown={(e) => {
                // Keep the editor selection intact for insertDocLink.
                e.preventDefault();
                choose(d);
              }}
            >
              <span class="doc-link-icon" aria-hidden="true">
                {DOC_ICON[d.type] ?? '📄'}
              </span>
              <span class="doc-link-label">{d.title || 'Untitled'}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
