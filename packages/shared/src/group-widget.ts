import {
  fitWidgetLayout,
  fitWidgetSections,
  widgetText,
  type WidgetDimensions,
  type WidgetSection,
} from './widget-sizing';
import { widgetTextLevel } from './widget-layout';
import { widgetSummary } from './widget-accessibility';
import { formatCurrency, getCurrency } from './currency';
import { displayMajorAmount, toMajorAmount } from './exact-money';
import { counted, SEPARATOR } from './separator';
import { widgetSavedTime, type WidgetSession } from './balances-widget';
import type { GroupCategory } from './types';
import { dayCount } from './trip-summary';
import { dayKeyInZone, monthKeyInZone } from './zoned-calendar';
export interface GroupWidgetSetup {
  kind: 'group';
  hideAmounts?: boolean;
  widgetId: number;
  accountId: string;
  groupId: string;
}
export interface WidgetMonthPart {
  month: string;
  verifiedAt: number;
  count: number;
  mainCurrency: string;
  mainCurrencyOnly: boolean;
  totals: { currency: string; totalMinor: number }[];
  shareMinor?: number;
}

export interface WidgetGroupPart {
  id: string;
  name: string;
  theme: GroupCategory;
  archived: boolean;
  mainCurrency: string;
  verifiedAt: number;
  balancesVerifiedAt: number;
  /** Calendar days from the Group read. Absent in copies saved before Trip day support. */
  tripDates?: { start: string | null; end: string | null };
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
function tripDay(part: WidgetGroupPart, now: number): string | null {
  const start = part.tripDates?.start;
  const end = part.tripDates?.end;
  const today = dayKeyInZone(now, Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC');
  if (part.theme !== 'trip' || !start || !end || today < start || today > end) return null;
  try {
    return `Day ${dayCount(start, today)} of ${dayCount(start, end)}`;
  } catch {
    return null;
  }
}

function monthWidgetView(month: WidgetMonthPart | undefined, setup: GroupWidgetSetup, now: number) {
  const empty = {
    totals: [] as string[],
    share: null as string | null,
    mainCurrencyOnly: null as string | null,
    count: null as string | null,
    saved: null as string | null,
    prompt: 'Open the Group to update' as string | null,
    more: null as string | null,
  };
  const savedMonth =
    month?.month === monthKeyInZone(now, Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC')
      ? month
      : undefined;
  if (!savedMonth) return empty;
  try {
    return {
      totals: setup.hideAmounts
        ? []
        : [...savedMonth.totals]
            .sort(
              (a, b) =>
                Number(b.currency === savedMonth.mainCurrency) -
                Number(a.currency === savedMonth.mainCurrency),
            )
            .map((row) =>
              formatCurrency(displayMajorAmount(row.totalMinor, row.currency), row.currency),
            ),
      share:
        !setup.hideAmounts && savedMonth.shareMinor !== undefined
          ? formatCurrency(
              toMajorAmount(savedMonth.shareMinor, savedMonth.mainCurrency),
              savedMonth.mainCurrency,
            )
          : null,
      mainCurrencyOnly:
        !setup.hideAmounts && savedMonth.shareMinor !== undefined && savedMonth.mainCurrencyOnly
          ? 'Main currency only'
          : null,
      count: setup.hideAmounts ? `${counted(savedMonth.count, 'Expense')} this Month` : null,
      saved: widgetSavedTime(savedMonth.verifiedAt, now),
      prompt: null,
      more: null as string | null,
    };
  } catch {
    return empty;
  }
}

function groupWidgetView(
  part: WidgetGroupPart | null | undefined,
  setup: GroupWidgetSetup,
  session: WidgetSession,
  now: number,
  month?: WidgetMonthPart,
) {
  const empty = {
    state: 'no-copy',
    month: null as null | {
      totals: string[];
      share: string | null;
      mainCurrencyOnly: string | null;
      count: string | null;
      saved: string | null;
      prompt: string | null;
      more: string | null;
    },
    hidden: null as string | null,
    name: null as string | null,
    tripDay: null as string | null,
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
  const monthView = monthWidgetView(month, setup, now);
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
    month: monthView,
    tripDay: tripDay(part, now),
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

function paymentOverflow(payments: ReturnType<typeof groupWidgetView>['payments']) {
  return `+${counted(payments.length, 'more', 'more')}${SEPARATOR}${[
    ...new Set(payments.map((p) => getCurrency(p.currency)?.symbol ?? p.currency)),
  ].join(', ')}`;
}

/** Dimensions are dp. Native density keeps every allocated edge on a physical pixel. */
function groupLayout(
  view: ReturnType<typeof groupWidgetView>,
  size: WidgetDimensions,
  scale: number,
) {
  scale = Number.isFinite(scale) && scale > 0 ? scale : 1;
  const level = widgetTextLevel(scale);
  const narrow = size.width <= 140;
  const tiny = narrow && size.height <= 160;
  const ratio =
    size.pixelRatio && Number.isFinite(size.pixelRatio) && size.pixelRatio > 0
      ? size.pixelRatio
      : 1;
  const pixels = (dp: number) => Math.ceil(dp * ratio - 1e-9) / ratio;
  // Even the declaration's 110 dp minimum keeps the complete balance at 10 sp.
  const minimumMoneyWidth = widgetText(size.width, scale).width(view.compactAmount ?? '', 10, true);
  const padding = narrow
    ? Math.floor(
        Math.min(8, Math.max(0, Math.floor((size.width - minimumMoneyWidth) / 2))) * ratio,
      ) / ratio
    : pixels(14);
  const paddingVertical = narrow ? pixels(8) : padding;
  const cornerRadius = narrow ? 12 : 24;
  const width = Math.max(1, Math.floor(size.width * ratio) / ratio - padding * 2);
  const height = Math.max(0, Math.floor(size.height * ratio) / ratio - paddingVertical * 2);
  const compact = size.width / Math.max(1, scale) < 240;
  const gap = tiny ? 4 : 8;
  const settings = fitWidgetLayout(
    { width, height, pixelRatio: ratio },
    scale,
    (text, optional) => {
      const showSaved = optional && level === 0 && !tiny;
      const showTile = optional && level < 2 && !tiny;
      const showArchivedTag = view.final && !tiny;
      const stackHeader = showArchivedTag && level > 0;
      const money = text.fit(view.compactAmount ?? '', 18, width, true);
      const actionFont = compact && level === 2 ? 10 : 12;
      const actionLabel =
        tiny || (!optional && !(compact && level === 2 && !narrow))
          ? null
          : view.target === 'setup'
            ? view.action
            : view.target === 'sign-in'
              ? 'Sign in'
              : view.addExpense
                ? compact && level === 2
                  ? 'Add expense'
                  : '＋ Add expense'
                : null;
      const actionPadding = compact && level === 2 ? 6 : 12;
      const actionLines = actionLabel
        ? text.words(actionLabel, actionFont, width - actionPadding * 2)
        : [];
      const showStateTile =
        showTile && ['lost-access', 'expired', 'signed-out'].includes(view.state);
      const titleFont = tiny ? 10 : compact ? 13 : 15;
      const smallTitles: Record<string, string> = {
        'signed-out': 'Sign in to Splitbook',
        expired: 'Sign in again',
        'other-account': 'Set up again',
        'lost-access': 'Group unavailable',
        'no-copy': 'Nothing saved yet',
      };
      const titleLines = view.title
        ? text.words(
            tiny ? (smallTitles[view.state] ?? view.title) : view.title,
            titleFont,
            width - (showStateTile ? 60 : 0),
          )
        : [];
      const descriptionFont = compact ? 10 : 12;
      const descriptionLines = text.words(view.description, descriptionFont);
      const showTripDay =
        optional &&
        level === 0 &&
        !compact &&
        !!view.tripDay &&
        width -
          (showTile ? 40 : 0) -
          (showSaved && view.saved ? text.width(view.saved, 9) + 8 : 0) -
          text.width(view.tripDay, 11) -
          22 >=
          100;
      const nameRoom =
        width -
        (showTile ? 40 : 0) -
        (!compact && showSaved && view.saved ? text.width(view.saved, 9) + 8 : 0) -
        (showArchivedTag && !stackHeader ? text.width('Archived', 9) + 12 : 0) -
        (showTripDay ? text.width(view.tripDay!, 11) + 22 : 0);
      const name = view.name ?? '';
      const nameFont = text.fit(
        name.split(/\s+/).sort((a, b) => text.width(b, 13) - text.width(a, 13))[0] ?? '',
        13,
        nameRoom,
      );
      const wrappedName =
        tiny || name.split(/\s+/).some((word) => text.width(word, nameFont) > nameRoom)
          ? [name]
          : text.words(name, nameFont, nameRoom);
      const nameLines =
        wrappedName.length > 2 ? [wrappedName[0], wrappedName.slice(1).join(' ')] : wrappedName;
      const balanceFont = tiny ? 10 : 14;
      const balanceLabelLines = text.words(
        tiny && view.final
          ? 'Final'
          : (view.compactLabel ?? '') + (view.final ? SEPARATOR + 'final' : ''),
        11,
      );
      const balanceLines = text.words(
        tiny
          ? view.hidden
            ? 'Balances hidden'
            : view.state === 'all-square'
              ? 'All square'
              : view.balance
          : view.balance,
        balanceFont,
      );
      const showCurrencyOverflow = optional && level === 0 && !tiny && !!view.currencyOverflow;
      const headerHeight =
        Math.max(nameLines.length * text.line(nameFont), showTripDay ? text.line(11) + 6 : 0) +
        (stackHeader ? text.line(9) + 12 : 0) +
        (compact ? (showSaved ? text.line(9) + 3 : 0) : text.line(11) + 3);
      const balanceHeight =
        view.name && compact
          ? view.compactAmount
            ? balanceLabelLines.length * text.line(11) +
              text.line(money) +
              4 +
              (showCurrencyOverflow ? text.line(10) + 4 : 0)
            : balanceLines.length * text.line(balanceFont)
          : 0;
      const label = (p: (typeof view.payments)[number]) =>
        compact ? (p.incoming ? `From ${p.firstName}` : `Pay ${p.firstName}`) : p.label;
      const rowWidth = width - (compact ? 0 : 14 + 2 * 8 + 10 + text.width('WW', 10));
      const paymentFont = compact
        ? Math.min(
            13,
            ...view.payments.map((p) =>
              text.fit(label(p), 13, rowWidth - text.width(p.amount, 13, true) - 8),
            ),
          )
        : 12;
      const stackPayments = view.payments.some(
        (p) => text.width(label(p), paymentFont) + text.width(p.amount, 13, true) + 8 > rowWidth,
      );
      const rowHeight = Math.max(
        (compact ? 28 : 38) * scale * text.factor,
        (stackPayments ? text.line(paymentFont) + text.line(13) + 2 : text.line(13)) + pixels(1),
      );
      const paymentFits = view.payments.every((p) => text.width(p.amount, 13, true) <= rowWidth);
      const updateInFooter =
        !compact &&
        !!actionLabel &&
        text.width('Open to update', 11) + text.width(actionLabel, actionFont) + 32 <= width;
      const moreInFooter =
        !compact &&
        !!actionLabel &&
        text.width(paymentOverflow(view.payments), 10) + text.width(actionLabel, actionFont) + 32 <=
          width;
      const monthEligible = !!view.month && optional && level === 0 && !tiny;
      const sectionLabelHeight = text.line(11) + 4;
      const monthPanelPadding = compact ? 0 : 8;
      const monthColumnWidth = (compact ? width : (width - 8) / 2) - monthPanelPadding * 2;
      const monthAmountFont = monthEligible
        ? text.fit(
            [...(view.month?.totals ?? []), view.month?.share ?? ''].sort(
              (a, b) => text.width(b, 15, true) - text.width(a, 15, true),
            )[0] ?? '',
            15,
            monthColumnWidth,
            true,
          )
        : 15;
      const monthNoteLines = text.words(view.month?.mainCurrencyOnly ?? '', 10, monthColumnWidth);
      const monthPromptLines = text.words(view.month?.prompt ?? view.month?.count ?? '', 11);
      const spentHeight = view.month?.totals.length
        ? monthPanelPadding * 2 +
          text.line(11) +
          4 +
          view.month.totals.length * text.line(monthAmountFont)
        : 0;
      const shareHeight = view.month?.share
        ? monthPanelPadding * 2 +
          text.line(11) +
          4 +
          text.line(monthAmountFont) +
          (monthNoteLines.length ? 4 + monthNoteLines.length * text.line(10) : 0)
        : 0;
      const monthTextHeight = monthPromptLines.length * text.line(11);
      const monthHeading = view.hidden ? 0 : sectionLabelHeight;
      const monthSpendingLabel = view.month?.totals.length
        ? monthPanelPadding * 2 + text.line(11) + 4
        : 0;
      const monthInset =
        monthHeading +
        monthSpendingLabel +
        (compact ? shareHeight + (spentHeight && shareHeight ? 8 : 0) : 0);
      const monthRows = view.month?.totals.length || 1;
      const monthMoreHeight =
        Math.max(
          text.words(`+${counted(monthRows, 'more', 'more')}`, 10, monthColumnWidth).length,
          text.words(`In ${counted(monthRows, 'currency', 'currencies')}`, 10, monthColumnWidth)
            .length,
        ) *
          text.line(10) +
        4;
      const monthSection: WidgetSection = {
        id: 'month',
        ...(view.payments.length
          ? compact
            ? { whenComplete: 'payments' }
            : { afterRows: { id: 'payments', rows: view.payments.length } }
          : {}),
        rows: monthRows,
        rowHeight: view.month?.totals.length ? text.line(monthAmountFont) : monthTextHeight,
        inset: monthInset,
        minHeight: view.month?.totals.length
          ? compact
            ? monthInset + monthMoreHeight
            : monthHeading + Math.max(shareHeight, monthSpendingLabel + monthMoreHeight)
          : view.hidden
            ? 0
            : monthHeading + text.line(11) + 4 + text.line(monthAmountFont),
        ...(view.month?.totals.length ? { moreHeight: monthMoreHeight } : {}),
      };
      let showSectionLabels = monthEligible && !view.hidden;
      let sections: WidgetSection[] = [
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
          ? [{ id: 'balance', rows: 1, rowHeight: balanceHeight, required: true }]
          : []),
        ...(view.title
          ? [
              {
                id: 'title',
                rows: 1,
                rowHeight: Math.max(
                  titleLines.length * text.line(titleFont),
                  showStateTile ? 48 : 0,
                ),
                required: true,
              },
            ]
          : []),
        ...(view.state === 'loading'
          ? [{ id: 'loading', rows: 3, rowHeight: 24, grow: true }]
          : []),
        ...(!tiny && view.payments.length
          ? [
              {
                id: 'payments',
                rows: view.payments.length,
                maxRows: paymentFits ? view.payments.length : 0,
                rowHeight,
                inset: (compact ? 0 : pixels(4) * 2) + (showSectionLabels ? sectionLabelHeight : 0),
                moreHeight: moreInFooter
                  ? 0
                  : Math.max(
                      text.words(paymentOverflow(view.payments), 10).length,
                      text.words(view.people ?? '', 10).length,
                    ) *
                      text.line(10) +
                    4,
                grow: true,
              },
            ]
          : []),
        ...(view.description && optional && level < 2 && !tiny
          ? [
              {
                id: 'description',
                rows: 1,
                rowHeight: descriptionLines.length * text.line(descriptionFont),
              },
            ]
          : []),
        // #1187 inserts opt-in Recent between Payments and This Month.
        ...(monthEligible ? [monthSection] : []),
        ...(view.hidden && level < 2 && !tiny
          ? [{ id: 'hidden', rows: 1, rowHeight: text.line(10) + 6 }]
          : []),
        ...(view.action === 'Open to update' && !updateInFooter && !tiny
          ? [
              {
                id: 'update',
                rows: 1,
                rowHeight: text.line(11),
                ...(view.payments.length ? { whenComplete: 'payments' } : {}),
              },
            ]
          : []),
        // Messages are fixed blocks. Only list rows (or this space below a message) grow.
        ...(!view.payments.length && view.state !== 'loading'
          ? [{ id: 'space', rows: 1, rowHeight: 0, required: true, grow: true }]
          : []),
        ...(actionLabel
          ? [
              {
                id: 'action',
                rows: 1,
                rowHeight: actionLines.length * text.line(actionFont) + 18,
                required: true,
              },
            ]
          : []),
      ];
      // Labels exist only when a second information section is admitted. A probe with the
      // shared rule reserves both labels together, then removes that reservation if Month loses.
      if (
        showSectionLabels &&
        !fitWidgetSections(height, sections, gap, ratio).sections.some(
          (section) => section.id === 'month',
        )
      ) {
        showSectionLabels = false;
        sections = sections
          .filter((section) => section.id !== 'month')
          .map((section) =>
            section.id === 'payments'
              ? { ...section, inset: (section.inset ?? 0) - sectionLabelHeight }
              : section,
          );
      }
      return {
        sections,
        showSectionLabels,
        sectionLabelHeight,
        monthAmountFontSize: text.font(monthAmountFont),
        monthColumnWidth,
        monthPanelPadding,
        monthNoteLines,
        monthPromptLines,
        monthColumnGap: compact ? (spentHeight && shareHeight ? 8 : 0) : 8,
        fontSizes: {
          caption: text.font(9),
          small: text.font(10),
          secondary: text.font(11),
          body: text.font(12),
          paymentAmount: text.font(13),
        },
        showSaved,
        tripDay: showTripDay ? view.tripDay : null,
        showTile,
        showStateTile,
        showArchivedTag,
        stackHeader,
        nameLines,
        nameFontSize: text.font(nameFont),
        moneyFontSize: text.font(money),
        actionFontSize: text.font(actionFont),
        actionPaddingHorizontal: actionPadding,
        actionLines,
        titleLines,
        titleFontSize: text.font(titleFont),
        balanceFontSize: text.font(balanceFont),
        balanceLabelLines,
        balanceLines,
        descriptionLines,
        showCurrencyOverflow,
        stackPayments,
        paymentFontSize: text.font(paymentFont),
        moreInFooter,
        updateInFooter,
      };
    },
    gap,
  );
  const payments = settings.sections.find((s) => s.id === 'payments');
  const monthSection = settings.sections.find((s) => s.id === 'month');
  const monthMore = monthSection?.more
    ? monthSection.rows
      ? `+${counted(monthSection.more, 'more', 'more')}`
      : `In ${counted(view.month?.totals.length ?? 0, 'currency', 'currencies')}`
    : null;
  const more = payments?.more
    ? payments.rows
      ? paymentOverflow(view.payments.slice(payments.rows))
      : (view.people ?? '')
    : '';
  const text = widgetText(width, scale, 1, ratio);
  const moreLines = more
    ? text.width(more, settings.fontSizes.small) <= width
      ? [more]
      : text.words(more, settings.fontSizes.small)
    : [];
  return {
    ...settings,
    padding,
    paddingVertical,
    cornerRadius,
    width,
    compact,
    scale,
    paymentPadding: compact ? 0 : pixels(4),
    monthRows: monthSection?.rows ?? 0,
    monthCardHeight:
      !compact && monthSection
        ? monthSection.height - (view.hidden ? 0 : settings.sectionLabelHeight)
        : undefined,
    monthMore,
    monthMoreLines: monthMore
      ? text.words(monthMore, settings.fontSizes.small, settings.monthColumnWidth)
      : [],
    paymentLabel: settings.showSectionLabels && payments?.rows ? 'PAYMENTS' : null,
    paymentPanelHeight: payments
      ? payments.height -
        (settings.showSectionLabels && payments.rows ? settings.sectionLabelHeight : 0)
      : 0,
    monthLabel: view.hidden ? null : 'THIS MONTH',
    monthSaved: view.hidden ? null : view.month?.saved,
    paymentRows: Array.from({ length: payments?.rows ?? 0 }, (_, i) => ({
      height: payments!.rowHeight,
      contentHeight: payments!.rowHeight - (i ? pixels(1) : 0),
      dividerHeight: i ? pixels(1) : 0,
    })),
    paymentLines: payments?.rows ?? 0,
    moreLines,
    showMore: !!payments?.more,
    showUpdateInFooter:
      settings.updateInFooter && !payments?.more && view.action === 'Open to update',
    showPrivacyLabel: settings.sections.some((s) => s.id === 'hidden'),
    loadingRows: Array.from(
      { length: settings.sections.find((s) => s.id === 'loading')?.rows ?? 0 },
      (_, index) => ({
        width: Math.min(width, [100, 130, 110][index]!),
        height: settings.sections.find((s) => s.id === 'loading')!.rowHeight,
      }),
    ),
  };
}

function projectGroupWidget(
  part: WidgetGroupPart | null | undefined,
  setup: GroupWidgetSetup,
  size: WidgetDimensions,
  session: WidgetSession,
  now: number,
  fontScale = 1,
  month?: WidgetMonthPart,
) {
  let full: ReturnType<typeof groupWidgetView>;
  try {
    full = groupWidgetView(part, setup, session, now, month);
  } catch {
    // Damaged saved data must not prevent Android drawing the widget or erase its setup.
    full = groupWidgetView(undefined, setup, session, now);
  }
  const layout = groupLayout(full, size, fontScale);
  const limit = layout.paymentLines;
  const omitted = full.payments.slice(limit);
  const more =
    layout.showMore && omitted.length ? (limit ? paymentOverflow(omitted) : full.people) : null;
  return {
    ...full,
    layout,
    more,
    month: full.month
      ? {
          ...full.month,
          totals: full.month.totals.slice(0, layout.monthRows),
          more: layout.monthMore,
        }
      : null,
    payments: full.payments.slice(0, limit).map((p) => ({
      ...p,
      displayLabel: layout.compact
        ? p.incoming
          ? `From ${p.firstName}`
          : `Pay ${p.firstName}`
        : p.label,
    })),
    summary: widgetSummary([
      'Group',
      full.state === 'loading' ? 'Loading' : null,
      full.name,
      full.tripDay,
      full.title,
      full.balance,
      size.width < 280 && full.currencyOverflow
        ? `${full.compactLabel} ${full.compactAmount}`
        : null,
      size.width < 280 ? full.people : null,
      // Speech keeps every saved payment, including rows omitted at this size (Large text board).
      ...spokenPayments(full.payments),
      full.hidden ? null : full.description,
      full.month ? 'This Month' : null,
      ...(full.month?.totals.length ? ['Group spent', ...full.month.totals] : []),
      full.month?.share ? `Your share ${full.month.share}` : null,
      full.month?.mainCurrencyOnly,
      full.month?.count,
      full.month?.prompt,
      full.month?.saved,
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
