import { shownGroup, shownView } from '../data/mobile-controller';
import type { LoadStatus, MobileSnapshot } from '../data/types';

export interface RefreshFeedback {
  /** The native pull indicator: only while a pull that started on this view runs. */
  pull: boolean;
  /**
   * Visible content is re-read or retried: Home's top bar says so, and in a Group the progress
   * bar under its top bar does (Activity's slot also reads "Saved hh:mm · refreshing", until
   * #222). Neither gives a time: what is shown says itself when it was read, "Saved" only for
   * this device's copy (#332, #219).
   */
  quiet: boolean;
  /** An automatic refresh of this view is running: nothing says so, not even an updating label. */
  silent: boolean;
  /** Cold start: the saved Home shows while the session is checked. */
  checking: boolean;
  /**
   * The one progress bar under the top bar, so labelled: a first load with nothing to keep on
   * screen, a Group's quiet refresh, which leaves its top bar intact, or the cold-start session
   * check under the saved Home (#335).
   */
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
  // A list read empty is loaded: refreshing it is no first load. Activity was read once it
  // has a page.
  const first =
    state.screen === 'groups'
      ? !checking &&
        ((groups.status === 'loading' && !groups.loaded) ||
          (['idle', 'loading'].includes(home.status) && home.data === null))
      : group && !detail.data
        ? detail.status === 'loading'
        : group && state.destination === 'activity'
          ? reading(activity.status, detail.status) && activity.pagination === null
          : group && state.destination === 'balances'
            ? reading(balances.status, detail.status) && balances.data === null
            : group && reading(expenses.status, detail.status) && !listed;
  const shown = group ? shownGroup(state) : null;
  // An automatic refresh says nothing, even of a view it reads for the first time.
  const progress =
    first && !pull && !silent
      ? state.screen === 'groups'
        ? 'Loading Home'
        : !detail.data
          ? `Opening ${shown?.name ?? 'this Group'}`
          : `Loading ${state.destination === 'activity' ? 'Activity' : state.destination}`
      : null;
  // Figures read again after a change, as after a Group's Expenses were read, keep their place
  // and their time like any others: this cue is what says they're being read (#219).
  const refreshing =
    state.screen === 'groups'
      ? [
          groups.status === 'loading' && groups.loaded,
          home.status === 'loading' && home.data !== null,
        ]
      : !group
        ? []
        : [
            detail.status === 'loading' && detail.data !== null,
            state.destination === 'activity'
              ? // Older pages have their own footer; a first load shows its placeholder.
                activity.status === 'loading' && activity.pagination !== null
              : state.destination === 'balances'
                ? balances.status === 'loading' && balances.data !== null
                : // Pagination has its own footer.
                  expenses.status === 'loading' && expenses.moreStatus !== 'loading' && listed,
          ];
  const quiet = refreshing.some(Boolean) && !checking && !pull && !silent;
  return {
    pull,
    quiet,
    silent,
    checking,
    progress: checking
      ? 'Checking your session'
      : (progress ?? (group && quiet ? 'Refreshing' : null)),
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
