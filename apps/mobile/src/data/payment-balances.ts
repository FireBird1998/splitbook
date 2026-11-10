import type { GroupCurrencyBalance } from './types';
import { previewSettlement, settlementLedgerFromRead } from '@splitbook/shared/settlement-preview';
import { MoneyValidationError } from '@splitbook/shared/exact-money';

/**
 * Android's Balances as the shared payment readings take them: people by `_id`, without rows
 * naming someone this phone can't identify. Amounts keep their currency and exact value; the
 * shared reading converts them to minor units once, when selecting or checking the Debts.
 */
export function paymentBalances(balances: readonly GroupCurrencyBalance[]) {
  return balances.map(({ currency, balances, debts }) => ({
    currency,
    balances: balances.flatMap(({ user, balance }) =>
      user.id ? [{ user: { _id: user.id, name: user.name }, balance }] : [],
    ),
    debts: debts.flatMap(({ from, to, amount }) =>
      from.id && to.id
        ? [{ from: { _id: from.id, name: from.name }, to: { _id: to.id, name: to.name }, amount }]
        : [],
    ),
  }));
}

/**
 * A single payment's shared preview. The sheet keeps the suggestion it opened with; Record
 * omits that override to check the Balances it just read. Both compare exact minor units.
 */
export function paymentPreview(
  balances: readonly GroupCurrencyBalance[],
  payment: { paidBy: string; paidTo: string; currency: string; amountMinor: number },
  suggestedMinor?: number,
) {
  const [read] = paymentBalances(balances.filter(({ currency }) => currency === payment.currency));
  let positionsKnown = read?.balances.some(({ user }) => user._id === payment.paidBy) ?? false;
  let ledger;
  try {
    ledger = settlementLedgerFromRead(read ?? {}, payment.currency);
  } catch (error) {
    if (!(error instanceof MoneyValidationError)) throw error;
    // Debts still decide the extra amount and tick. No caller may state a position made from
    // an unreadable balance as if it were zero; invalid Debts still fail this second read.
    ledger = settlementLedgerFromRead({ ...read, balances: [] }, payment.currency);
    positionsKnown = false;
  }
  if (suggestedMinor !== undefined)
    ledger.suggestions = [
      { from: payment.paidBy, to: payment.paidTo, amountMinor: suggestedMinor },
    ];
  const preview = previewSettlement(ledger, payment);
  return (
    preview && {
      ...preview,
      paidBy: positionsKnown ? preview.paidBy : null,
      paidTo: positionsKnown ? preview.paidTo : null,
    }
  );
}
