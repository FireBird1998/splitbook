import {
  balancesWidget,
  type WidgetCopy,
  type WidgetSession,
  type WidgetTarget,
} from './balances-widget';
import { fitWidgetLayout, type WidgetDimensions, type WidgetSection } from './widget-sizing';
import { widgetTextLevel } from './widget-layout';
import { widgetSummary } from './widget-accessibility';
import { formatCurrency } from './currency';
import { toMajorAmount } from './exact-money';
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
  const read = balancesWidget(copy, setup, '4x2', session, now);
  const otherAccount =
    session.status === 'authenticated' && !!copy && copy.accountId !== session.accountId;
  const state = otherAccount ? 'other-account' : read.state;
  const title = otherAccount ? 'Set up this widget again' : read.title;
  const description = otherAccount
    ? 'This phone is signed in to another account.'
    : read.description;
  const target: WidgetTarget = otherAccount
    ? { kind: 'setup', widgetId: setup.widgetId }
    : read.target;
  const normal = state === 'normal';
  const small = size.height < 130;
  const tall = size.height >= 280;
  const wide = size.width >= 280;
  const heading = tall ? 'Overview' : 'Balances';
  const level = widgetTextLevel(scale);
  const moneyRows = (field: 'owedMinor' | 'oweMinor') =>
    normal && copy?.home
      ? copy.home.currencies
          .filter((r) => r[field] > 0)
          .map((r) => formatCurrency(toMajorAmount(r[field], r.currency), r.currency))
      : [];
  const allOwed = moneyRows('owedMinor'),
    allOwe = moneyRows('oweMinor');
  const hidden = normal && setup.hideAmounts ? 'Amounts hidden' : null;
  const counts = (field: 'owedMinor' | 'oweMinor') => {
    const n = normal ? (copy?.home?.currencies.filter((r) => r[field] > 0).length ?? 0) : 0;
    return n ? [`in ${counted(n, 'currency', 'currencies')}`] : [];
  };
  const groupCount = read.footer && !read.muted ? read.footer : null;
  const ratio =
    size.pixelRatio && Number.isFinite(size.pixelRatio) && size.pixelRatio > 0
      ? size.pixelRatio
      : 1;
  const padding = Math.ceil((small ? 8 : 14) * ratio) / ratio;
  const width = Math.max(1, Math.floor(size.width * ratio) / ratio - padding * 2);
  const height = Math.max(0, Math.floor(size.height * ratio) / ratio - padding * 2);
  const gap = small ? 4 : 8;
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
      const owed = hidden ? counts('owedMinor') : allOwed.slice(0, cap);
      const owe = hidden ? counts('oweMinor') : allOwe.slice(0, cap);
      const overflow = (rows: string[]) =>
        !hidden && rows.length > cap
          ? small
            ? `+${rows.length - cap}`
            : `+${counted(rows.length - cap, 'currency', 'currencies')}`
          : null;
      const owedOverflow = overflow(allOwed),
        oweOverflow = overflow(allOwe);
      const columns = wide || (small && !!hidden && !level);
      const panel = wide;
      const columnWidth = columns ? (width - 8) / 2 - (panel ? 20 : 0) : width;
      const showSaved = optional && !level && !!read.saved;
      const showHeader = !small || (normal && !level);
      const moneyBase = small ? 19 : level === 2 ? 13 : 16;
      const moneyFont = text.fit(
        [...owed, ...owe].sort((a, b) => b.length - a.length)[0] ?? '',
        hidden ? 11 : moneyBase,
        small ? width : columnWidth,
        !hidden,
      );
      const labelFont = small ? 10 : 11;
      const bodyFont = small ? 10 : 12;
      const showOverflow = optional && level < 2;
      const review = !small && optional && !level ? read.review : null;
      const action =
        normal && wide && tall && optional
          ? '＋ Add expense'
          : state === 'no-groups' && !small
            ? '＋ Create a Group'
            : null;
      const actionTarget: WidgetTarget = state === 'no-groups' ? 'create-group' : 'choose-group';
      const actionFont = 12;
      const actionLines = action ? text.words(action, actionFont, width - 24) : [];
      const privacyLines = hidden
        ? text.words(hidden, small && level === 2 ? 8 : 10, width - 18)
        : [];
      const titleLines = title
        ? text.words(title, small ? 10 : 15, width - (!small && optional && !level ? 60 : 0))
        : [];
      const descriptionLines =
        description && optional && level < 2 ? text.words(description, bodyFont) : [];
      const showStateTile = !normal && state !== 'loading' && optional && !level && !small;
      const secondary =
        small && normal && !hidden && owed.length && owe.length ? `You owe ${owe[0]}` : null;
      const secondaryFont = level ? 9 : 12;
      const compactLines =
        small && normal && level > 0
          ? hidden
            ? ['You’re owed', 'You owe']
            : [`Owed ${owed[0] ?? '—'}`, `Owe ${owe[0] ?? '—'}`]
          : [];
      const compactFont = text.fit(
        compactLines.reduce((a, b) => (a.length > b.length ? a : b), ''),
        small && level === 2 ? 9 : 10,
        width,
      );
      const compactFallback = compactLines.some((line) => text.width(line, compactFont) > width)
        ? 'Open to see balances'
        : null;
      const colHeight = (rows: string[], more: string | null) =>
        text.line(labelFont) +
        Math.max(1, rows.length) * text.line(hidden ? 11 : moneyFont) +
        (showOverflow && more ? text.line(10) : 0) +
        (panel ? 20 : 0);
      const balanceHeight = compactFallback
        ? text.line(10) * 2
        : compactLines.length
          ? compactLines.length * text.line(compactFont)
          : small && !hidden
            ? text.line(moneyFont) + (secondary ? text.line(secondaryFont) + 2 : 0)
            : columns
              ? Math.max(colHeight(owed, owedOverflow), colHeight(owe, oweOverflow))
              : colHeight(owed, owedOverflow) + colHeight(owe, oweOverflow) + 6;
      const footerAcross =
        wide &&
        !!review &&
        !!action &&
        text.width(review, 11) + 20 + text.width(action, actionFont) + 24 + 8 <= width;
      const footerHeight =
        (review ? text.line(11) + 10 : 0) +
        (action ? actionLines.length * text.line(actionFont) + 18 : 0);
      const footer =
        (footerAcross
          ? Math.max(text.line(11) + 10, actionLines.length * text.line(actionFont) + 18)
          : footerHeight + (review && action ? 4 : 0)) ||
        (!small && read.muted ? text.line(11) : 0) ||
        (!small && showSaved && groupCount ? text.line(10) : 0);
      const sections: WidgetSection[] = [
        ...(showHeader
          ? [{ id: 'header', rows: 1, rowHeight: text.line(small ? 10 : 13), required: true }]
          : []),
        ...(normal ? [{ id: 'balance', rows: 1, rowHeight: balanceHeight, required: true }] : []),
        ...(title
          ? [
              {
                id: 'message',
                rows: 1,
                rowHeight:
                  Math.max(titleLines.length * text.line(small ? 10 : 15), showStateTile ? 48 : 0) +
                  (descriptionLines.length ? 8 + descriptionLines.length * text.line(bodyFont) : 0),
                required: true,
              },
            ]
          : []),
        ...(state === 'loading'
          ? [{ id: 'loading', rows: 3, rowHeight: 24, grow: true, required: true }]
          : [{ id: 'space', rows: 1, rowHeight: 0, grow: true, required: true }]),
        ...(hidden
          ? [
              {
                id: 'privacy',
                rows: 1,
                rowHeight: Math.max(
                  14,
                  privacyLines.length * text.line(small && level === 2 ? 8 : 10),
                ),
                required: true,
              },
            ]
          : []),
        ...(footer ? [{ id: 'footer', rows: 1, rowHeight: footer, required: true }] : []),
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
        review,
        action,
        actionTarget,
        actionLines,
        footerAcross,
        privacyLines,
        titleLines,
        descriptionLines,
        compactLines,
        compactFallback,
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
          privacy: text.font(small && level === 2 ? 8 : 10),
          secondary: text.font(secondaryFont),
          compact: text.font(compactFont),
        },
      };
    },
    gap,
  );
  const summary = widgetSummary([
    heading,
    state === 'loading' ? 'Loading' : null,
    title,
    description,
    normal && allOwed.length
      ? 'You’re owed ' + (hidden ? counts('owedMinor').join('') : allOwed.join(' and '))
      : null,
    normal && allOwe.length
      ? 'You owe ' + (hidden ? counts('oweMinor').join('') : allOwe.join(' and '))
      : null,
    read.review?.replace(SEPARATOR, ' '),
    read.saved,
    hidden,
    read.muted ? 'Open to update' : null,
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
    groupCount,
    ...layout,
    layout: { ...layout, padding, width, height, scale },
    reviewTarget: 'review' as const,
  };
}
export type OverviewWidgetView = ReturnType<typeof overviewWidget>;
