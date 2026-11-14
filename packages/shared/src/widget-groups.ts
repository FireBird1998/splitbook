import type { WidgetCopy, WidgetTarget } from './balances-widget';

/** Home’s Group figures and list come from separate existing reads. Neither is a live balance. */
export function widgetGroups(copy: WidgetCopy | null, accountId: string) {
  if (!copy || copy.accountId !== accountId) return [];
  const currencies = [
    ...new Set([
      ...(copy.home?.currencies.map((row) => row.currency) ?? []),
      ...Object.values(copy.home?.byGroup ?? {}).flatMap((rows) => rows.map((row) => row.currency)),
    ]),
  ];
  const rank = (currency: string) => currencies.indexOf(currency);
  return (copy.savedGroups?.rows ?? [])
    .filter(
      (group) =>
        !group.archived &&
        !copy.groups?.[group.id]?.archived &&
        !copy.lostGroupIds?.includes(group.id),
    )
    .map((group, position) => {
      const balances = copy.home?.byGroup?.[group.id];
      const owing = balances
        ?.filter((row) => row.balanceMinor !== 0)
        .sort((a, b) => rank(a.currency) - rank(b.currency));
      return {
        id: group.id,
        name: group.name,
        theme: group.theme,
        // Empty means verified square; missing means Home has not answered for this Group.
        balances: balances === undefined ? null : owing!,
        verifiedAt: balances === undefined ? null : copy.home!.verifiedAt,
        position,
        target: { kind: 'group', groupId: group.id } satisfies WidgetTarget,
      };
    })
    .sort((a, b) => {
      const first = a.balances?.[0],
        second = b.balances?.[0];
      return (
        Number(!!second) - Number(!!first) ||
        (first && second
          ? rank(first.currency) - rank(second.currency) ||
            Math.abs(second.balanceMinor) - Math.abs(first.balanceMinor)
          : 0) ||
        // Preserve the Groups list order when no balance distinguishes the rows.
        a.position - b.position
      );
    });
}
