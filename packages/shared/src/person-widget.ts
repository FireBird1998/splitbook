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
import { widgetPayments, widgetPaymentVerifiedAt, type WidgetPayment } from './widget-payments';
import { widgetPeople, type WidgetPerson } from './widget-people';
import { counted } from './separator';
import { widgetSummary } from './widget-accessibility';

export interface PersonWidgetSetup {
  kind: 'person';
  widgetId: number;
  accountId: string;
  person: Pick<WidgetPerson, 'id'> & Partial<Pick<WidgetPerson, 'firstName' | 'initials'>>;
  hideAmounts?: boolean;
}
interface PersonReading {
  state:
    | 'normal'
    | 'loading'
    | 'no-copy'
    | 'signed-out'
    | 'expired'
    | 'other-account'
    | 'all-square'
    | 'no-shared-group';
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
  hidden: string | null;
  hiddenCounts: string[];
  update: string | null;
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
    hidden: null,
    hiddenCounts: [],
    update: null,
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
  const catalogue = widgetPeople(copy, session.accountId);
  const selected = catalogue.find((person) => person.id === setup.person.id);
  const duplicate = catalogue.some(
    (person) => person.id !== setup.person.id && person.firstName === setup.person.firstName,
  );
  const savedName = setup.person.firstName ?? null;
  const secondInitial = setup.person.initials?.slice(1, 2);
  const name =
    selected?.name ??
    (duplicate && savedName && secondInitial ? `${savedName} ${secondInitial}` : savedName);
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
    ...(selected?.groups.flatMap((group) =>
      parts[group.id] ? [widgetPaymentVerifiedAt(parts[group.id])] : [],
    ) ?? []),
  ];
  const age = times.length ? Math.min(...times) : null;
  const hasRead = !!selected?.groups.some((group) => !!parts[group.id]);
  const complete = !!selected?.groups.length && selected.groups.every((group) => !!parts[group.id]);
  const membershipKnown =
    copy?.accountId === session.accountId && copy.groupPeople !== undefined && !!copy.savedGroups;
  const noShared = membershipKnown && !shared.size;
  const state: PersonReading['state'] = noShared
    ? 'no-shared-group'
    : session.loading && !hasRead
      ? 'loading'
      : payments.length
        ? 'normal'
        : complete
          ? 'all-square'
          : 'no-copy';
  const hidden = setup.hideAmounts === true;
  const groupCount = (incoming: boolean) =>
    new Set(payments.filter((row) => row.incoming === incoming).map((row) => row.groupId)).size;
  const payCount = groupCount(false),
    paidCount = groupCount(true);
  const hiddenCounts = hidden
    ? [
        payCount ? `You pay in ${counted(payCount, 'Group')}` : null,
        paidCount ? `Pays you in ${counted(paidCount, 'Group')}` : null,
      ].filter((value): value is string => !!value)
    : [];
  return {
    ...empty,
    state,
    name: noShared ? null : hidden ? 'One person' : name,
    initials: noShared || hidden ? null : (selected?.initials ?? setup.person.initials ?? null),
    groupsLabel: shared.size ? `${counted(shared.size, 'Group')} together` : null,
    saved: hasRead && age !== null ? widgetSavedTime(age, now) : null,
    muted: age !== null && now - age > 86400000,
    title: noShared
      ? `No shared Group${hidden || !name ? '' : ` with ${name}`}`
      : state === 'all-square'
        ? `All square${hidden || !name ? '' : ` with ${name}`}`
        : null,
    description: noShared
      ? 'Their lines were removed from this phone.'
      : state === 'all-square'
        ? 'Nothing is suggested either way, in any Group.'
        : state === 'no-copy'
          ? hidden || !name
            ? 'This phone has no saved copy of your shared Groups. Open Splitbook to load them.'
            : `This phone has no saved copy of your Groups with ${name}. Open Splitbook to load them.`
          : null,
    action: noShared ? 'Choose another' : null,
    target: noShared ? { kind: 'setup', widgetId: setup.widgetId } : 'home',
    payments: hidden ? [] : payments,
    squareGroups: hidden ? [] : squareGroups,
    hidden: hidden ? 'Amounts and names hidden' : null,
    hiddenCounts,
    update: hasRead && age !== null && now - age > 86400000 ? 'Open to update' : null,
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
    ...read.hiddenCounts.map((label) => ({ kind: 'count' as const, groupName: '', label })),
    ...read.payments.map((payment) => ({
      kind: 'payment' as const,
      payment,
      groupName: payment.groupName,
    })),
    ...(size.height >= 300 && level < 2
      ? read.squareGroups.map((group) => ({ kind: 'square' as const, groupName: group.name }))
      : []),
  ];
  const layout = fitWidgetLayout(
    { width, height, pixelRatio: ratio },
    scale,
    (text, optional) => {
      const showSaved = optional && !level && !!read.saved;
      const showGroups =
        read.state === 'no-copy' || (optional && !compact && level < 2 && !!read.groupsLabel);
      const avatarSize = Math.max(28, text.line(10) + 8);
      const showAvatar = optional && width > 100 && !(read.hidden && level === 2);
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
        const label =
          row.kind === 'count'
            ? row.label
            : compact
              ? payment
                ? payment.incoming
                  ? 'Pays you'
                  : 'You pay'
                : 'All square'
              : (payment?.label ?? 'All square');
        const base = 12;
        const labelLines =
          row.kind === 'count' ? text.words(label, base, width - (compact ? 0 : 16)) : [label];
        const amountFont = payment
          ? text.fit(payment.amount, 13, width - (compact ? 0 : 16), true)
          : 13;
        const stack =
          !!payment &&
          text.width(label, base) + text.width(payment.amount, amountFont, true) + 8 >
            width - (compact ? 0 : 16);
        const minimumHeight =
          row.kind === 'count'
            ? labelLines.length * text.line(12) + 12 + pixel(1)
            : (compact ? text.line(captionFont) + 3 : 0) +
              Math.max(text.line(base), text.line(amountFont)) +
              (stack ? text.line(amountFont) + 2 : 0) +
              (!compact ? text.line(captionFont) + 3 + 12 : 4) +
              pixel(1);
        return { label, labelLines, amountFont: text.font(amountFont), stack, minimumHeight };
      });
      const rowHeight = Math.max(1, ...measured.map((row) => row.minimumHeight));
      const paymentFits = read.payments.every(
        (row) => text.width(row.amount, 10, true) <= width - (compact ? 0 : 16),
      );
      const titleFont = compact ? 13 : 15,
        bodyFont = 12,
        actionFont = 12;
      const showStateTile =
        !!read.title &&
        optional &&
        level < 2 &&
        (read.state === 'all-square' || (!level && !compact));
      const stateTileSize = read.state === 'all-square' ? 22 : 48;
      const messageGap = read.state === 'all-square' ? 8 : 12;
      const separateDescription = read.state === 'all-square' && size.height < 300;
      const messageWidth = width - (showStateTile ? stateTileSize + messageGap : 0);
      const titleLines = read.title ? text.words(read.title, titleFont, messageWidth) : [];
      const descriptionLines =
        read.description && optional && level < 2
          ? text.words(read.description, bodyFont, separateDescription ? width : messageWidth)
          : [];
      const actionLines = read.action ? text.words(read.action, actionFont, width - 24) : [];
      const showPrivacy = !!read.hidden && optional && level < 2;
      const privacyLines = showPrivacy ? text.words(read.hidden!, 10, width - 18) : [];
      const sections: WidgetSection[] = [
        ...(read.name ? [{ id: 'header', rows: 1, rowHeight: headerHeight, required: true }] : []),
        ...(separateDescription
          ? [{ id: 'message-before', rows: 1, rowHeight: 0, required: true, grow: true }]
          : []),
        ...(read.title || descriptionLines.length
          ? [
              {
                id: 'message',
                rows: 1,
                rowHeight:
                  Math.max(
                    showStateTile ? stateTileSize : 0,
                    titleLines.length * text.line(titleFont),
                  ) +
                  (!separateDescription && descriptionLines.length
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
                  ? level === 2 && !read.hidden
                    ? 1 + Math.floor(Math.max(0, size.height - 224) / 120)
                    : rows.length
                  : 0,
                rowHeight,
                inset: compact ? 0 : 8,
                moreHeight: text.line(10) + 4,
                grow: 'when-complete' as const,
              },
            ]
          : []),
        {
          id: 'space',
          rows: 1,
          rowHeight: 0,
          required: true,
          grow: separateDescription,
          fallbackGrow: !separateDescription,
        },
        ...(separateDescription && descriptionLines.length
          ? [
              {
                id: 'description',
                rows: 1,
                rowHeight: descriptionLines.length * text.line(bodyFont),
                required: true,
              },
            ]
          : []),
        ...(read.update
          ? [{ id: 'update', rows: 1, rowHeight: text.line(10), required: true }]
          : []),
        ...(showPrivacy
          ? [
              {
                id: 'privacy',
                rows: 1,
                rowHeight: Math.max(14, privacyLines.length * text.line(10)),
                required: true,
              },
            ]
          : []),
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
        privacyLines,
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
        separateDescription,
        actionLines,
        showStateTile,
        stateIcon: read.state === 'no-shared-group' ? ('warning' as const) : null,
        stateTileSize,
        stateIconSize: read.state === 'all-square' ? 22 : 28,
        messageGap,
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
      : counted(
          rows.length,
          read.hidden ? 'direction' : read.squareGroups.length ? 'line' : 'payment',
        )
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
      read.initials ? `Initials ${[...read.initials].join(' ')}` : null,
      read.groupsLabel,
      read.title,
      read.description,
      ...read.payments.map((row) => `${row.label} ${row.amount} in ${row.groupName}`),
      ...read.squareGroups.map((group) => `All square in ${group.name}`),
      ...read.hiddenCounts,
      read.saved,
      read.hidden,
      read.update,
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
