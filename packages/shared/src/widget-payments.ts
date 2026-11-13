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

/**
 * TalkBack labels for the visible payment rows. When two rows share a first name and their
 * stored initials differ, each name gains its second initial ("You pay Priya S"), so speech
 * tells them apart the way the avatars do. Old copies without initials keep first names only.
 */
export function spokenWidgetPayments(
  payments: readonly { firstName: string; initials: string; incoming: boolean; amount: string }[],
) {
  const byName = new Map<string, string[]>();
  for (const p of payments)
    byName.set(p.firstName, [...(byName.get(p.firstName) ?? []), p.initials]);
  return payments.map((p) => {
    const shared = byName.get(p.firstName)!;
    const distinct =
      shared.length > 1 &&
      p.initials.length > 1 &&
      shared.filter((initials) => initials === p.initials).length === 1;
    const name = distinct ? `${p.firstName} ${p.initials.slice(1, 2)}` : p.firstName;
    return `${p.incoming ? `${name} pays you` : `You pay ${name}`} ${p.amount}`;
  });
}
