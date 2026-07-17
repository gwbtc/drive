import type * as Y from 'yjs';
import type { Awareness } from 'y-protocols/awareness';
import type { Signal } from '@preact/signals';

export type Status = 'connecting' | 'live' | 'reconnecting' | 'offline' | 'revoked';

// 'saved': server has everything. 'saving': submits in flight.
// 'save-failed': at least one edit is only local; reconcile is retrying.
export type SaveState = 'saved' | 'saving' | 'save-failed';

// docType arrives on %meta facts (v8+); undefined until the first one lands.
export type DocMeta = { title: string; modified: number; docType?: string };

export interface DocProvider {
  ydoc: Y.Doc;
  awareness: Awareness;
  status: Signal<Status>;
  meta: Signal<DocMeta>;
  role: Signal<string>;
  ready: Signal<boolean>;
  saveState: Signal<SaveState>;
  // Bumped whenever a comment fact arrives; panes re-fetch on change
  // (4s polling remains the fallback for older ships).
  commentsVersion: Signal<number>;
  destroy(): void;
}
