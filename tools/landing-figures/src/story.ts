// The story every landing figure tells, computed with the app's own money code: the same split
// the web and Android clients use, so a figure's numbers can never drift from the product.
import {
  MONEY_VERSION,
  calculateSplitAmountsMinor,
  toMajorAmount,
} from '@splitbook/shared/exact-money';
import { calculateNetBalancesMinor, simplifyDebtsMinor } from '@splitbook/shared/debt-simplifier';

export const CURRENCY = 'INR';

export const MEMBERS = [
  { id: 'you', name: 'You' },
  { id: 'priya', name: 'Priya' },
  { id: 'sam', name: 'Sam' },
  { id: 'alex', name: 'Alex' },
] as const;

export type MemberId = (typeof MEMBERS)[number]['id'];
export type Balances = Record<MemberId, number>;

interface Expense {
  title: string;
  amountMinor: number;
  paidBy: MemberId;
  method: 'equal' | 'shares';
  between: Array<{ user: MemberId; shares?: number }>;
}

export const EXPENSES: readonly Expense[] = [
  {
    title: 'Dinner',
    amountMinor: 120000,
    paidBy: 'you',
    method: 'equal',
    between: [{ user: 'you' }, { user: 'priya' }, { user: 'sam' }, { user: 'alex' }],
  },
  {
    title: 'Cab',
    amountMinor: 60000,
    paidBy: 'priya',
    method: 'equal',
    between: [{ user: 'priya' }, { user: 'sam' }, { user: 'alex' }],
  },
  {
    title: 'Groceries',
    amountMinor: 100000,
    paidBy: 'sam',
    method: 'shares',
    between: [
      { user: 'you', shares: 2 },
      { user: 'priya', shares: 1 },
      { user: 'sam', shares: 1 },
      { user: 'alex', shares: 1 },
    ],
  },
];

const binOf = (id: MemberId) => MEMBERS.findIndex((member) => member.id === id);

type Split = Array<{ user: MemberId; amountMinor: number }>;

// One chip per share: an equal split gives each person one chip, shares give that many chips. A
// member's chips split their amount equally with the same split the app uses. On the belt the
// leading chip goes to the farthest bin, so the bar can be sorted in a single pass.
function chipsOf(expense: Expense, split: Split) {
  const chips: Array<{ to: MemberId; amountMinor: number }> = [];
  for (const part of split) {
    const shares =
      expense.method === 'shares'
        ? (expense.between.find((b) => b.user === part.user)?.shares ?? 1)
        : 1;
    const each = Array.from({ length: shares }, (_, i) => ({ user: `${part.user}#${i}` }));
    for (const chip of calculateSplitAmountsMinor('equal', part.amountMinor, each))
      chips.push({ to: part.user, amountMinor: chip.amountMinor });
  }
  return chips.sort((a, b) => binOf(b.to) - binOf(a.to));
}

// The balances the app would show after these Expenses, from its own balance calculation over
// them as they would be stored.
function balancesAfter(expenses: Array<{ paidBy: MemberId; amountMinor: number; split: Split }>) {
  const stored = (user: MemberId, amountMinor: number) => ({
    user,
    amount: toMajorAmount(amountMinor, CURRENCY),
    amountMinor,
  });
  const net = calculateNetBalancesMinor(
    expenses.map((expense) => ({
      currency: CURRENCY,
      moneyVersion: MONEY_VERSION,
      paidBy: [stored(expense.paidBy, expense.amountMinor)],
      splitBetween: expense.split.map((part) => stored(part.user, part.amountMinor)),
    })),
    [],
    CURRENCY,
  );
  const balances = Object.fromEntries(MEMBERS.map((member) => [member.id, 0])) as Balances;
  for (const { userId, amountMinor } of net) balances[userId as MemberId] = amountMinor;
  return balances;
}

export function story() {
  const done: Array<{ paidBy: MemberId; amountMinor: number; split: Split }> = [];
  const steps = EXPENSES.map((expense) => {
    const split: Split = calculateSplitAmountsMinor(
      expense.method,
      expense.amountMinor,
      expense.between,
    ).map(({ user, amountMinor }) => ({ user, amountMinor }));
    done.push({ paidBy: expense.paidBy, amountMinor: expense.amountMinor, split });
    return { ...expense, split, chips: chipsOf(expense, split), after: balancesAfter(done) };
  });
  const final = balancesAfter(done);
  const transfers = simplifyDebtsMinor(
    MEMBERS.map((member) => ({ userId: member.id, amountMinor: final[member.id] })),
  ).map(({ from, to, amountMinor }) => ({
    from: from as MemberId,
    to: to as MemberId,
    amountMinor,
  }));
  return { currency: CURRENCY, members: MEMBERS, steps, transfers };
}
