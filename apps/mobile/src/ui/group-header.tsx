import { lazy, Suspense } from 'react';
import { readGroupHeader } from '@splitbook/shared/group-header';
import { getGroupTheme } from '@splitbook/shared/group-themes';
import { headerScenesEnabled } from '../config';
import type { MobileGroup } from '../data/types';
import { TripStrip } from './trip-strip';

// Neither native SVG nor art is evaluated for Classic or switch-off Groups.
const Scene = lazy(() => import('./header-scene'));
export function GroupHeader({ group, motion = true }: { group: MobileGroup; motion?: boolean }) {
  const header = readGroupHeader(group.header, headerScenesEnabled());
  const classic =
    getGroupTheme(group.category).header === 'strip' ? <TripStrip group={group} /> : null;
  return header.style === 'scene' ? (
    <Suspense fallback={classic}>
      <Scene group={group} header={header} motion={motion} />
    </Suspense>
  ) : (
    classic
  );
}
