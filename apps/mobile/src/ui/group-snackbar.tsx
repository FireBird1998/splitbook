import { useEffect } from 'react';
import { AccessibilityInfo } from 'react-native';
import type { GroupSnackbar as Notice } from '../data/types';
import { Snackbar } from './compact/feedback';

/** "View in August", with the year when it differs from the Month shown. */
export function viewMonthLabel(month: string, shown: string | null) {
  const sameYear = shown !== null && shown.slice(0, 4) === month.slice(0, 4);
  return `View in ${new Date(`${month}-01T12:00:00`).toLocaleDateString(
    'en',
    sameYear ? { month: 'long' } : { month: 'long', year: 'numeric' },
  )}`;
}

/**
 * Confirms a save on the Group view. Another Month is only offered; the view changes when the
 * member chooses it. Stays for Android's accessibility timeout, which can extend it.
 */
export function GroupSnackbar({
  notice,
  shownMonth,
  onView,
  onDismiss,
}: {
  notice: Notice;
  shownMonth: string | null;
  onView: () => void;
  onDismiss: () => void;
}) {
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    let active = true;
    void AccessibilityInfo.getRecommendedTimeoutMillis(notice.viewMonth ? 10_000 : 6_000).then(
      (timeout) => {
        if (active) timer = setTimeout(onDismiss, timeout);
      },
    );
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [notice]);
  return (
    // Its default offset sits just above the Group's bottom navigation.
    <Snackbar
      message={notice.message}
      action={
        notice.viewMonth
          ? { label: viewMonthLabel(notice.viewMonth, shownMonth), onPress: onView }
          : undefined
      }
    />
  );
}
