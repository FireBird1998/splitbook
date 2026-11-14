'use client';

import { useMemo, useSyncExternalStore } from 'react';
import { dayKeyInZone } from '@splitbook/shared/zoned-calendar';
import { useViewerTimeZone } from '@/lib/hooks/use-viewer-time-zone';

function openedClock() {
  let instant: number | null = null;
  return {
    snapshot: () => instant,
    subscribe(changed: () => void) {
      const refresh = () => {
        instant = Date.now();
        changed();
      };
      const visible = () => {
        if (document.visibilityState === 'visible') refresh();
      };
      window.addEventListener('focus', refresh);
      window.addEventListener('pageshow', refresh);
      document.addEventListener('visibilitychange', visible);
      refresh();
      return () => {
        window.removeEventListener('focus', refresh);
        window.removeEventListener('pageshow', refresh);
        document.removeEventListener('visibilitychange', visible);
      };
    },
  };
}

/** Like the Trip summary's viewer-local today, but sampled only on opening/returning, never on a timer. */
export function useHeaderClock() {
  const zone = useViewerTimeZone();
  const clock = useMemo(() => openedClock(), []);
  const instant = useSyncExternalStore(clock.subscribe, clock.snapshot, () => null);
  return zone && instant !== null
    ? { today: dayKeyInZone(instant, zone), hour: new Date(instant).getHours() }
    : null;
}
