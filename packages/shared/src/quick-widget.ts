import { fitWidgetLayout, widgetText, type WidgetDimensions } from './widget-sizing';
import type { WidgetCopy, WidgetSession, WidgetTarget } from './balances-widget';
export interface QuickWidgetSetup {
  kind: 'quick';
  widgetId: number;
  accountId: string;
  groupId: string | null;
  /** Absent on widgets placed before Quick actions. */
  mode?: 'expense' | 'payment';
}
export function quickWidget(
  copy: WidgetCopy | null,
  setup: QuickWidgetSetup,
  size: WidgetDimensions,
  session: WidgetSession,
  fontScale = 1,
) {
  const payment = setup.mode === 'payment';
  const action = payment ? 'Record payment' : 'Add expense';
  const layout = (title: string, subtitle: string | null, normal: boolean) => {
    const compact = size.width < 140;
    const padding = Math.min(10, size.width / 8, size.height / 8),
      gap = 4,
      tileSize = Math.max(
        0,
        Math.min(
          compact && !normal ? 32 : 48,
          size.width - padding * 2 - 1,
          size.height - padding * 2 - 1,
        ),
      );
    const room = Math.max(0, size.width - padding * 2 - (compact ? 0 : tileSize + gap));
    const fitted = fitWidgetLayout(
      { ...size, width: room, height: Math.max(0, size.height - padding * 2) },
      fontScale,
      (text, optional) => {
        const titleFontSize = compact ? 10 : 15;
        const subtitleFontSize = compact ? 10 : 12;
        const titleLines = text.words(title, titleFontSize);
        const showTitle = !compact || (!normal && optional);
        const showSubtitle = !compact && optional && !!subtitle;
        const messageHeight =
          (showTitle ? titleLines.length * text.line(titleFontSize) : 0) +
          (showSubtitle ? 4 + text.line(subtitleFontSize) : 0);
        return {
          sections: [
            {
              id: 'action',
              rows: 1,
              rowHeight: compact
                ? tileSize + (showTitle ? 4 + messageHeight : 0)
                : Math.max(tileSize, messageHeight),
              required: true,
            },
          ],
          showTitle,
          showSubtitle,
          titleLines,
          subtitleMaxLines: 1,
          titleFontSize: text.font(titleFontSize),
          subtitleFontSize: text.font(subtitleFontSize),
          titleLineHeight: text.line(titleFontSize),
          subtitleLineHeight: text.line(subtitleFontSize),
        };
      },
      0,
    );
    const text = widgetText(room, fontScale, fitted.textFactor, size.pixelRatio);
    const fallback =
      !fitted.fits ||
      (fitted.showTitle &&
        fitted.titleLines.some((line) => text.width(line, compact ? 10 : 15) > room));
    return {
      ...fitted,
      ...(fallback
        ? fitWidgetLayout(
            { ...size, height: Math.max(0, size.height - padding * 2) },
            fontScale,
            () => ({ sections: [{ id: 'mark', rows: 1, rowHeight: tileSize, required: true }] }),
            0,
          )
        : {}),
      padding,
      gap,
      tileSize,
      compact: compact || fallback,
      showTile: true,
      showTitle: fitted.showTitle && !fallback,
      showSubtitle: fitted.showSubtitle && !fallback,
      icon: normal
        ? payment
          ? 'payment'
          : 'expense'
        : session.status === 'signed-out'
          ? 'brand'
          : session.status === 'expired'
            ? 'lock'
            : title === 'Group archived'
              ? 'archive'
              : title === 'Set up again'
                ? 'account'
                : 'info',
    };
  };
  const blocked = (
    state: string,
    title: string,
    subtitle: string | null,
    target: WidgetTarget,
  ) => ({
    state,
    layout: layout(title, subtitle, false),
    size,
    title,
    subtitle,
    summary: [title, subtitle].filter(Boolean).join('. '),
    target,
  });
  if (session.status !== 'authenticated')
    return blocked(
      session.status,
      session.status === 'expired' ? 'Sign in again' : 'Sign in',
      payment ? 'to record payments' : 'to add expenses',
      'sign-in',
    );
  if (session.accountId !== setup.accountId || (copy && copy.accountId !== setup.accountId))
    return blocked('other-account', 'Set up again', 'Another account', {
      kind: 'setup',
      widgetId: setup.widgetId,
    });
  if (setup.groupId && copy?.lostGroupIds?.includes(setup.groupId))
    return blocked('lost-access', 'Not in this Group', 'Choose a Group', {
      kind: 'setup',
      widgetId: setup.widgetId,
    });
  const group =
    setup.groupId && copy?.accountId === setup.accountId
      ? (copy.groups?.[setup.groupId] ?? copy.savedGroups?.rows.find((g) => g.id === setup.groupId))
      : null;
  if (group?.archived)
    return blocked('archived', 'Group archived', 'Choose another', {
      kind: 'setup',
      widgetId: setup.widgetId,
    });
  if (payment && !setup.groupId)
    return blocked('no-group', 'Choose a Group', null, { kind: 'setup', widgetId: setup.widgetId });
  const subtitle = group?.name ?? 'Choose a Group';
  return {
    state: 'normal',
    layout: layout(action, subtitle, true),
    size,
    title: action,
    subtitle,
    summary: group ? `${action} in ${group.name}` : `${action}. Choose a Group`,
    target: (setup.groupId
      ? { kind: payment ? 'record-payment' : 'expense', groupId: setup.groupId }
      : 'choose-group') as WidgetTarget,
  };
}
