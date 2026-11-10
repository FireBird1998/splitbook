import { describe, expect, it } from 'vitest';
import { settleAllDebtsBetween } from '@splitbook/shared/settle-all';
import { paymentBalances } from './payment-balances';
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
