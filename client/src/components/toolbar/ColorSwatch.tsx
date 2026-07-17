import { Dropdown } from './Dropdown';

const PRESETS = [
  '#000000', '#5f6368', '#9aa0a6', '#bdc1c6',
  '#d93025', '#f29900', '#1e8e3e', '#1a73e8',
  '#9334e6', '#0b5394', '#b06000', '#137333',
];

type Props = {
  label: preact.JSX.Element | string;
  title: string;
  value?: string | null;
  onPick: (color: string | null) => void;
};

export function ColorSwatch({ label, title, value, onPick }: Props) {
  return (
    <Dropdown label={label} title={title}>
      {(close) => (
        <div class="color-swatch-grid">
          {PRESETS.map((c) => (
            <button
              key={c}
              class={`color-swatch-cell ${value === c ? 'selected' : ''}`}
              style={{ background: c }}
              title={c}
              aria-label={`Color ${c}`}
              onClick={() => {
                onPick(c);
                close();
              }}
            />
          ))}
          <label class="color-swatch-custom" title="Custom color">
            <input
              type="color"
              value={value || '#000000'}
              onInput={(e) => onPick((e.target as HTMLInputElement).value)}
            />
            <span>Custom…</span>
          </label>
          <button
            class="color-swatch-clear"
            onClick={() => {
              onPick(null);
              close();
            }}
          >
            Clear
          </button>
        </div>
      )}
    </Dropdown>
  );
}
