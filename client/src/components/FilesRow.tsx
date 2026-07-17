import { formatDate, type DocSummary } from '../api';

type Props = {
  item: DocSummary;
  index?: number;
  selected?: boolean;
  showCheckbox?: boolean;
  focused?: boolean;
  dropHover?: boolean;
  draggable?: boolean;
  onOpen: (item: DocSummary) => void;
  onDelete?: (item: DocSummary) => void;
  onStar?: (item: DocSummary) => void;
  onToggleSelect?: (e: MouseEvent) => void;
  onContextMenu?: (e: MouseEvent) => void;
  onDragStart?: (e: DragEvent) => void;
  onDragEnd?: (e: DragEvent) => void;
  onDragOver?: (e: DragEvent) => void;
  onDragEnter?: (e: DragEvent) => void;
  onDragLeave?: (e: DragEvent) => void;
  onDrop?: (e: DragEvent) => void;
};

const TYPE_ICON: Record<string, string> = {
  text: '📄',
  sheet: '📊',
  note: '📝',
  image: '🖼️',
  file: '📎',
  folder: '📁',
};

const TYPE_LABEL: Record<string, string> = {
  text: 'Document',
  sheet: 'Sheet',
  note: 'Note',
  image: 'Image',
  file: 'File',
  folder: 'Folder',
};

export function FilesRow({
  item,
  index,
  selected,
  showCheckbox,
  focused,
  dropHover,
  draggable,
  onOpen,
  onDelete,
  onStar,
  onToggleSelect,
  onContextMenu,
  onDragStart,
  onDragEnd,
  onDragOver,
  onDragEnter,
  onDragLeave,
  onDrop,
}: Props) {
  const starred = !!item.starred;
  const name = item.title || 'Untitled';
  return (
    <li
      class={`files-row ${selected ? 'selected' : ''} ${showCheckbox ? 'with-check' : ''} ${
        focused ? 'focused' : ''
      } ${dropHover ? 'drop-hover' : ''}`}
      data-testid="files-row"
      data-index={index}
      draggable={draggable}
      onContextMenu={onContextMenu}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onDragOver={onDragOver}
      onDragEnter={onDragEnter}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    >
      <span
        class="files-row-check"
        onClick={(e) => onToggleSelect?.(e as unknown as MouseEvent)}
      >
        <input
          type="checkbox"
          checked={!!selected}
          aria-label={`Select ${item.title || 'Untitled'}`}
          onClick={(e) => e.stopPropagation()}
          onChange={(e) => onToggleSelect?.(e as unknown as MouseEvent)}
        />
      </span>
      <button
        class="files-row-main"
        onClick={(e) => {
          if ((e as MouseEvent).metaKey || (e as MouseEvent).ctrlKey) {
            onToggleSelect?.(e as unknown as MouseEvent);
          } else {
            onOpen(item);
          }
        }}
      >
        <span class="files-row-icon" aria-hidden="true">{TYPE_ICON[item.type] ?? '📄'}</span>
        <span class="files-row-info">
          <span class="files-row-title">{item.title || 'Untitled'}</span>
          <span class="files-row-meta">
            {TYPE_LABEL[item.type] ?? item.type} · {formatDate(item.modified)}
            {item.blob ? ` · ${formatBytes(item.blob.size)}` : ''}
          </span>
        </span>
      </button>
      {onStar && (
        <button
          class={`files-row-star ${starred ? 'starred' : ''}`}
          title={starred ? 'Unstar' : 'Star'}
          aria-label={starred ? `Unstar ${name}` : `Star ${name}`}
          aria-pressed={starred}
          data-testid="star-toggle"
          onClick={(e) => {
            e.stopPropagation();
            onStar(item);
          }}
        >
          {starred ? '★' : '☆'}
        </button>
      )}
      {onDelete && (
        <button
          class="btn-icon"
          title="Delete"
          aria-label={`Delete ${name}`}
          onClick={(e) => {
            e.stopPropagation();
            onDelete(item);
          }}
        >
          ×
        </button>
      )}
    </li>
  );
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}
