/**
 * A payment that settled several Debts at once (#734), as one Activity row on the web and
 * Android, in the single payment's words (#727): who paid whom, what in all, each Debt it cleared,
 * and each one's rate. The events are a batch's `settlement_recorded` events, as
 * `groupSettlementBatches` collects them; nothing is looked up again or converted.
 */
import { readCrossCurrencyRecord, rateText } from './cross-currency-payment';
import { formatCrossCurrencySettlement, minorMoney } from './cross-currency-settlement';
import { parseAmountMinor } from './exact-money';
import { memberLabel } from './member-label';

/** One of the batch's Settlements, as its Activity event keeps it. */
export interface SettlementBatchWordsEvent {
  metadata?: Readonly<Record<string, unknown>> | null;
}

export interface SettlementBatchWords {
  /** "You", or the payer's recorded name. */
  payer: string;
  /** "you" when the viewer was paid; the payee's recorded name otherwise. */
  payee: string | null;
  /** "₹3,322.00 to clear ₹1,480.00 and €20.00": what follows the people. */
  amounts: string;
  /** "You paid Sam Chen ₹3,322.00 to clear ₹1,480.00 and €20.00". */
  headline: string;
  /** Each Debt it cleared, and its rate: "€20.00 at ₹92.10 per €, suggested ₹92.10 (20 Oct)". */
  debts: string[];
  /** Where the rest of a batch a page boundary split is; null once all of it is here. */
  rest: string | null;
}

/** "₹1,480.00 and €20.00", or "₹1,480.00, €20.00 and ¥8,400". */
const andList = (words: string[]) =>
  words.length > 1 ? `${words.slice(0, -1).join(', ')} and ${words.at(-1)}` : (words[0] ?? '');

const text = (value: unknown) => (typeof value === 'string' ? value : undefined);

/** The amount a Settlement cleared, in its Debt's currency's minor units. */
function clearedMinor(meta: Readonly<Record<string, unknown>>) {
  const currency = text(meta.currency) ?? '';
  return typeof meta.amountMinor === 'number'
    ? meta.amountMinor
    : parseAmountMinor(Number(meta.amount), currency);
}

/**
 * The words of a batch's row. `events` are the batch's events loaded so far, in the order they
 * were recorded, as `groupSettlementBatches` gives them; `batchSize` is how many it has in all,
 * so a batch a page boundary split says what it has.
 */
export function settlementBatchWords(
  events: readonly SettlementBatchWordsEvent[],
  batchSize: number,
  viewerId?: string,
): SettlementBatchWords {
  const metas = events.map(({ metadata }) => metadata ?? {});
  const first = metas[0] ?? {};
  const payer = memberLabel(first.paidBy, first.paidByName, viewerId) ?? 'Former member';
  const payee =
    viewerId && first.paidTo === viewerId
      ? 'you'
      : memberLabel(first.paidTo, first.paidToName, viewerId);
  let paidCurrency: string | null = null,
    paidMinor = 0;
  const cleared: string[] = [];
  const debts = metas.map((meta) => {
    const currency = text(meta.currency) ?? '';
    const debt = minorMoney(clearedMinor(meta), currency);
    cleared.push(debt);
    const cross = readCrossCurrencyRecord(meta);
    if (!cross) {
      paidMinor += clearedMinor(meta);
      paidCurrency ??= currency;
      return `${debt}, same currency, no rate`;
    }
    paidMinor += cross.amountPaidMinor;
    paidCurrency = cross.paidCurrency;
    // The rate in the single payment's words, after "to clear": its Debt, rate and suggestion.
    const said = formatCrossCurrencySettlement(
      {
        ...cross,
        appliedRate: rateText(cross.appliedRate),
        ...(cross.suggestedRate ? { suggestedRate: rateText(cross.suggestedRate) } : {}),
      },
      viewerId,
    );
    const at = said.indexOf(` to clear ${debt}`);
    return at < 0 ? said : said.slice(at + ' to clear '.length);
  });
  const missing = batchSize - metas.length;
  const amounts =
    missing > 0 || !paidCurrency
      ? `to clear ${andList([...cleared, `${missing} more ${missing === 1 ? 'Debt' : 'Debts'}`])}`
      : `${minorMoney(paidMinor, paidCurrency)} to clear ${andList(cleared)}`;
  return {
    payer,
    payee,
    amounts,
    headline: `${payer} paid${payee ? ` ${payee}` : ''} ${amounts}`,
    debts,
    rest: missing > 0 ? 'The rest of this payment is in older Activity.' : null,
  };
}
