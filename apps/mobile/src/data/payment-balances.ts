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
 * omits it to check against the Balances it just read. Both compare exact minor units.
 *
 * Only this pair's rows are read, so another person's row that can't be read never decides the
 * payment. The sheet never throws for a Debt: its suggestion was read when it opened. Record
 * throws when this pair's own Debt can't be read, and so records nothing.
 */
export function paymentPreview(
  balances: readonly GroupCurrencyBalance[],
  payment: { paidBy: string; paidTo: string; currency: string; amountMinor: number },
  suggestedMinor?: number,
) {
  const [read] = paymentBalances(balances.filter(({ currency }) => currency === payment.currency));
  const own = (read?.balances ?? []).filter(({ user }) =>
    [payment.paidBy, payment.paidTo].includes(user._id),
  );
  const debts =
    suggestedMinor === undefined
      ? (read?.debts ?? []).filter(
          ({ from, to }) => from._id === payment.paidBy && to._id === payment.paidTo,
        )
      : [];
  let positionsKnown = own.some(({ user }) => user._id === payment.paidBy);
  let ledger;
  try {
    ledger = settlementLedgerFromRead({ balances: own, debts }, payment.currency);
  } catch (error) {
    if (!(error instanceof MoneyValidationError)) throw error;
    // The Debt still decides the extra amount and the tick. No caller may state a position made
    // from a balance that can't be read as if it were zero.
    ledger = settlementLedgerFromRead({ balances: [], debts }, payment.currency);
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
