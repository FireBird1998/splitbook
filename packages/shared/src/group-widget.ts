import { groupLayout } from './widget-layout';
import { widgetSummary } from './widget-accessibility';
import { formatCurrency, getCurrency } from './currency';
import { toMajorAmount } from './exact-money';
import { counted, SEPARATOR } from './separator';
import { widgetSavedTime, type WidgetSession } from './balances-widget';
import type { GroupCategory } from './types';
export interface GroupWidgetSetup {
  kind: 'group';
  hideAmounts?: boolean;
  widgetId: number;
  accountId: string;
  groupId: string;
}
export interface WidgetGroupPart {
  id: string;
  name: string;
  theme: GroupCategory;
  archived: boolean;
  mainCurrency: string;
  verifiedAt: number;
  balancesVerifiedAt: number;
  currencies: {
    currency: string;
    balanceMinor: number;
    payments: {
      from: string | null;
      to: string | null;
      fromName: string;
      toName: string;
      fromInitials?: string;
      toInitials?: string;
      amountMinor: number;
    }[];
  }[];
}
export type GroupWidgetSize = '2x2' | '4x2' | '4x3';
function groupWidgetView(
  part: WidgetGroupPart | null | undefined,
  setup: GroupWidgetSetup,
  size: GroupWidgetSize,
  session: WidgetSession,
  now: number,
  fontScale = 1,
) {
  const empty = {
    state: 'no-copy',
    hidden: null as string | null,
    name: null as string | null,
    theme: null as GroupCategory | null,
    balance: '',
    compactLabel: null as string | null,
    compactAmount: null as string | null,
    currencyOverflow: null as string | null,
    payments: [] as {
      label: string;
      amount: string;
      firstName: string;
      initials: string;
      incoming: boolean;
      payment: { from: string; to: string; currency: string } | null;
    }[],
    balanceTone: 'neutral' as 'neutral' | 'positive' | 'negative',
    more: null as string | null,
    people: null as string | null,
    addExpense: false,
    saved: null as string | null,
    muted: false,
    final: false,
    title: 'Nothing saved yet' as string | null,
    description: 'Open Splitbook to load this Group.',
    action: null as string | null,
    target: 'group' as 'group' | 'setup' | 'sign-in',
  };
  if (session.status !== 'authenticated')
    return {
      ...empty,
      state: session.status,
      title: session.status === 'expired' ? 'Sign in again' : 'Sign in to Splitbook',
      description:
        session.status === 'expired'
          ? 'to see this Group. It comes back once you do.'
          : 'to see your Group here',
      action: 'Sign in',
      target: 'sign-in' as const,
    };
  if (session.accountId !== setup.accountId)
    return {
      ...empty,
      state: 'other-account',
      title: 'Set up this widget again',
      description: 'This phone is signed in to another account.',
      action: 'Set up',
      target: 'setup' as const,
    };
  if (part === null)
    return {
      ...empty,
      state: 'lost-access',
      title: 'You’re no longer in this Group',
      description: 'Its saved copy was removed from this phone.',
      action: 'Choose another Group',
      target: 'setup' as const,
    };
  if (!part)
    return {
      ...empty,
      state: session.loading ? 'loading' : 'no-copy',
      title: session.loading ? null : empty.title,
    };
  const currencies = [...part.currencies].sort(
    (a, b) => Number(b.currency === part.mainCurrency) - Number(a.currency === part.mainCurrency),
  );
  const ownPayments = currencies.flatMap((bucket) =>
    bucket.payments.filter(
      (payment) => payment.from === setup.accountId || payment.to === setup.accountId,
    ),
  );
  const hiddenSummary = () => {
    const owe = new Set(ownPayments.filter((p) => p.from === setup.accountId).map((p) => p.to))
      .size;
    const owed = new Set(ownPayments.filter((p) => p.to === setup.accountId).map((p) => p.from))
      .size;
    return (
      [
        owe ? `You owe ${counted(owe, 'person', 'people')}` : null,
        owed ? `You’re owed by ${counted(owed, 'person', 'people')}` : null,
      ]
        .filter(Boolean)
        .join(SEPARATOR) || 'Balances hidden'
    );
  };
  const own = (setup.hideAmounts ? [] : currencies).flatMap((bucket) =>
    bucket.payments
      .filter((payment) => payment.from === setup.accountId || payment.to === setup.accountId)
      .map((payment) => {
        const outgoing = payment.from === setup.accountId;
        const firstName = (outgoing ? payment.toName : payment.fromName).trim().split(/\s+/)[0];
        const storedInitials = outgoing ? payment.toInitials : payment.fromInitials;
        return {
          label: outgoing ? `You pay ${firstName}` : `${firstName} pays you`,
          amount: formatCurrency(
            toMajorAmount(payment.amountMinor, bucket.currency),
            bucket.currency,
          ),
          firstName,
          // Older copies contain only the first name; the next read adds the app's initials.
          initials:
            typeof storedInitials === 'string' && storedInitials
              ? storedInitials
              : firstName.slice(0, 1).toUpperCase(),
          currency: bucket.currency,
          incoming: payment.to === setup.accountId,
          payment:
            payment.from && payment.to
              ? { from: payment.from, to: payment.to, currency: bucket.currency }
              : null,
          person: outgoing ? payment.to : payment.from,
        };
      }),
  );
  const bucket = currencies[0],
    limit = groupLayout(size, fontScale).paymentLines;
  const allSquare = currencies.every((bucket) => bucket.balanceMinor === 0);
  const age = Math.min(part.verifiedAt, part.balancesVerifiedAt),
    muted = now - age > 86400000;
  const balanceText = allSquare
    ? 'You’re all square'
    : setup.hideAmounts
      ? hiddenSummary()
      : currencies.length > 1
        ? `In ${counted(currencies.length, 'currency', 'currencies')}`
        : `${bucket!.balanceMinor < 0 ? 'You owe' : 'You’re owed'} ${formatCurrency(toMajorAmount(Math.abs(bucket!.balanceMinor), bucket!.currency), bucket!.currency)}`;
  return {
    ...empty,
    state: part.archived ? 'archived' : allSquare ? 'all-square' : 'normal',
    name: part.name,
    hidden: setup.hideAmounts ? 'Amounts and names hidden' : null,
    theme: part.theme,
    compactLabel:
      bucket && !allSquare && !setup.hideAmounts
        ? bucket.balanceMinor < 0
          ? 'You owe'
          : 'You’re owed'
        : null,
    compactAmount:
      bucket && !allSquare && !setup.hideAmounts
        ? formatCurrency(
            toMajorAmount(Math.abs(bucket.balanceMinor), bucket.currency),
            bucket.currency,
          )
        : null,
    currencyOverflow:
      !setup.hideAmounts && currencies.length > 1
        ? `+${counted(currencies.length - 1, 'currency', 'currencies')}`
        : null,
    balanceTone: (currencies.length > 1
      ? 'neutral'
      : bucket && bucket.balanceMinor < 0
        ? 'negative'
        : 'positive') as 'neutral' | 'negative' | 'positive',
    title: null,
    description: allSquare
      ? `You’re all square in ${part.name}.`
      : part.archived
        ? 'Nothing more can be saved here.'
        : '',
    balance: balanceText + (part.archived ? `${SEPARATOR}final` : ''),
    payments: own
      .slice(0, limit)
      .map(({ label, amount, firstName, initials, incoming, payment }) => ({
        label,
        amount,
        firstName,
        initials,
        incoming,
        payment,
      })),
    more:
      size !== '2x2' && own.length > limit
        ? `+${counted(own.length - limit, 'more', 'more')}${SEPARATOR}${[...new Set(own.slice(limit).map((p) => getCurrency(p.currency)?.symbol ?? p.currency))].join(', ')}`
        : null,
    people: own.length
      ? `${bucket?.balanceMinor && bucket.balanceMinor < 0 ? 'to' : 'from'} ${counted(new Set(own.map((p) => p.person)).size, 'person', 'people')}`
      : null,
    addExpense: !part.archived,
    saved: widgetSavedTime(age, now),
    muted,
    final: part.archived,
    action: muted ? 'Open to update' : null,
  };
}

/**
 * TalkBack labels for the visible payment rows. When two rows share a first name and their
 * stored initials differ, each name gains its second initial ("You pay Priya S"), so speech
 * tells them apart the way the avatars do. Old copies without initials keep first names only.
 */
function spokenPayments(payments: ReturnType<typeof groupWidgetView>['payments']) {
  const byName = new Map<string, string[]>();
  for (const p of payments)
    byName.set(p.firstName, [...(byName.get(p.firstName) ?? []), p.initials]);
  return payments.map((p) => {
    const shared = byName.get(p.firstName)!;
    const distinct =
      shared.length > 1 &&
      p.initials.length > 1 &&
      shared.filter((initials) => initials === p.initials).length === 1;
    const name = distinct ? `${p.firstName} ${p.initials.slice(1, 2)}` : p.firstName;
    return `${p.incoming ? `${name} pays you` : `You pay ${name}`} ${p.amount}`;
  });
}

function groupWidgetProjection(...args: Parameters<typeof groupWidgetView>) {
  const view = groupWidgetView(...args);
  const full = args[5] ? groupWidgetView(args[0], args[1], args[2], args[3], args[4]) : view;
  return {
    ...view,
    layout: groupLayout(args[2], args[5] ?? 1),
    summary: widgetSummary([
      'Group',
      full.state === 'loading' ? 'Loading' : null,
      full.name,
      full.title,
      full.balance,
      args[2] === '2x2' && full.currencyOverflow
        ? `${full.compactLabel} ${full.compactAmount}`
        : null,
      args[2] === '2x2' ? full.people : null,
      ...spokenPayments(full.payments),
      full.more,
      full.hidden ? null : full.description,
      full.saved,
      full.hidden,
      full.target === 'setup' || full.muted ? full.action : null,
    ]),
  };
}

export function groupWidget(...args: Parameters<typeof groupWidgetView>) {
  try {
    return groupWidgetProjection(...args);
  } catch {
    // Damaged saved data must not prevent Android drawing the widget or erase its setup.
    return groupWidgetProjection(undefined, args[1], args[2], args[3], args[4], args[5]);
  }
}
