import type { Editor } from '@tiptap/core';
import { useEffect, useState } from 'preact/hooks';

type Props = { editor: Editor; onClose: () => void };

type Heading = { level: number; text: string; pos: number };

// Read all heading nodes (level + text + document position) from the live
// Tiptap doc. Positions are the position *before* each heading node, which is
// what `view.nodeDOM(pos)` expects for scroll-into-view.
function readHeadings(editor: Editor): Heading[] {
  const out: Heading[] = [];
  editor.state.doc.descendants((node, pos) => {
    if (node.type.name === 'heading') {
      out.push({
        level: node.attrs.level as number,
        text: node.textContent || 'Untitled section',
        pos,
      });
    }
    return true;
  });
  return out;
}

export function OutlinePane({ editor, onClose }: Props) {
  const [headings, setHeadings] = useState<Heading[]>(() => readHeadings(editor));

  // Recompute live as the document changes.
  useEffect(() => {
    const update = () => setHeadings(readHeadings(editor));
    editor.on('update', update);
    return () => {
      editor.off('update', update);
    };
  }, [editor]);

  const jump = (pos: number) => {
    const dom = editor.view.nodeDOM(pos) as HTMLElement | null;
    if (dom && typeof dom.scrollIntoView === 'function') {
      dom.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
    // Also move the caret so keyboard focus follows the jump.
    editor.chain().setTextSelection(pos + 1).run();
  };

  const minLevel = headings.reduce((m, h) => Math.min(m, h.level), 3);

  return (
    <aside class="outline-pane" data-testid="outline-pane" aria-label="Document outline">
      <div class="outline-header">
        <span class="outline-title">Outline</span>
        <button class="icon-btn" title="Close outline" aria-label="Close outline" onClick={onClose}>
          ✕
        </button>
      </div>
      {headings.length === 0 ? (
        <p class="outline-empty muted">No headings yet. Use H1–H3 to build an outline.</p>
      ) : (
        <ul class="outline-list">
          {headings.map((h, i) => (
            <li key={i} style={{ paddingLeft: `${(h.level - minLevel) * 14}px` }}>
              <button
                class={`outline-item outline-h${h.level}`}
                onClick={() => jump(h.pos)}
                title={h.text}
              >
                {h.text}
              </button>
            </li>
          ))}
        </ul>
      )}
    </aside>
  );
}
