import { toMajorAmount } from '@splitbook/shared/exact-money';
import { groupCurrencies, type GroupCurrencyList } from '@splitbook/shared/group-currencies';
import type { CurrencySpending } from '@splitbook/shared/spending-currencies';

/** Someone's balance in one currency, as the Group's Balances read gives it. */
interface CurrencyBalances {
  currency: string;
  balances: Array<{ user: { _id: string }; balance: number }>;
}

/**
 * What the Trip strip shows for a Trip in several currencies (#729): the Group's currencies, and
 * the total and the member's balance in one of them: the one chosen on the Trip summary's
 * switch, else the one the Trip summary opened on (the most Expenses). Nothing is converted, so
 * a trip spent in yen shows its yen, never "₹0.00". Until the Trip summary answers, it keeps to
 * the main currency with no total.
 */
export function tripStripFigures({
  group,
  userId,
  summary,
  balances,
  chosen,
}: {
  group: GroupCurrencyList;
  userId: string;
  /** The Trip summary read, opened on its own currency, with what each currency spent. */
  summary?: { currency: string; currencies?: readonly CurrencySpending[] };
  balances?: {
    balances?: CurrencyBalances['balances'];
    byCurrency?: readonly CurrencyBalances[];
  };
  /** The currency chosen on the switch, from the address. */
  chosen?: string;
}) {
  const currencies = groupCurrencies(group);
  const spending = summary?.currencies ?? [];
  const currency =
    chosen && (currencies.includes(chosen) || spending.some((row) => row.currency === chosen))
      ? chosen
      : (summary?.currency ?? group.defaultCurrency);
  const spent = spending.find((row) => row.currency === currency);
  // The main currency's balances are the read's own, as the strip has always shown them.
  const bucket =
    (currency === group.defaultCurrency ? balances?.balances : undefined) ??
    balances?.byCurrency?.find((row) => row.currency === currency)?.balances;
  return {
    currencies,
    currency,
    total: summary ? toMajorAmount(spent?.spentMinor ?? 0, currency) : null,
    balance: bucket?.find((row) => row.user._id === userId)?.balance ?? (bucket ? 0 : null),
  };
}
