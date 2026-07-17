import { useState } from 'preact/hooks';
import { NotePopover } from './NotePopover';

type Props = {
  labels: string[];
  onAdd: (label: string) => void;
  onRemove: (label: string) => void;
};

// The per-card label editor: a tag-icon trigger opening a popover that lists the
// note's current labels (each removable) and an input to add a new one. The
// on-card display of the label chips lives in NoteCard.
export function NoteLabels({ labels, onAdd, onRemove }: Props) {
  const [draft, setDraft] = useState('');

  const submit = () => {
    const t = draft.trim();
    if (t) onAdd(t);
    setDraft('');
  };

  return (
    <NotePopover testid="note-labels" title="Labels" triggerClass="note-labels-trigger" trigger={() => '🏷'}>
      {() => (
        <div class="note-labels-pop">
          <div class="note-labels-current">
            {labels.length === 0 && <span class="muted small">No labels yet</span>}
            {labels.map((l) => (
              <span key={l} class="note-label-chip">
                <span class="note-label-text">{l}</span>
                <button
                  type="button"
                  class="note-label-x"
                  title={`Remove ${l}`}
                  aria-label={`Remove label ${l}`}
                  onClick={() => onRemove(l)}
                >
                  ×
                </button>
              </span>
            ))}
          </div>
          <form
            class="note-labels-add"
            onSubmit={(e) => {
              e.preventDefault();
              submit();
            }}
          >
            <input
              class="note-label-input"
              data-testid="note-label-input"
              placeholder="Add label…"
              value={draft}
              maxLength={40}
              onInput={(e) => setDraft((e.target as HTMLInputElement).value)}
            />
            <button
              type="submit"
              class="note-label-add-btn"
              title="Add label"
              aria-label="Add label"
              disabled={draft.trim().length === 0}
            >
              +
            </button>
          </form>
        </div>
      )}
    </NotePopover>
  );
}
