'use client';

import { useCallback, useSyncExternalStore } from 'react';
import { isTimeZone, monthKeyInZone } from '@splitbook/shared/zoned-calendar';

/*
 * The viewer's own time zone, which decides their Months (#307, #314). It is read in the
 * browser only: the server's zone would be wrong, so a server render gets null and shows the
 * reads that need it as loading until the page hydrates.
 */

const noSubscription = () => () => {};

function browserTimeZone(): string {
  const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  return isTimeZone(zone) ? zone : 'UTC';
}

export function useViewerTimeZone(): string | null {
  return useSyncExternalStore(noSubscription, browserTimeZone, () => null);
}

/** Checked once a minute, so a page left open moves to the new Month when it starts. */
const MONTH_CHECK_MS = 60_000;

function everyMinute(onChange: () => void) {
  const timer = window.setInterval(onChange, MONTH_CHECK_MS);
  return () => window.clearInterval(timer);
}

/** The viewer's current Month (`YYYY-MM`) in their time zone; null in a server render. */
export function useViewerMonth(timeZone: string | null): string | null {
  const snapshot = useCallback(
    () => (timeZone ? monthKeyInZone(Date.now(), timeZone) : null),
    [timeZone],
  );
  return useSyncExternalStore(everyMinute, snapshot, () => null);
}
