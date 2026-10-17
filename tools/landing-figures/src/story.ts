// The story every landing figure tells, computed with the app's own money code: the same split,
// balance and simplify functions the web and Android clients use, and the same equal split for the
// items Fig 2's assistant prepares. The debts between pairs of members (Fig 3's grey cords) have
// no shared function; they are netted here from the shared split's shares, and check proves that
// paying them would clear the shared balances.
import {
  MONEY_VERSION,
  calculateSplitAmountsMinor,
  sumMinorAmounts,
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

/** Money moving from one member to another: a debt owed, or a payment that settles one. */
export interface Movement {
  from: MemberId;
  to: MemberId;
  amountMinor: number;
}

// The debts the Expenses leave before anyone settles up: each person owes each payer their share,
// and what two people owe each other nets to one debt between them (one cord on Fig 3's board).
function debtsOf(steps: Array<{ paidBy: MemberId; split: Split }>) {
  const owed = new Map<string, number>();
  for (const step of steps)
    for (const part of step.split) {
      if (part.user === step.paidBy) continue;
      const key = `${part.user}>${step.paidBy}`;
      owed.set(key, sumMinorAmounts([owed.get(key) ?? 0, part.amountMinor]));
    }
  const debts: Movement[] = [];
  MEMBERS.forEach((a, i) =>
    MEMBERS.slice(i + 1).forEach((b) => {
      const net = sumMinorAmounts([
        owed.get(`${a.id}>${b.id}`) ?? 0,
        -(owed.get(`${b.id}>${a.id}`) ?? 0),
      ]);
      if (net > 0) debts.push({ from: a.id, to: b.id, amountMinor: net });
      if (net < 0) debts.push({ from: b.id, to: a.id, amountMinor: -net });
    }),
  );
  return debts;
}

/** An item an assistant prepares for To review (Fig 2), split equally between the people it names. */
interface Prepared {
  title: string;
  /** Its name on the machines' small screens. */
  short: string;
  amountMinor: number;
  between: MemberId[];
  /** Whether the member saves it in the tour; the other waits in To review. */
  saved: boolean;
}

/** What Claude prepares from one chat message on Fig 2: the member saves Dinner, and Cab waits. */
export const PREPARED: readonly Prepared[] = [
  {
    title: 'Dinner at Thalassa',
    short: 'Dinner',
    amountMinor: 240000,
    between: ['you', 'priya', 'sam'],
    saved: true,
  },
  {
    title: 'Cab to the airport',
    short: 'Cab',
    amountMinor: 60000,
    between: ['you', 'priya'],
    saved: false,
  },
];

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
  ).map(
    ({ from, to, amountMinor }): Movement => ({
      from: from as MemberId,
      to: to as MemberId,
      amountMinor,
    }),
  );
  // Each prepared item is a bar of one chip per person, as the app's equal split shares it.
  const prepared = PREPARED.map((item) => ({
    ...item,
    chips: calculateSplitAmountsMinor(
      'equal',
      item.amountMinor,
      item.between.map((user) => ({ user })),
    ).map(({ user, amountMinor }) => ({ to: user, amountMinor })),
  }));
  return {
    currency: CURRENCY,
    members: MEMBERS,
    steps,
    debts: debtsOf(steps),
    transfers,
    prepared,
  };
}
