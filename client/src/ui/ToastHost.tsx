import { toasts, toast as toastApi, type Toast } from './toast';

const icons: Record<Toast['kind'], string> = {
  success: '✓',
  error: '!',
  info: 'i',
  loading: '⟳',
};

export function ToastHost() {
  const items = toasts.value;
  if (items.length === 0) return null;
  return (
    <div class="toast-host">
      {items.map((t) => (
        <div
          key={t.id}
          class={`toast toast-${t.kind}`}
          role={t.kind === 'error' ? 'alert' : 'status'}
          aria-atomic="true"
        >
          <span
            class={`toast-icon ${t.kind === 'loading' ? 'toast-icon-spin' : ''}`}
            aria-hidden="true"
          >
            {icons[t.kind]}
          </span>
          <span class="toast-message">{t.message}</span>
          {t.duration === Infinity && (
            <button
              class="toast-dismiss"
              aria-label="Dismiss"
              onClick={() => toastApi.dismiss(t.id)}
            >
              ×
            </button>
          )}
        </div>
      ))}
    </div>
  );
}
