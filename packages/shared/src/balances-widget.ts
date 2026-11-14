import { dayKeyInZone } from './zoned-calendar';
import type { WidgetGroupPart, WidgetMonthPart, WidgetRecentPart } from './group-widget';
import type { GroupCategory } from './types';
/** Saved read available to the Android widget renderer, never a live balance. */
export interface WidgetCopy {
  version: 1;
  accountId: string;
  home: null | {
    verifiedAt: number;
    groupCount: number;
    currencies: { currency: string; owedMinor: number; oweMinor: number }[];
  };
  groups?: Record<string, WidgetGroupPart>;
  months?: Record<string, WidgetMonthPart>;
  /** Active Tags from Group reads already made by the app, in their read order. */
  tags?: Record<string, { verifiedAt: number; rows: { id: string; name: string }[] }>;
  recents?: Record<string, WidgetRecentPart>;
  lostGroupIds?: string[];
  savedGroups?: {
    verifiedAt: number;
    rows: {
      id: string;
      name: string;
      theme: GroupCategory;
      archived: boolean;
      members: number;
      currencies: number;
    }[];
  };
  review?: { count: number; verifiedAt: number };
  /** Only the Group identifies this phone’s unfinished entry; never its typed facts. */
  finishLater?: { groupId: string; groupName: string };
}
export type WidgetTarget =
  | 'home'
  | 'review'
  | 'sign-in'
  | 'create-group'
  | 'choose-group'
  | {
      kind: 'group' | 'settle' | 'expense' | 'record-payment' | 'expenses';
      groupId: string;
      payment?: { from: string; to: string; currency: string };
    }
  | { kind: 'expense-tag'; groupId: string; tagId: string }
  | { kind: 'setup'; widgetId: number };
export type WidgetSession =
  | { status: 'authenticated'; accountId: string; loading: boolean }
  | { status: 'expired' }
  | { status: 'signed-out' };

import { SEPARATOR, counted } from './separator';
import { formatCurrency } from './currency';
import { toMajorAmount } from './exact-money';
type WidgetBalancesState =
  | 'normal'
  | 'loading'
  | 'no-copy'
  | 'signed-out'
  | 'expired'
  | 'all-square'
  | 'no-groups';

/** Calendar boundaries use the phone's local zone; age uses elapsed time. */
export function widgetSavedTime(verifiedAt: number, now: number) {
  const zone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  const savedDay = dayKeyInZone(verifiedAt, zone);
  const today = dayKeyInZone(now, zone);
  if (savedDay === today) {
    const parts = new Intl.DateTimeFormat('en-GB', {
      timeZone: zone,
      hour: 'numeric',
      minute: '2-digit',
      hourCycle: 'h23',
    }).formatToParts(verifiedAt);
    const hour = Number(parts.find((part) => part.type === 'hour')?.value);
    const minute = parts.find((part) => part.type === 'minute')?.value;
    return `Saved ${hour % 12 || 12}:${minute}`;
  }
  const days = (Date.parse(today) - Date.parse(savedDay)) / 86_400_000;
  const saved = new Date(`${savedDay}T00:00:00Z`);
  if (days > 0 && days < 7)
    return `Saved ${['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][saved.getUTCDay()]}`;
  return `Saved ${saved.getUTCDate()} ${['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][saved.getUTCMonth()]}`;
}

/** Account, saved-time and balance reading for Overview. */
export function readWidgetBalances(
  copy: WidgetCopy | null,
  setup: { reviewEnabled?: boolean; hideAmounts?: boolean },
  session: WidgetSession,
  now: number,
) {
  const empty = {
    state: 'no-copy' as WidgetBalancesState,
    title: 'Nothing saved yet' as string | null,
    description: 'Open Splitbook to load your balances.' as string | null,
    target: 'home' as WidgetTarget,
    saved: null as string | null,
    muted: false,
    review: null as string | null,
    hidden: null as string | null,
    owed: [] as string[],
    owe: [] as string[],
    groupCount: 0,
  };
  if (session.status !== 'authenticated')
    return {
      ...empty,
      state: session.status,
      title: session.status === 'expired' ? 'Sign in again' : 'Sign in to Splitbook',
      description: session.status === 'expired' ? 'to see balances' : 'to see your balances here',
      target: 'sign-in' as const,
    };
  if (!copy || copy.accountId !== session.accountId || !copy.home)
    return session.loading
      ? { ...empty, state: 'loading' as const, title: null, description: null }
      : empty;
  const home = copy.home;
  const muted = now - home.verifiedAt > 86_400_000;
  const base = {
    ...empty,
    saved: widgetSavedTime(home.verifiedAt, now),
    muted,
    groupCount: home.groupCount,
    review:
      setup.reviewEnabled !== false && !muted && copy.review && copy.review.count > 0
        ? `To review${SEPARATOR}${copy.review.count}`
        : null,
  };
  if (!home.groupCount)
    return {
      ...base,
      state: 'no-groups' as const,
      title: 'No Groups yet',
      description: 'Share costs with a Group.',
      target: 'create-group' as const,
    };
  if (home.currencies.every((row) => row.oweMinor === 0 && row.owedMinor === 0))
    return {
      ...base,
      state: 'all-square' as const,
      title: 'You’re all square',
      description: 'Nobody owes anybody, in any currency.',
    };
  const lines = (field: 'owedMinor' | 'oweMinor') => {
    const rows = home.currencies.filter((row) => row[field] > 0);
    return setup.hideAmounts
      ? rows.length
        ? [`in ${counted(rows.length, 'currency', 'currencies')}`]
        : []
      : rows.map((row) => formatCurrency(toMajorAmount(row[field], row.currency), row.currency));
  };
  return {
    ...base,
    state: 'normal' as const,
    title: null,
    description: null,
    hidden: setup.hideAmounts ? 'Amounts hidden' : null,
    owed: lines('owedMinor'),
    owe: lines('oweMinor'),
  };
}
