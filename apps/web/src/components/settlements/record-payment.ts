/**
 * The Balances tab's Record payment form (#312), without React: reading the amount typed,
 * the rule that only the two people in a payment can record it, and what the shared settlement
 * preview says about a new payment, in the words the form shows. The UI says "payment"; the
 * code and the glossary call it a Settlement.
 */
import { formatCurrency, getCurrencyPrecision } from '@splitbook/shared/currency';
import {
  MAX_EXPENSE_AMOUNT,
  MoneyValidationError,
  parseAmountMinor,
  toMajorAmount,
} from '@splitbook/shared/exact-money';
import { canRecordSettlement } from '@splitbook/shared/settlement-authorization';
import {
  previewSettlement,
  suggestedSettlementMinor,
  type SettlementLedger,
  type SettlementPreview,
} from '@splitbook/shared/settlement-preview';

/** The server's limit on a Settlement's note. */
export const NOTE_MAX_LENGTH = 500;

export const RECORD_PAYMENT_FOOTNOTE = 'Records a payment made outside Splitbook. No money moves.';
export const OVERPAY_TICK = 'I meant to pay more than suggested';

/** Money as the app shows it: "₹1,060.00". */
export const money = (amountMinor: number, currency: string) =>
  formatCurrency(toMajorAmount(Math.abs(amountMinor), currency), currency);

/** What goes in the amount field for an exact amount: "1060.00", or "1060" in yen. */
export function amountInputText(amountMinor: number, currency: string): string {
  return toMajorAmount(amountMinor, currency).toFixed(getCurrencyPrecision(currency));
}

export type AmountReading =
  | { status: 'empty' }
  | { status: 'invalid'; message: string }
  | { status: 'valid'; amountMinor: number };

/** "1,060.00", or "1,060" for a currency without decimal places. */
const example = (currency: string) => (getCurrencyPrecision(currency) === 0 ? '1,060' : '1,060.00');

/**
 * The amount typed, in exact minor units. Commas are read only as thousands separators in
 * their usual places ("1,060.50"), so "10,50" is refused rather than read as 1,050.
 */
export function readPaymentAmount(text: string, currency: string): AmountReading {
  const typed = text.trim();
  if (typed === '') return { status: 'empty' };
  const like = `Enter an amount like ${example(currency)}.`;
  if (typed.includes(',') && !/^\d{1,3}(?:,\d{3})+(?:\.\d*)?$/.test(typed)) {
    return { status: 'invalid', message: like };
  }
  const plain = typed.replaceAll(',', '');
  if (!/^(?:\d+(?:\.\d*)?|\.\d+)$/.test(plain)) return { status: 'invalid', message: like };
  let amountMinor: number;
  try {
    amountMinor = parseAmountMinor(plain, currency);
  } catch (error) {
    if (error instanceof MoneyValidationError && error.code === 'INVALID_MONEY_PRECISION') {
      const places = getCurrencyPrecision(currency);
      return {
        status: 'invalid',
        message:
          places === 0
            ? `${currency} amounts have no decimal places.`
            : `Use at most ${places} decimal places.`,
      };
    }
    return { status: 'invalid', message: like };
  }
  if (amountMinor <= 0) {
    return { status: 'invalid', message: `Enter an amount above ${money(0, currency)}.` };
  }
  if (amountMinor > MAX_EXPENSE_AMOUNT * 10 ** getCurrencyPrecision(currency)) {
    return {
      status: 'invalid',
      message: `Enter at most ${formatCurrency(MAX_EXPENSE_AMOUNT, currency)}.`,
    };
  }
  return { status: 'valid', amountMinor };
}

/** "Sam Chen" → "Sam". */
export const firstName = (name: string) => name.trim().split(/\s+/)[0] || name;

/**
 * Why this pair can't record a payment, or null when it can. Only the payer or the payee may
 * record one (`settlement-authorization`), so the viewer must be one of them.
 */
export function partyProblem(
  viewerId: string,
  from: string,
  to: string,
  nameOf: (id: string) => string,
): string | null {
  if (!from || !to) return null;
  if (from === to) return 'Pick two different people.';
  if (!canRecordSettlement(viewerId, from, to)) {
    return `Only ${firstName(nameOf(from))} or ${firstName(nameOf(to))} can record a payment between them.`;
  }
  return null;
}

/** "Sam will see it in Activity.": who else learns of the payment. */
export function whoSees(
  viewerId: string,
  from: string,
  to: string,
  nameOf: (id: string) => string,
) {
  const other = from === viewerId ? to : from;
  return `Either of you can record it. ${firstName(nameOf(other))} will see it in Activity.`;
}

/** Where someone stands, from the viewer's side: "owes ₹420.00", "gets back ₹50.00", "settled up". */
export function standing(afterMinor: number, currency: string, isViewer: boolean) {
  if (afterMinor < 0)
    return { words: isViewer ? 'owe' : 'owes', amount: money(afterMinor, currency) };
  if (afterMinor > 0)
    return { words: isViewer ? 'get back' : 'gets back', amount: money(afterMinor, currency) };
  return { words: isViewer ? 'are settled up' : 'is settled up', amount: null };
}

/**
 * The overpayment warning, Android's wording: how much more than suggested, and where the
 * payer would stand afterwards in the Group (balances are simplified across the Group, so this
 * is the payer's overall position, not a debt between these two).
 */
export function overpaymentMessage(
  preview: SettlementPreview,
  currency: string,
  payer: { isViewer: boolean; name: string },
  payeeName: string,
): string {
  const who = payer.isViewer ? 'you’d' : `${firstName(payer.name)} would`;
  const after = preview.paidBy.afterMinor;
  const position =
    after > 0
      ? `${who} be owed ${money(after, currency)}`
      : after < 0
        ? `${who} still owe ${money(after, currency)}`
        : `${who} be settled up`;
  const lead =
    preview.suggestedMinor === 0
      ? `No payment from ${payer.isViewer ? 'you' : firstName(payer.name)} to ${payeeName} is suggested.`
      : `That’s ${money(preview.overpaidMinor, currency)} more than suggested.`;
  return `${lead} Afterwards ${position} in this Group.`;
}

/** The figures behind the form: the Group's balances, in the Group's currency, once read. */
export type LedgerState =
  | { status: 'loading' }
  | { status: 'error' }
  | { status: 'ready'; ledger: SettlementLedger };

export interface NewPaymentDraft {
  from: string;
  to: string;
  amount: string;
  note: string;
  /** "I meant to pay more than suggested". */
  ack: boolean;
}

/** Everything the form says about a new payment, and whether Record may send it. */
export interface NewPaymentCheck {
  /** Why the pair can't record a payment, shown under From and To. */
  partyError: string | null;
  amount: AmountReading;
  noteError: string | null;
  /** The suggestion for a valid pair once the balances are read. */
  suggestedMinor: number | null;
  preview: SettlementPreview | null;
  /** The overpayment warning; Record waits for the tick. */
  overpayment: string | null;
  /** Why Record is disabled, under the button; null when nothing more is needed or a field says why. */
  waitingFor: string | null;
  ready: boolean;
}

export function checkNewPayment(
  draft: NewPaymentDraft,
  context: {
    viewerId: string;
    currency: string;
    ledger: LedgerState;
    nameOf: (id: string) => string;
  },
): NewPaymentCheck {
  const { viewerId, currency, ledger, nameOf } = context;
  const partyError = partyProblem(viewerId, draft.from, draft.to, nameOf);
  const pairReady = Boolean(draft.from && draft.to) && partyError === null;
  const amount = readPaymentAmount(draft.amount, currency);
  const noteError =
    draft.note.length > NOTE_MAX_LENGTH
      ? `Keep the note to ${NOTE_MAX_LENGTH} characters (${draft.note.length} now).`
      : null;
  const book = ledger.status === 'ready' ? ledger.ledger : null;
  const suggestedMinor =
    pairReady && book ? suggestedSettlementMinor(book, draft.from, draft.to) : null;
  const preview =
    pairReady && book && amount.status === 'valid'
      ? previewSettlement(book, {
          paidBy: draft.from,
          paidTo: draft.to,
          amountMinor: amount.amountMinor,
        })
      : null;
  const overpayment =
    preview?.overpays === true
      ? overpaymentMessage(
          preview,
          currency,
          { isViewer: draft.from === viewerId, name: nameOf(draft.from) },
          draft.to === viewerId ? 'you' : nameOf(draft.to),
        )
      : null;

  let waitingFor: string | null = null;
  if (!draft.from || !draft.to) waitingFor = 'Choose who paid whom.';
  else if (partyError) waitingFor = null;
  else if (amount.status === 'empty') waitingFor = 'Enter the amount paid.';
  else if (amount.status === 'invalid' || noteError) waitingFor = null;
  else if (ledger.status === 'loading') waitingFor = 'Loading the latest balances…';
  else if (ledger.status === 'error')
    waitingFor = 'Balances could not be loaded, so this payment can’t be checked yet.';
  else if (overpayment && !draft.ack) waitingFor = `Tick “${OVERPAY_TICK}” first.`;

  const ready =
    pairReady &&
    amount.status === 'valid' &&
    noteError === null &&
    preview !== null &&
    (!preview.overpays || draft.ack);
  return { partyError, amount, noteError, suggestedMinor, preview, overpayment, waitingFor, ready };
}

/** What the amount field's locked currency reads as. */
export const currencyLabel = (currency: string) => `Currency ${currency}, the Group’s currency`;
