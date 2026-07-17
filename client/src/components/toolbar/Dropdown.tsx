import { useEffect, useRef, useState } from 'preact/hooks';
import type { ComponentChildren } from 'preact';

type Props = {
  label: ComponentChildren;
  title?: string;
  align?: 'left' | 'right';
  children: (close: () => void) => ComponentChildren;
};

// Click-outside-closing popover anchored to its trigger button. Stays out of
// the editor's selection — onMouseDown preventDefault on the trigger so the
// editor's prose doesn't lose focus.
export function Dropdown({ label, title, align = 'left', children }: Props) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

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
    <div class="tb-drop-wrap" ref={ref}>
      <button
        class={`tb-btn tb-drop-trigger ${open ? 'active' : ''}`}
        onMouseDown={(e) => {
          e.preventDefault();
          setOpen((v) => !v);
        }}
        title={title}
        aria-label={title}
        aria-haspopup="true"
        aria-expanded={open}
      >
        {label}
        <span class="tb-drop-caret" aria-hidden="true">▾</span>
      </button>
      {open && (
        // Callers pass arbitrary controls (buttons, swatch grids, sliders),
        // not a uniform menuitem list, so we use a generic group rather than
        // claim a role="menu" whose children aren't menuitems.
        <div
          class={`tb-drop-menu tb-drop-${align}`}
          role="group"
          onMouseDown={(e) => e.preventDefault()}
        >
          {children(() => setOpen(false))}
        </div>
      )}
    </div>
  );
}
