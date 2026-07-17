import { NotePopover } from './NotePopover';
import { NOTE_COLORS, type NoteColor } from '../notes/meta';

type Props = {
  value: NoteColor;
  onPick: (color: NoteColor) => void;
};

// The per-card background-color picker (Keep's swatch grid). The trigger shows
// the current color as a small ringed dot; the popover is the full palette.
export function NoteColorPicker({ value, onPick }: Props) {
  return (
    <NotePopover
      testid="note-color"
      title="Change color"
      triggerClass="note-color-trigger"
      trigger={() => (
        <span class={`note-swatch note-color-${value}`} aria-hidden="true" />
      )}
    >
      {(close) => (
        <div class="note-color-grid" role="listbox" aria-label="Note color">
          {NOTE_COLORS.map((c) => (
            <button
              key={c}
              type="button"
              role="option"
              aria-selected={value === c}
              data-color={c}
              class={`note-color-cell note-color-${c} ${value === c ? 'selected' : ''}`}
              title={c}
              aria-label={c}
              onClick={() => {
                onPick(c);
                close();
              }}
            />
          ))}
        </div>
      )}
    </NotePopover>
  );
}
