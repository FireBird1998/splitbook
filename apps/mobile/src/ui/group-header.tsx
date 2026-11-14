import { lazy, Suspense } from 'react';
import { readGroupHeader } from '@splitbook/shared/group-header';
import { headerScenesEnabled } from '../config';
import type { MobileGroup } from '../data/types';
import { ClassicGroupHeader, HeaderScenePlaceholder } from './header-scene-card';

// Neither native SVG nor art is evaluated for Classic or switch-off Groups.
const Scene = lazy(() =>
  import('./header-scene').catch(() => ({
    default: ({ group }: { group: MobileGroup }) => <ClassicGroupHeader group={group} />,
  })),
);
export function GroupHeader({
  group,
  motion = true,
  tilt = true,
  visible = true,
}: {
  group: MobileGroup;
  motion?: boolean;
  tilt?: boolean;
  visible?: boolean;
}) {
  const header = readGroupHeader(group.header, headerScenesEnabled());
  return header.style === 'scene' ? (
    <Suspense fallback={<HeaderScenePlaceholder group={group} header={header} />}>
      <Scene group={group} header={header} motion={motion} tilt={tilt} visible={visible} />
    </Suspense>
  ) : (
    <ClassicGroupHeader group={group} />
  );
}
