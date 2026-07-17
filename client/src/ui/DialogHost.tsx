import { useEffect, useRef, useState } from 'preact/hooks';
import { dialogQueue, type DialogRequest } from './dialogs';
import { useFocusTrap } from './useFocusTrap';

export function DialogHost() {
  const items = dialogQueue.value;
  const head = items[0];
  if (!head) return null;
  return head.kind === 'confirm' ? (
    <ConfirmView key={head.id} req={head} />
  ) : (
    <PromptView key={head.id} req={head} />
  );
}

function ConfirmView({ req }: { req: Extract<DialogRequest, { kind: 'confirm' }> }) {
  const ref = useRef<HTMLDivElement>(null);
  useFocusTrap(ref);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        req.resolve(false);
      } else if (e.key === 'Enter') {
        e.preventDefault();
        req.resolve(true);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [req]);

  return (
    <div class="modal-backdrop" onClick={() => req.resolve(false)}>
      <div
        class="dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={`dlg-title-${req.id}`}
        ref={ref}
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id={`dlg-title-${req.id}`} class="dialog-title">{req.title}</h2>
        {req.message && <p class="dialog-message">{req.message}</p>}
        <div class="dialog-actions">
          <button class="btn" onClick={() => req.resolve(false)}>{req.cancelLabel}</button>
          <button
            class={`btn ${req.danger ? 'danger' : 'primary'}`}
            onClick={() => req.resolve(true)}
            autofocus
          >
            {req.confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

function PromptView({ req }: { req: Extract<DialogRequest, { kind: 'prompt' }> }) {
  const [value, setValue] = useState(req.defaultValue);
  const ref = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  useFocusTrap(ref);

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        req.resolve(null);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [req]);

  return (
    <div class="modal-backdrop" onClick={() => req.resolve(null)}>
      <div
        class="dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={`dlg-title-${req.id}`}
        ref={ref}
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id={`dlg-title-${req.id}`} class="dialog-title">{req.title}</h2>
        {req.message && <p class="dialog-message">{req.message}</p>}
        <form
          class="dialog-form"
          onSubmit={(e) => {
            e.preventDefault();
            req.resolve(value);
          }}
        >
          <input
            ref={inputRef}
            class="input dialog-input"
            value={value}
            placeholder={req.placeholder}
            onInput={(e) => setValue((e.target as HTMLInputElement).value)}
          />
          <div class="dialog-actions">
            <button type="button" class="btn" onClick={() => req.resolve(null)}>
              {req.cancelLabel}
            </button>
            <button type="submit" class="btn primary">
              {req.confirmLabel}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
