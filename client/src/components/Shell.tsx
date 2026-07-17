import type { ComponentChildren } from 'preact';
import { LeftRail, type RailKey } from './LeftRail';

type Props = {
  active: RailKey | 'space';
  activeSpaceId?: string | null;
  ship: string;
  navigate: (path: string) => void;
  children: ComponentChildren;
};

export function Shell({ active, activeSpaceId, ship, navigate, children }: Props) {
  return (
    <div class="shell">
      <LeftRail
        active={active}
        activeSpaceId={activeSpaceId}
        ship={ship}
        navigate={navigate}
      />
      <main class="shell-main">{children}</main>
    </div>
  );
}
