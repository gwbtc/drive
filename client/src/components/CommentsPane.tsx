import { useEffect, useState } from 'preact/hooks';
import type { Editor } from '@tiptap/core';
import {
  addComment,
  resolveComment,
  deleteComment,
  listComments,
  formatDate,
  genCommentId,
  type Comment,
} from '../api';
import { toast } from '../ui/toast';
import { confirmDialog } from '../ui/dialogs';

type Props = {
  docId: string;
  ship: string;
  editor: Editor | null;
  // Bumped by the provider when a comment fact arrives over SSE; triggers
  // an immediate re-fetch (the 4s poll is the fallback).
  commentsVersion?: number;
};

export function CommentsPane({ docId, ship, editor, commentsVersion }: Props) {
  const [comments, setComments] = useState<Comment[]>([]);
  const [text, setText] = useState('');
  const [showResolved, setShowResolved] = useState(false);
  const [activeId, setActiveId] = useState<string | null>(null);

  // Read the current selection out of the editor lazily, since the editor's
  // selection state lives on the view, not in our React state.
  const getSelection = (): { text: string; from: number; to: number } | null => {
    if (!editor) return null;
    const { from, to } = editor.state.selection;
    if (from === to) return null;
    const t = editor.state.doc.textBetween(from, to, ' ');
    return { text: t, from, to };
  };

  const refresh = async () => {
    try {
      setComments(await listComments(docId));
    } catch {
      /* transient poll failure — keep showing the last-known comments */
    }
  };

  useEffect(() => {
    void refresh();
    const id = setInterval(refresh, 4000);
    return () => clearInterval(id);
  }, [docId, commentsVersion]);

  const onSubmit = async (e: Event) => {
    e.preventDefault();
    if (!text.trim()) return;
    const t = text.trim();
    const sel = getSelection();
    const cid = genCommentId();
    const anchor = sel?.text.slice(0, 200) ?? '';
    setText('');
    try {
      await addComment(docId, cid, t, anchor);
      // Apply mark only after server confirms — avoids orphan marks when
      // the action fails. Use the saved range; user's selection may have
      // moved during the await. No .focus() — that schedules a rAF
      // view.focus() that traps focus on subsequent clicks.
      if (sel && editor) {
        editor
          .chain()
          .setTextSelection({ from: sel.from, to: sel.to })
          .setComment(cid)
          .run();
      }
      await refresh();
    } catch (err) {
      toast.error(err);
      setText(t);
    }
  };

  const scrollToMark = (id: string) => {
    if (!editor) return;
    const dom = editor.view.dom as HTMLElement;
    const el = dom.querySelector(`[data-comment-id="${id}"]`);
    if (el && 'scrollIntoView' in el) {
      (el as HTMLElement).scrollIntoView({ block: 'center', behavior: 'smooth' });
      setActiveId(id);
      setTimeout(() => setActiveId((cur) => (cur === id ? null : cur)), 1500);
    }
  };

  const onResolve = async (c: Comment) => {
    if (editor) editor.chain().unsetComment(c.id).run();
    await resolveComment(docId, c.id);
    await refresh();
  };

  const onDelete = async (c: Comment) => {
    const ok = await confirmDialog({
      title: 'Delete this comment?',
      confirmLabel: 'Delete',
      danger: true,
    });
    if (!ok) return;
    if (editor) editor.chain().unsetComment(c.id).run();
    try {
      await deleteComment(docId, c.id);
      await refresh();
    } catch (e) {
      toast.error(e);
    }
  };

  const visible = comments.filter((c) => showResolved || !c.resolved);
  const sel = getSelection();

  return (
    <aside class="comments-pane">
      <header class="comments-header">
        <span class="comments-title">Comments</span>
        <label class="comments-toggle">
          <input
            type="checkbox"
            checked={showResolved}
            onChange={(e) => setShowResolved((e.target as HTMLInputElement).checked)}
          />
          <span>Show resolved</span>
        </label>
      </header>
      <div class="comments-list">
        {visible.length === 0 && (
          <div class="comments-empty">No comments yet.</div>
        )}
        {visible.map((c) => (
          <div
            key={c.id}
            class={`comment ${c.resolved ? 'resolved' : ''} ${activeId === c.id ? 'active' : ''}`}
            onClick={() => scrollToMark(c.id)}
          >
            {c.anchor && (
              <div class="comment-anchor" title={c.anchor}>
                <span class="comment-anchor-bar" />
                <span class="comment-anchor-text">{c.anchor}</span>
              </div>
            )}
            <div class="comment-head">
              <span class="comment-author">{c.author}</span>
              <span class="comment-date">{formatDate(c.created)}</span>
            </div>
            <div class="comment-body">{c.text}</div>
            <div class="comment-actions">
              {!c.resolved && (
                <button
                  class="comment-link"
                  onClick={(e) => {
                    e.stopPropagation();
                    void onResolve(c);
                  }}
                >
                  Resolve
                </button>
              )}
              {c.author === ship && (
                <button
                  class="comment-link danger"
                  onClick={(e) => {
                    e.stopPropagation();
                    void onDelete(c);
                  }}
                >
                  Delete
                </button>
              )}
            </div>
          </div>
        ))}
      </div>
      <form class="comments-compose" onSubmit={onSubmit}>
        {sel ? (
          <div class="comments-anchor-preview">
            <span class="comment-anchor-bar" />
            <span class="comment-anchor-text">"{sel.text.slice(0, 100)}"</span>
          </div>
        ) : (
          <div class="comments-hint">
            Select text in the document to anchor a comment, or post unanchored.
          </div>
        )}
        <textarea
          class="comments-textarea"
          aria-label="Add a comment"
          placeholder="Add a comment…"
          value={text}
          onInput={(e) => setText((e.target as HTMLTextAreaElement).value)}
        />
        <button class="btn primary pill" type="submit" disabled={!text.trim()}>
          Comment
        </button>
      </form>
    </aside>
  );
}
