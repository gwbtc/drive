import * as Y from 'yjs';
import {
  Awareness,
  encodeAwarenessUpdate,
  applyAwarenessUpdate,
} from 'y-protocols/awareness';
import { signal } from '@preact/signals';
import { IndexeddbPersistence } from 'y-indexeddb';
import type { DocProvider, Status, DocMeta, SaveState } from './types';
import {
  submitUpdate,
  submitAwareness,
  submitSnapshot,
  subscribeRemote,
  ourShip,
  BASE,
} from '../api';
import { applyServerState, encodeMissingUpdate, type ServerDocState } from './reconcile';
import { toast } from '../ui/toast';

type DocFact =
  | { type: 'snapshot'; seq: number; blob: number[] }
  | { type: 'update'; update: number[] }
  | { type: 'awareness'; ship: string; blob: number[] }
  | { type: 'role-change'; who?: string; role: string }
  | { type: 'revoked' }
  | { type: 'request-snapshot' }
  | { type: 'meta'; title: string; modified: number; 'doc-type'?: string }
  | { type: 'trashed'; at: number }
  | { type: 'blob'; mime: string }
  | { type: 'comment-add'; id: string }
  | { type: 'comment-resolved'; id: string }
  | { type: 'comment-deleted'; id: string }
  | { type: 'save-failed' };

type Mode = 'ship' | 'token';

// Exponential backoff: 1, 2, 4, 8, 15, 30s — clamped at 30s.
const BACKOFF_MS = [1000, 2000, 4000, 8000, 15000, 30000];

export class HttpProvider implements DocProvider {
  ydoc = new Y.Doc();
  awareness: Awareness;
  status = signal<Status>('connecting');
  meta = signal<DocMeta>({ title: '', modified: 0 });
  role = signal<string>('viewer');
  ready = signal<boolean>(false);
  saveState = signal<SaveState>('saved');
  commentsVersion = signal<number>(0);

  private docId: string;
  private mode: Mode;
  private owner: string | null;
  private es: EventSource | null = null;
  private idb: IndexeddbPersistence | null = null;
  private destroyed = false;
  private retryCount = 0;
  private retryTimer: number | null = null;
  // Save pipeline: `inFlight` live POSTs; once one fails we flip `dirty`
  // and stop spraying per-keystroke requests — the reconcile loop owns
  // delivery until it succeeds (the Y.Doc itself is the outbox).
  private inFlight = 0;
  private dirty = false;
  private reconcileTimer: number | null = null;
  private reconcileRetry = 0;
  private onYUpdate: (u: Uint8Array, origin: unknown) => void;
  private onAwareness: (
    changes: { added: number[]; updated: number[]; removed: number[] },
    origin: unknown,
  ) => void;
  private onVisibility: () => void;

  constructor(docId: string, mode: Mode, ownerIfRemote: string | null = null) {
    this.docId = docId;
    this.mode = mode;
    this.owner = ownerIfRemote;
    this.awareness = new Awareness(this.ydoc);

    // Offline durability (ship mode only — token guests may be on shared
    // machines, so we deliberately keep their docs memory-only).
    if (mode === 'ship') {
      try {
        this.idb = new IndexeddbPersistence(
          `drive/${ourShip() ?? 'ship'}/${docId}`,
          this.ydoc,
        );
      } catch {
        this.idb = null; // no IndexedDB (private browsing) — memory-only
      }
    }

    this.onYUpdate = (u, origin) => {
      // 'remote' = came from the server; the persistence instance is the
      // origin for updates loaded from IndexedDB — those reach the server
      // through reconcile()'s precise diff, not a blind replay.
      if (origin === 'remote' || (this.idb !== null && origin === this.idb)) return;
      void this.trackedSubmit(Array.from(u));
    };
    this.onAwareness = ({ added, updated }, origin) => {
      if (origin === 'remote') return;
      const ids = [...added, ...updated];
      if (ids.length === 0) return;
      const blob = encodeAwarenessUpdate(this.awareness, ids);
      submitAwareness(this.docId, Array.from(blob), this.mode).catch(() => {});
    };
    this.ydoc.on('update', this.onYUpdate);
    this.awareness.on('update', this.onAwareness);

    // When the tab becomes visible, kick a reconnect attempt immediately if
    // we're currently offline. Browsers throttle background SSE retries.
    this.onVisibility = () => {
      if (document.hidden) return;
      if (this.status.value === 'offline' || this.status.value === 'reconnecting') {
        this.scheduleReconnect(0);
      }
    };
    document.addEventListener('visibilitychange', this.onVisibility);

    void this.connect();
  }

  private async connect() {
    // 1. Load the local copy first: the doc opens instantly (and offline).
    if (this.idb) {
      try {
        await this.idb.whenSynced;
        if (!this.destroyed) this.ready.value = true;
      } catch {
        /* fall through to network */
      }
    }

    if (this.mode === 'ship' && this.owner) {
      try {
        await subscribeRemote(this.owner, this.docId);
      } catch (e) {
        console.warn('subscribe-remote failed', e);
      }
    }

    // 2. Pull server state and push anything it's missing (offline edits).
    const ok = await this.reconcile();
    if (!ok && !this.idb) {
      toast.error("Couldn't load this document");
    }

    // 3. Mark ready so the editor mounts (even if the pull failed, an
    //    idb-backed doc is usable; reconcile keeps retrying when dirty).
    this.ready.value = true;

    // 4. Open SSE for live updates.
    this.openSSE();
  }

  // Pull /state, apply it (idempotent), then push the single diff the
  // server is missing. Strict superset of the old pull-only resync: this
  // is both "catch up after reconnect" and "deliver offline/failed edits".
  private async reconcile(): Promise<boolean> {
    if (this.destroyed) return false;
    try {
      const r = await fetch(`${BASE}/state?id=${this.docId}`, {
        credentials: 'include',
      });
      if (!r.ok) throw new Error(`state ${r.status}`);
      const s: ServerDocState = await r.json();
      applyServerState(this.ydoc, s, 'remote');
      if (s.meta) {
        this.meta.value = { title: s.meta.title, modified: s.meta.modified };
      }
      const missing = encodeMissingUpdate(this.ydoc, s);
      if (missing) {
        await submitUpdate(this.docId, missing, this.mode);
      }
      this.dirty = false;
      this.reconcileRetry = 0;
      if (this.inFlight === 0) this.saveState.value = 'saved';
      return true;
    } catch {
      if (this.dirty) this.scheduleReconcile();
      return false;
    }
  }

  private scheduleReconcile() {
    if (this.destroyed || this.reconcileTimer != null) return;
    const delay = BACKOFF_MS[Math.min(this.reconcileRetry, BACKOFF_MS.length - 1)];
    this.reconcileRetry++;
    this.reconcileTimer = setTimeout(() => {
      this.reconcileTimer = null;
      void this.reconcile();
    }, delay) as unknown as number;
  }

  private async trackedSubmit(update: number[]) {
    if (this.dirty) {
      // Already in failure mode — the edit is in the Y.Doc; reconcile will
      // carry it. Don't stack more doomed requests.
      this.saveState.value = 'save-failed';
      return;
    }
    this.inFlight++;
    this.saveState.value = 'saving';
    try {
      await submitUpdate(this.docId, update, this.mode);
      this.inFlight--;
      if (this.inFlight === 0 && !this.dirty) this.saveState.value = 'saved';
    } catch {
      this.inFlight--;
      this.markSaveFailed();
    }
  }

  // The gen/covered snapshot protocol: re-pull /state so we (a) hold
  // everything the server does and (b) know exactly which generation and
  // how many buffered updates our encode covers. The server drops stale
  // generations and truncates only `covered` — updates racing in during
  // the encode survive.
  private async answerSnapshotRequest() {
    try {
      const r = await fetch(`${BASE}/state?id=${this.docId}`, {
        credentials: 'include',
      });
      if (!r.ok) return;
      const s: ServerDocState & { seq?: number } = await r.json();
      applyServerState(this.ydoc, s, 'remote');
      const gen = typeof s.seq === 'number' ? s.seq : 0;
      const covered = Array.isArray(s.updates) ? s.updates.length : 0;
      const blob = Y.encodeStateAsUpdate(this.ydoc);
      await submitSnapshot(this.docId, gen, covered, Array.from(blob), this.mode);
    } catch {
      /* another client — or the next request — will compact instead */
    }
  }

  private markSaveFailed() {
    this.dirty = true;
    if (this.saveState.value !== 'save-failed') {
      this.saveState.value = 'save-failed';
      toast.error("Couldn't save — will keep retrying");
    }
    this.scheduleReconcile();
  }

  private openSSE() {
    if (this.destroyed) return;
    this.es?.close();
    this.es = new EventSource(`${BASE}/sse?id=${this.docId}`, {
      withCredentials: true,
    });
    this.es.addEventListener('open', () => {
      if (this.retryCount > 0) {
        // We just recovered — sync both directions.
        this.retryCount = 0;
        toast.success('Reconnected');
        void this.reconcile();
      }
      this.status.value = 'live';
    });
    this.es.addEventListener('error', () => {
      // ES auto-retries but never tells us; we kill it and reopen on our cadence.
      if (this.destroyed) return;
      this.scheduleReconnect();
    });
    this.es.addEventListener('fact', (e: MessageEvent) => {
      try {
        const fact: DocFact = JSON.parse(e.data);
        this.onFact(fact);
      } catch (err) {
        console.warn('bad fact', err);
      }
    });
  }

  private scheduleReconnect(overrideDelay?: number) {
    if (this.destroyed) return;
    if (this.retryTimer != null) {
      clearTimeout(this.retryTimer);
      this.retryTimer = null;
    }
    this.es?.close();
    this.es = null;
    this.status.value = this.retryCount === 0 ? 'offline' : 'reconnecting';
    const delay =
      overrideDelay ??
      BACKOFF_MS[Math.min(this.retryCount, BACKOFF_MS.length - 1)];
    this.retryCount++;
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      this.status.value = 'reconnecting';
      this.openSSE();
    }, delay) as unknown as number;
  }

  private onFact(fact: DocFact) {
    switch (fact.type) {
      case 'snapshot':
        if (fact.blob.length > 0) {
          Y.applyUpdate(this.ydoc, new Uint8Array(fact.blob), 'remote');
        }
        break;
      case 'update':
        Y.applyUpdate(this.ydoc, new Uint8Array(fact.update), 'remote');
        break;
      case 'awareness':
        applyAwarenessUpdate(this.awareness, new Uint8Array(fact.blob), 'remote');
        break;
      case 'role-change': {
        // Facts fan to every subscriber; only apply a role that's about us.
        // (Token guests have no @p identity — their role is fixed by the
        // session, so targeted role facts never apply.)
        const me = ourShip();
        const target = fact.who?.replace(/^~/, '');
        if (fact.who === undefined) {
          this.role.value = fact.role; // older owner ships
        } else if (this.mode === 'ship' && me && target === me.replace(/^~/, '')) {
          this.role.value = fact.role;
        }
        break;
      }
      case 'revoked':
        this.status.value = 'revoked';
        // Access is gone — drop the local cache too.
        this.idb?.clearData().catch(() => {});
        this.idb = null;
        this.destroy();
        break;
      case 'request-snapshot':
        void this.answerSnapshotRequest();
        break;
      case 'meta':
        this.meta.value = {
          title: fact.title,
          modified: fact.modified,
          docType: fact['doc-type'] ?? this.meta.value.docType,
        };
        break;
      case 'trashed':
        // The doc was soft-deleted by its owner. Treat like a revoke for UX.
        this.status.value = 'revoked';
        this.idb?.clearData().catch(() => {});
        this.idb = null;
        this.destroy();
        break;
      case 'comment-add':
      case 'comment-resolved':
      case 'comment-deleted':
        this.commentsVersion.value = this.commentsVersion.value + 1;
        break;
      case 'save-failed': {
        // A forwarded edit was rejected upstream (e.g. role revoked while
        // editing a mirror). Surface it, but do NOT start the reconcile
        // loop: re-pushing through the mirror would just re-forward the
        // rejected edit; the agent-side outbox replays it if access
        // returns, and the edit stays safe in the local Y.Doc + IndexedDB.
        if (this.saveState.value !== 'save-failed') {
          this.saveState.value = 'save-failed';
          toast.error("Your edit was rejected — you may no longer have edit access");
        }
        break;
      }
      case 'blob':
        // Bytes are stored agent-side; browsers fetch /blob themselves.
        break;
    }
  }

  destroy() {
    if (this.destroyed) return;
    this.destroyed = true;

    document.removeEventListener('visibilitychange', this.onVisibility);
    if (this.retryTimer != null) {
      clearTimeout(this.retryTimer);
      this.retryTimer = null;
    }
    if (this.reconcileTimer != null) {
      clearTimeout(this.reconcileTimer);
      this.reconcileTimer = null;
    }

    // Broadcast that this client is leaving so peers drop the cursor right
    // away (otherwise it lingers for ~30s until Yjs's awareness timeout).
    try {
      const myId = this.awareness.clientID;
      this.awareness.setLocalState(null);
      const blob = encodeAwarenessUpdate(this.awareness, [myId]);
      if (blob.length > 0) {
        const body = JSON.stringify({
          'submit-awareness': { id: this.docId, blob: Array.from(blob) },
        });
        const path = this.mode === 'ship' ? '/drive/action' : '/drive/token-action';
        // Use keepalive so the request survives page-navigation/unmount.
        fetch(path, {
          method: 'POST',
          credentials: 'include',
          headers: { 'content-type': 'application/json' },
          body,
          keepalive: true,
        }).catch(() => {});
      }
    } catch {
      /* no-op */
    }

    this.ydoc.off('update', this.onYUpdate);
    this.awareness.off('update', this.onAwareness);
    this.es?.close();
    // Keep the IndexedDB copy (it's the offline cache) but stop persisting.
    this.idb?.destroy();
    this.awareness.destroy();
    this.ydoc.destroy();
  }
}
