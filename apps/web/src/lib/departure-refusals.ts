import { NextResponse } from 'next/server';
import { formatCurrency } from '@splitbook/shared/currency';
import { toMajorAmount } from '@splitbook/shared/exact-money';

/**
 * The words of the refusals that keep a member in the Group: their own leave, or an admin
 * removing them (#875). Both follow one rule, so both say it the same way: an open balance, or
 * a recurring Expense in its problem state that still includes them (#257).
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

/** A recurring Expense in its problem state, by name. */
export interface BrokenRecurringExpense {
  id: string;
  description: string;
}

/** "Rent (recurring), Wi-Fi (recurring) and Water (recurring)". */
function recurringNames(recurringExpenses: BrokenRecurringExpense[]) {
  const names = recurringExpenses.map(
    ({ description }) => `${description.trim() || 'A recurring Expense'} (recurring)`,
  );
  return names.length > 1 ? `${names.slice(0, -1).join(', ')} and ${names.at(-1)}` : names[0];
}

/** 409 `RECURRING_EXPENSE_PROBLEM`: the refusal's words, and the recurring Expenses by id. */
function recurringProblem(message: string, recurringExpenses: BrokenRecurringExpense[]) {
  return NextResponse.json(
    {
      error: message,
      status: 409,
      code: 'RECURRING_EXPENSE_PROBLEM',
      recurringExpenses: recurringExpenses.map(({ id, description }) => ({ id, description })),
    },
    { status: 409 },
  );
}

/**
 * "Rent (recurring) still includes you. Ask an admin to remove you from it, then leave.", or
 * for an admin, who can: "Remove yourself from it, then leave."
 */
export function leaveRecurringProblem(recurringExpenses: BrokenRecurringExpense[], admin: boolean) {
  const many = recurringExpenses.length > 1;
  const them = many ? 'them' : 'it';
  return recurringProblem(
    `${recurringNames(recurringExpenses)} still ${many ? 'include' : 'includes'} you. ` +
      (admin
        ? `Remove yourself from ${them}, then leave.`
        : `Ask an admin to remove you from ${them}, then leave.`),
    recurringExpenses,
  );
}

/** "Rent (recurring) still includes Priya Shah. Remove them from it before removing them from the Group." */
export function removalRecurringProblem(
  memberName: string,
  recurringExpenses: BrokenRecurringExpense[],
) {
  const many = recurringExpenses.length > 1;
  return recurringProblem(
    `${recurringNames(recurringExpenses)} still ${many ? 'include' : 'includes'} ${memberName}. ` +
      `Remove them from ${many ? 'each' : 'it'} before removing them from the Group.`,
    recurringExpenses,
  );
}
