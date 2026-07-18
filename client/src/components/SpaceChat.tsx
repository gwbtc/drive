// The chatroom for one space, shown as the "Chat" tab inside SpaceView. Any
// member can post (the backend authorizes by membership); the host is the
// single writer + ordering authority, so messages appear once the fan-out
// lands. Live via the 'space-chat' app event; falls back to a slow poll.

import { useEffect, useRef, useState } from 'preact/hooks';
import {
  getSpaceChat,
  postMessage,
  deleteMessage,
  readSpace,
  type ChatMsg,
} from '../api';
import { listingFeed } from '../listingFeed';
import { toast } from '../ui/toast';
import { ChatThread } from './ChatThread';

export function SpaceChat({
  spaceId,
  me,
  canPost,
}: {
  spaceId: string;
  me: string;
  canPost: boolean;
}) {
  const [messages, setMessages] = useState<ChatMsg[]>([]);
  // The unread divider is pinned to where we entered the room, so live
  // arrivals don't keep shoving it down while we read.
  const [readAt, setReadAt] = useState<number | undefined>(undefined);
  const pinnedRead = useRef(false);

  useEffect(() => {
    let cancelled = false;
    pinnedRead.current = false;
    const refresh = async () => {
      try {
        const c = await getSpaceChat(spaceId);
        if (cancelled) return;
        setMessages(c.messages);
        if (!pinnedRead.current) {
          setReadAt(c.read);
          pinnedRead.current = true;
        }
        void readSpace(spaceId); // we're looking at it — clear the badge
      } catch {
        /* keep what we have */
      }
    };
    void refresh();
    const unsub = listingFeed.on('space-chat', (p) => {
      if (!p || p.space === spaceId) void refresh();
    });
    const id = setInterval(refresh, 60000);
    return () => {
      cancelled = true;
      unsub();
      clearInterval(id);
    };
  }, [spaceId]);

  return (
    <ChatThread
      messages={messages}
      me={me}
      readAt={readAt}
      canPost={canPost}
      onSend={(t) => postMessage(spaceId, t).catch(toast.error)}
      onDelete={(m) => deleteMessage(spaceId, m.id).catch(toast.error)}
      placeholder="Message this space…"
      emptyLabel="No messages in this space yet. Say hello 👋"
    />
  );
}
