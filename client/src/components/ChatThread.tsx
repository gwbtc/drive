// Shared chat surface: a scrolling message list + a composer. Used by both
// the per-space room (SpaceChat) and 1:1 DMs (MessagesView). Purely
// presentational — the parent owns fetching, live updates, and send/delete.

import { Fragment } from 'preact';
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import type { ChatMsg } from '../api';
import { openContextMenu } from '../ui/contextMenu';

// Stable per-ship color, matching the presence/cursor hue used elsewhere.
function userColor(label: string): string {
  let h = 0;
  for (let i = 0; i < label.length; i++) h = (h * 31 + label.charCodeAt(i)) >>> 0;
  return `hsl(${h % 360}, 55%, 55%)`;
}

// Compact timestamp: HH:MM for today, else "Mon D" (+ year if not this year).
function msgTime(ms: number): string {
  const d = new Date(ms);
  const now = new Date();
  const sameDay =
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate();
  const hm = d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  if (sameDay) return hm;
  const md = d.toLocaleDateString([], {
    month: 'short',
    day: 'numeric',
    year: d.getFullYear() === now.getFullYear() ? undefined : 'numeric',
  });
  return `${md}, ${hm}`;
}

const GROUP_GAP_MS = 5 * 60 * 1000; // start a new author header after a 5-min gap

type Props = {
  messages: ChatMsg[]; // oldest-first
  me: string; // "~zod"
  readAt?: number; // unread divider before the first message newer than this
  canPost: boolean;
  onSend: (text: string) => unknown; // returns a promise or void; we await it
  onDelete?: (m: ChatMsg) => unknown; // shown for own messages (+ admins)
  placeholder?: string;
  emptyLabel?: string;
};

export function ChatThread({
  messages,
  me,
  readAt,
  canPost,
  onSend,
  onDelete,
  placeholder,
  emptyLabel,
}: Props) {
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);

  // First index that is unread (peer-authored, newer than our read stamp).
  const firstUnread = useMemo(() => {
    if (readAt == null) return -1;
    return messages.findIndex((m) => m.at > readAt && m.author !== me);
  }, [messages, readAt, me]);

  // Keep pinned to the newest message when it's near the bottom already.
  const atBottomRef = useRef(true);
  useEffect(() => {
    const el = scrollRef.current;
    if (el && atBottomRef.current) el.scrollTop = el.scrollHeight;
  }, [messages.length]);

  const onScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    atBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
  };

  const submit = async () => {
    const t = text.trim();
    if (!t || sending) return;
    setSending(true);
    setText('');
    try {
      await onSend(t);
      atBottomRef.current = true;
    } finally {
      setSending(false);
      taRef.current?.focus();
    }
  };

  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void submit();
    }
  };

  return (
    <div class="chat">
      <div class="chat-scroll" ref={scrollRef} onScroll={onScroll}>
        {messages.length === 0 ? (
          <div class="chat-empty muted">{emptyLabel ?? 'No messages yet.'}</div>
        ) : (
          messages.map((m, i) => {
            const prev = messages[i - 1];
            const startGroup =
              !prev || prev.author !== m.author || m.at - prev.at > GROUP_GAP_MS;
            const mine = m.author === me;
            return (
              <Fragment key={m.id}>
                {i === firstUnread && i !== 0 && (
                  <div class="chat-unread-divider" role="separator">
                    <span>New messages</span>
                  </div>
                )}
                <div
                  class={`chat-msg${mine ? ' mine' : ''}${
                    startGroup ? ' group-start' : ''
                  }`}
                  onContextMenu={
                    onDelete && mine
                      ? (e: MouseEvent) => {
                          e.preventDefault();
                          openContextMenu(e.clientX, e.clientY, [
                            { label: 'Delete message', danger: true, onSelect: () => onDelete(m) },
                          ]);
                        }
                      : undefined
                  }
                >
                  {startGroup && (
                    <div class="chat-msg-head">
                      <span class="patp" style={{ color: userColor(m.author) }}>
                        {m.author}
                      </span>
                      <span class="chat-msg-time">{msgTime(m.at)}</span>
                    </div>
                  )}
                  <div class="chat-msg-text">{m.text}</div>
                </div>
              </Fragment>
            );
          })
        )}
      </div>
      {canPost ? (
        <div class="chat-composer">
          <textarea
            ref={taRef}
            class="chat-input"
            rows={1}
            value={text}
            placeholder={placeholder ?? 'Write a message…'}
            aria-label={placeholder ?? 'Write a message'}
            onInput={(e) => setText((e.target as HTMLTextAreaElement).value)}
            onKeyDown={onKey}
          />
          <button
            class="btn primary chat-send"
            disabled={!text.trim() || sending}
            onClick={() => void submit()}
          >
            Send
          </button>
        </div>
      ) : (
        <div class="chat-composer chat-readonly muted">
          You have view-only access to this space.
        </div>
      )}
    </div>
  );
}
