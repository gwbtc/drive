import type { ContextMenuItem } from './contextMenu';
import { setDocSpace, type DocSummary, type SpaceSummary } from '../api';
import { isJoinedSpace } from '../spaces';
import { toast } from './toast';

// Build the "Move to space" section of a doc's context menu: a disabled header
// plus one destination per space (excluding the doc's current space) and, when
// the doc currently lives in a space, a "Personal" destination. `currentSpaceId`
// is the doc's current space (null = personal). `onMoved` runs after a
// successful move so the caller can refresh its listing.
//
// Returns [] when there's no actionable destination (e.g. a personal doc and
// the user has no spaces) so the caller doesn't render a lone dead header.
// Folders are intentionally excluded — a space is not a folder, and moving a
// folder into a space without its children is confusing.
export function moveToSpaceItems(
  doc: DocSummary,
  spaces: SpaceSummary[],
  currentSpaceId: string | null,
  onMoved: () => void,
): ContextMenuItem[] {
  if (doc.type === 'folder') return [];

  const move = async (target: string | null, label: string) => {
    try {
      await setDocSpace(doc.id, target);
      toast.success(`Moved to ${label}`);
      onMoved();
    } catch (e) {
      toast.error(e);
    }
  };

  const dests: ContextMenuItem[] = [];
  if (currentSpaceId !== null) {
    dests.push({ label: 'Personal', onSelect: () => void move(null, 'Personal') });
  }
  for (const s of spaces) {
    if (s.id === currentSpaceId) continue;
    // You can only assign a doc to a space you HOST — a joined space is hosted
    // elsewhere, so it's never a valid move destination.
    if (isJoinedSpace(s)) continue;
    const name = s.name || 'Untitled space';
    dests.push({ label: name, onSelect: () => void move(s.id, name) });
  }
  if (dests.length === 0) return [];
  return [{ label: 'Move to space', onSelect: () => {}, disabled: true }, ...dests];
}
