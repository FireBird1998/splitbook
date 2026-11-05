import { NextResponse } from 'next/server';
import { formatCurrency } from '@splitbook/shared/currency';
import { toMajorAmount } from '@splitbook/shared/exact-money';

/**
 * The words of the refusals that keep a member in the Group: their own leave, or an admin
 * removing them (#875). Both follow one rule, so both say it the same way.
 */

/** A member's non-zero balance in one currency, in minor units: negative owes, positive is owed. */
export interface OpenBalance {
  currency: string;
  amountMinor: number;
}

/**
 * "owe ₹1,480.00 and are owed €12.50", one figure per currency, as said of "you" or, with
 * `owes` and `is owed`, of a member by name.
 */
function owing(balances: OpenBalance[], said: 'of you' | 'of a member') {
  const figure = ({ currency, amountMinor }: OpenBalance) =>
    formatCurrency(toMajorAmount(Math.abs(amountMinor), currency), currency);
  const owe = balances.filter((balance) => balance.amountMinor < 0).map(figure);
  const owed = balances.filter((balance) => balance.amountMinor > 0).map(figure);
  const [oweVerb, owedVerb] = said === 'of you' ? ['owe', 'are owed'] : ['owes', 'is owed'];
  return [
    owe.length ? `${oweVerb} ${owe.join(' and ')}` : '',
    owed.length ? `${owedVerb} ${owed.join(' and ')}` : '',
  ]
    .filter(Boolean)
    .join(' and ');
}

/** 409 `OPEN_BALANCE`: the refusal's words, and each currency's balance in major units. */
function openBalance(message: string, balances: OpenBalance[]) {
  return NextResponse.json(
    {
      error: message,
      status: 409,
      code: 'OPEN_BALANCE',
      balances: balances.map(({ currency, amountMinor }) => ({
        currency,
        amount: toMajorAmount(amountMinor, currency),
      })),
    },
    { status: 409 },
  );
}

/** "Settle up before you leave: you owe ₹150.00 in this Group." */
export function leaveOpenBalance(balances: OpenBalance[]) {
  return openBalance(
    `Settle up before you leave: you ${owing(balances, 'of you')} in this Group.`,
    balances,
  );
}

/** "Priya Shah owes ₹300.00 in this Group. Settle up before removing them." */
export function removalOpenBalance(memberName: string, balances: OpenBalance[]) {
  return openBalance(
    `${memberName} ${owing(balances, 'of a member')} in this Group. Settle up before removing them.`,
    balances,
  );
}
