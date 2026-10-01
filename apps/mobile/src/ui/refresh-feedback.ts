import type { MobileSnapshot } from '../data/types';

export interface RefreshFeedback {
  /** The native pull indicator: only while a pull-to-refresh runs. */
  pull: boolean;
  /** One quiet status line while visible content is re-read automatically or retried. */
  quiet: boolean;
  /** When the oldest figures being re-read on screen were verified, shown with the quiet status. */
  savedAt: number | null;
}

/**
 * One progress cue per operation. A first load without matching content shows
 * its own section placeholder, so it is neither a pull nor a quiet refresh here.
 */
export function refreshFeedback(state: MobileSnapshot): RefreshFeedback {
  const { groups, home, detail, financial } = state;
  const { expenses, balances } = financial;
  const refreshing =
    state.screen === 'groups'
      ? [
          { active: groups.status === 'loading' && groups.data.length > 0, time: null },
          { active: home.status === 'loading' && home.data !== null, time: home.refreshedAt },
        ]
      : state.screen === 'group' && state.destination === 'activity'
        ? [
            {
              active: detail.status === 'loading' && detail.data !== null,
              time: detail.refreshedAt,
            },
            {
              // Older pages have their own footer; a first load shows its placeholder.
              active: state.activity.status === 'loading' && state.activity.events.length > 0,
              time: null,
            },
          ]
        : state.screen === 'group' &&
            // Pagination has its own footer.
            expenses.moreStatus !== 'loading'
          ? [
              {
                active: detail.status === 'loading' && detail.data !== null,
                time: detail.refreshedAt,
              },
              {
                active:
                  expenses.status === 'loading' &&
                  (expenses.summary !== null || expenses.data.length > 0),
                time: expenses.refreshedAt,
              },
              {
                // Unverified Balances already carry their own "Updating" label.
                active: balances.status === 'loading' && balances.data !== null && !balances.stale,
                time: balances.refreshedAt,
              },
            ]
          : [];
  const active = refreshing.filter((item) => item.active);
  const times = active.map((item) => item.time).filter((time): time is number => time !== null);
  return {
    pull: state.pull,
    quiet: active.length > 0 && !state.pull,
    savedAt: times.length ? Math.min(...times) : null,
  };
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
