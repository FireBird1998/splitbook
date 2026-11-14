import { initials } from '../initials';
import { parseExpensePageResponse } from '@splitbook/shared/expense-page-read';
import { parseRecentLedgerRead } from '@splitbook/shared/recent-ledger-read';
import { readStoredAmountMinor } from '@splitbook/shared/exact-money';
import { getCurrency } from '@splitbook/shared/currency';
import type { FinancialPersonRead } from '@splitbook/shared/wire-fields';
import type { WidgetRecentPart } from '@splitbook/shared/group-widget';

const personId = (person: FinancialPersonRead) =>
  typeof person === 'string' ? person : (person?._id ?? null);
const firstName = (person: FinancialPersonRead) =>
  typeof person === 'object' && person?.name?.trim()
    ? person.name.trim().split(/\s+/)[0]
    : 'Former member';

/** Project an existing Expenses read, keeping only the opt-in widget's fields. */
export function widgetRecentCopy(
  value: unknown,
  groupId: string,
  verifiedAt: number,
  accountId: string,
): WidgetRecentPart | null {
  const page = parseExpensePageResponse(value);
  if (page.recent === undefined) return null;
  const ledger = parseRecentLedgerRead(page.recent);
  const expenses = ledger.expenses
    .filter((row) => row.group === groupId && getCurrency(row.currency))
    .map((row) => {
      const payers = row.paidBy.filter((payer) => payer.amount > 0);
      const payer = payers.length === 1 ? payers[0].user : null;
      return {
        sortDate: Date.parse(row.createdAt),
        createdAt: Date.parse(row.createdAt),
        row: {
          id: row._id,
          kind: 'expense' as const,
          description: row.description,
          payer: payers.length === 1 ? firstName(payer) : '',
          payerId: personId(payer),
          payerInitials: typeof payer === 'object' && payer?.name ? initials(payer.name) : '',
          payers: payers.length,
          amountMinor: readStoredAmountMinor(row),
          currency: row.currency,
          date: row.date.slice(0, 10),
          createdAt: row.createdAt,
        },
      };
    });
  const settlements = ledger.settlements
    .filter(
      (row) =>
        row.group === groupId &&
        getCurrency(row.paidCurrency ?? row.currency) &&
        (!row.paidCurrency ||
          (Number.isSafeInteger(row.amountPaidMinor) && row.amountPaidMinor! > 0)),
    )
    .map((row) => ({
      sortDate: Date.parse(row.createdAt),
      createdAt: Date.parse(row.createdAt),
      row: {
        id: row._id,
        kind: 'settlement' as const,
        description: `${personId(row.paidBy) === accountId ? 'You' : firstName(row.paidBy)} paid ${personId(row.paidTo) === accountId ? 'you' : firstName(row.paidTo)}`,
        payer: firstName(row.paidBy),
        payerId: personId(row.paidBy),
        payerInitials:
          typeof row.paidBy === 'object' && row.paidBy?.name ? initials(row.paidBy.name) : '',
        payee: {
          id: personId(row.paidTo),
          firstName: firstName(row.paidTo),
          initials:
            typeof row.paidTo === 'object' && row.paidTo?.name ? initials(row.paidTo.name) : '',
        },
        payers: 1,
        amountMinor: row.paidCurrency ? row.amountPaidMinor! : readStoredAmountMinor(row),
        currency: row.paidCurrency ?? row.currency,
        date: row.createdAt,
        createdAt: row.createdAt,
      },
    }));
  return {
    verifiedAt,
    rows: [...expenses, ...settlements]
      .sort((a, b) => b.sortDate - a.sortDate || b.createdAt - a.createdAt)
      .slice(0, 20)
      .map((entry) => entry.row),
  };
}
