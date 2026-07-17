import { useEffect, useRef, useState } from 'preact/hooks';
import { joinSpace } from '../api';
import { toast } from '../ui/toast';
import { useFocusTrap } from '../ui/useFocusTrap';

type Props = {
  onClose: () => void;
};

// Join a space hosted on another ship. The
// host shares the space id (a `0v…`) out-of-band and the joiner types it in
// alongside the host ship. Modeled on ShareDialog / SpaceMembersDialog: a
// backdrop + focus-trapped modal that closes on Escape.
export function JoinSpaceDialog({ onClose }: Props) {
  const [host, setHost] = useState('');
  const [spaceId, setSpaceId] = useState('');
  const [busy, setBusy] = useState(false);

  const modalRef = useRef<HTMLDivElement>(null);
  useFocusTrap(modalRef);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const onSubmit = async (e: Event) => {
    e.preventDefault();
    const h = host.trim();
    const id = spaceId.trim();
    if (!h || !id || busy) return;
    setBusy(true);
    try {
      // joinSpace strips a leading ~ from the host itself.
      await joinSpace(h, id);
      // The subscription is async on the host side — the space lands in the
      // switcher when the listing feed refreshes (useSpaces picks it up).
      toast.success('Joining space…');
      onClose();
    } catch {
      toast.error('Could not join — check the host ship and space id.');
      setBusy(false);
    }
  };

  return (
    <div class="modal-backdrop" onClick={onClose}>
      <div
        class="modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="join-space-title"
        data-testid="join-space-dialog"
        ref={modalRef}
        onClick={(e) => e.stopPropagation()}
      >
        <header class="modal-header">
          <h2 id="join-space-title">Join a space</h2>
          <button class="btn-icon" aria-label="Close" onClick={onClose}>
            ×
          </button>
        </header>

        <section>
          <p class="muted small">
            Enter the host ship and the space id they shared with you.
          </p>
          <form class="join-space-form" onSubmit={onSubmit}>
            <label class="join-space-field">
              <span class="join-space-field-label">Host ship</span>
              <input
                class="input"
                data-testid="join-space-host"
                aria-label="Host ship"
                placeholder="~sampel-palnet"
                value={host}
                onInput={(e) => setHost((e.target as HTMLInputElement).value)}
              />
            </label>
            <label class="join-space-field">
              <span class="join-space-field-label">Space id</span>
              <input
                class="input"
                data-testid="join-space-id"
                aria-label="Space id"
                placeholder="0v…"
                value={spaceId}
                onInput={(e) => setSpaceId((e.target as HTMLInputElement).value)}
              />
            </label>
            <div class="join-space-actions">
              <button class="btn" type="button" onClick={onClose}>
                Cancel
              </button>
              <button
                class="btn primary"
                type="submit"
                data-testid="join-space-submit"
                disabled={busy || !host.trim() || !spaceId.trim()}
              >
                Join
              </button>
            </div>
          </form>
        </section>
      </div>
    </div>
  );
}
