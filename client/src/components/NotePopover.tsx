import { useEffect, useRef, useState } from 'preact/hooks';
import type { ComponentChildren } from 'preact';

type Props = {
  // Trigger button contents. Receives the open state so callers can reflect it.
  trigger: (open: boolean) => ComponentChildren;
  title: string;
  align?: 'left' | 'right';
  testid?: string;
  triggerClass?: string;
  children: (close: () => void) => ComponentChildren;
};

// A small click-outside / Escape-closing popover for the note-card tools.
//
// Deliberately NOT the toolbar Dropdown: that one preventDefaults mousedown on
// its menu (to keep the prose editor focused), which would stop a text input
// inside the labels editor from ever taking focus. Here the trigger is a plain
// click and the menu lets focus move normally, so the label <input> works.
export function NotePopover({
  trigger,
  title,
  align = 'right',
  testid,
  triggerClass,
  children,
}: Props) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <span class="note-pop-wrap" ref={ref}>
      <button
        type="button"
        data-testid={testid}
        class={`note-tool-btn ${triggerClass ?? ''} ${open ? 'active' : ''}`}
        title={title}
        aria-label={title}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        {trigger(open)}
      </button>
      {open && (
        <div class={`note-pop-menu note-pop-${align}`} role="menu">
          {children(() => setOpen(false))}
        </div>
      )}
    </span>
  );
}
