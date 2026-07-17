import type { Editor } from '@tiptap/core';
import { useEffect, useRef } from 'preact/hooks';
import { TEMPLATES, type Template } from '../templates';
import { useFocusTrap } from '../ui/useFocusTrap';

type Props = { editor: Editor; onClose: () => void };

// Overlay for seeding a fresh doc from a built-in template. Picking one runs a
// single `setContent` transaction — because the editor is Collaboration-bound
// that emits a normal Yjs update that syncs and persists.
export function TemplatePicker({ editor, onClose }: Props) {
  const overlayRef = useRef<HTMLDivElement>(null);
  useFocusTrap(overlayRef);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const pick = (tpl: Template) => {
    if (tpl.id === 'blank') {
      onClose();
      editor.chain().focus().run();
      return;
    }
    editor.commands.setContent(tpl.content as unknown as Record<string, unknown>);
    editor.chain().focus('end').run();
    onClose();
  };

  return (
    <div class="modal-backdrop" onClick={onClose}>
      <div
        class="template-overlay"
        data-testid="templates"
        role="dialog"
        aria-modal="true"
        aria-labelledby="template-picker-title"
        ref={overlayRef}
        onClick={(e) => e.stopPropagation()}
      >
        <div class="template-head">
          <h2 class="template-title" id="template-picker-title">Start from a template</h2>
          <button class="icon-btn" title="Close" aria-label="Close" onClick={onClose}>
            ✕
          </button>
        </div>
        <div class="template-grid">
          {TEMPLATES.map((tpl) => (
            <button
              key={tpl.id}
              class="template-card"
              data-testid={`template-${tpl.id}`}
              onClick={() => pick(tpl)}
            >
              <span class="template-icon" aria-hidden="true">
                {tpl.icon}
              </span>
              <span class="template-name">{tpl.name}</span>
              <span class="template-desc">{tpl.description}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
