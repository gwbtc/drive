import { useEffect, useState } from 'preact/hooks';
import type { Awareness } from 'y-protocols/awareness';

type User = { name?: string; color?: string; ship?: string };

type Props = { awareness: Awareness; me: number; ship: string };

const userColor = (label: string) => {
  let h = 0;
  for (let i = 0; i < label.length; i++) h = (h * 31 + label.charCodeAt(i)) >>> 0;
  return `hsl(${h % 360}, 60%, 50%)`;
};

export function PresenceStack({ awareness, me, ship }: Props) {
  const [peers, setPeers] = useState<Array<{ clientId: number; user: User }>>([]);

  useEffect(() => {
    const update = () => {
      const states = awareness.getStates();
      const arr: Array<{ clientId: number; user: User }> = [];
      for (const [clientId, state] of states.entries()) {
        if (clientId === me) continue;
        const user = (state?.user ?? {}) as User;
        arr.push({ clientId, user });
      }
      // Stable order by clientId so avatars don't jump around.
      arr.sort((a, b) => a.clientId - b.clientId);
      setPeers(arr);
    };
    update();
    awareness.on('change', update);
    return () => awareness.off('change', update);
  }, [awareness, me]);

  if (peers.length === 0) return null;
  const visible = peers.slice(0, 5);
  const overflow = peers.length - visible.length;

  return (
    <div class="presence-stack" aria-label={`${peers.length} other ${peers.length === 1 ? 'user' : 'users'} viewing`}>
      <span class="presence-self patp" title={`You (${ship})`}>{shortLabel(ship)}</span>
      {visible.map((p) => {
        const label = p.user.ship ?? p.user.name ?? '?';
        const display = shortLabel(label);
        const color = p.user.color || userColor(label);
        return (
          <span
            key={p.clientId}
            class="presence-dot"
            style={{ background: color }}
            title={label}
            aria-label={label}
          >
            {display.charAt(0).toUpperCase()}
          </span>
        );
      })}
      {overflow > 0 && <span class="presence-overflow" title={`${overflow} more`}>+{overflow}</span>}
    </div>
  );
}

function shortLabel(s: string): string {
  if (!s) return '?';
  if (s === 'Guest') return 'G';
  // For @p names like ~zod or ~sampel-palnet, take the first letter after ~.
  const tilded = s.startsWith('~') ? s.slice(1) : s;
  return tilded.charAt(0);
}
