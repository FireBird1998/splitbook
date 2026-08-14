import { describe, expect, it } from 'vitest';
import { aggregateCurrencyBalances, selectNextAction } from './dashboard';
import type { DashboardGroupBalance } from '@/types';

const group = (
  overrides: Partial<DashboardGroupBalance> & Pick<DashboardGroupBalance, 'groupId' | 'name'>,
): DashboardGroupBalance => ({
  category: 'trip',
  updatedAt: '2026-07-20T12:00:00.000Z',
  hasMixedCurrencies: false,
  balances: [],
  ...overrides,
});

describe('aggregateCurrencyBalances', () => {
  it('returns an empty list when there are no group balances', () => {
    expect(aggregateCurrencyBalances([])).toEqual([]);
  });

  it('keeps totals in separate currency buckets', () => {
    const result = aggregateCurrencyBalances([
      group({
        groupId: 'goa',
        name: 'Goa',
        balances: [{ currency: 'INR', balance: -1250, counterparties: [] }],
      }),
      group({
        groupId: 'paris',
        name: 'Paris',
        balances: [{ currency: 'EUR', balance: 42, counterparties: [] }],
      }),
    ]);

    expect(result).toEqual([
      { currency: 'EUR', youOwe: 0, youAreOwed: 42, net: 42, oweBreakdown: [], owedBreakdown: [] },
      {
        currency: 'INR',
        youOwe: 1250,
        youAreOwed: 0,
        net: -1250,
        oweBreakdown: [],
        owedBreakdown: [],
      },
    ]);
  });

  it('combines only balances that share a currency', () => {
    const result = aggregateCurrencyBalances([
      group({
        groupId: 'one',
        name: 'One',
        balances: [
          { currency: 'USD', balance: -10.25, counterparties: [] },
          { currency: 'EUR', balance: -5, counterparties: [] },
        ],
      }),
      group({
        groupId: 'two',
        name: 'Two',
        balances: [{ currency: 'USD', balance: 4.5, counterparties: [] }],
      }),
    ]);

    expect(result).toMatchObject([
      { currency: 'EUR', youOwe: 5, youAreOwed: 0, net: -5 },
      { currency: 'USD', youOwe: 10.25, youAreOwed: 4.5, net: -5.75 },
    ]);
  });

  it('nets owing and owed amounts within the same currency across many groups', () => {
    const result = aggregateCurrencyBalances([
      group({
        groupId: 'a',
        name: 'A',
        balances: [{ currency: 'INR', balance: -100, counterparties: [] }],
      }),
      group({
        groupId: 'b',
        name: 'B',
        balances: [{ currency: 'INR', balance: 250, counterparties: [] }],
      }),
      group({
        groupId: 'c',
        name: 'C',
        balances: [{ currency: 'INR', balance: -50, counterparties: [] }],
      }),
    ]);

    expect(result).toMatchObject([{ currency: 'INR', youOwe: 150, youAreOwed: 250, net: 100 }]);
  });

  it('rounds bucket totals to cents to avoid floating point drift', () => {
    const result = aggregateCurrencyBalances([
      group({
        groupId: 'a',
        name: 'A',
        balances: [{ currency: 'USD', balance: -10.1, counterparties: [] }],
      }),
      group({
        groupId: 'b',
        name: 'B',
        balances: [{ currency: 'USD', balance: -0.2, counterparties: [] }],
      }),
    ]);

    expect(result).toMatchObject([{ currency: 'USD', youOwe: 10.3, youAreOwed: 0, net: -10.3 }]);
  });

  it('splits counterparties into owe and owed breakdowns, largest first', () => {
    const [bucket] = aggregateCurrencyBalances([
      group({
        groupId: 'goa',
        name: 'Goa',
        balances: [
          {
            currency: 'INR',
            balance: -3000,
            counterparties: [
              { counterpartyId: 'sam', counterpartyName: 'Sam', amount: 1000, direction: 'owe' },
              {
                counterpartyId: 'priya',
                counterpartyName: 'Priya',
                amount: 2000,
                direction: 'owe',
              },
            ],
          },
        ],
      }),
      group({
        groupId: 'paris',
        name: 'Paris',
        balances: [
          {
            currency: 'INR',
            balance: 500,
            counterparties: [
              { counterpartyId: 'alex', counterpartyName: 'Alex', amount: 500, direction: 'owed' },
            ],
          },
        ],
      }),
    ]);

    expect(bucket.oweBreakdown.map((entry) => [entry.counterpartyName, entry.amount])).toEqual([
      ['Priya', 2000],
      ['Sam', 1000],
    ]);
    expect(bucket.owedBreakdown).toHaveLength(1);
    expect(bucket.owedBreakdown[0]).toMatchObject({ counterpartyName: 'Alex', amount: 500 });
  });

  it('merges the same person across trips and keeps the per-trip detail', () => {
    const [bucket] = aggregateCurrencyBalances([
      group({
        groupId: 'goa',
        name: 'Goa',
        balances: [
          {
            currency: 'INR',
            balance: -1200,
            counterparties: [
              { counterpartyId: 'sam', counterpartyName: 'Sam', amount: 1200, direction: 'owe' },
            ],
          },
        ],
      }),
      group({
        groupId: 'manali',
        name: 'Manali',
        balances: [
          {
            currency: 'INR',
            balance: -800,
            counterparties: [
              { counterpartyId: 'sam', counterpartyName: 'Sam', amount: 800, direction: 'owe' },
            ],
          },
        ],
      }),
    ]);

    expect(bucket.oweBreakdown).toHaveLength(1);
    expect(bucket.oweBreakdown[0].amount).toBe(2000);
    expect(bucket.oweBreakdown[0].groups).toEqual([
      { groupId: 'goa', groupName: 'Goa', amount: 1200 },
      { groupId: 'manali', groupName: 'Manali', amount: 800 },
    ]);
  });

  it('keeps each breakdown summing to its bucket total', () => {
    const [bucket] = aggregateCurrencyBalances([
      group({
        groupId: 'a',
        name: 'A',
        balances: [
          {
            currency: 'USD',
            balance: -10.15,
            counterparties: [
              { counterpartyId: 'x', counterpartyName: 'X', amount: 10.15, direction: 'owe' },
            ],
          },
        ],
      }),
      group({
        groupId: 'b',
        name: 'B',
        balances: [
          {
            currency: 'USD',
            balance: -0.2,
            counterparties: [
              { counterpartyId: 'y', counterpartyName: 'Y', amount: 0.2, direction: 'owe' },
            ],
          },
        ],
      }),
    ]);

    const breakdownTotal = bucket.oweBreakdown.reduce((sum, entry) => sum + entry.amount, 0);
    expect(breakdownTotal).toBeCloseTo(bucket.youOwe, 2);
  });
});

describe('selectNextAction', () => {
  it('recommends creating a group when none exist', () => {
    expect(selectNextAction([], 0)).toMatchObject({
      kind: 'create-group',
      href: '/groups/new',
    });
  });

  it('prioritizes the largest payment the user can settle across currencies', () => {
    const result = selectNextAction(
      [
        group({
          groupId: 'recent-small',
          name: 'Weekend',
          updatedAt: '2026-07-24T00:00:00.000Z',
          balances: [
            {
              currency: 'USD',
              balance: -5,
              settlement: { counterpartyId: 'sam', counterpartyName: 'Sam', amount: 5 },
              counterparties: [
                { counterpartyId: 'sam', counterpartyName: 'Sam', amount: 5, direction: 'owe' },
              ],
            },
          ],
        }),
        group({
          groupId: 'large',
          name: 'Goa',
          updatedAt: '2026-07-20T00:00:00.000Z',
          balances: [
            {
              currency: 'INR',
              balance: -2500,
              settlement: { counterpartyId: 'priya', counterpartyName: 'Priya', amount: 2500 },
              counterparties: [
                {
                  counterpartyId: 'priya',
                  counterpartyName: 'Priya',
                  amount: 2500,
                  direction: 'owe',
                },
              ],
            },
          ],
        }),
      ],
      2,
    );

    expect(result).toMatchObject({
      kind: 'settle',
      groupId: 'large',
      counterpartyName: 'Priya',
      amount: 2500,
      currency: 'INR',
      href: '/groups/large?tab=balances',
    });
  });

  it('surfaces pending invitations before suggesting another expense', () => {
    expect(
      selectNextAction(
        [
          group({
            groupId: 'goa',
            name: 'Goa',
            balances: [{ currency: 'INR', balance: 500, counterparties: [] }],
          }),
        ],
        1,
      ),
    ).toMatchObject({ kind: 'review-invitations', href: '#pending-actions' });
  });

  it('suggests adding an expense to the most recently active group', () => {
    const result = selectNextAction(
      [
        group({
          groupId: 'older',
          name: 'Older',
          updatedAt: '2026-07-01T00:00:00.000Z',
        }),
        group({
          groupId: 'newer',
          name: 'Newer',
          updatedAt: '2026-07-24T00:00:00.000Z',
        }),
      ],
      0,
    );

    expect(result).toMatchObject({
      kind: 'add-expense',
      groupId: 'newer',
      href: '/groups/newer?action=add-expense',
    });
  });
});
