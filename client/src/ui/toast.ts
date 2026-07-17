import { signal } from '@preact/signals';

export type ToastKind = 'success' | 'error' | 'info' | 'loading';

export type Toast = {
  id: number;
  kind: ToastKind;
  message: string;
  duration: number; // ms; Infinity = sticky
};

let nextId = 1;
export const toasts = signal<Toast[]>([]);

const dismiss = (id: number) => {
  toasts.value = toasts.value.filter((t) => t.id !== id);
};

const push = (kind: ToastKind, message: string, duration = 4000): number => {
  const id = nextId++;
  const t: Toast = { id, kind, message, duration };
  toasts.value = [...toasts.value, t];
  if (duration !== Infinity) {
    setTimeout(() => dismiss(id), duration);
  }
  return id;
};

const update = (id: number, patch: Partial<Toast>) => {
  toasts.value = toasts.value.map((t) => (t.id === id ? { ...t, ...patch } : t));
  if (patch.duration !== undefined && patch.duration !== Infinity) {
    setTimeout(() => dismiss(id), patch.duration);
  }
};

// Format an error from any source into a short human-readable line.
const errMsg = (e: unknown): string => {
  if (!e) return 'Something went wrong';
  if (e instanceof Error) {
    // Strip wrapping prefixes our api.ts adds, like "action failed: 500 ..."
    const m = e.message.match(/action failed:\s*\d+\s*([\s\S]+)/i);
    if (m) {
      // Try JSON parse for structured errors
      try {
        const parsed = JSON.parse(m[1]);
        if (parsed?.error) return String(parsed.error);
      } catch {}
      return e.message.length > 160 ? e.message.slice(0, 160) + '…' : e.message;
    }
    return e.message;
  }
  return String(e);
};

export const toast = {
  success: (message: string, duration?: number) => push('success', message, duration),
  error: (message: string | unknown, duration?: number) =>
    push('error', typeof message === 'string' ? message : errMsg(message), duration ?? 6000),
  info: (message: string, duration?: number) => push('info', message, duration),
  loading: (message: string) => push('loading', message, Infinity),
  dismiss,
  promise: async <T>(
    p: Promise<T>,
    opts: { loading: string; success: string | ((v: T) => string); error?: string | ((e: unknown) => string) },
  ): Promise<T> => {
    const id = push('loading', opts.loading, Infinity);
    try {
      const v = await p;
      const msg = typeof opts.success === 'function' ? opts.success(v) : opts.success;
      update(id, { kind: 'success', message: msg, duration: 3000 });
      return v;
    } catch (e) {
      const msg =
        typeof opts.error === 'function'
          ? opts.error(e)
          : opts.error ?? errMsg(e);
      update(id, { kind: 'error', message: msg, duration: 6000 });
      throw e;
    }
  },
};
