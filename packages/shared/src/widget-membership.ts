import type { WidgetCopy } from './balances-widget';

/** The placed Group uses its established lost-access state for retired parts. */
export function readWidgetGroup(copy: WidgetCopy | null, accountId: string, id: string) {
  if (!copy || copy.accountId !== accountId) return undefined;
  return copy.lostGroupIds?.includes(id) ? null : copy.groups?.[id];
}

/** Setup uses only saved, currently available Groups and never fetches. */
export function widgetSetupGroups(copy: WidgetCopy | null) {
  return (copy?.savedGroups?.rows ?? []).filter(
    (group) =>
      !group.archived &&
      !copy?.groups?.[group.id]?.archived &&
      !copy?.lostGroupIds?.includes(group.id),
  );
}

/** Omission asks the running controller to check access; it never hides saved parts. */
export function widgetGroupsToConfirm(copy: WidgetCopy | null, listed: ReadonlySet<string>) {
  if (!copy) return [];
  const ids = new Set([
    ...Object.keys(copy.groups ?? {}),
    ...Object.keys(copy.groupPeople ?? {}),
    ...Object.keys(copy.tags ?? {}),
    ...Object.keys(copy.months ?? {}),
    ...Object.keys(copy.recents ?? {}),
    ...Object.keys(copy.home?.byGroup ?? {}),
    ...(copy.finishLater ? [copy.finishLater.groupId] : []),
  ]);
  return [...ids].filter(
    (id) =>
      !listed.has(id) &&
      !copy.groups?.[id]?.archived &&
      !copy.groupPeople?.[id]?.archived &&
      !copy.lostGroupIds?.includes(id) &&
      copy.peopleRefusedAt?.[id] === undefined,
  );
}
