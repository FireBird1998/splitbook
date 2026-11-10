import type { GroupCurrencyBalance } from './types';

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
