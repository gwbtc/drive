import { useEffect } from 'preact/hooks';
import { contextMenu, closeContextMenu } from './contextMenu';

export function ContextMenuHost() {
  const req = contextMenu.value;

  useEffect(() => {
    if (!req) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as Element;
      if (!t.closest('.ctx-menu')) closeContextMenu();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeContextMenu();
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    window.addEventListener('blur', closeContextMenu);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('blur', closeContextMenu);
    };
  }, [req]);

  if (!req) return null;
  // Clamp to viewport so menu doesn't fall off the screen.
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const x = Math.min(req.x, vw - 220);
  const y = Math.min(req.y, vh - req.items.length * 36 - 16);
  return (
    <div class="ctx-menu" role="menu" style={{ left: `${x}px`, top: `${y}px` }}>
      {req.items.map((it, i) => (
        <button
          key={i}
          class={`ctx-menu-item ${it.danger ? 'danger' : ''}`}
          role="menuitem"
          disabled={it.disabled}
          onClick={() => {
            closeContextMenu();
            it.onSelect();
          }}
        >
          {it.label}
        </button>
      ))}
    </div>
  );
}
