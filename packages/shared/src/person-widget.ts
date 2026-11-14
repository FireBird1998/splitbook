import {
  widgetSavedTime,
  type WidgetCopy,
  type WidgetSession,
  type WidgetTarget,
} from './balances-widget';
import {
  fitWidgetLayout,
  widgetText,
  type WidgetDimensions,
  type WidgetSection,
} from './widget-sizing';
import { widgetTextLevel } from './widget-layout';
import { widgetPayments, type WidgetPayment } from './widget-payments';
import { widgetPeople, type WidgetPerson } from './widget-people';
import { counted } from './separator';
import { widgetSummary } from './widget-accessibility';

export interface PersonWidgetSetup {
  kind: 'person';
  widgetId: number;
  accountId: string;
  person: WidgetPerson;
  hideAmounts?: boolean;
}
interface PersonReading {
  state: 'normal' | 'loading' | 'no-copy' | 'signed-out' | 'expired' | 'other-account';
  name: string | null;
  initials: string | null;
  groupsLabel: string | null;
  saved: string | null;
  muted: boolean;
  title: string | null;
  description: string | null;
  action: string | null;
  target: WidgetTarget;
  payments: WidgetPayment[];
  squareGroups: { id: string; name: string }[];
}
function readPerson(
  copy: WidgetCopy | null,
  setup: PersonWidgetSetup,
  session: WidgetSession,
  now: number,
): PersonReading {
  const empty: PersonReading = {
    state: 'no-copy',
    name: null,
    initials: null,
    groupsLabel: null,
    saved: null,
    muted: false,
    title: 'Nothing saved yet',
    description: 'Open Splitbook to load your shared Groups.',
    action: null,
    target: 'home',
    payments: [],
    squareGroups: [],
  };
  if (session.status !== 'authenticated')
    return {
      ...empty,
      state: session.status,
      title: session.status === 'expired' ? 'Sign in again' : 'Sign in to Splitbook',
      description:
        session.status === 'expired'
          ? 'to see what’s between you. It comes back once you do.'
          : 'This widget shows a person once you’re signed in.',
      action: 'Sign in',
      target: 'sign-in',
    };
  if (session.accountId !== setup.accountId)
    return {
      ...empty,
      state: 'other-account',
      title: 'Set up this widget again',
      description: 'It was set up by another account on this phone.',
      action: 'Set up',
      target: { kind: 'setup', widgetId: setup.widgetId },
    };
  const selected = widgetPeople(copy, session.accountId).find(
    (person) => person.id === setup.person.id,
  );
  const name = selected?.name ?? setup.person.firstName;
  const shared = new Set(selected?.groups.map((group) => group.id) ?? []);
  const payments = widgetPayments(copy, session.accountId)
    .filter((row) => row.person === setup.person.id && shared.has(row.groupId))
    .map((row) => ({ ...row, label: row.incoming ? `${name} pays you` : `You pay ${name}` }));
  const parts = copy?.accountId === session.accountId ? (copy.groups ?? {}) : {};
  const squareGroups = (selected?.groups ?? [])
    .filter((group) => parts[group.id] && !payments.some((row) => row.groupId === group.id))
    .map(({ id, name }) => ({ id, name }));
  const times = [
    ...(selected?.groups.map((group) => group.verifiedAt) ?? []),
    ...payments.map((row) => row.verifiedAt),
  ];
  const age = times.length ? Math.min(...times) : null;
  const hasRead = !!selected?.groups.some((group) => !!parts[group.id]);
  return {
    ...empty,
    state:
      session.loading && !hasRead ? 'loading' : hasRead && payments.length ? 'normal' : 'no-copy',
    name,
    initials: selected?.initials ?? setup.person.initials,
    groupsLabel: shared.size ? `${counted(shared.size, 'Group')} together` : null,
    saved: hasRead && age !== null ? widgetSavedTime(age, now) : null,
    muted: age !== null && now - age > 86400000,
    title: null,
    description:
      (session.loading && !hasRead) || (hasRead && payments.length)
        ? null
        : `This phone has no saved copy of your Groups with ${name}. Open Splitbook to load them.`,
    payments,
    squareGroups,
  };
}
function projectPerson(
  copy: WidgetCopy | null,
  setup: PersonWidgetSetup,
  size: WidgetDimensions,
  session: WidgetSession,
  now: number,
  fontScale = 1,
) {
  const read = readPerson(copy, setup, session, now);
  const scale = Number.isFinite(fontScale) && fontScale > 0 ? fontScale : 1;
  const level = widgetTextLevel(scale),
    compact = level === 2 || size.width / Math.max(1, scale) < 240;
  const ratio =
    size.pixelRatio && Number.isFinite(size.pixelRatio) && size.pixelRatio > 0
      ? size.pixelRatio
      : 1;
  const pixel = (dp: number) => Math.ceil(dp * ratio - 1e-9) / ratio;
  const padding = pixel(14),
    width = Math.max(1, Math.floor(size.width * ratio) / ratio - padding * 2),
    height = Math.max(0, Math.floor(size.height * ratio) / ratio - padding * 2);
  const rows = [
    ...read.payments.map((payment) => ({
      kind: 'payment' as const,
      payment,
      groupName: payment.groupName,
    })),
    ...(size.height >= 300 && !level
      ? read.squareGroups.map((group) => ({ kind: 'square' as const, groupName: group.name }))
      : []),
  ];
  const layout = fitWidgetLayout(
    { width, height, pixelRatio: ratio },
    scale,
    (text, optional) => {
      const showSaved = optional && !level && !!read.saved;
      const showGroups = read.state === 'no-copy' || (optional && level < 2 && !!read.groupsLabel);
      const avatarSize = Math.max(28, text.line(10) + 8);
      const showAvatar = optional && width > 100;
      const nameFont = 13,
        captionFont = compact ? 12 : 10;
      const savedBeside = showSaved && !compact && width > 280;
      const subtitleLines = showGroups
        ? text.words(
            read.state === 'no-copy' ? 'Nothing saved yet' : (read.groupsLabel ?? ''),
            10,
            width - (showAvatar ? avatarSize + 8 : 0),
          )
        : [];
      const headerHeight = read.name
        ? Math.max(
            showAvatar ? avatarSize : 0,
            text.line(nameFont) +
              (showGroups ? subtitleLines.length * text.line(10) + 3 : 0) +
              (!savedBeside && showSaved ? text.line(9) + 3 : 0),
          )
        : 0;
      const measured = rows.map((row) => {
        const payment = row.kind === 'payment' ? row.payment : null;
        const label = compact
          ? payment
            ? payment.incoming
              ? 'Pays you'
              : 'You pay'
            : 'All square'
          : (payment?.label ?? 'All square');
        const base = compact ? 12 : 12;
        const amountFont = payment
          ? text.fit(payment.amount, 13, width - (compact ? 0 : 16), true)
          : 13;
        const stack =
          !!payment &&
          text.width(label, base) + text.width(payment.amount, amountFont, true) + 8 >
            width - (compact ? 0 : 16);
        const minimumHeight =
          (compact ? text.line(captionFont) + 3 : 0) +
          Math.max(text.line(base), text.line(amountFont)) +
          (stack ? text.line(amountFont) + 2 : 0) +
          (!compact ? text.line(captionFont) + 3 + 12 : 4) +
          pixel(1);
        return { label, amountFont: text.font(amountFont), stack, minimumHeight };
      });
      const rowHeight = Math.max(1, ...measured.map((row) => row.minimumHeight));
      const paymentFits = read.payments.every(
        (row) => text.width(row.amount, 10, true) <= width - (compact ? 0 : 16),
      );
      const titleFont = compact ? 13 : 15,
        bodyFont = 12,
        actionFont = 12;
      const showStateTile = !!read.title && optional && !level && !compact;
      const messageWidth = width - (showStateTile ? 60 : 0);
      const titleLines = read.title ? text.words(read.title, titleFont, messageWidth) : [];
      const descriptionLines =
        read.description && optional && level < 2
          ? text.words(read.description, bodyFont, messageWidth)
          : [];
      const actionLines = read.action ? text.words(read.action, actionFont, width - 24) : [];
      const sections: WidgetSection[] = [
        ...(read.name ? [{ id: 'header', rows: 1, rowHeight: headerHeight, required: true }] : []),
        ...(read.title || descriptionLines.length
          ? [
              {
                id: 'message',
                rows: 1,
                rowHeight:
                  Math.max(showStateTile ? 48 : 0, titleLines.length * text.line(titleFont)) +
                  (descriptionLines.length
                    ? (titleLines.length ? 8 : 0) + descriptionLines.length * text.line(bodyFont)
                    : 0),
                required: true,
              },
            ]
          : []),
        ...(read.state === 'loading'
          ? [{ id: 'loading', rows: 3, rowHeight: 24, grow: true }]
          : []),
        ...(rows.length
          ? [
              {
                id: 'payments',
                rows: rows.length,
                maxRows: paymentFits
                  ? level === 2
                    ? 1 + Math.floor(Math.max(0, size.height - 224) / 140)
                    : rows.length
                  : 0,
                rowHeight,
                inset: compact ? 0 : 8,
                moreHeight: text.line(10) + 4,
                grow: true,
              },
            ]
          : []),
        { id: 'space', rows: 1, rowHeight: 0, required: true, fallbackGrow: true },
        ...(actionLines.length
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
      return {
        sections,
        showSaved,
        showGroups,
        subtitleLines,
        showAvatar,
        avatarSize,
        savedBeside,
        compact,
        measured,
        titleLines,
        descriptionLines,
        actionLines,
        showStateTile,
        fonts: {
          name: text.font(nameFont),
          caption: text.font(captionFont),
          small: text.font(10),
          saved: text.font(9),
          label: text.font(12),
          title: text.font(titleFont),
          body: text.font(bodyFont),
          action: text.font(actionFont),
          avatar: text.font(10),
        },
      };
    },
    8,
  );
  const section = layout.sections.find((s) => s.id === 'payments');
  const { measured, ...geometry } = layout;
  const visible = rows.slice(0, section?.rows ?? 0).map((row, i) => ({
    ...row,
    ...measured[i],
    height: section!.rowHeight,
    dividerHeight: i ? pixel(1) : 0,
    contentHeight: section!.rowHeight - (i ? pixel(1) : 0),
  }));
  const more = section?.more
    ? section.rows
      ? `+${section.more} more`
      : counted(rows.length, read.squareGroups.length ? 'line' : 'payment')
    : null;
  return {
    ...read,
    payments: visible
      .filter((row) => row.kind === 'payment')
      .map((row) => ({ ...row.payment, ...row })),
    rows: visible,
    more,
    layout: {
      ...geometry,
      padding,
      width,
      height,
      scale,
      panelPadding: compact ? 0 : 4,
      loadingRows: Array.from(
        { length: layout.sections.find((s) => s.id === 'loading')?.rows ?? 0 },
        (_, i) => ({
          width: Math.min(width, [100, 130, 110][i]),
          height: layout.sections.find((s) => s.id === 'loading')!.rowHeight,
        }),
      ),
      moreLines: more ? widgetText(width, scale).words(more, layout.fonts.small) : [],
    },
    summary: widgetSummary([
      'Person',
      read.state === 'loading' ? 'Loading' : null,
      read.name,
      read.groupsLabel,
      read.title,
      read.description,
      ...read.payments.map((row) => `${row.label} ${row.amount} in ${row.groupName}`),
      ...read.squareGroups.map((group) => `All square in ${group.name}`),
      read.saved,
      read.action,
    ]),
  };
}
/** Dimensions are launcher dp; all choices and measured geometry stay outside native drawing. */
export function personWidget(
  ...args: Parameters<typeof projectPerson>
): ReturnType<typeof projectPerson> {
  try {
    return projectPerson(...args);
  } catch {
    return projectPerson(null, args[1], args[2], args[3], args[4], args[5]);
  }
}
export type PersonWidgetView = ReturnType<typeof personWidget>;
