import type { WidgetCopy } from './balances-widget';

/** A verified list retires older Group parts. Archived final reads remain available. */
export function widgetGroupWasDropped(
  copy: Omit<Partial<WidgetCopy>, 'savedGroups'> & {
    savedGroups?: { verifiedAt: number; rows: readonly { id: string }[] };
  },
  id: string,
) {
  const list = copy.savedGroups,
    part = copy.groups?.[id],
    people = copy.groupPeople?.[id];
  if (!list || !Number.isFinite(list.verifiedAt) || !Array.isArray(list.rows)) return false;
  if (part?.archived ?? people?.archived) return false;
  const newest = Math.max(
    part?.verifiedAt ?? -Infinity,
    part?.balancesVerifiedAt ?? -Infinity,
    people?.verifiedAt ?? -Infinity,
    copy.tags?.[id]?.verifiedAt ?? -Infinity,
    copy.months?.[id]?.verifiedAt ?? -Infinity,
    copy.recents?.[id]?.verifiedAt ?? -Infinity,
    copy.home?.byGroup?.[id] ? copy.home.verifiedAt : -Infinity,
  );
  return list.verifiedAt >= newest && !list.rows.some((group) => group.id === id);
}

/** The placed Group uses its established lost-access state for retired parts. */
export function readWidgetGroup(copy: WidgetCopy | null, accountId: string, id: string) {
  if (!copy || copy.accountId !== accountId) return undefined;
  return copy.lostGroupIds?.includes(id) || widgetGroupWasDropped(copy, id)
    ? null
    : copy.groups?.[id];
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
