import type { MobileSnapshot } from '../data/types';

export interface RefreshFeedback {
  /** The native pull indicator: only while a member-requested refresh runs. */
  pull: boolean;
  /** One quiet status line while visible content is re-read automatically. */
  quiet: boolean;
}

/**
 * One progress cue per operation. A first load without matching content shows
 * its own section placeholder, so it is neither a pull nor a quiet refresh here.
 */
export function refreshFeedback(state: MobileSnapshot): RefreshFeedback {
  const { groups, home, detail, financial } = state;
  const { expenses, balances } = financial;
  const updating =
    state.screen === 'groups'
      ? (groups.status === 'loading' && groups.data.length > 0) ||
        (home.status === 'loading' && home.data !== null)
      : state.screen === 'group' &&
        // Pagination has its own footer.
        expenses.moreStatus !== 'loading' &&
        ((detail.status === 'loading' && detail.data !== null) ||
          (expenses.status === 'loading' &&
            (expenses.summary !== null || expenses.data.length > 0)) ||
          // Unverified Balances already carry their own "Updating" label.
          (balances.status === 'loading' && balances.data !== null && !balances.stale));
  return { pull: state.pull, quiet: updating && !state.pull };
}

/** "12:05 PM" today, otherwise "Sep 30, 12:05 PM": when the shown figures were read. */
export function refreshedLabel(time: number | null, now = Date.now()) {
  if (time === null) return 'an unknown time';
  const date = new Date(time);
  return date.toDateString() === new Date(now).toDateString()
    ? date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
    : date.toLocaleString([], {
        month: 'short',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
      });
}
