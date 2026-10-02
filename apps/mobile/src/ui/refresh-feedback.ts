import { shownGroup, shownView } from '../data/mobile-controller';
import type { LoadStatus, MobileSnapshot } from '../data/types';

export interface RefreshFeedback {
  /** The native pull indicator: only while a pull that started on this view runs. */
  pull: boolean;
  /** One quiet status line while visible content is re-read or retried. */
  quiet: boolean;
  /** When the oldest figures being re-read on screen were verified, shown with the quiet status. */
  savedAt: number | null;
  /** An automatic refresh of this view is running: nothing says so, not even an updating label. */
  silent: boolean;
  /** Cold start: the saved Home shows while the session is checked. */
  checking: boolean;
  /** A first load of this view with nothing to keep on screen: one progress bar, so labelled. */
  progress: string | null;
}

/** About to read, or reading: a destination waits for its Group's read. */
const reading = (status: LoadStatus, group: LoadStatus) =>
  status === 'loading' || (status === 'idle' && group === 'loading');

/**
 * One progress cue per operation. A first load shows its placeholders and one progress bar;
 * a refresh keeps its content with the quiet status, except on the view an automatic refresh
 * or a pull started on, where that refresh is silent or shows the pull indicator.
 */
export function refreshFeedback(state: MobileSnapshot): RefreshFeedback {
  const { groups, home, detail, financial, activity } = state;
  const { expenses, balances } = financial;
  const view = shownView(state);
  const pull = state.pull === view;
  const silent = state.automatic === view;
  const checking = state.auth.status === 'restoring' && state.auth.user !== null;
  const group = state.screen === 'group';
  // Never one Month's Expenses under another Month's label.
  const listed =
    expenses.month === financial.month &&
    (expenses.status === 'ready' || expenses.summary !== null || expenses.data.length > 0);
  const first =
    state.screen === 'groups'
      ? !checking &&
        ((groups.status === 'loading' && !groups.data.length) ||
          (['idle', 'loading'].includes(home.status) && home.data === null))
      : group && !detail.data
        ? detail.status === 'loading'
        : group && state.destination === 'activity'
          ? reading(activity.status, detail.status) && !activity.events.length
          : group && state.destination === 'balances'
            ? reading(balances.status, detail.status) && balances.data === null
            : group && reading(expenses.status, detail.status) && !listed;
  const shown = group ? shownGroup(state) : null;
  const progress =
    first && !pull
      ? state.screen === 'groups'
        ? 'Loading Home'
        : !detail.data
          ? `Opening ${shown?.name ?? 'this Group'}`
          : `Loading ${state.destination === 'activity' ? 'Activity' : state.destination}`
      : null;
  const refreshing =
    state.screen === 'groups'
      ? [
          { active: groups.status === 'loading' && groups.data.length > 0, time: null },
          {
            // Unverified Home figures already carry their own "Updating" label.
            active: home.status === 'loading' && home.data !== null && !home.stale,
            time: home.refreshedAt,
          },
        ]
      : !group
        ? []
        : [
            {
              active: detail.status === 'loading' && detail.data !== null,
              time: detail.refreshedAt,
            },
            ...(state.destination === 'activity'
              ? [
                  {
                    // Older pages have their own footer; a first load shows its placeholder.
                    active: activity.status === 'loading' && activity.events.length > 0,
                    time: activity.refreshedAt,
                  },
                ]
              : state.destination === 'balances'
                ? [
                    {
                      // Unverified Balances already carry their own "Updating" label.
                      active:
                        balances.status === 'loading' && balances.data !== null && !balances.stale,
                      time: balances.refreshedAt,
                    },
                  ]
                : [
                    {
                      // Pagination has its own footer.
                      active:
                        expenses.status === 'loading' &&
                        expenses.moreStatus !== 'loading' &&
                        listed,
                      time: expenses.refreshedAt,
                    },
                  ]),
          ];
  const active = refreshing.filter((item) => item.active);
  const times = active.map((item) => item.time).filter((time): time is number => time !== null);
  return {
    pull,
    quiet: active.length > 0 && !checking && !pull && !silent,
    savedAt: checking ? home.refreshedAt : times.length ? Math.min(...times) : null,
    silent,
    checking,
    progress,
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
