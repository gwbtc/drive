import type { Status, SaveState } from '../providers/types';

type Props = { status: Status; save?: SaveState };

const LABELS: Record<Status, string> = {
  connecting: 'Connecting',
  live: 'Live',
  reconnecting: 'Reconnecting',
  offline: 'Offline',
  revoked: 'Revoked',
};

const SAVE_LABELS: Record<SaveState, string> = {
  saved: 'All changes saved',
  saving: 'Saving…',
  'save-failed': 'Save failed — retrying',
};

export function ConnectionPip({ status, save }: Props) {
  // Save state is the headline whenever it's more informative than the
  // connection status; a failed save also recolors the dot.
  const label =
    save === 'save-failed' || save === 'saving'
      ? SAVE_LABELS[save]
      : status === 'live' && save === 'saved'
        ? SAVE_LABELS[save]
        : LABELS[status];
  const cls = save === 'save-failed' ? 'save-failed' : status;
  return (
    <div class={`pip pip-${cls}`} title={label}>
      <span class="pip-dot" aria-hidden="true" />
      {/* Only the label text is a live region, so a screen reader announces
          the new status once — not the whole pip on every transition. */}
      <span class="pip-label" aria-live="polite">{label}</span>
    </div>
  );
}
