// Drag-and-drop move state, shared across components. HTML5 DnD carries the
// dragged doc id in dataTransfer, but drop targets that live outside the
// FilesView subtree (the left rail, the breadcrumb) need to read the dragged
// set without prop-drilling — so it also lives in this module-level signal.

import { signal } from '@preact/signals';
import { bulkMove } from '../api';
import { toast } from './toast';

export const draggedIds = signal<string[]>([]);

export function beginDrag(ids: string[]) {
  draggedIds.value = ids;
}

export function endDrag() {
  draggedIds.value = [];
}

export const isDragging = () => draggedIds.value.length > 0;

// Move every currently-dragged doc into `target` (null = Drive root). Guards
// against dropping an item onto itself; a full descendant check isn't possible
// with the listing on hand, so self is the minimum invariant we enforce.
export async function dropOnto(target: string | null): Promise<void> {
  const ids = draggedIds.value.filter((id) => id !== target);
  draggedIds.value = [];
  if (ids.length === 0) return;
  try {
    await bulkMove(ids, target);
    toast.success(ids.length === 1 ? 'Moved' : `Moved ${ids.length} items`);
  } catch (e) {
    toast.error(e);
  }
}
