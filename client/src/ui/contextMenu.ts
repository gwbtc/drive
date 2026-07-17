import { signal } from '@preact/signals';

export type ContextMenuItem = {
  label: string;
  onSelect: () => void;
  danger?: boolean;
  disabled?: boolean;
};

export type ContextMenuRequest = {
  id: number;
  x: number;
  y: number;
  items: ContextMenuItem[];
};

let nextId = 1;
export const contextMenu = signal<ContextMenuRequest | null>(null);

export function openContextMenu(x: number, y: number, items: ContextMenuItem[]) {
  contextMenu.value = { id: nextId++, x, y, items };
}

export function closeContextMenu() {
  contextMenu.value = null;
}
