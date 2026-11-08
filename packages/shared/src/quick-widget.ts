import type { WidgetCopy, WidgetSession, WidgetTarget } from './balances-widget';
export interface QuickWidgetSetup {
  kind: 'quick';
  widgetId: number;
  accountId: string;
  groupId: string | null;
}
export function quickWidget(
  copy: WidgetCopy | null,
  setup: QuickWidgetSetup,
  size: '1x1' | '2x1',
  session: WidgetSession,
) {
  const blocked = (
    state: string,
    title: string,
    subtitle: string | null,
    target: WidgetTarget,
  ) => ({
    state,
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
      null,
      'sign-in',
    );
  if (session.accountId !== setup.accountId || (copy && copy.accountId !== setup.accountId))
    return blocked('other-account', 'Set up again', null, {
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
  const subtitle = group?.name ?? 'Choose a Group';
  return {
    state: 'normal',
    size,
    title: 'Add expense',
    subtitle,
    summary: group ? `Add expense in ${group.name}` : 'Add expense. Choose a Group',
    target: (setup.groupId
      ? { kind: 'expense', groupId: setup.groupId }
      : 'choose-group') as WidgetTarget,
  };
}
