import { useEffect, useState } from 'preact/hooks';
import { listDocs, type DocSummary } from '../api';
import { dropOnto, isDragging } from '../ui/dragState';

type Props = {
  folderId: string | null;
  navigate: (path: string) => void;
};

export function Breadcrumb({ folderId, navigate }: Props) {
  const [path, setPath] = useState<DocSummary[]>([]);
  // Which segment a drag is currently hovering over; 'root' = the Drive crumb.
  const [dropKey, setDropKey] = useState<string | null>(null);

  useEffect(() => {
    if (!folderId) {
      setPath([]);
      return;
    }
    let cancelled = false;
    void listDocs().then((l) => {
      if (cancelled) return;
      const byId = new Map(l.owned.map((d) => [d.id, d]));
      const stack: DocSummary[] = [];
      let cur = byId.get(folderId);
      while (cur) {
        stack.unshift(cur);
        cur = cur.parent ? byId.get(cur.parent) : undefined;
      }
      setPath(stack);
    });
    return () => {
      cancelled = true;
    };
  }, [folderId]);

  const click = (href: string) => (e: Event) => {
    e.preventDefault();
    navigate(href);
  };

  // Drop-target wiring for moving docs into an ancestor folder (or the root).
  const dragOver = (key: string) => (e: DragEvent) => {
    if (!isDragging()) return;
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
    if (dropKey !== key) setDropKey(key);
  };
  const dragLeave = (key: string) => () => {
    if (dropKey === key) setDropKey(null);
  };
  const drop = (target: string | null) => async (e: DragEvent) => {
    e.preventDefault();
    setDropKey(null);
    await dropOnto(target);
  };

  return (
    <nav class="breadcrumb" aria-label="Breadcrumb">
      <a
        class={`bc-seg ${dropKey === 'root' ? 'drop-hover' : ''}`}
        href="/drive/files"
        aria-label="Drive root"
        onClick={click('/drive/files')}
        onDragOver={dragOver('root')}
        onDragLeave={dragLeave('root')}
        onDrop={drop(null)}
      >
        Drive
      </a>
      {path.map((seg, i) => {
        const isCurrent = i === path.length - 1;
        return (
          <span key={seg.id} class="bc-wrap">
            <span class="bc-sep">›</span>
            {isCurrent ? (
              <span class="bc-seg current" aria-current="page">{seg.title || 'Untitled'}</span>
            ) : (
              <a
                class={`bc-seg ${dropKey === seg.id ? 'drop-hover' : ''}`}
                href={`/drive/files/${seg.id}`}
                onClick={click(`/drive/files/${seg.id}`)}
                onDragOver={dragOver(seg.id)}
                onDragLeave={dragLeave(seg.id)}
                onDrop={drop(seg.id)}
              >
                {seg.title || 'Untitled'}
              </a>
            )}
          </span>
        );
      })}
    </nav>
  );
}
