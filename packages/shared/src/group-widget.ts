import { fitWidgetSections, type WidgetDimensions, type WidgetSection } from './widget-sizing';
import { widgetTextLevel } from './widget-layout';
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
function groupWidgetView(
  part: WidgetGroupPart | null | undefined,
  setup: GroupWidgetSetup,
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
      currency: string;
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
  const bucket = currencies[0];
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
    payments: own.map(({ label, amount, currency, firstName, initials, incoming, payment }) => ({
      label,
      amount,
      currency,
      firstName,
      initials,
      incoming,
      payment,
    })),
    more: null as string | null,
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

/** Dimensions are dp; text grows with Android while spacing stays fixed. */
function groupLayout(
  view: ReturnType<typeof groupWidgetView>,
  size: WidgetDimensions,
  scale: number,
) {
  const level = widgetTextLevel(scale),
    padding = 14,
    gap = 8;
  const width = Math.max(1, size.width - padding * 2),
    height = Math.max(1, size.height - padding * 2);
  const compact = size.width / Math.max(1, scale) < 240;
  let factor = 1,
    fitName = false;
  const line = (font: number) => Math.ceil(font * factor * scale * 1.3);
  const words = (value: string, font: number, room = width) => {
    const result: string[] = [];
    for (const word of value.split(/\s+/)) {
      const previous = result.at(-1);
      if (previous && (previous.length + word.length + 1) * font * factor * scale * 0.62 <= room)
        result[result.length - 1] = previous + ' ' + word;
      else result.push(word);
    }
    return result;
  };
  const make = (optional: boolean) => {
    const showSaved = optional && level === 0,
      showTile = optional && level < 2;
    const money = Math.min(
      18,
      width / Math.max(1, (view.compactAmount?.length ?? 1) * scale * 0.64),
    );
    const actionFont = compact && level === 2 ? 10 : 12;
    const actionLabel =
      view.target === 'setup'
        ? view.action
        : view.target === 'sign-in'
          ? 'Sign in'
          : view.addExpense
            ? compact && level === 2
              ? 'Add expense'
              : '＋ Add expense'
            : null;
    const actionLines = actionLabel
      ? words(actionLabel, actionFont, width - (compact && level === 2 ? 12 : 24))
      : [];
    const showStateTile = showTile && ['lost-access', 'expired', 'signed-out'].includes(view.state);
    const titleLines = view.title
      ? words(view.title, compact ? 13 : 15, width - (showStateTile ? 60 : 0))
      : [];
    const descriptionLines = words(view.description, compact ? 10 : 12);
    const nameRoom =
      width -
      (showTile ? 40 : 0) -
      (!compact && showSaved && view.saved ? view.saved.length * 9 * scale * 0.62 + 8 : 0) -
      (view.final ? 8 * 9 * scale * 0.62 + 12 : 0);
    const nameFont = fitName
      ? Math.min(13, Math.max(1, nameRoom) / Math.max(1, (view.name?.length ?? 1) * scale * 0.62))
      : 13;
    const nameLines = words(view.name ?? '', nameFont, Math.max(1, nameRoom));
    const headerHeight = view.name
      ? nameLines.length * line(nameFont) + (compact ? (showSaved ? line(9) + 3 : 0) : line(11) + 3)
      : 0;
    const balanceLabelLines = words(
      (view.compactLabel ?? '') + (view.final ? SEPARATOR + 'final' : ''),
      11,
    );
    const balanceLines = words(view.balance, 14);
    const showCurrencyOverflow = optional && level === 0 && !!view.currencyOverflow;
    const balanceHeight =
      view.name && compact
        ? view.compactAmount
          ? balanceLabelLines.length * line(11) +
            line(money) +
            4 +
            (showCurrencyOverflow ? line(10) + 4 : 0)
          : balanceLines.length * line(14)
        : 0;
    const rowHeight = level === 1 ? line(12) + line(13) + 16 : Math.max(38, line(13) + 14);
    const updateInFooter =
      !compact &&
      !!actionLabel &&
      'Open to update'.length * 11 * scale * 0.62 +
        actionLabel.length * actionFont * scale * 0.62 +
        32 <=
        width;
    const sections: WidgetSection[] = [
      ...(view.name
        ? [
            {
              id: 'header',
              rows: 1,
              rowHeight: Math.max(headerHeight, showTile ? 32 : 0),
              required: true,
            },
          ]
        : []),
      ...(balanceHeight
        ? [
            {
              id: 'balance',
              rows: 1,
              rowHeight: balanceHeight,
              required: true,
              grow: !view.payments.length,
            },
          ]
        : []),
      ...(view.title
        ? [
            {
              id: 'title',
              rows: 1,
              rowHeight: Math.max(
                titleLines.length * line(compact ? 13 : 15),
                showStateTile ? 48 : 0,
              ),
              required: true,
              grow: true,
            },
          ]
        : []),
      ...(view.state === 'loading' ? [{ id: 'loading', rows: 3, rowHeight: 24, grow: true }] : []),
      ...(view.payments.length &&
      view.payments.every((p) => p.amount.length * 13 * scale * 0.64 < width - (compact ? 40 : 100))
        ? [{ id: 'payments', rows: view.payments.length, rowHeight, inset: 8, grow: true }]
        : []),
      ...(view.hidden && level < 2
        ? [{ id: 'hidden', rows: 1, rowHeight: line(10) + 6, grow: true }]
        : []),
      ...(view.description && optional && level < 2
        ? [
            {
              id: 'description',
              rows: 1,
              rowHeight: descriptionLines.length * line(compact ? 10 : 12),
              grow: true,
            },
          ]
        : []),
      ...(view.action === 'Open to update' ? [{ id: 'update', rows: 1, rowHeight: line(11) }] : []),
      ...(actionLabel
        ? [
            {
              id: 'action',
              rows: 1,
              rowHeight: actionLines.length * line(actionFont) + 18,
              required: true,
            },
          ]
        : []),
    ];
    return {
      showSaved,
      showTile,
      showStateTile,
      nameLines,
      nameFont,
      updateInFooter,
      money,
      actionFont,
      actionLines,
      titleLines,
      descriptionLines,
      balanceLabelLines,
      balanceLines,
      showCurrencyOverflow,
      sections,
    };
  };
  let settings = make(true);
  const required = () => {
    const rows = settings.sections.filter((s) => s.required);
    return rows.reduce((sum, s) => sum + s.rowHeight, 0) + Math.max(0, rows.length - 1) * gap;
  };
  // Optional content is removed before the last resort of fitting indispensable text.
  if (required() > height) settings = make(false);
  if (required() > height) {
    fitName = true;
    settings = make(false);
  }
  while (required() > height && factor > 0.25) {
    factor *= 0.9;
    settings = make(false);
  }
  let plan = fitWidgetSections(height, settings.sections, gap);
  let paymentLines = plan.sections.find((s) => s.id === 'payments')?.rows ?? 0;
  // The existing overflow hint takes precedence over the older-copy prompt.
  if (paymentLines < view.payments.length && (paymentLines > 0 || !compact || size.width >= 280)) {
    settings.sections = settings.sections.filter((s) => s.id !== 'update');
    plan = fitWidgetSections(height, settings.sections, gap);
    paymentLines = plan.sections.find((s) => s.id === 'payments')?.rows ?? 0;
  }
  if ((paymentLines > 0 || !compact) && paymentLines < view.payments.length) {
    const action = settings.sections.find((s) => s.id === 'action');
    const extra = compact ? line(10) + 4 : 0;
    if (action) action.rowHeight += extra;
    if (!action)
      settings.sections.push({ id: 'more', rows: 1, rowHeight: line(10), required: true });
    plan = fitWidgetSections(height, settings.sections, gap);
    paymentLines = plan.sections.find((s) => s.id === 'payments')?.rows ?? 0;
    if (!paymentLines && action) action.rowHeight -= extra;
  }
  if (compact && !paymentLines && view.people && level < 2) {
    settings.sections.splice(settings.sections.length - 1, 0, {
      id: 'people',
      rows: 1,
      rowHeight: line(11),
      grow: true,
    });
    settings.sections = settings.sections.filter((s) => s.id !== 'payments');
    plan = fitWidgetSections(height, settings.sections, gap);
  }
  // If no payment can be drawn, the balance takes the spare height; the action stays at
  // the bottom rather than growing an empty area beneath its button.
  if (!paymentLines) {
    settings.sections = settings.sections.filter((s) => s.id !== 'payments');
    const balance =
      settings.sections.find((s) => s.id === 'balance') ??
      settings.sections.find((s) => s.id === 'header');
    if (balance) {
      balance.grow = true;
      plan = fitWidgetSections(height, settings.sections, gap);
    }
  }
  const present = (id: string) => plan.sections.some((s) => s.id === id);
  return {
    ...plan,
    loadingRows: Array.from(
      { length: plan.sections.find((s) => s.id === 'loading')?.rows ?? 0 },
      (_, index) => ({
        width: Math.min(width, [100, 130, 110][index]!),
        height: plan.sections.find((s) => s.id === 'loading')!.rowHeight,
      }),
    ),
    padding,
    compact,
    width,
    scale,
    paymentLines,
    showTile: settings.showTile,
    showStateTile: settings.showStateTile,
    showSaved: settings.showSaved,
    showDescription: level < 2 && (!compact || level === 0),
    showPeople: present('people'),
    showPrivacyLabel: present('hidden'),
    showMore: (paymentLines > 0 || !compact) && paymentLines < view.payments.length,
    showUpdateInFooter:
      settings.updateInFooter &&
      view.action === 'Open to update' &&
      paymentLines === view.payments.length,
    stackPayments: level === 1,
    stackHeader: level > 0,
    actionFontSize: settings.actionFont * factor,
    actionPaddingHorizontal: compact && level === 2 ? 6 : 12,
    showCurrencyOverflow: settings.showCurrencyOverflow,
    balanceLabelLines: settings.balanceLabelLines,
    balanceLines: settings.balanceLines,
    moneyFontSize: settings.money * factor,
    nameLines: settings.nameLines,
    nameFontSize: settings.nameFont * factor,
    textFactor: factor,
    actionLines: settings.actionLines,
    titleLines: settings.titleLines,
    descriptionLines: settings.descriptionLines,
  };
}

function projectGroupWidget(
  part: WidgetGroupPart | null | undefined,
  setup: GroupWidgetSetup,
  size: WidgetDimensions,
  session: WidgetSession,
  now: number,
  fontScale = 1,
) {
  let full: ReturnType<typeof groupWidgetView>;
  try {
    full = groupWidgetView(part, setup, session, now);
  } catch {
    // Damaged saved data must not prevent Android drawing the widget or erase its setup.
    full = groupWidgetView(undefined, setup, session, now);
  }
  const layout = groupLayout(full, size, fontScale);
  const limit = layout.paymentLines;
  const omitted = full.payments.slice(limit);
  const more =
    omitted.length && (size.width >= 280 || !layout.compact || limit > 0)
      ? `+${counted(omitted.length, 'more', 'more')}${SEPARATOR}${[
          ...new Set(
            omitted
              .map((p) => p.currency)
              .filter(Boolean)
              .map((code) => getCurrency(code!)?.symbol ?? code),
          ),
        ].join(', ')}`
      : null;
  return {
    ...full,
    layout,
    more,
    payments: full.payments.slice(0, limit).map((p) => ({
      ...p,
      displayLabel: layout.compact
        ? p.incoming
          ? `${p.firstName} pays you`
          : `Pay ${p.firstName}`
        : p.label,
    })),
    summary: widgetSummary([
      'Group',
      full.state === 'loading' ? 'Loading' : null,
      full.name,
      full.title,
      full.balance,
      size.width < 280 && full.currencyOverflow
        ? `${full.compactLabel} ${full.compactAmount}`
        : null,
      size.width < 280 ? full.people : null,
      // Speech keeps every saved payment, including rows omitted at this size (Large text board).
      ...spokenPayments(full.payments),
      full.hidden ? null : full.description,
      full.saved,
      full.hidden,
      full.target === 'setup' || full.muted ? full.action : null,
    ]),
  };
}

export function groupWidget(...args: Parameters<typeof projectGroupWidget>) {
  try {
    return projectGroupWidget(...args);
  } catch {
    return projectGroupWidget(undefined, args[1], args[2], args[3], args[4], args[5]);
  }
}
