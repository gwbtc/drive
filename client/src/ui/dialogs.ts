import { signal } from '@preact/signals';

export type ConfirmRequest = {
  id: number;
  kind: 'confirm';
  title: string;
  message?: string;
  confirmLabel: string;
  cancelLabel: string;
  danger: boolean;
  resolve: (value: boolean) => void;
};

export type PromptRequest = {
  id: number;
  kind: 'prompt';
  title: string;
  message?: string;
  defaultValue: string;
  placeholder: string;
  confirmLabel: string;
  cancelLabel: string;
  resolve: (value: string | null) => void;
};

export type DialogRequest = ConfirmRequest | PromptRequest;

let nextId = 1;
// Queue: dialogs are sequential — only the head is shown.
export const dialogQueue = signal<DialogRequest[]>([]);

const close = (id: number) => {
  dialogQueue.value = dialogQueue.value.filter((d) => d.id !== id);
};

export function confirmDialog(opts: {
  title: string;
  message?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
}): Promise<boolean> {
  return new Promise((resolve) => {
    const id = nextId++;
    const req: ConfirmRequest = {
      id,
      kind: 'confirm',
      title: opts.title,
      message: opts.message,
      confirmLabel: opts.confirmLabel ?? 'OK',
      cancelLabel: opts.cancelLabel ?? 'Cancel',
      danger: !!opts.danger,
      resolve: (v) => {
        close(id);
        resolve(v);
      },
    };
    dialogQueue.value = [...dialogQueue.value, req];
  });
}

export function promptDialog(opts: {
  title: string;
  message?: string;
  defaultValue?: string;
  placeholder?: string;
  confirmLabel?: string;
  cancelLabel?: string;
}): Promise<string | null> {
  return new Promise((resolve) => {
    const id = nextId++;
    const req: PromptRequest = {
      id,
      kind: 'prompt',
      title: opts.title,
      message: opts.message,
      defaultValue: opts.defaultValue ?? '',
      placeholder: opts.placeholder ?? '',
      confirmLabel: opts.confirmLabel ?? 'OK',
      cancelLabel: opts.cancelLabel ?? 'Cancel',
      resolve: (v) => {
        close(id);
        resolve(v);
      },
    };
    dialogQueue.value = [...dialogQueue.value, req];
  });
}
