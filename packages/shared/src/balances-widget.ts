import { balancesLayout, widgetTextLevel } from './widget-layout';
import { dayKeyInZone } from './zoned-calendar';
import { widgetSummary } from './widget-accessibility';
import type { WidgetGroupPart, WidgetMonthPart } from './group-widget';
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
      kind: 'group' | 'settle' | 'expense' | 'record-payment';
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
export type BalancesWidgetSize = '2x1' | '2x2' | '4x2';
export interface BalancesWidgetView {
  layout: ReturnType<typeof balancesLayout>;
  summary: string;
  compactLines: string[];
  compactFallback: string | null;
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

/** Size-independent reading shared by Overview and the original small-view contract. */
export function readWidgetBalances(
  copy: WidgetCopy | null,
  setup: { reviewEnabled?: boolean; hideAmounts?: boolean },
  session: WidgetSession,
  now: number,
) {
  const empty = {
    state: 'no-copy' as BalancesWidgetView['state'],
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

function balancesWidgetView(
  copy: WidgetCopy | null,
  setup: { kind: 'balances'; reviewEnabled?: boolean; hideAmounts?: boolean },
  size: BalancesWidgetSize,
  session: WidgetSession,
  now: number,
  fontScale = 1,
): BalancesWidgetView {
  const { groupCount, ...read } = readWidgetBalances(copy, setup, session, now);
  const layout = balancesLayout(size, fontScale, read.state === 'normal');
  const limit = layout.currencyLines;
  const overflow = (rows: string[]) =>
    !read.hidden && rows.length > limit
      ? size === '2x1'
        ? `+${rows.length - limit}`
        : `+${counted(rows.length - limit, 'currency', 'currencies')}`
      : null;
  return {
    ...read,
    layout,
    summary: '',
    compactLines: [],
    compactFallback: null,
    size,
    owed: read.owed.slice(0, limit),
    owe: read.owe.slice(0, limit),
    owedOverflow: overflow(read.owed),
    oweOverflow: overflow(read.owe),
    review: size === '2x1' ? null : read.review,
    footer: read.muted
      ? 'Open to update'
      : read.saved && size === '4x2'
        ? `Across ${counted(groupCount, 'Group')}`
        : null,
  };
}

/** One spoken description, kept independent of which lines fit visually. */
export function balancesWidget(...args: Parameters<typeof balancesWidgetView>): BalancesWidgetView {
  const view = balancesWidgetView(...args);
  const full = args[5] ? balancesWidgetView(args[0], args[1], args[2], args[3], args[4]) : view;
  const overflowSpeech = (overflow: string | null, direction: 'owed' | 'owing') => {
    if (!overflow) return null;
    const count = Number(overflow.match(/\d+/)?.[0] ?? 0);
    return `${count} more ${count === 1 ? 'currency' : 'currencies'} ${direction}`;
  };
  const summary = widgetSummary([
    'Balances',
    full.state === 'loading' ? 'Loading' : null,
    full.title,
    full.description,
    full.owed.length
      ? 'You’re owed ' +
        full.owed.join(' and ') +
        (args[2] === '2x1' && full.owedOverflow
          ? ' and ' + overflowSpeech(full.owedOverflow, 'owed')
          : '')
      : null,
    full.owe.length
      ? 'You owe ' +
        full.owe.join(' and ') +
        (args[2] === '2x1' && full.oweOverflow
          ? ' and ' + overflowSpeech(full.oweOverflow, 'owing')
          : '')
      : null,
    args[2] !== '2x1' ? overflowSpeech(full.owedOverflow, 'owed') : null,
    args[2] !== '2x1' ? overflowSpeech(full.oweOverflow, 'owing') : null,
    full.saved,
    full.review?.replace(SEPARATOR, ' '),
    full.hidden,
    full.muted ? 'Open to update' : null,
  ]);
  const level = widgetTextLevel(args[5] ?? 1);
  const compact = args[2] === '2x1' && level > 0 && view.state === 'normal';
  const lines = compact
    ? view.hidden
      ? ['You’re owed', 'You owe']
      : [`Owed ${view.owed[0] ?? '—'}`, `Owe ${view.owe[0] ?? '—'}`]
    : [];
  const tooWide = !view.hidden && lines.some((line) => line.length > (level === 2 ? 15 : 20));
  return {
    ...view,
    summary,
    compactLines: tooWide ? [] : lines,
    compactFallback: tooWide ? 'Open to see balances' : null,
    layout: balancesLayout(args[2], args[5] ?? 1, view.state === 'normal', Boolean(view.hidden)),
  };
}
