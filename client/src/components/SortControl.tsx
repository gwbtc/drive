import type { DocSummary } from '../api';
import { Dropdown } from './toolbar/Dropdown';

export type SortKey =
  | 'modified-desc'
  | 'modified-asc'
  | 'name-asc'
  | 'created-desc'
  | 'type';

const LABELS: Record<SortKey, string> = {
  'modified-desc': 'Last modified',
  'modified-asc': 'Oldest modified',
  'name-asc': 'Name A–Z',
  'created-desc': 'Newest created',
  type: 'Type',
};

type Props = {
  value: SortKey;
  onChange: (k: SortKey) => void;
};

export function SortControl({ value, onChange }: Props) {
  return (
    <Dropdown label={<span class="sort-label">Sort: {LABELS[value]}</span>} title="Sort">
      {(close) => (
        <ul class="tb-drop-list">
          {(Object.keys(LABELS) as SortKey[]).map((k) => (
            <li key={k}>
              <button
                class={`tb-drop-item ${value === k ? 'selected' : ''}`}
                onClick={() => {
                  onChange(k);
                  close();
                }}
              >
                {LABELS[k]}
              </button>
            </li>
          ))}
        </ul>
      )}
    </Dropdown>
  );
}

export function sortDocs<T extends DocSummary | (TrashLike & DocSummary)>(
  items: T[],
  key: SortKey,
): T[] {
  const out = [...items];
  out.sort((a, b) => {
    switch (key) {
      case 'modified-asc':
        return a.modified - b.modified;
      case 'name-asc':
        return (a.title || '').localeCompare(b.title || '');
      case 'created-desc':
        return b.created - a.created;
      case 'type':
        return (a.type || '').localeCompare(b.type || '');
      case 'modified-desc':
      default:
        return b.modified - a.modified;
    }
  });
  return out;
}

type TrashLike = { id: string };
