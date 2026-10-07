/**
 * What recording a Settlement would do (#312), before it is recorded: the amount Splitbook
 * suggests for the pair, whether an amount pays more than that, and where each side would stand
 * afterwards. Pure and exact: every amount is in minor units of one currency, the Group's.
 *
 * Balances are simplified across the Group, so "what settles the pair" is the suggested payment
 * from one to the other (the Balances read's debts), never a debt worked out between just these
 * two people. A pair with no suggested payment in that direction has a suggestion of 0, so any
 * payment between them pays more than suggested.
 */
import {
  MoneyValidationError,
  assertSafeMinorAmount,
  moneyParticipantId,
  readLegacyAmountMinor,
  sumMinorAmounts,
} from './exact-money';
import type { MinorBalance } from './debt-simplifier';

/** A payment Splitbook suggests, from the one who owes to the one who is owed. */
export interface SuggestedSettlement {
  from: string;
  to: string;
  amountMinor: number;
}

/** One currency of a Group's Balances, in minor units. */
export interface SettlementLedger {
  /** Each person's all-time net: positive is owed to them, negative they owe. */
  balances: readonly MinorBalance[];
  /** The suggested payments that settle everyone. */
  suggestions: readonly SuggestedSettlement[];
}

/** Where one side of the payment stands, before and after it. */
export interface SettlementPosition {
  userId: string;
  beforeMinor: number;
  afterMinor: number;
}

export interface SettlementPreview {
  amountMinor: number;
  /** The suggested payment from the payer to the payee, or 0 when none is suggested. */
  suggestedMinor: number;
  /** Whether the amount is more than suggested: an overpayment needs an explicit tick. */
  overpays: boolean;
  /** How much more than suggested, or 0 when it isn't more. */
  overpaidMinor: number;
  /** The payer goes up by the amount, the payee down by it. */
  paidBy: SettlementPosition;
  paidTo: SettlementPosition;
}

function assertPair(paidBy: string, paidTo: string) {
  if (!paidBy || !paidTo) throw new MoneyValidationError('INVALID_PARTY', 'Choose both people');
  if (paidBy === paidTo) {
    throw new MoneyValidationError('SAME_PARTY', 'A payment needs two different people');
  }
}

/**
 * The suggested payment from `paidBy` to `paidTo`: the amount that settles them. 0 when
 * nothing is suggested in that direction, including when the suggestion runs the other way.
 */
export function suggestedSettlementMinor(
  ledger: SettlementLedger,
  paidBy: string,
  paidTo: string,
): number {
  assertPair(paidBy, paidTo);
  return sumMinorAmounts(
    ledger.suggestions
      .filter((suggestion) => suggestion.from === paidBy && suggestion.to === paidTo)
      .map((suggestion) => suggestion.amountMinor),
  );
}

const netOf = (ledger: SettlementLedger, userId: string) =>
  sumMinorAmounts(
    ledger.balances
      .filter((balance) => balance.userId === userId)
      .map((balance) => balance.amountMinor),
  );

/**
 * What paying `amountMinor` from `paidBy` to `paidTo` would do. Null when the amount is zero or
 * negative, which is no payment. Throws for the same person on both sides, or an amount that
 * isn't a safe whole number of minor units.
 */
export function previewSettlement(
  ledger: SettlementLedger,
  payment: { paidBy: string; paidTo: string; amountMinor: number },
): SettlementPreview | null {
  const { paidBy, paidTo } = payment;
  const amountMinor = assertSafeMinorAmount(payment.amountMinor);
  const suggestedMinor = suggestedSettlementMinor(ledger, paidBy, paidTo);
  if (amountMinor <= 0) return null;
  const overpaidMinor = Math.max(0, sumMinorAmounts([amountMinor, -suggestedMinor]));
  const payerBefore = netOf(ledger, paidBy);
  const payeeBefore = netOf(ledger, paidTo);
  return {
    amountMinor,
    suggestedMinor,
    overpays: overpaidMinor > 0,
    overpaidMinor,
    paidBy: {
      userId: paidBy,
      beforeMinor: payerBefore,
      afterMinor: sumMinorAmounts([payerBefore, amountMinor]),
    },
    paidTo: {
      userId: paidTo,
      beforeMinor: payeeBefore,
      afterMinor: sumMinorAmounts([payeeBefore, -amountMinor]),
    },
  };
}

/** One currency of the Balances read as it comes over the wire: major units, people populated. */
export interface SettlementLedgerRead {
  balances?: ReadonlyArray<{ user: unknown; balance: number }>;
  debts?: ReadonlyArray<{ from: unknown; to: unknown; amount: number }>;
}

/**
 * The Balances read's figures for one currency in exact minor units. People the read can't
 * identify (a former member it sends as null) are left out. Throws when an amount isn't a
 * valid amount in `currency`.
 */
export function settlementLedgerFromRead(
  read: SettlementLedgerRead,
  currency: string,
): SettlementLedger {
  const minor = (amount: number) => readLegacyAmountMinor(amount, currency);
  return {
    balances: (read.balances ?? []).flatMap(({ user, balance }) => {
      const userId = moneyParticipantId(user);
      return userId ? [{ userId, amountMinor: minor(balance) }] : [];
    }),
    suggestions: (read.debts ?? []).flatMap(({ from, to, amount }) => {
      const fromId = moneyParticipantId(from);
      const toId = moneyParticipantId(to);
      return fromId && toId ? [{ from: fromId, to: toId, amountMinor: minor(amount) }] : [];
    }),
  };
}
