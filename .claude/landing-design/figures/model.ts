// The story every Splitbook landing figure tells, computed with the app's own money code:
// the same split and simplify functions the web and Android clients use.
import { calculateSplitAmountsMinor } from '../../../packages/shared/src/exact-money.ts';
import { simplifyDebtsMinor } from '../../../packages/shared/src/debt-simplifier.ts';

export const MEMBERS = [
  { id: 'you', name: 'You' },
  { id: 'priya', name: 'Priya' },
  { id: 'sam', name: 'Sam' },
  { id: 'alex', name: 'Alex' },
] as const;

type Id = (typeof MEMBERS)[number]['id'];
interface Expense {
  title: string;
  amountMinor: number;
  paidBy: Id;
  method: 'equal' | 'shares';
  between: Array<{ user: Id; shares?: number }>;
}

export const EXPENSES: Expense[] = [
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

export function story() {
  const balance: Record<string, number> = Object.fromEntries(MEMBERS.map((m) => [m.id, 0]));
  const steps = EXPENSES.map((expense) => {
    const split = calculateSplitAmountsMinor(expense.method, expense.amountMinor, expense.between);
    const delta: Record<string, number> = Object.fromEntries(MEMBERS.map((m) => [m.id, 0]));
    delta[expense.paidBy] += expense.amountMinor;
    for (const part of split) delta[part.user] -= part.amountMinor;
    for (const m of MEMBERS) balance[m.id] += delta[m.id];
    return {
      ...expense,
      split: split.map((part) => ({ user: part.user, amountMinor: part.amountMinor })),
      delta,
      after: { ...balance },
    };
  });
  const transfers = simplifyDebtsMinor(
    MEMBERS.map((m) => ({ userId: m.id, amountMinor: balance[m.id] })),
  );
  return { members: MEMBERS, steps, transfers };
}
