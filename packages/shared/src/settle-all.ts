/**
 * Settle up (#734, board "Web · Settle both currencies at once"): one payment, in one currency,
 * that clears every Debt between the member and another person, each at its own rate. Each
 * Debt's own currency moves by its own amount only; nothing is converted on the ledger. Pure and
 * framework-free, for the web and Android.
 */
import {
  crossCurrencyRateKind,
  plainRate,
  readCrossCurrencyEntry,
  suggestedRateText,
  type RateSuggestion,
} from './cross-currency-payment';
import { getCurrencyPrecision } from './currency';
import { minorMoney } from './cross-currency-settlement';
import { readLegacyAmountMinor, toMajorAmount } from './exact-money';
import { canRecordSettlement } from './settlement-authorization';
import {
  calculateSettlementBatch,
  type SettlementBatchAmounts,
  type SettlementBatchRate,
} from './settlement-batch';

/** What a client knows of a Debt's suggested rate: still reading, none, or the suggestion. */
export type SettleAllRateState =
  | { status: 'loading' }
  | { status: 'none'; reason?: string | null }
  | { status: 'ready'; suggestion: RateSuggestion };

interface Person {
  _id: string;
  name: string;
}

/** A currency's Suggested payments, as Balances reads them. */
export interface SuggestedPayments {
  currency: string;
  debts: ReadonlyArray<{ from: Person; to: Person; amount: number }>;
}

/** One Debt a settle-up clears, in its own currency's minor units. */
export interface SettleAllDebt {
  currency: string;
  amountMinor: number;
}

/** A payment the member can record that clears Debts in several currencies at once. */
export interface SettleAllOffer {
  paidBy: string;
  paidTo: string;
  /** The other person's name. */
  other: string;
  /** Whether the member pays, or is paid. */
  youPay: boolean;
  /** In `currencies`' order: the main currency, then the Group's other currencies. */
  debts: SettleAllDebt[];
}

/**
 * Each person the member owes, or who owes the member, in two currencies or more, as the
 * Suggested payments say: one offer each, its Debts in `currencies`' order.
 */
export function settleAllOffers(
  buckets: readonly SuggestedPayments[],
  viewerId: string,
  currencies: readonly string[],
): SettleAllOffer[] {
  const offers = new Map<string, SettleAllOffer>();
  for (const { currency, debt, amountMinor } of suggested(buckets, currencies)) {
    if (!canRecordSettlement(viewerId, debt.from._id, debt.to._id)) continue;
    const key = `${debt.from._id}:${debt.to._id}`;
    const youPay = debt.from._id === viewerId;
    const offer = offers.get(key) ?? {
      paidBy: debt.from._id,
      paidTo: debt.to._id,
      other: youPay ? debt.to.name : debt.from.name,
      youPay,
      debts: [],
    };
    offer.debts.push({ currency, amountMinor });
    offers.set(key, offer);
  }
  return [...offers.values()].filter((offer) => offer.debts.length > 1);
}

/**
 * Every Debt one person owes another as the Suggested payments say, in `currencies`' order: what
 * Record checks a settle-up against just before it sends it (#734).
 */
export function settleAllDebtsBetween(
  buckets: readonly SuggestedPayments[],
  paidBy: string,
  paidTo: string,
  currencies: readonly string[],
): SettleAllDebt[] {
  return suggested(buckets, currencies)
    .filter(({ debt }) => debt.from._id === paidBy && debt.to._id === paidTo)
    .map(({ currency, amountMinor }) => ({ currency, amountMinor }));
}

/** Each Suggested payment with an exact amount above zero, its currency in `currencies`' order. */
function suggested(buckets: readonly SuggestedPayments[], currencies: readonly string[]) {
  return [...buckets]
    .sort((a, b) => rank(currencies, a.currency) - rank(currencies, b.currency))
    .flatMap(({ currency, debts }) =>
      debts.flatMap((debt) => {
        try {
          const amountMinor = readLegacyAmountMinor(debt.amount, currency);
          return amountMinor > 0 ? [{ currency, debt, amountMinor }] : [];
        } catch {
          return [];
        }
      }),
    );
}

/** Its place in the Group's currencies; one the Group no longer lists comes after them. */
const rank = (currencies: readonly string[], currency: string) => {
  const at = currencies.indexOf(currency);
  return at < 0 ? currencies.length : at;
};

/** "₹1,480.00 and €20.00", or "₹500.00, €12.50 and ¥900". */
const andList = (words: string[]) =>
  words.length > 1 ? `${words.slice(0, -1).join(', ')} and ${words.at(-1)}` : (words[0] ?? '');

/** What the offer and its sheet say, in the board's words. */
export function settleAllWords(offer: SettleAllOffer) {
  const count = offer.debts.length;
  const lead = offer.youPay
    ? `You owe ${offer.other} in ${count} currencies`
    : `${offer.other} owes you in ${count} currencies`;
  const clears = count === 2 ? 'clear both' : 'clear them all';
  return {
    lead,
    amounts: andList(
      offer.debts.map(({ currency, amountMinor }) => minorMoney(amountMinor, currency)),
    ),
    offer: `One payment can ${clears}.`,
    action: count === 2 ? 'Settle both' : 'Settle all',
    title: `Settle up with ${offer.other}`,
    intro: `${lead}. One payment can ${clears}; each Debt keeps its own rate.`,
    payColumn: offer.youPay ? 'You pay' : `${offer.other} pays`,
    note: `Records ${count} Settlements, one for each Debt, each with its own rate. Activity shows them as one payment. To pay part of a Debt, record it on its own.`,
  };
}

/** A Debt in another currency than the payment's: its suggested rate, and the member's own. */
export interface SettleAllRate {
  state: SettleAllRateState;
  /** The member's own rate, as typed; null while it pays at the suggestion. */
  custom: string | null;
}

/** One Debt of a settle-up, as the sheet shows it. */
export interface SettleAllLine {
  currency: string;
  debtMinor: number;
  /** What it pays, in the paying currency; null until its rate is known. */
  paidMinor: number | null;
  /** The rate it is paid at, as a decimal; null in the paying currency, or until it's known. */
  rate: string | null;
  kind: 'same' | 'suggested' | 'custom' | 'entered' | null;
  suggestion: RateSuggestion | null;
}

/** A rate is known for a Debt's currency paid in another, never for either one alone. */
export const rateKey = (currency: string, paidCurrency: string) => `${currency}>${paidCurrency}`;

/**
 * Each Debt's rate for a payment in `paidCurrency`: the one known for that pair, or still to be
 * read, beside the member's own. Switching the paying currency never keeps another pair's rate.
 */
export function settleAllRates(
  debts: readonly SettleAllDebt[],
  paidCurrency: string,
  known: Readonly<Record<string, SettleAllRateState | undefined>>,
  custom: Readonly<Record<string, string | null | undefined>>,
): Record<string, SettleAllRate> {
  return Object.fromEntries(
    debts.map(({ currency }) => [
      currency,
      {
        state: known[rateKey(currency, paidCurrency)] ?? { status: 'loading' },
        custom: custom[currency] ?? null,
      },
    ]),
  );
}

/** Record's reason while a Debt has no rate yet. */
export const enterRateFor = (currency: string) =>
  `Enter the rate for the ${currency} Debt to record it.`;

/**
 * A settle-up read by the shared rules: each Debt's line, and once every rate is known the
 * payment's rows and total (`calculateSettlementBatch`), else what Record waits for.
 */
export function readSettleAll({
  debts,
  paidCurrency,
  rates,
}: {
  debts: readonly SettleAllDebt[];
  paidCurrency: string;
  rates: Readonly<Record<string, SettleAllRate | undefined>>;
}): { lines: SettleAllLine[]; amounts: SettlementBatchAmounts | null; waiting: string | null } {
  let waiting: string | null = null;
  const choices: Record<string, SettlementBatchRate> = {};
  const lines = debts.map(({ currency, amountMinor: debtMinor }): SettleAllLine => {
    if (currency === paidCurrency)
      return {
        currency,
        debtMinor,
        paidMinor: debtMinor,
        rate: null,
        kind: 'same',
        suggestion: null,
      };
    const { state, custom } = rates[currency] ?? { state: { status: 'loading' }, custom: null };
    const suggestion = state.status === 'ready' ? state.suggestion : null;
    const unknown = { currency, debtMinor, paidMinor: null, rate: null, kind: null, suggestion };
    const typed = custom?.trim() ? custom.trim() : suggestion && suggestedRateText(suggestion.rate);
    if (!typed) {
      waiting ??=
        state.status === 'loading'
          ? `Getting the suggested rate for ${currency}…`
          : enterRateFor(currency);
      return unknown;
    }
    const pair = { currency, paidCurrency };
    const reading = readCrossCurrencyEntry(
      {
        cleared: toMajorAmount(debtMinor, currency).toFixed(getCurrencyPrecision(currency)),
        rate: typed,
        paid: '',
        drivers: ['rate', 'cleared'],
      },
      pair,
    );
    if (reading.status !== 'valid') {
      waiting ??= reading.status === 'invalid' ? reading.message : enterRateFor(currency);
      return unknown;
    }
    const plain = plainRate(typed) ?? typed;
    const kind = crossCurrencyRateKind(pair, reading.amounts, suggestion);
    const provenance = suggestion && {
      suggestedRate: suggestion.rate,
      rateSource: suggestion.source,
      rateAsOf: suggestion.asOf,
      rateFetchedAt: suggestion.fetchedAt,
    };
    choices[currency] =
      !provenance || kind === 'entered'
        ? { rateKind: 'entered', rate: plain }
        : kind === 'suggested'
          ? { rateKind: 'suggested', ...provenance }
          : { rateKind: 'custom', rate: plain, ...provenance };
    return {
      currency,
      debtMinor,
      paidMinor: reading.amounts.amountPaidMinor,
      rate: kind === 'suggested' && suggestion ? suggestion.rate : plain,
      kind,
      suggestion,
    };
  });
  let amounts: SettlementBatchAmounts | null = null;
  if (!waiting)
    try {
      amounts = calculateSettlementBatch({
        debts: lines.map(({ currency, debtMinor }) => ({ currency, amountMinor: debtMinor })),
        paidCurrency,
        rates: choices,
      });
    } catch {
      waiting = 'This payment can’t be worked out from these rates. Check them.';
    }
  return { lines, amounts, waiting };
}
