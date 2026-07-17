import { useEffect, useRef } from 'preact/hooks';
import { useFocusTrap } from '../ui/useFocusTrap';

type Props = { onClose: () => void };

// Display the platform's real modifier glyphs so the list matches what the
// user actually presses (⌘/⌥ on macOS, Ctrl/Alt elsewhere).
const isMac =
  typeof navigator !== 'undefined' &&
  /Mac|iP(hone|ad|od)/.test(navigator.platform || navigator.userAgent || '');
const MOD = isMac ? '⌘' : 'Ctrl';
const ALT = isMac ? '⌥' : 'Alt';

type Shortcut = { keys: string[]; desc: string };
type Group = { title: string; items: Shortcut[] };

const GROUPS: Group[] = [
  {
    title: 'Global',
    items: [
      { keys: [MOD, 'K'], desc: 'Open the command palette' },
      { keys: ['?'], desc: 'Show this shortcuts help' },
      { keys: ['Esc'], desc: 'Close a dialog, menu, or overlay' },
    ],
  },
  {
    title: 'Files',
    items: [
      { keys: ['↑', '↓'], desc: 'Move between items' },
      { keys: ['Enter'], desc: 'Open the focused item' },
      { keys: ['F2'], desc: 'Rename the focused item' },
      { keys: ['Delete'], desc: 'Move the focused item to trash' },
      { keys: ['Shift', 'Click'], desc: 'Select a range of items' },
      { keys: ['Drag'], desc: 'Move items into a folder' },
      { keys: ['Esc'], desc: 'Clear the current selection' },
    ],
  },
  {
    title: 'Editor',
    items: [
      { keys: [MOD, 'F'], desc: 'Find in the document' },
      { keys: [MOD, ALT, 'H'], desc: 'Find & replace' },
      { keys: ['@'], desc: 'Link to another document' },
      { keys: [MOD, 'B'], desc: 'Bold' },
      { keys: [MOD, 'I'], desc: 'Italic' },
      { keys: [MOD, 'U'], desc: 'Underline' },
    ],
  },
  {
    title: 'Sheets',
    items: [
      { keys: ['↑', '↓', '←', '→'], desc: 'Move the active cell' },
      { keys: ['Tab'], desc: 'Move to the next cell' },
      { keys: ['Enter'], desc: 'Edit / confirm a cell' },
      { keys: ['Esc'], desc: 'Cancel editing a cell' },
      { keys: ['Drag', 'fill handle'], desc: 'Fill a series across cells' },
    ],
  },
];

export function ShortcutsHelp({ onClose }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  useFocusTrap(ref);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div class="modal-backdrop" onClick={onClose}>
      <div
        class="modal shortcuts-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="shortcuts-title"
        data-testid="shortcuts-help"
        ref={ref}
        onClick={(e) => e.stopPropagation()}
      >
        <div class="modal-header">
          <h2 id="shortcuts-title">Keyboard shortcuts</h2>
          <button class="icon-btn" aria-label="Close shortcuts help" onClick={onClose}>
            ✕
          </button>
        </div>
        <div class="shortcuts-grid">
          {GROUPS.map((g) => (
            <div key={g.title} class="shortcuts-group">
              <h3>{g.title}</h3>
              <dl class="shortcuts-list">
                {g.items.map((s, i) => (
                  <div class="shortcut-row" key={i}>
                    <dt class="shortcut-keys">
                      {s.keys.map((k, j) => (
                        <kbd key={j} class="kbd">
                          {k}
                        </kbd>
                      ))}
                    </dt>
                    <dd class="shortcut-desc">{s.desc}</dd>
                  </div>
                ))}
              </dl>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
