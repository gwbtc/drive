import { displayName } from '../api';
import { useEffect, useRef, useState } from 'preact/hooks';
import {
  shareDoc,
  revokeShare,
  mintToken,
  revokeToken,
  getTokens,
  type DocSummary,
  type TokenInfo,
} from '../api';
import { toast } from '../ui/toast';
import { useFocusTrap } from '../ui/useFocusTrap';

type Props = {
  doc: DocSummary;
  ship: string;
  onClose: () => void;
};

export function ShareDialog({ doc, ship, onClose }: Props) {
  const [who, setWho] = useState('');
  const [role, setRole] = useState<'viewer' | 'commenter' | 'editor'>('editor');
  const [acl, setAcl] = useState(doc.acl ?? []);
  const [tokens, setTokens] = useState<TokenInfo[]>([]);

  const refreshTokens = async () => {
    try {
      setTokens(await getTokens(doc.id));
    } catch {
      toast.error("Couldn't load share links");
    }
  };

  useEffect(() => {
    void refreshTokens();
  }, [doc.id]);

  const onShare = async (e: Event) => {
    e.preventDefault();
    const trimmed = (who || '').trim();
    if (!trimmed) return;
    // Backend expects bare ship name (no leading tilde) so slav %p succeeds.
    const bare = trimmed.replace(/^~/, '');
    if (!bare) return;
    try {
      await shareDoc(doc.id, bare, role);
      const display = '~' + bare;
      setAcl((a) => [...a.filter((x) => x.who !== display), { who: display, role }]);
      setWho('');
      toast.success(`Shared with ~${bare}`);
    } catch (err) {
      toast.error('Could not share — check the ship name.');
    }
  };

  const onRevoke = async (target: string) => {
    const bare = target.replace(/^~/, '');
    await revokeShare(doc.id, bare);
    setAcl((a) => a.filter((x) => x.who !== target));
  };

  const onMintToken = async (r: 'viewer' | 'commenter' | 'editor') => {
    await mintToken(doc.id, r);
    await new Promise((res) => setTimeout(res, 200));
    await refreshTokens();
  };

  const onRevokeToken = async (token: string) => {
    await revokeToken(token);
    await refreshTokens();
  };

  const tokenUrl = (token: string) =>
    `${window.location.origin}/drive/t?k=${token}`;

  const modalRef = useRef<HTMLDivElement>(null);
  useFocusTrap(modalRef);

  // Close on Escape, matching the other modal overlays.
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

  return (
    <div class="modal-backdrop" onClick={onClose}>
      <div
        class="modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="share-dialog-title"
        ref={modalRef}
        onClick={(e) => e.stopPropagation()}
      >
        <header class="modal-header">
          <h2 id="share-dialog-title">Share "{doc.title || 'Untitled'}"</h2>
          <button class="btn-icon" aria-label="Close" onClick={onClose}>×</button>
        </header>

        <section>
          <h3>People</h3>
          <ul class="acl-list">
            <li class="acl-item">
              <span class="acl-who">{displayName(ship)}</span>
              <span class="acl-role muted">owner</span>
            </li>
            {acl.map((entry) => (
              <li key={entry.who} class="acl-item">
                <span class="acl-who">{displayName(entry.who)}</span>
                <span class="acl-role">{entry.role}</span>
                <button class="btn-icon" aria-label={`Revoke ${entry.who}`} onClick={() => onRevoke(entry.who)}>×</button>
              </li>
            ))}
          </ul>
          <form class="share-form" onSubmit={onShare}>
            <input
              class="input"
              aria-label="Ship name to share with"
              placeholder="~zod or ~sampel-palnet"
              value={who}
              onInput={(e) => setWho((e.target as HTMLInputElement).value)}
            />
            <select
              class="select"
              aria-label="Access level"
              value={role}
              onChange={(e) => setRole((e.target as HTMLSelectElement).value as never)}
            >
              <option value="viewer">Viewer</option>
              <option value="commenter">Commenter</option>
              <option value="editor">Editor</option>
            </select>
            <button class="btn primary" type="submit">Add</button>
          </form>
        </section>

        <section>
          <h3>Share links</h3>
          <p class="muted small">
            Anyone with the link can access the doc without an Urbit ID. Revocable.
          </p>
          <div class="token-actions">
            <button class="btn" onClick={() => onMintToken('viewer')}>
              + view link
            </button>
            <button class="btn" onClick={() => onMintToken('commenter')}>
              + comment link
            </button>
            <button class="btn" onClick={() => onMintToken('editor')}>
              + edit link
            </button>
          </div>
          <ul class="token-list">
            {tokens.length === 0 && <li class="muted">No active links</li>}
            {tokens.map((t) => (
              <li key={t.token} class="token-item">
                <span class="token-role">{t.role}</span>
                <input
                  class="token-url"
                  readOnly
                  value={tokenUrl(t.token)}
                  onClick={(e) => (e.target as HTMLInputElement).select()}
                />
                <button
                  class="btn-icon"
                  title="Copy"
                  aria-label="Copy link"
                  onClick={() => {
                    void navigator.clipboard.writeText(tokenUrl(t.token));
                    toast.success('Link copied');
                  }}
                >
                  ⧉
                </button>
                <button
                  class="btn-icon"
                  title="Revoke"
                  aria-label="Revoke link"
                  onClick={() => onRevokeToken(t.token)}
                >
                  ×
                </button>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </div>
  );
}
