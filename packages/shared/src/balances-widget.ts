import { balancesLayout } from './widget-layout';
import { widgetSummary } from './widget-accessibility';
import type { WidgetGroupPart } from './group-widget';
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
}
export type WidgetTarget =
  | 'home'
  | 'review'
  | 'sign-in'
  | 'create-group'
  | 'choose-group'
  | {
      kind: 'group' | 'settle' | 'expense';
      groupId: string;
      payment?: { from: string; to: string; currency: string };
    }
  | { kind: 'setup'; widgetId: number };
export type WidgetSession =
  | { status: 'authenticated'; accountId: string; loading: boolean }
  | { status: 'expired' }
  | { status: 'signed-out' };

import { SEPARATOR, counted } from './separator';
import { formatCurrency } from './currency';
import { toMajorAmount } from './exact-money';
export type BalancesWidgetSize = '2x1' | '2x2' | '4x2';
export interface BalancesWidgetView {
  layout: ReturnType<typeof balancesLayout>;
  summary: string;
  state: 'normal' | 'loading' | 'no-copy' | 'signed-out' | 'expired' | 'all-square' | 'no-groups';
  size: BalancesWidgetSize;
  hidden: string | null;
  saved: string | null;
  muted: boolean;
  owed: string[];
  owe: string[];
  owedOverflow: string | null;
  oweOverflow: string | null;
  review: string | null;
  footer: string | null;
  title: string | null;
  description: string | null;
  target: WidgetTarget;
}

/** Calendar boundaries use the phone's local zone; age uses elapsed time. */
export function widgetSavedTime(verifiedAt: number, now: number) {
  const saved = new Date(verifiedAt),
    today = new Date(now);
  const day = (date: Date) => `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
  if (day(saved) === day(today))
    return `Saved ${saved.getHours() % 12 || 12}:${String(saved.getMinutes()).padStart(2, '0')}`;
  const days =
    (Date.UTC(today.getFullYear(), today.getMonth(), today.getDate()) -
      Date.UTC(saved.getFullYear(), saved.getMonth(), saved.getDate())) /
    86_400_000;
  if (days > 0 && days < 7)
    return `Saved ${['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][saved.getDay()]}`;
  return `Saved ${saved.getDate()} ${['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][saved.getMonth()]}`;
}

function balancesWidgetView(
  copy: WidgetCopy | null,
  setup: { kind: 'balances'; reviewEnabled?: boolean; hideAmounts?: boolean },
  size: BalancesWidgetSize,
  session: WidgetSession,
  now: number,
  fontScale = 1,
): BalancesWidgetView {
  const view: BalancesWidgetView = {
    summary: '',
    layout: balancesLayout(size, fontScale, false),
    state: 'no-copy',
    hidden: null,
    size,
    saved: null,
    muted: false,
    owed: [],
    owe: [],
    owedOverflow: null,
    oweOverflow: null,
    review: null,
    footer: null,
    title: 'Nothing saved yet',
    description: 'Open Splitbook to load your balances.',
    target: 'home',
  };
  if (session.status === 'signed-out' || session.status === 'expired')
    return {
      ...view,
      state: session.status,
      title: session.status === 'expired' ? 'Sign in again' : 'Sign in to Splitbook',
      description: session.status === 'expired' ? 'to see balances' : 'to see your balances here',
      target: 'sign-in',
    };
  if (!copy || copy.accountId !== session.accountId || !copy.home)
    return session.loading ? { ...view, state: 'loading', title: null, description: null } : view;
  const home = copy.home;
  view.saved = widgetSavedTime(home.verifiedAt, now);
  view.muted = now - home.verifiedAt > 86_400_000;
  view.footer = view.muted
    ? 'Open to update'
    : size === '4x2'
      ? `Across ${counted(home.groupCount, 'Group')}`
      : null;
  view.review =
    setup.reviewEnabled !== false &&
    !view.muted &&
    size !== '2x1' &&
    copy.review &&
    copy.review.count > 0
      ? `To review${SEPARATOR}${copy.review.count}`
      : null;
  if (!home.groupCount)
    return {
      ...view,
      state: 'no-groups',
      title: 'No Groups yet',
      description: 'Share costs with a Group.',
      target: 'create-group',
    };
  if (home.currencies.every((row) => row.oweMinor === 0 && row.owedMinor === 0))
    return {
      ...view,
      state: 'all-square',
      title: 'You’re all square',
      description: 'Nobody owes anybody, in any currency.',
    };
  if (setup.hideAmounts) {
    const summary = (field: 'oweMinor' | 'owedMinor') => {
      const count = home.currencies.filter((row) => row[field] > 0).length;
      return count ? [`in ${counted(count, 'currency', 'currencies')}`] : [];
    };
    return {
      ...view,
      state: 'normal',
      title: null,
      description: null,
      hidden: 'Amounts hidden',
      owed: summary('owedMinor'),
      owe: summary('oweMinor'),
    };
  }
  const limit = balancesLayout(size, fontScale, true).currencyLines;
  const lines = (field: 'oweMinor' | 'owedMinor') => {
    const rows = home.currencies.filter((row) => row[field] > 0);
    const remaining = rows.length - limit;
    return {
      lines: rows
        .slice(0, limit)
        .map((row) => formatCurrency(toMajorAmount(row[field], row.currency), row.currency)),
      overflow:
        remaining > 0
          ? size === '2x1'
            ? `+${remaining}`
            : `+${counted(remaining, 'currency', 'currencies')}`
          : null,
    };
  };
  const owed = lines('owedMinor'),
    owe = lines('oweMinor');
  return {
    ...view,
    state: 'normal',
    title: null,
    description: null,
    owed: owed.lines,
    owe: owe.lines,
    owedOverflow: owed.overflow,
    oweOverflow: owe.overflow,
  };
}

/** One spoken description, kept independent of which lines fit visually. */
export function balancesWidget(...args: Parameters<typeof balancesWidgetView>): BalancesWidgetView {
  const view = balancesWidgetView(...args);
  const full = args[5] ? balancesWidgetView(args[0], args[1], args[2], args[3], args[4]) : view;
  const summary = widgetSummary([
    'Balances',
    full.title,
    full.description,
    full.owed.length ? 'You’re owed ' + full.owed.join(' and ') : null,
    full.owe.length ? 'You owe ' + full.owe.join(' and ') : null,
    full.owedOverflow ? full.owedOverflow.replace('+', '') + ' more owed' : null,
    full.oweOverflow ? full.oweOverflow.replace('+', '') + ' more owing' : null,
    full.saved,
    full.review?.replace(SEPARATOR, ' '),
    full.hidden,
    full.muted ? 'Open to update' : null,
  ]);
  return {
    ...view,
    summary,
    layout: balancesLayout(args[2], args[5] ?? 1, view.state === 'normal'),
  };
}
