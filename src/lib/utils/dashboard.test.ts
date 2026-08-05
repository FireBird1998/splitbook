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
        balances: [{ currency: 'INR', balance: -1250 }],
      }),
      group({
        groupId: 'paris',
        name: 'Paris',
        balances: [{ currency: 'EUR', balance: 42 }],
      }),
    ]);

    expect(result).toEqual([
      { currency: 'EUR', youOwe: 0, youAreOwed: 42, net: 42 },
      { currency: 'INR', youOwe: 1250, youAreOwed: 0, net: -1250 },
    ]);
  });

  it('combines only balances that share a currency', () => {
    const result = aggregateCurrencyBalances([
      group({
        groupId: 'one',
        name: 'One',
        balances: [
          { currency: 'USD', balance: -10.25 },
          { currency: 'EUR', balance: -5 },
        ],
      }),
      group({
        groupId: 'two',
        name: 'Two',
        balances: [{ currency: 'USD', balance: 4.5 }],
      }),
    ]);

    expect(result).toEqual([
      { currency: 'EUR', youOwe: 5, youAreOwed: 0, net: -5 },
      { currency: 'USD', youOwe: 10.25, youAreOwed: 4.5, net: -5.75 },
    ]);
  });

  it('nets owing and owed amounts within the same currency across many groups', () => {
    const result = aggregateCurrencyBalances([
      group({
        groupId: 'a',
        name: 'A',
        balances: [{ currency: 'INR', balance: -100 }],
      }),
      group({
        groupId: 'b',
        name: 'B',
        balances: [{ currency: 'INR', balance: 250 }],
      }),
      group({
        groupId: 'c',
        name: 'C',
        balances: [{ currency: 'INR', balance: -50 }],
      }),
    ]);

    expect(result).toEqual([{ currency: 'INR', youOwe: 150, youAreOwed: 250, net: 100 }]);
  });

  it('rounds bucket totals to cents to avoid floating point drift', () => {
    const result = aggregateCurrencyBalances([
      group({
        groupId: 'a',
        name: 'A',
        balances: [{ currency: 'USD', balance: -10.1 }],
      }),
      group({
        groupId: 'b',
        name: 'B',
        balances: [{ currency: 'USD', balance: -0.2 }],
      }),
    ]);

    expect(result).toEqual([{ currency: 'USD', youOwe: 10.3, youAreOwed: 0, net: -10.3 }]);
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
            balances: [{ currency: 'INR', balance: 500 }],
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
