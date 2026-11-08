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
      .map((payment) => ({
        label:
          payment.from === setup.accountId
            ? `You pay ${payment.toName.trim().split(/\s+/)[0]}`
            : `${payment.fromName.trim().split(/\s+/)[0]} pays you`,
        amount: formatCurrency(
          toMajorAmount(payment.amountMinor, bucket.currency),
          bucket.currency,
        ),
        firstName: (payment.from === setup.accountId ? payment.toName : payment.fromName)
          .trim()
          .split(/\s+/)[0],
        initials: (payment.from === setup.accountId ? payment.toName : payment.fromName)
          .trim()
          .split(/\s+/)
          .slice(0, 2)
          .map((word) => word[0] ?? '')
          .join('')
          .toUpperCase(),
        currency: bucket.currency,
        incoming: payment.to === setup.accountId,
        payment:
          payment.from && payment.to
            ? { from: payment.from, to: payment.to, currency: bucket.currency }
            : null,
        person: payment.from === setup.accountId ? payment.to : payment.from,
      })),
  );
  const bucket = currencies[0],
    limit = size === '2x2' ? 0 : size === '4x3' ? 4 : 2;
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
      limit && own.length > limit
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

export function groupWidget(...args: Parameters<typeof groupWidgetView>) {
  const view = groupWidgetView(...args);
  return {
    ...view,
    summary: widgetSummary([
      'Group',
      view.hidden ? null : view.name,
      view.title,
      view.balance,
      ...view.payments.map((p) => p.label + ' ' + p.amount),
      view.hidden ? null : view.description,
      view.saved,
      view.hidden,
      view.target === 'setup' || view.muted ? view.action : null,
    ]),
  };
}
