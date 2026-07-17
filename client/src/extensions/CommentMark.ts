import { Mark, mergeAttributes } from '@tiptap/core';

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    commentMark: {
      setComment: (id: string) => ReturnType;
      unsetComment: (id: string) => ReturnType;
    };
  }
}

// A Tiptap mark that anchors a comment to a range of text. The mark renders
// as <span data-comment-id="..." class="comment-mark"> and survives edits
// (Yjs propagates marks just like any other node).
export const CommentMark = Mark.create({
  name: 'comment',
  inclusive: false,
  excludes: '',
  addAttributes() {
    return {
      id: {
        default: '',
        parseHTML: (el) => (el as HTMLElement).getAttribute('data-comment-id'),
        renderHTML: (attrs) =>
          attrs.id ? { 'data-comment-id': attrs.id } : {},
      },
    };
  },
  parseHTML() {
    return [{ tag: 'span[data-comment-id]' }];
  },
  renderHTML({ HTMLAttributes }) {
    return [
      'span',
      mergeAttributes(HTMLAttributes, { class: 'comment-mark' }),
      0,
    ];
  },
  addCommands() {
    return {
      setComment:
        (id: string) =>
        ({ commands }) =>
          commands.setMark(this.name, { id }),
      unsetComment:
        (id: string) =>
        ({ tr, dispatch }) => {
          const { doc } = tr;
          const ranges: Array<{ from: number; to: number }> = [];
          doc.descendants((node, pos) => {
            const m = node.marks.find(
              (mk) => mk.type.name === 'comment' && mk.attrs.id === id,
            );
            if (m) ranges.push({ from: pos, to: pos + node.nodeSize });
          });
          if (!ranges.length) return false;
          if (dispatch) {
            ranges.forEach(({ from, to }) => {
              tr.removeMark(from, to, this.type);
            });
          }
          return true;
        },
    };
  },
});
