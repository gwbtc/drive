// App-wide event feed: one SSE stream (GET /drive/sse?feed=listing) shared by
// every view. The agent pings it with typed JSON events:
//   {"type":"listing"}                     — a listing-mutating action landed
//   {"type":"space-chat","space":"0v..."}  — a room's messages changed
//   {"type":"dm","peer":"~sampel"}         — a DM thread changed
// Subscribers re-fetch on the events they care about. Views also keep a slow
// fallback poll because SSE can die silently; on reconnect we re-notify every
// listener so nothing missed while disconnected is lost.

import { BASE } from './api';

type Handler = (payload: any) => void;

const BACKOFF_MS = [1000, 2000, 4000, 8000, 15000, 30000];

class AppFeed {
  private handlers = new Map<string, Set<Handler>>();
  private es: EventSource | null = null;
  private retryCount = 0;
  private retryTimer: number | null = null;

  // Subscribe to a specific event type. Returns an unsubscribe fn.
  on(type: string, fn: Handler): () => void {
    let set = this.handlers.get(type);
    if (!set) {
      set = new Set();
      this.handlers.set(type, set);
    }
    set.add(fn);
    if (this.total() === 1) this.open();
    return () => {
      const s = this.handlers.get(type);
      if (!s) return;
      s.delete(fn);
      if (s.size === 0) this.handlers.delete(type);
      if (this.total() === 0) this.close();
    };
  }

  // Back-compat sugar: listing-change subscribers take no payload.
  subscribe(fn: () => void): () => void {
    return this.on('listing', () => fn());
  }

  private total(): number {
    let n = 0;
    for (const s of this.handlers.values()) n += s.size;
    return n;
  }

  private open() {
    if (this.es) return;
    this.es = new EventSource(`${BASE}/sse?feed=listing`, {
      withCredentials: true,
    });
    this.es.addEventListener('open', () => {
      if (this.retryCount > 0) {
        this.retryCount = 0;
        // Missed events while disconnected — re-notify everyone so they
        // re-fetch (payload null = "you may have missed something").
        for (const set of this.handlers.values()) {
          for (const fn of [...set]) this.safe(fn, null);
        }
      }
    });
    this.es.addEventListener('error', () => this.scheduleReconnect());
    this.es.addEventListener('fact', (e: MessageEvent) => {
      let fact: any;
      try {
        fact = JSON.parse(e.data);
      } catch {
        return; // heartbeats etc.
      }
      const set = fact?.type && this.handlers.get(fact.type);
      if (!set) return;
      for (const fn of [...set]) this.safe(fn, fact);
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
    if (this.retryTimer != null || this.total() === 0) return;
    this.es?.close();
    this.es = null;
    const delay = BACKOFF_MS[Math.min(this.retryCount, BACKOFF_MS.length - 1)];
    this.retryCount++;
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      if (this.total() > 0) this.open();
    }, delay) as unknown as number;
  }

  private safe(fn: Handler, payload: any) {
    try {
      fn(payload);
    } catch {
      /* a broken subscriber must not stall the rest */
    }
  }
}

export const listingFeed = new AppFeed();
