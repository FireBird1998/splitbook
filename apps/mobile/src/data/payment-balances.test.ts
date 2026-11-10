import { describe, expect, it } from 'vitest';
import { settleAllDebtsBetween } from '@splitbook/shared/settle-all';
import { paymentBalances, paymentPreview } from './payment-balances';
import type { GroupCurrencyBalance } from './types';

const alex = { id: 'alex', name: 'Alex Rivera', image: null };
const sam = { id: 'sam', name: 'Sam Chen', image: null };

describe('Balances for the shared payment readings', () => {
  it('leaves out balances and payments whose people the phone cannot identify', () => {
    const former = { id: null, name: 'Former member', image: null };
    expect(
      paymentBalances([
        {
          currency: 'INR',
          balances: [{ user: former, balance: 12 }],
          debts: [
            { from: former, to: sam, amount: 12 },
            { from: alex, to: former, amount: 20 },
            { from: alex, to: sam, amount: 30 },
          ],
        },
      ]),
    ).toEqual([
      {
        currency: 'INR',
        balances: [],
        debts: [
          {
            from: { _id: 'alex', name: 'Alex Rivera' },
            to: { _id: 'sam', name: 'Sam Chen' },
            amount: 30,
          },
        ],
      },
    ]);
  });

  it('identifies people by id and keeps each currency and amount exact', () => {
    const balances: GroupCurrencyBalance[] = [
      {
        currency: 'INR',
        balances: [{ user: alex, balance: -1480.29 }],
        debts: [{ from: alex, to: sam, amount: 1480.29 }],
      },
      {
        currency: 'EUR',
        balances: [],
        debts: [{ from: alex, to: sam, amount: 0.29 }],
      },
      {
        currency: 'JPY',
        balances: [],
        debts: [{ from: sam, to: alex, amount: 2500 }],
      },
    ];
    const read = paymentBalances(balances);
    expect(read).toEqual([
      {
        currency: 'INR',
        balances: [{ user: { _id: 'alex', name: 'Alex Rivera' }, balance: -1480.29 }],
        debts: [
          {
            from: { _id: 'alex', name: 'Alex Rivera' },
            to: { _id: 'sam', name: 'Sam Chen' },
            amount: 1480.29,
          },
        ],
      },
      {
        currency: 'EUR',
        balances: [],
        debts: [
          {
            from: { _id: 'alex', name: 'Alex Rivera' },
            to: { _id: 'sam', name: 'Sam Chen' },
            amount: 0.29,
          },
        ],
      },
      {
        currency: 'JPY',
        balances: [],
        debts: [
          {
            from: { _id: 'sam', name: 'Sam Chen' },
            to: { _id: 'alex', name: 'Alex Rivera' },
            amount: 2500,
          },
        ],
      },
    ]);
    expect(
      settleAllDebtsBetween(read, 'alex', 'sam', ['INR', 'EUR', 'JPY'], ['alex', 'sam']),
    ).toEqual([
      { currency: 'INR', amountMinor: 148029 },
      { currency: 'EUR', amountMinor: 29 },
    ]);
    expect(
      settleAllDebtsBetween(read, 'sam', 'alex', ['INR', 'EUR', 'JPY'], ['alex', 'sam']),
    ).toEqual([{ currency: 'JPY', amountMinor: 2500 }]);
  });
});

describe('A single payment’s preview', () => {
  const priya = { id: 'priya', name: 'Priya Shah', image: null };
  // ₹10.005 is not an amount in rupees: a row holding it can't be read.
  const balances = (rows: Partial<GroupCurrencyBalance> = {}): GroupCurrencyBalance[] => [
    {
      currency: 'INR',
      balances: [
        { user: alex, balance: -30 },
        { user: sam, balance: 30 },
      ],
      debts: [{ from: alex, to: sam, amount: 30 }],
      ...rows,
    },
  ];
  const payment = { paidBy: 'alex', paidTo: 'sam', currency: 'INR', amountMinor: 4000 };

  it('reads only this pair’s rows: another person’s unreadable row never decides the payment', () => {
    const others = balances({
      balances: [
        { user: alex, balance: -30 },
        { user: sam, balance: 30 },
        { user: priya, balance: 10.005 },
      ],
      debts: [
        { from: alex, to: sam, amount: 30 },
        { from: priya, to: sam, amount: 10.005 },
      ],
    });
    // The sheet, with the suggestion it opened with; and Record, from the Balances just read.
    for (const preview of [paymentPreview(others, payment, 3000), paymentPreview(others, payment)])
      expect(preview).toMatchObject({
        suggestedMinor: 3000,
        overpays: true,
        overpaidMinor: 1000,
        paidBy: { userId: 'alex', beforeMinor: -3000, afterMinor: 1000 },
      });
  });

  it('never throws for the sheet when this pair’s own Debt can’t be read', () => {
    const unreadable = balances({ debts: [{ from: alex, to: sam, amount: 10.005 }] });
    expect(paymentPreview(unreadable, payment, 3000)).toMatchObject({
      suggestedMinor: 3000,
      overpays: true,
      paidBy: { afterMinor: 1000 },
    });
    // Record has no suggestion to check against, so it must not go on.
    expect(() => paymentPreview(unreadable, payment)).toThrow();
  });

  it('states no position when the payer’s own balance can’t be read', () => {
    const unreadable = balances({
      balances: [
        { user: alex, balance: -30.005 },
        { user: sam, balance: 30 },
      ],
    });
    expect(paymentPreview(unreadable, payment, 3000)).toMatchObject({
      overpays: true,
      overpaidMinor: 1000,
      paidBy: null,
    });
  });
});
