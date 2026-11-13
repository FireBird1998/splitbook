import { formatCurrency } from './currency';
import { toMajorAmount } from './exact-money';
import type { WidgetGroupPart } from './group-widget';
import type { WidgetCopy, WidgetTarget } from './balances-widget';

/** One reading of the saved Suggested payments, shared by Group and Overview. */
export function groupWidgetPayments(part: WidgetGroupPart, accountId: string) {
  return part.currencies.flatMap((bucket) =>
    bucket.payments
      .filter((p) => p.from === accountId || p.to === accountId)
      .map((p) => {
        const outgoing = p.from === accountId;
        const firstName = (outgoing ? p.toName : p.fromName).trim().split(/\s+/)[0];
        const initials = outgoing ? p.toInitials : p.fromInitials;
        return {
          label: outgoing ? `You pay ${firstName}` : `${firstName} pays you`,
          amount: formatCurrency(toMajorAmount(p.amountMinor, bucket.currency), bucket.currency),
          amountMinor: p.amountMinor,
          currency: bucket.currency,
          firstName,
          // Old copies keep only the first name; a later app read supplies the initials.
          initials:
            typeof initials === 'string' && initials
              ? initials
              : firstName.slice(0, 1).toUpperCase(),
          incoming: p.to === accountId,
          payment: p.from && p.to ? { from: p.from, to: p.to, currency: bucket.currency } : null,
          person: outgoing ? p.to : p.from,
        };
      }),
  );
}

/** Account and Group guards happen before ordering. Different currencies are never compared. */
export function widgetPayments(copy: WidgetCopy | null, accountId: string) {
  if (!copy || copy.accountId !== accountId) return [];
  const rows = Object.values(copy.groups ?? {})
    .filter((g) => !g.archived && !copy.lostGroupIds?.includes(g.id))
    .flatMap((group) =>
      groupWidgetPayments(group, accountId).map((row) => ({
        ...row,
        groupId: group.id,
        groupName: group.name,
        verifiedAt: group.balancesVerifiedAt,
        target: {
          kind: 'settle',
          groupId: group.id,
          ...(row.payment ? { payment: row.payment } : {}),
        } satisfies WidgetTarget,
      })),
    );
  const currencies = [
    ...new Set([
      ...(copy.home?.currencies.map((row) => row.currency) ?? []),
      ...rows.map((row) => row.currency),
    ]),
  ];
  const rank = new Map(currencies.map((code, i) => [code, i]));
  return rows.sort(
    (a, b) =>
      Number(a.incoming) - Number(b.incoming) ||
      rank.get(a.currency)! - rank.get(b.currency)! ||
      b.amountMinor - a.amountMinor,
  );
}
export type WidgetPayment = ReturnType<typeof widgetPayments>[number];
