// Whole-drive change feed: one SSE stream (GET /drive/sse?feed=listing)
// shared by every listing view. The agent pings {"type":"listing"} after
// any listing-mutating action; subscribers re-fetch. Views keep a slow
// fallback poll (the subscribe() return includes nothing fancy — they
// keep their own 60s interval) because SSE can die silently.

import { BASE } from './api';

type Listener = () => void;

const BACKOFF_MS = [1000, 2000, 4000, 8000, 15000, 30000];

class ListingFeed {
  private listeners = new Set<Listener>();
  private es: EventSource | null = null;
  private retryCount = 0;
  private retryTimer: number | null = null;

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    if (this.listeners.size === 1) this.open();
    return () => {
      this.listeners.delete(fn);
      if (this.listeners.size === 0) this.close();
    };
  }

  private open() {
    if (this.es) return;
    this.es = new EventSource(`${BASE}/sse?feed=listing`, {
      withCredentials: true,
    });
    this.es.addEventListener('open', () => {
      if (this.retryCount > 0) {
        this.retryCount = 0;
        // Missed pings while disconnected — refresh once on recovery.
        this.notify();
      }
    });
    this.es.addEventListener('error', () => this.scheduleReconnect());
    this.es.addEventListener('fact', (e: MessageEvent) => {
      try {
        const fact = JSON.parse(e.data);
        if (fact?.type === 'listing') this.notify();
      } catch {
        /* heartbeats etc. */
      }
    });
  }

  private close() {
    this.es?.close();
    this.es = null;
    if (this.retryTimer != null) {
      clearTimeout(this.retryTimer);
      this.retryTimer = null;
    }
    this.retryCount = 0;
  }

  private scheduleReconnect() {
    if (this.retryTimer != null || this.listeners.size === 0) return;
    this.es?.close();
    this.es = null;
    const delay = BACKOFF_MS[Math.min(this.retryCount, BACKOFF_MS.length - 1)];
    this.retryCount++;
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      if (this.listeners.size > 0) this.open();
    }, delay) as unknown as number;
  }

  private notify() {
    for (const fn of [...this.listeners]) {
      try {
        fn();
      } catch {
        /* a broken subscriber must not stall the rest */
      }
    }
  }
}

export const listingFeed = new ListingFeed();
