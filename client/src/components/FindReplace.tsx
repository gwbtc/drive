import { useEffect, useRef, useState } from 'preact/hooks';
import type { Editor } from '@tiptap/core';
import { getSearchState } from '../extensions/SearchHighlight';

type Props = { editor: Editor; onClose: () => void; initialMode?: 'find' | 'replace' };

export function FindReplace({ editor, onClose, initialMode = 'find' }: Props) {
  const [query, setQuery] = useState('');
  const [replacement, setReplacement] = useState('');
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [mode, setMode] = useState<'find' | 'replace'>(initialMode);
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const state = getSearchState(editor);
  const matchCount = state?.matches.length ?? 0;

  useEffect(() => {
    inputRef.current?.focus();
    return () => {
      editor.chain().clearSearch().run();
    };
  }, [editor]);

  // Whenever query / case toggle changes, update the highlight plugin.
  useEffect(() => {
    if (!query) {
      editor.chain().clearSearch().run();
      setActive(0);
      return;
    }
    editor.chain().setSearch(query, { caseSensitive, activeIndex: 0 }).run();
    setActive(0);
    // Scroll active into view
    requestAnimationFrame(() => {
      const el = editor.view.dom.querySelector('.search-match-active');
      el?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    });
  }, [query, caseSensitive, editor]);

  const gotoMatch = (idx: number) => {
    const cur = getSearchState(editor);
    if (!cur || cur.matches.length === 0) return;
    const wrapped = ((idx % cur.matches.length) + cur.matches.length) % cur.matches.length;
    setActive(wrapped);
    editor
      .chain()
      .setSearch(query, { caseSensitive, activeIndex: wrapped })
      .setTextSelection({ from: cur.matches[wrapped].from, to: cur.matches[wrapped].to })
      .run();
    requestAnimationFrame(() => {
      const el = editor.view.dom.querySelector('.search-match-active');
      el?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    });
  };

  const doReplace = () => {
    const cur = getSearchState(editor);
    if (!cur || cur.matches.length === 0) return;
    const m = cur.matches[active];
    if (!m) return;
    editor
      .chain()
      .insertContentAt({ from: m.from, to: m.to }, replacement)
      .run();
    // After replace, re-query and move to next.
    setTimeout(() => gotoMatch(active), 30);
  };

  const doReplaceAll = () => {
    const cur = getSearchState(editor);
    if (!cur || cur.matches.length === 0) return;
    // Replace right-to-left so positions before each match stay valid.
    const matches = [...cur.matches].reverse();
    let tr = editor.state.tr;
    for (const m of matches) {
      tr = tr.insertText(replacement, m.from, m.to);
    }
    editor.view.dispatch(tr);
  };

  return (
    <div class="find-panel" role="dialog" aria-label="Find and replace">
      <div class="find-row">
        <input
          ref={inputRef}
          class="find-input"
          aria-label="Find in document"
          placeholder="Find"
          value={query}
          onInput={(e) => setQuery((e.target as HTMLInputElement).value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              gotoMatch(active + (e.shiftKey ? -1 : 1));
            }
            if (e.key === 'Escape') {
              e.preventDefault();
              onClose();
            }
          }}
        />
        <span class="find-count">
          {matchCount === 0 ? '0' : `${active + 1} / ${matchCount}`}
        </span>
        <button class="btn-icon" title="Previous" aria-label="Previous match" onClick={() => gotoMatch(active - 1)}>‹</button>
        <button class="btn-icon" title="Next" aria-label="Next match" onClick={() => gotoMatch(active + 1)}>›</button>
        <label class="find-case" title="Match case">
          <input
            type="checkbox"
            aria-label="Match case"
            checked={caseSensitive}
            onChange={(e) => setCaseSensitive((e.target as HTMLInputElement).checked)}
          />
          <span>Aa</span>
        </label>
        <button
          class="btn-icon"
          title={mode === 'find' ? 'Show replace' : 'Hide replace'}
          aria-label="Toggle replace"
          onClick={() => setMode((m) => (m === 'find' ? 'replace' : 'find'))}
        >
          {mode === 'find' ? '…' : '×r'}
        </button>
        <button class="btn-icon" title="Close" aria-label="Close find" onClick={onClose}>×</button>
      </div>
      {mode === 'replace' && (
        <div class="find-row">
          <input
            class="find-input"
            aria-label="Replace with"
            placeholder="Replace with"
            value={replacement}
            onInput={(e) => setReplacement((e.target as HTMLInputElement).value)}
          />
          <button class="btn" onClick={doReplace} disabled={matchCount === 0}>Replace</button>
          <button class="btn" onClick={doReplaceAll} disabled={matchCount === 0}>Replace all</button>
        </div>
      )}
    </div>
  );
}
