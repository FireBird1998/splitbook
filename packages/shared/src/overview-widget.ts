import { widgetGroups } from './widget-groups';
import { formatCurrency } from './currency';
import { toMajorAmount } from './exact-money';
import { widgetPayments, spokenWidgetPayments } from './widget-payments';
import {
  readWidgetBalances,
  type WidgetCopy,
  type WidgetSession,
  type WidgetTarget,
} from './balances-widget';
import { fitWidgetLayout, type WidgetDimensions, type WidgetSection } from './widget-sizing';
import { widgetTextLevel } from './widget-layout';
import { widgetSummary } from './widget-accessibility';
import { counted, SEPARATOR } from './separator';

export interface OverviewSetup {
  kind: 'balances';
  widgetId: number;
  hideAmounts?: boolean;
  reviewEnabled?: boolean;
}
/** The same receiver and setup as Balances. All sizes here are actual launcher dp. */
export function overviewWidget(
  copy: WidgetCopy | null,
  setup: OverviewSetup,
  size: WidgetDimensions,
  session: WidgetSession,
  now: number,
  scale = 1,
) {
  // Keep the established account, saved-time and message readings in one place.
  const read = readWidgetBalances(copy, setup, session, now);
  const otherAccount =
    session.status === 'authenticated' && !!copy && copy.accountId !== session.accountId;
  const state = otherAccount ? 'other-account' : read.state;
  const title = otherAccount ? 'Set up this widget again' : read.title;
  const tall = size.height >= 280;
  const tallDescriptions: Partial<Record<typeof state, string>> = {
    expired: 'to see your Overview. It comes back once you do.',
    'signed-out': 'to see your balances, payments and Groups here.',
    'no-copy': 'Open Splitbook to load your balances, payments and Groups.',
    'no-groups': 'Share costs with a Group, and it shows here.',
  };
  const groupRows =
    session.status === 'authenticated' && (state === 'normal' || state === 'all-square')
      ? widgetGroups(copy, session.accountId)
      : [];
  const description =
    state === 'all-square' && groupRows.length
      ? 'in every currency'
      : otherAccount
        ? 'This phone is signed in to another account.'
        : tall
          ? (tallDescriptions[state] ?? read.description)
          : read.description;
  const target: WidgetTarget = otherAccount
    ? { kind: 'setup', widgetId: setup.widgetId }
    : read.target;
  const unfinished =
    session.status === 'authenticated' &&
    copy?.accountId === session.accountId &&
    setup.reviewEnabled !== false &&
    !!copy.home &&
    !copy.lostGroupIds?.includes(copy.finishLater?.groupId ?? '')
      ? copy.finishLater
      : undefined;
  const normal = state === 'normal';
  const small = size.height < 130;
  const wide = size.width >= 280;
  const heading = tall ? 'Overview' : 'Balances';
  const level = widgetTextLevel(scale);
  const showGroups = tall && groupRows.length > 0 && (state === 'all-square' || size.height >= 400);
  const homeFiguresMissing = !!copy?.home && copy.home.byGroup === undefined;
  const allOwed = read.owed,
    allOwe = read.owe;
  const hidden = read.hidden ? 'Amounts and names hidden' : null;
  const suggested =
    normal && session.status === 'authenticated' ? widgetPayments(copy, session.accountId) : [];
  const personCount = (incoming: boolean) =>
    new Set(suggested.filter((row) => row.incoming === incoming).map((row) => row.person)).size;
  const payCount = personCount(false),
    paidCount = personCount(true);
  const hiddenPayments = hidden
    ? [
        payCount ? `You pay ${counted(payCount, 'person', 'people')}` : null,
        paidCount
          ? `${counted(paidCount, 'person', 'people')} ${paidCount === 1 ? 'pays' : 'pay'} you`
          : null,
      ].filter((v): v is string => !!v)
    : [];
  const availablePayments = hidden ? [] : suggested;
  const acrossGroups =
    read.saved && !read.muted ? `Across ${counted(read.groupCount, 'Group')}` : null;
  const ratio =
    size.pixelRatio && Number.isFinite(size.pixelRatio) && size.pixelRatio > 0
      ? size.pixelRatio
      : 1;
  const padding = Math.ceil((small ? 8 : 14) * ratio) / ratio;
  const width = Math.max(1, Math.floor(size.width * ratio) / ratio - padding * 2);
  const height = Math.max(0, Math.floor(size.height * ratio) / ratio - padding * 2);
  const gap = small ? (hidden && level === 2 ? 2 : 4) : 8;
  const layout = fitWidgetLayout(
    { ...size, width, height },
    scale,
    (text, optional) => {
      const cap =
        small || !optional || level === 2
          ? 1
          : level === 1
            ? wide
              ? 2
              : 1
            : wide
              ? tall && size.height < 400
                ? 2
                : 3
              : 2;
      const owed = allOwed.slice(0, cap);
      const owe = allOwe.slice(0, cap);
      const overflow = (rows: string[]) =>
        !hidden && rows.length > cap
          ? small
            ? `+${rows.length - cap}`
            : `+${counted(rows.length - cap, 'currency', 'currencies')}`
          : null;
      const owedOverflow = overflow(allOwed),
        oweOverflow = overflow(allOwe);
      const columns =
        (wide &&
          (!!hidden ||
            [...owed, ...owe].every(
              (amount) => text.width(amount, 10, true) <= (width - 8) / 2 - 20,
            ))) ||
        (small && !!hidden && !level);
      const panel = wide && columns;
      const columnWidth = columns ? (width - 8) / 2 - (panel ? 20 : 0) : width;
      const showSaved = optional && !level && !!read.saved;
      const showHeader = !small || (normal && !level);
      const showOverflow = optional && level < 2;
      const primaryOverflow = owed.length ? owedOverflow : oweOverflow;
      const moneyRoom = small
        ? width - (showOverflow && primaryOverflow ? text.width(primaryOverflow, 10) + 4 : 0)
        : columnWidth;
      const moneyBase = small ? 19 : level === 2 ? 13 : 16;
      const moneyFont = text.fit(
        [...owed, ...owe].sort((a, b) => b.length - a.length)[0] ?? '',
        hidden ? 11 : moneyBase,
        moneyRoom,
        !hidden,
      );
      const labelFont = small ? 10 : 11;
      const bodyFont = small ? 10 : 12;
      const review = !small && optional && (!level || tall) ? read.review : null;
      const finishLater =
        tall && optional && !level && unfinished
          ? {
              label: wide ? 'Finish later' : '✎',
              icon: wide,
              accessibilityLabel: '1 Expense to finish',
              groupName: unfinished.groupName,
              target: { kind: 'expense', groupId: unfinished.groupId } satisfies WidgetTarget,
            }
          : null;
      const action =
        (normal || state === 'all-square') && wide && tall && optional
          ? '＋ Add expense'
          : state === 'no-groups'
            ? '＋ Create a Group'
            : state === 'signed-out' || state === 'expired'
              ? 'Sign in'
              : null;
      const actionTarget: WidgetTarget =
        state === 'no-groups'
          ? 'create-group'
          : state === 'signed-out' || state === 'expired'
            ? 'sign-in'
            : 'choose-group';
      const actionFont = small ? 10 : 12;
      const actionPaddingVertical = small ? 4 : 9;
      const actionPaddingHorizontal = small ? 8 : 12;
      const actionLines = action
        ? text.words(action, actionFont, width - actionPaddingHorizontal * 2)
        : [];
      const privacyLines = hidden
        ? text.words(hidden, small && level === 2 ? 7 : 10, width - 18)
        : [];
      const showStateTile =
        !normal &&
        !['loading', 'no-groups', 'no-copy'].includes(state) &&
        !(state === 'all-square' && groupRows.length) &&
        optional &&
        !level &&
        !small;
      const messageBesideTile = state === 'signed-out' || state === 'expired';
      const messageWidth = width - (showStateTile ? 60 : 0);
      const titleLines = title ? text.words(title, small ? 10 : 15, messageWidth) : [];
      const descriptionLines =
        description && optional && level < 2
          ? text.words(description, bodyFont, messageBesideTile ? messageWidth : width)
          : [];
      const titleHeight = titleLines.length * text.line(small ? 10 : 15);
      const descriptionHeight = descriptionLines.length
        ? 8 + descriptionLines.length * text.line(bodyFont)
        : 0;
      const tileHeight = showStateTile ? 48 : 0;
      const messageHeight = messageBesideTile
        ? Math.max(titleHeight + descriptionHeight, tileHeight)
        : Math.max(titleHeight, tileHeight) + descriptionHeight;
      const secondary =
        small && normal && !hidden && owed.length && owe.length ? `You owe ${owe[0]}` : null;
      const secondaryFont = text.fit(secondary ?? '', level ? 9 : 12, width);
      const compactLines =
        small && normal && level > 0
          ? hidden
            ? ['You’re owed', 'You owe']
            : [`Owed ${owed[0] ?? '—'}`, `Owe ${owe[0] ?? '—'}`]
          : [];
      const compactFont = text.fit(
        compactLines.reduce((a, b) => (a.length > b.length ? a : b), ''),
        small && level === 2 ? (hidden ? 8 : 9) : 10,
        width,
      );
      const compactFallback =
        compactLines.some((line) => text.width(line, compactFont) > width) ||
        (!compactLines.length && secondary && text.width(secondary, secondaryFont) > width) ||
        (!hidden &&
          !small &&
          [...owed, ...owe].some((amount) => text.width(amount, moneyFont, true) > columnWidth))
          ? 'Open to see balances'
          : null;
      const fallbackLines = compactFallback ? text.words(compactFallback, 10) : [];
      const colHeight = (rows: string[], more: string | null) =>
        text.line(labelFont) +
        Math.max(1, rows.length) * text.line(hidden ? 11 : moneyFont) +
        (showOverflow && more ? text.line(10) : 0) +
        (panel ? 20 : 0);
      const balanceHeight = compactFallback
        ? text.line(10) * fallbackLines.length
        : compactLines.length
          ? compactLines.length * text.line(compactFont)
          : small && !hidden
            ? text.line(moneyFont) + (secondary ? text.line(secondaryFont) + 2 : 0)
            : columns
              ? Math.max(colHeight(owed, owedOverflow), colHeight(owe, oweOverflow))
              : colHeight(owed, owedOverflow) + colHeight(owe, oweOverflow) + 6;
      const footerNote =
        !small && (read.muted || (showGroups && homeFiguresMissing))
          ? 'Open to update'
          : !action && !small && showSaved && !finishLater && (!review || wide)
            ? acrossGroups
            : null;
      const chipPaddingHorizontal = 8;
      const reviewWidth = review ? text.width(review, 11) + chipPaddingHorizontal * 2 + 18 : 0;
      const draftWidth = finishLater
        ? text.width(finishLater.label, 11) +
          chipPaddingHorizontal * 2 +
          (finishLater.icon ? 18 : 0)
        : 0;
      const waitingAcross = reviewWidth + draftWidth + (reviewWidth && draftWidth ? 6 : 0) <= width;
      const waitingWidth = waitingAcross
        ? reviewWidth + draftWidth + (reviewWidth && draftWidth ? 6 : 0)
        : Math.max(reviewWidth, draftWidth);
      const waitingHeight =
        review || finishLater
          ? (Math.max(text.line(11), 14) + 10) *
              (waitingAcross || !review || !finishLater ? 1 : 2) +
            (waitingAcross ? 0 : 4)
          : 0;
      const noteWidth = footerNote ? text.width(footerNote, 10) : 0;
      const leadingWidth = waitingWidth + noteWidth + (waitingWidth && noteWidth ? 8 : 0);
      const leadingHeight = Math.max(waitingHeight, footerNote ? text.line(10) : 0);
      const actionWidth = action
        ? Math.min(
            width,
            Math.ceil(
              (Math.max(...actionLines.map((line) => text.width(line, actionFont))) +
                actionPaddingHorizontal * 2 +
                4) *
                ratio,
            ) / ratio,
          )
        : 0;
      const footerAcross =
        wide && !!leadingHeight && !!action && leadingWidth + actionWidth + 8 <= width;
      const actionHeight = action
        ? actionLines.length * text.line(actionFont) + actionPaddingVertical * 2
        : 0;
      const footer = footerAcross
        ? Math.max(leadingHeight, actionHeight)
        : leadingHeight + actionHeight + (leadingHeight && actionHeight ? 4 : 0);
      const showTitle =
        !small || !action || titleLines.length * text.line(10) + footer + gap * 2 + 1 <= height;
      const centerMessage = tall && !!title && state !== 'all-square';
      const compactPayments = size.width / Math.max(1, scale) < 240;
      const paymentDetails = optional && !level;
      const paymentHeaderHeight = paymentDetails ? text.line(10) + 4 : 0;
      const paymentFont = compactPayments ? 13 : 12;
      const paymentAvatarSize = Math.max(24, text.line(10));
      const paymentWidth = width - (compactPayments ? 0 : 24 + paymentAvatarSize);
      const measuredPayments = availablePayments.map((row) => {
        const label = compactPayments
          ? row.incoming
            ? `From ${row.firstName}`
            : `Pay ${row.firstName}`
          : row.label;
        const amountWidth = text.width(row.amount, 13, true);
        // Short rows reserve the complete amount and truncate only the person's name.
        // Stack only when even the action word and amount cannot share the line.
        const minimumLabel = compactPayments ? (row.incoming ? 'From' : 'Pay') : label;
        const stack = text.width(minimumLabel, paymentFont) + amountWidth + 8 > paymentWidth;
        const captionBelow =
          paymentDetails &&
          !compactPayments &&
          (stack ||
            text.width(label + SEPARATOR + row.groupName, paymentFont) + amountWidth + 8 >
              paymentWidth);
        return {
          label,
          stack,
          captionBelow,
          inlineCaption: paymentDetails ? SEPARATOR + row.groupName : '',
          textHeight: stack
            ? text.line(paymentFont) +
              text.line(13) +
              2 +
              (paymentDetails && !compactPayments ? text.line(10) + 2 : 0)
            : captionBelow
              ? text.line(paymentFont) + text.line(10) + 2
              : Math.max(text.line(paymentFont), text.line(13)),
        };
      });
      // Large full rows keep a readable avatar/tap-height base; short rows keep their 28 dp base.
      const paymentRowHeight = Math.max(
        (compactPayments ? 28 : level ? 48 : 36) * scale * text.factor,
        ...measuredPayments.map((row) => row.textHeight + Math.ceil(ratio) / ratio),
      );
      const paymentLimit =
        level === 1
          ? availablePayments.length
          : level === 2
            ? 2
            : 2 + Math.floor(Math.max(0, size.height - 464) / 120);
      const paymentFits = availablePayments.every(
        (row) => text.width(row.amount, 13, true) <= paymentWidth,
      );
      const hasReadGroup = Object.values(copy?.groups ?? {}).some(
        (group) => !group.archived && !copy?.lostGroupIds?.includes(group.id),
      );
      const paymentMessage =
        normal && tall && !suggested.length && !hasReadGroup ? 'Open the Group to update' : null;
      const paymentMessageLines = paymentMessage ? text.words(paymentMessage, 11) : [];
      const measuredPaymentCounts = hiddenPayments.map((label) =>
        text.words(label, 12, width - 24),
      );
      const paymentCountHeight = Math.max(
        36 * scale * text.factor,
        ...measuredPaymentCounts.map(
          (lines) => lines.length * text.line(12) + 8 + Math.ceil(ratio) / ratio,
        ),
      );
      const groupDetails = optional && !level;
      const groupHeaderHeight = groupDetails ? text.line(10) + 4 : 0;
      const compactGroups = size.width / Math.max(1, scale) < 240;
      const groupLimit = !level && size.height >= 584 ? 2 : 1;
      const measuredGroups = groupRows.map((group) => {
        const visible = group.balances?.slice(0, groupLimit) ?? [];
        const labels =
          group.balances === null
            ? homeFiguresMissing
              ? []
              : ['Open the Group to update']
            : !group.balances.length
              ? ['All square']
              : visible.map((row) => (row.balanceMinor > 0 ? 'You’re owed' : 'You owe'));
        const amounts = hidden
          ? []
          : visible.map((row) =>
              formatCurrency(toMajorAmount(Math.abs(row.balanceMinor), row.currency), row.currency),
            );
        const moreCurrencies =
          !hidden && group.balances && group.balances.length > groupLimit
            ? `+${counted(group.balances.length - groupLimit, 'currency', 'currencies')}`
            : null;
        const contentWidth = width - (compactGroups ? 0 : 16);
        const balanceWidth = Math.max(
          ...labels.map(
            (label, i) =>
              text.width(label, 9) + (amounts[i] ? text.width(amounts[i], 12, true) + 6 : 0),
          ),
          0,
        );
        const stack =
          compactGroups || text.width(group.name, 12) + balanceWidth + 44 > contentWidth;
        const amountStack =
          stack &&
          amounts.some(
            (amount, i) =>
              text.width(amount, 12, true) + text.width(labels[i], 9) + 8 > contentWidth,
          );
        const valueHeight =
          labels.reduce(
            (n, _, i) =>
              n +
              (amounts[i]
                ? amountStack
                  ? text.line(9) + text.line(12)
                  : Math.max(text.line(9), text.line(12))
                : text.line(9)),
            0,
          ) + (moreCurrencies ? text.line(9) : 0);
        const nameHeight = compactGroups ? text.line(12) : Math.max(24, text.line(12));
        const textHeight = stack ? nameHeight + valueHeight + 2 : Math.max(nameHeight, valueHeight);
        return {
          labels,
          amounts,
          moreCurrencies,
          stack,
          amountStack,
          textHeight,
          balanceWidth: Math.max(balanceWidth, moreCurrencies ? text.width(moreCurrencies, 9) : 0),
          positive: visible.map((row) => row.balanceMinor > 0),
          fits:
            amounts.every((amount) => text.width(amount, 12, true) <= contentWidth) &&
            labels.every((label) => text.width(label, 9) <= contentWidth) &&
            (!moreCurrencies || text.width(moreCurrencies, 9) <= contentWidth),
        };
      });
      const groupRowHeight = Math.max(
        (compactGroups ? 36 : 42) * scale * text.factor,
        ...measuredGroups.map((row) => row.textHeight + Math.ceil(ratio) / ratio),
      );
      const sections: WidgetSection[] = [
        ...(showHeader
          ? [{ id: 'header', rows: 1, rowHeight: text.line(small ? 10 : 13), required: true }]
          : []),
        ...(normal ? [{ id: 'balance', rows: 1, rowHeight: balanceHeight, required: true }] : []),
        ...(normal && tall && availablePayments.length
          ? [
              {
                id: 'payments',
                rows: availablePayments.length,
                maxRows: paymentFits ? paymentLimit : 0,
                rowHeight: paymentRowHeight,
                headingHeight: paymentHeaderHeight,
                inset: compactPayments ? 0 : 8,
                moreHeight: paymentDetails ? 0 : undefined,
                grow: true,
              },
            ]
          : []),
        ...(normal && tall && measuredPaymentCounts.length
          ? [
              {
                id: 'payment-counts',
                rows: measuredPaymentCounts.length,
                rowHeight: paymentCountHeight,
                headingHeight: paymentHeaderHeight,
                inset: 8,
                grow: true,
              },
            ]
          : []),
        ...(normal && tall && paymentMessage
          ? [
              {
                id: 'payments-message',
                rows: 1,
                rowHeight: paymentHeaderHeight + paymentMessageLines.length * text.line(11),
              },
            ]
          : []),
        ...(centerMessage
          ? [{ id: 'message-before', rows: 1, rowHeight: 0, grow: true, required: true }]
          : []),
        ...(title && showTitle
          ? [
              {
                id: 'message',
                rows: 1,
                rowHeight: messageHeight,
                required: true,
              },
            ]
          : []),
        ...(showGroups
          ? [
              {
                id: 'groups',
                rows: groupRows.length,
                maxRows: measuredGroups.every((row) => row.fits)
                  ? availablePayments.length && paymentFits
                    ? level
                      ? 1
                      : 2 + Math.floor(Math.max(0, size.height - 464) / 120) * 2
                    : groupRows.length
                  : 0,
                rowHeight: groupRowHeight,
                headingHeight: groupHeaderHeight,
                inset: compactGroups ? 0 : 8,
                moreHeight: groupDetails ? 0 : undefined,
                grow: 'when-complete' as const,
              },
            ]
          : []),
        ...(state === 'loading'
          ? [{ id: 'loading', rows: 3, rowHeight: 24, grow: true, required: true }]
          : [
              {
                id: centerMessage ? 'message-after' : 'space',
                rows: 1,
                rowHeight: 0,
                grow: centerMessage,
                fallbackGrow: !centerMessage,
                required: true,
              },
            ]),
        ...(hidden
          ? [
              {
                id: 'privacy',
                rows: 1,
                rowHeight: Math.max(
                  14,
                  privacyLines.length * text.line(small && level === 2 ? 7 : 10),
                ),
                required: true,
              },
            ]
          : []),
        ...(footer
          ? [
              {
                id: 'footer',
                rows: 1,
                rowHeight: footer,
                // At 200%, list rows get their natural height before a whole footer is tried.
                ...(level === 2 && (normal || state === 'all-square')
                  ? { whenComplete: normal ? 'balance' : 'message' }
                  : { required: true }),
              },
            ]
          : []),
      ];
      const primaryOwed = owed.length > 0;
      const primary = {
        label: primaryOwed ? 'You’re owed' : 'You owe',
        positive: primaryOwed,
        amount: (primaryOwed ? owed : owe)[0] ?? '—',
        overflow: primaryOwed ? owedOverflow : oweOverflow,
      };
      const headerLabel = small && normal && !hidden ? primary.label : heading;
      const headerTone =
        small && normal && !hidden ? (primary.positive ? 'positive' : 'negative') : 'text';
      const loadingRows = [100, 160, 120].map((w) => ({ width: Math.min(width, w) }));
      return {
        sections,
        compactPayments,
        measuredPayments,
        measuredGroups,
        compactGroups,
        groupHeaderHeight,
        groupNameFont: text.font(12),
        groupAmountFont: text.font(12),
        groupLabelFont: text.font(9),
        paymentHeaderHeight,
        paymentAvatarSize,
        paymentMessageLines,
        paymentCountsLines: measuredPaymentCounts.flat(),
        measuredPaymentCounts,
        paymentLabelFont: text.font(paymentFont),
        paymentAmountFont: text.font(13),
        primary,
        headerLabel,
        headerTone,
        loadingRows,
        owed,
        owe,
        owedOverflow,
        oweOverflow,
        showOverflow,
        columns,
        panel,
        small,
        showHeader,
        showSaved,
        showStateTile,
        messageBesideTile,
        review,
        action,
        actionTarget,
        actionLines,
        actionWidth,
        actionPaddingVertical,
        actionPaddingHorizontal,
        footerAcross,
        footerActionAlign:
          !footerAcross && leadingHeight ? ('flex-start' as const) : ('flex-end' as const),
        waitingAcross,
        chipPaddingHorizontal,
        finishLater,
        footerNote,
        privacyLines,
        titleLines,
        descriptionLines,
        compactLines,
        compactFallback,
        fallbackLines,
        secondary,
        fonts: {
          heading: text.font(small ? 10 : 13),
          saved: text.font(9),
          label: text.font(labelFont),
          money: text.font(moneyFont),
          body: text.font(bodyFont),
          title: text.font(small ? 10 : 15),
          action: text.font(actionFont),
          review: text.font(11),
          small: text.font(10),
          privacy: text.font(small && level === 2 ? 7 : 10),
          secondary: text.font(secondaryFont),
          compact: text.font(compactFont),
        },
      };
    },
    gap,
  );
  const {
    owed,
    owe,
    owedOverflow,
    oweOverflow,
    review,
    action,
    actionTarget,
    finishLater,
    measuredPayments,
    measuredGroups,
    measuredPaymentCounts,
    ...geometry
  } = layout;
  const paymentSection = layout.sections.find((s) => s.id === 'payments');
  const visiblePayments = availablePayments.slice(0, paymentSection?.rows ?? 0).map((row, i) => ({
    ...row,
    ...measuredPayments[i],
    muted: now - row.verifiedAt > 86400000,
    rowHeight: paymentSection!.rowHeight,
    dividerHeight: i ? Math.ceil(ratio) / ratio : 0,
    contentHeight: paymentSection!.rowHeight - (i ? Math.ceil(ratio) / ratio : 0),
  }));
  const countSection = layout.sections.find((s) => s.id === 'payment-counts');
  const paymentCounts = measuredPaymentCounts.slice(0, countSection?.rows ?? 0).map((lines, i) => ({
    lines,
    rowHeight: countSection!.rowHeight,
    dividerHeight: i ? Math.ceil(ratio) / ratio : 0,
    contentHeight: countSection!.rowHeight - (i ? Math.ceil(ratio) / ratio : 0),
  }));
  const groupSection = layout.sections.find((s) => s.id === 'groups');
  const visibleGroups = groupRows.slice(0, groupSection?.rows ?? 0).map((group, i) => ({
    id: group.id,
    name: group.name,
    theme: group.theme,
    target: group.target,
    ...measuredGroups[i],
    muted: group.verifiedAt !== null && now - group.verifiedAt > 86400000,
    rowHeight: groupSection!.rowHeight,
    dividerHeight: i ? Math.ceil(ratio) / ratio : 0,
    contentHeight: groupSection!.rowHeight - (i ? Math.ceil(ratio) / ratio : 0),
  }));
  const groupMore =
    groupSection?.rows && groupSection.more && layout.showOverflow
      ? `+${counted(groupSection.more, 'more', 'more')}`
      : null;
  const groupCount = groupSection && !groupSection.rows ? counted(groupRows.length, 'Group') : null;
  const spokenGroups = groupRows.map((group) => {
    const figures =
      group.balances === null
        ? homeFiguresMissing
          ? null
          : 'Open the Group to update'
        : !group.balances.length
          ? 'All square'
          : group.balances
              .map(
                (row) =>
                  (row.balanceMinor > 0 ? 'You’re owed' : 'You owe') +
                  (hidden
                    ? ''
                    : ' ' +
                      formatCurrency(
                        toMajorAmount(Math.abs(row.balanceMinor), row.currency),
                        row.currency,
                      )),
              )
              .join(' and ');
    return [group.name, figures].filter(Boolean).join('. ');
  });
  const paymentMore =
    paymentSection?.rows && paymentSection.more && layout.showOverflow
      ? `+${counted(paymentSection.more, 'more', 'more')}`
      : null;
  const paymentCount =
    paymentSection && !paymentSection.rows ? counted(availablePayments.length, 'payment') : null;
  const footerVisible = layout.sections.some((s) => s.id === 'footer');
  const spokenPayments = hidden
    ? hiddenPayments
    : spokenWidgetPayments(suggested).map((line, i) => `${line} in ${suggested[i].groupName}`);
  const summary = widgetSummary([
    heading,
    state === 'loading' ? 'Loading' : null,
    title,
    description,
    normal && allOwed.length ? 'You’re owed ' + allOwed.join(' and ') : null,
    normal && allOwe.length ? 'You owe ' + allOwe.join(' and ') : null,
    ...spokenPayments,
    ...spokenGroups,
    read.review?.replace(SEPARATOR, ' '),
    unfinished ? '1 Expense to finish' : null,
    read.saved,
    hidden,
    read.muted || (homeFiguresMissing && groupRows.length) ? 'Open to update' : null,
    normal && wide && tall ? 'Add expense' : null,
  ]);
  return {
    state,
    title,
    description,
    target,
    heading,
    summary,
    hidden,
    saved: read.saved,
    muted: read.muted,
    owed,
    owe,
    owedOverflow,
    oweOverflow,
    review: footerVisible ? review : null,
    finishLater: footerVisible ? finishLater : null,
    action: footerVisible ? action : null,
    actionTarget,
    payments: visiblePayments,
    paymentCounts,
    groups: visibleGroups,
    groupMore,
    groupCount,
    groupMoreTarget: 'home' as const,
    paymentMore,
    paymentCount,
    paymentMoreTarget: 'home' as const,
    layout: { ...geometry, padding, width, height, scale },
    reviewTarget: 'review' as const,
  };
}
export type OverviewWidgetView = ReturnType<typeof overviewWidget>;
