import { Extension } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    searchHighlight: {
      setSearch: (
        query: string,
        opts?: { caseSensitive?: boolean; activeIndex?: number },
      ) => ReturnType;
      clearSearch: () => ReturnType;
    };
  }
}

export type SearchMatch = { from: number; to: number };

const KEY = new PluginKey<{
  query: string;
  caseSensitive: boolean;
  activeIndex: number;
  matches: SearchMatch[];
  deco: DecorationSet;
}>('searchHighlight');

function findMatches(doc: any, query: string, caseSensitive: boolean): SearchMatch[] {
  const matches: SearchMatch[] = [];
  if (!query) return matches;
  const needle = caseSensitive ? query : query.toLowerCase();
  doc.descendants((node: any, pos: number) => {
    if (!node.isText) return true;
    const text = caseSensitive ? node.text : node.text.toLowerCase();
    let i = 0;
    while (true) {
      const at = text.indexOf(needle, i);
      if (at < 0) break;
      matches.push({ from: pos + at, to: pos + at + needle.length });
      i = at + Math.max(needle.length, 1);
    }
    return true;
  });
  return matches;
}

// A ProseMirror plugin that decorates current find matches without polluting
// the doc history. Used by the FindReplace panel.
export const SearchHighlight = Extension.create({
  name: 'searchHighlight',

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: KEY,
        state: {
          init: () => ({
            query: '',
            caseSensitive: false,
            activeIndex: -1,
            matches: [] as SearchMatch[],
            deco: DecorationSet.empty,
          }),
          apply(tr, prev) {
            const meta = tr.getMeta(KEY) as
              | { query: string; caseSensitive: boolean; activeIndex?: number }
              | { clear: true }
              | undefined;
            // If doc changed, recompute on existing query.
            let next = { ...prev };
            if (meta && 'clear' in meta) {
              return {
                query: '',
                caseSensitive: false,
                activeIndex: -1,
                matches: [],
                deco: DecorationSet.empty,
              };
            }
            if (meta && 'query' in meta) {
              next.query = meta.query;
              next.caseSensitive = !!meta.caseSensitive;
              if (typeof meta.activeIndex === 'number')
                next.activeIndex = meta.activeIndex;
            }
            if (tr.docChanged || (meta && 'query' in meta)) {
              const matches = findMatches(tr.doc, next.query, next.caseSensitive);
              next.matches = matches;
              if (next.activeIndex >= matches.length) next.activeIndex = -1;
              next.deco = DecorationSet.create(
                tr.doc,
                matches.map((m, i) =>
                  Decoration.inline(m.from, m.to, {
                    class: i === next.activeIndex ? 'search-match search-match-active' : 'search-match',
                  }),
                ),
              );
            } else if (meta && 'query' in meta) {
              // No-op extra path; handled above.
            } else if (tr.getMeta(KEY) === undefined && tr.docChanged) {
              next.deco = next.deco.map(tr.mapping, tr.doc);
            }
            return next;
          },
        },
        props: {
          decorations(state) {
            return KEY.getState(state)?.deco ?? null;
          },
        },
      }),
    ];
  },

  addCommands() {
    return {
      setSearch:
        (query: string, opts: { caseSensitive?: boolean; activeIndex?: number } = {}) =>
        ({ tr, dispatch }) => {
          if (dispatch)
            tr.setMeta(KEY, {
              query,
              caseSensitive: !!opts.caseSensitive,
              activeIndex: opts.activeIndex ?? -1,
            });
          return true;
        },
      clearSearch:
        () =>
        ({ tr, dispatch }) => {
          if (dispatch) tr.setMeta(KEY, { clear: true });
          return true;
        },
    };
  },
});

export function getSearchState(editor: any) {
  return KEY.getState(editor.state) ?? null;
}
