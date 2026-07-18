// The Messages view: 1:1 direct messages. A master-detail layout — the
// conversation list on the left, the active thread on the right. On phones it
// collapses to one pane at a time (list at /drive/messages, thread at
// /drive/dm/<peer>). DMs are peer-to-peer: each ship stores its own copy, so
// there's no host and no membership — you can message any ship.

import { useEffect, useRef, useState } from 'preact/hooks';
import {
  getDmThread,
  sendDm,
  deleteDm,
  readDm,
  type ChatMsg,
} from '../api';
import { useDmSummaries } from '../useSpaces';
import { listingFeed } from '../listingFeed';
import { promptDialog } from '../ui/dialogs';
import { toast } from '../ui/toast';
import { ChatThread } from './ChatThread';

const withTilde = (s: string) => (s.startsWith('~') ? s : `~${s}`);

// A rough plausibility check for a hand-typed ship name (planet/moon/comet):
// letters and hyphens only after an optional ~. Not a full @p validation, but
// enough to keep obviously-bad input out of the URL.
const looksLikeShip = (s: string) => /^~?[a-z][a-z-]{2,}$/.test(s.trim());

function timeAgo(ms: number): string {
  if (!ms) return '';
  const d = new Date(ms);
  const now = new Date();
  const sameDay =
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate();
  if (sameDay) return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
}

function DmThreadPane({
  peer,
  me,
  onBack,
}: {
  peer: string;
  me: string;
  onBack: () => void;
}) {
  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [readAt, setReadAt] = useState<number | undefined>(undefined);
  const pinnedRead = useRef(false);

  useEffect(() => {
    let cancelled = false;
    pinnedRead.current = false;
    const refresh = async () => {
      try {
        const t = await getDmThread(peer);
        if (cancelled) return;
        setMessages(t.messages);
        if (!pinnedRead.current) {
          setReadAt(t.read);
          pinnedRead.current = true;
        }
        void readDm(peer);
      } catch {
        /* keep what we have */
      }
    };
    void refresh();
    const unsub = listingFeed.on('dm', (p) => {
      if (!p || withTilde(p.peer) === withTilde(peer)) void refresh();
    });
    const id = setInterval(refresh, 60000);
    return () => {
      cancelled = true;
      unsub();
      clearInterval(id);
    };
  }, [peer]);

  return (
    <div class="dm-thread">
      <header class="dm-thread-head">
        <button class="btn-icon dm-back" aria-label="Back to conversations" onClick={onBack}>
          ‹
        </button>
        <span class="patp dm-thread-peer">{withTilde(peer)}</span>
      </header>
      <ChatThread
        messages={messages}
        me={me}
        readAt={readAt}
        canPost={true}
        onSend={(t) => sendDm(peer, t).catch(toast.error)}
        onDelete={(m) => deleteDm(peer, m.id).catch(toast.error)}
        placeholder={`Message ${withTilde(peer)}…`}
        emptyLabel="No messages yet — say hello 👋"
      />
    </div>
  );
}

export function MessagesView({
  peer,
  me,
  navigate,
}: {
  peer?: string;
  me: string;
  navigate: (path: string) => void;
}) {
  const convos = useDmSummaries();
  const activePeer = peer ? withTilde(peer) : undefined;

  const startNew = async () => {
    const raw = await promptDialog({
      title: 'New message',
      message: "Enter a ship name to message (e.g. ~sampel-palnet).",
      placeholder: '~sampel-palnet',
      confirmLabel: 'Open',
    });
    if (!raw) return;
    const ship = withTilde(raw.trim().toLowerCase());
    if (!looksLikeShip(ship)) {
      toast.error(new Error(`"${raw}" doesn't look like a ship name`));
      return;
    }
    navigate(`/drive/dm/${ship}`);
  };

  return (
    <div class="dm-layout" data-has-peer={activePeer ? 'true' : 'false'}>
      <aside class="dm-sidebar">
        <header class="dm-sidebar-head">
          <h1>Messages</h1>
          <button class="btn primary btn-sm" onClick={() => void startNew()}>
            New
          </button>
        </header>
        {convos.length === 0 ? (
          <div class="dm-list-empty muted">
            No conversations yet. Start one with <b>New</b>.
          </div>
        ) : (
          <ul class="dm-list">
            {convos.map((c) => {
              const active = activePeer === withTilde(c.peer);
              return (
                <li key={c.peer}>
                  <a
                    class={`dm-list-item${active ? ' active' : ''}`}
                    href={`/drive/dm/${withTilde(c.peer)}`}
                    onClick={(e: MouseEvent) => {
                      e.preventDefault();
                      navigate(`/drive/dm/${withTilde(c.peer)}`);
                    }}
                  >
                    <div class="dm-list-row1">
                      <span class="patp dm-list-peer">{withTilde(c.peer)}</span>
                      <span class="dm-list-time">{timeAgo(c['last-at'])}</span>
                    </div>
                    <div class="dm-list-row2">
                      <span class="dm-list-preview">
                        {c['last-author'] === me ? 'You: ' : ''}
                        {c['last-text'] || '—'}
                      </span>
                      {c.unread > 0 && <span class="dm-unread-pill">{c.unread}</span>}
                    </div>
                  </a>
                </li>
              );
            })}
          </ul>
        )}
      </aside>
      <section class="dm-main">
        {activePeer ? (
          <DmThreadPane
            peer={activePeer}
            me={me}
            onBack={() => navigate('/drive/messages')}
          />
        ) : (
          <div class="dm-main-empty muted">
            <p>Select a conversation, or start a new one.</p>
          </div>
        )}
      </section>
    </div>
  );
}
