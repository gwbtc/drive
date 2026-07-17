import { Extension } from '@tiptap/core';
import { Plugin, PluginKey, type EditorState } from '@tiptap/pm/state';

// A lightweight `@`-mention style extension for linking to other docs.
//
// Typing `@` (at the start of a word) opens a picker of the user's documents,
// filtered by the text after the `@`. Selecting one inserts a normal Link mark
// pointing at `/drive/d/<id>` with the doc's title as the link text — so it
// serializes like any other link (markdown/html/docx) and is navigated
// SPA-internally by the editor's click handler.
//
// This does NOT depend on `@tiptap/suggestion` (not installed). Instead a
// small ProseMirror plugin tracks the trigger; the React/Preact popup (owned
// by Editor.tsx) is fed the state and registers a keyboard handler via a
// shared ref so arrow/enter/escape navigate the list.

export type DocLinkState = {
  active: boolean;
  range: { from: number; to: number };
  query: string;
  rect: { left: number; top: number; bottom: number } | null;
};

export type DocLinkKeyRef = { current: ((e: KeyboardEvent) => boolean) | null };

export type DocLinkOptions = {
  onStateChange: (state: DocLinkState | null) => void;
  keyHandler: DocLinkKeyRef;
};

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    docLink: {
      insertDocLink: (args: {
        range: { from: number; to: number };
        id: string;
        title: string;
      }) => ReturnType;
      dismissDocLink: () => ReturnType;
    };
  }
}

const key = new PluginKey<InternalState>('docLink');

type Trigger = { from: number; to: number; query: string };
type InternalState = {
  active: boolean;
  range: { from: number; to: number };
  query: string;
  dismissedFrom: number | null;
};

// Find an active `@query` immediately before an empty cursor selection.
function computeTrigger(state: EditorState): Trigger | null {
  const sel = state.selection;
  if (!sel.empty) return null;
  const $from = sel.$from;
  const parent = $from.parent;
  if (!parent.isTextblock) return null;
  if (parent.type.name === 'codeBlock') return null;
  const textBefore = parent.textBetween(0, $from.parentOffset, '￼', '￼');
  const at = textBefore.lastIndexOf('@');
  if (at < 0) return null;
  const before = at === 0 ? '' : textBefore[at - 1];
  if (before && !/\s/.test(before)) return null; // '@' must start a word
  const query = textBefore.slice(at + 1);
  if (/\s/.test(query)) return null; // no spaces inside the query
  if (query.length > 60) return null;
  const cursor = $from.pos;
  const from = cursor - query.length - 1; // position of the '@'
  return { from, to: cursor, query };
}

export const DocLink = Extension.create<DocLinkOptions>({
  name: 'docLink',

  addOptions() {
    return {
      onStateChange: () => {},
      keyHandler: { current: null },
    };
  },

  addCommands() {
    return {
      insertDocLink:
        ({ range, id, title }) =>
        ({ chain }) =>
          chain()
            .focus()
            .insertContentAt({ from: range.from, to: range.to }, [
              {
                type: 'text',
                text: title || 'Untitled',
                marks: [{ type: 'link', attrs: { href: `/drive/d/${id}` } }],
              },
              { type: 'text', text: ' ' },
            ])
            .run(),
      dismissDocLink:
        () =>
        ({ tr, dispatch }) => {
          if (dispatch) dispatch(tr.setMeta(key, { dismiss: true }));
          return true;
        },
    };
  },

  addProseMirrorPlugins() {
    const options = this.options;
    return [
      new Plugin<InternalState>({
        key,
        state: {
          init: () => ({
            active: false,
            range: { from: 0, to: 0 },
            query: '',
            dismissedFrom: null,
          }),
          apply(tr, prev, _old, newState) {
            const meta = tr.getMeta(key) as { dismiss?: boolean } | undefined;
            const trig = computeTrigger(newState);
            if (!trig) {
              return { active: false, range: { from: 0, to: 0 }, query: '', dismissedFrom: null };
            }
            const stayDismissed =
              (meta?.dismiss ? true : prev.dismissedFrom === trig.from) && !!trig;
            if (stayDismissed) {
              return {
                active: false,
                range: { from: trig.from, to: trig.to },
                query: trig.query,
                dismissedFrom: trig.from,
              };
            }
            return {
              active: true,
              range: { from: trig.from, to: trig.to },
              query: trig.query,
              dismissedFrom: null,
            };
          },
        },
        props: {
          handleKeyDown(view, event) {
            const st = key.getState(view.state);
            if (!st?.active) return false;
            const handler = options.keyHandler.current;
            return handler ? handler(event) : false;
          },
        },
        view() {
          return {
            update(view) {
              const st = key.getState(view.state);
              if (!st?.active) {
                options.onStateChange(null);
                return;
              }
              let rect: DocLinkState['rect'] = null;
              try {
                const c = view.coordsAtPos(st.range.from);
                rect = { left: c.left, top: c.top, bottom: c.bottom };
              } catch {
                rect = null;
              }
              options.onStateChange({
                active: true,
                range: st.range,
                query: st.query,
                rect,
              });
            },
            destroy() {
              options.onStateChange(null);
            },
          };
        },
      }),
    ];
  },
});
