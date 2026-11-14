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
export function GroupHeader({ group, motion = true }: { group: MobileGroup; motion?: boolean }) {
  const header = readGroupHeader(group.header, headerScenesEnabled());
  return header.style === 'scene' ? (
    <Suspense fallback={<HeaderScenePlaceholder group={group} header={header} />}>
      <Scene group={group} header={header} motion={motion} />
    </Suspense>
  ) : (
    <ClassicGroupHeader group={group} />
  );
}
