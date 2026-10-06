import { describe, expect, it } from 'vitest';
import {
  aggregateCurrencyBalances,
  homeCurrencyBalances,
  memberSuggestedPayments,
  orderSuggestedPayments,
  selectNextAction,
} from './dashboard';
import { MoneyValidationError } from './exact-money';
import { simplifyDebtsMinor } from './debt-simplifier';
import type { DashboardGroupBalance, HomeSuggestedPayment } from './types';

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

// Fictional people and Groups for Needs you (#306).
const alex = 'a1';
const sam = 's2';
const priya = 'p3';
const jordan = 'j4';

describe('memberSuggestedPayments', () => {
  it('keeps every payment the member makes or receives, and none between two other people', () => {
    // Alex is owed ₹60.00 and ₹15.50, Sam owes ₹40.00, Priya owes ₹25.00, Jordan owes ₹10.50.
    const transactions = simplifyDebtsMinor([
      { userId: alex, amountMinor: 7550 },
      { userId: sam, amountMinor: -4000 },
      { userId: priya, amountMinor: -2500 },
      { userId: jordan, amountMinor: -1050 },
    ]);
    expect(memberSuggestedPayments(transactions, alex)).toEqual([
      { direction: 'receive', counterpartyId: sam, amountMinor: 4000 },
      { direction: 'receive', counterpartyId: priya, amountMinor: 2500 },
      { direction: 'receive', counterpartyId: jordan, amountMinor: 1050 },
    ]);
    expect(memberSuggestedPayments(transactions, sam)).toEqual([
      { direction: 'pay', counterpartyId: alex, amountMinor: 4000 },
    ]);
  });

  it('lists every payment of a member who pays more than one person, not only the largest', () => {
    const transactions = simplifyDebtsMinor([
      { userId: alex, amountMinor: -866_100 },
      { userId: priya, amountMinor: 584_900 },
      { userId: sam, amountMinor: 281_200 },
    ]);
    expect(memberSuggestedPayments(transactions, alex)).toEqual([
      { direction: 'pay', counterpartyId: priya, amountMinor: 584_900 },
      { direction: 'pay', counterpartyId: sam, amountMinor: 281_200 },
    ]);
  });

  it('is empty for a member who is settled up, or not in any payment', () => {
    const transactions = [{ from: sam, to: priya, amountMinor: 100 }];
    expect(memberSuggestedPayments(transactions, alex)).toEqual([]);
    expect(memberSuggestedPayments([], alex)).toEqual([]);
  });

  it('leaves out a zero payment and a payment to oneself, and refuses an inexact amount', () => {
    expect(
      memberSuggestedPayments(
        [
          { from: alex, to: sam, amountMinor: 0 },
          { from: alex, to: alex, amountMinor: 100 },
        ],
        alex,
      ),
    ).toEqual([]);
    expect(() =>
      memberSuggestedPayments([{ from: alex, to: sam, amountMinor: 1.5 }], alex),
    ).toThrow(MoneyValidationError);
  });
});

describe('orderSuggestedPayments', () => {
  const payment = (overrides: Partial<HomeSuggestedPayment>): HomeSuggestedPayment => ({
    groupId: 'g1',
    groupName: 'Maple House',
    currency: 'INR',
    direction: 'pay',
    counterpartyId: sam,
    counterpartyName: 'Sam Chen',
    amountMinor: 100,
    ...overrides,
  });

  it('puts what the member pays first, then by currency and the largest amount', () => {
    const receive = payment({ direction: 'receive', amountMinor: 999_999 });
    const eur = payment({ currency: 'EUR', amountMinor: 50 });
    const small = payment({ amountMinor: 42_000 });
    const large = payment({ amountMinor: 106_000, counterpartyId: priya });
    expect(orderSuggestedPayments([receive, small, large, eur])).toEqual([
      eur,
      large,
      small,
      receive,
    ]);
  });

  it('breaks ties by Group, then by person, whatever order the Groups were read in', () => {
    const goaSam = payment({ groupId: 'g2', groupName: 'Goa Friends Trip' });
    const mapleSam = payment({ groupId: 'g1', groupName: 'Maple House' });
    const maplePriya = payment({ counterpartyId: priya, counterpartyName: 'Priya Shah' });
    const expected = [goaSam, maplePriya, mapleSam];
    expect(orderSuggestedPayments([mapleSam, maplePriya, goaSam])).toEqual(expected);
    expect(orderSuggestedPayments([goaSam, mapleSam, maplePriya])).toEqual(expected);
  });

  it('returns a new list and leaves the given one as it was', () => {
    const given = [payment({ amountMinor: 1 }), payment({ amountMinor: 2 })];
    const ordered = orderSuggestedPayments(given);
    expect(ordered).not.toBe(given);
    expect(given.map(({ amountMinor }) => amountMinor)).toEqual([1, 2]);
  });
});

describe('homeCurrencyBalances', () => {
  const balances = (...items: Array<[string, number]>) => ({
    balances: items.map(([currency, balance]) => ({ currency, balance })),
  });

  it('gives each currency its net, what is owed both ways, and how many Groups it covers', () => {
    expect(
      homeCurrencyBalances(
        [
          { currency: 'EUR', youOwe: 0, youAreOwed: 42.5 },
          { currency: 'INR', youOwe: 1480, youAreOwed: 620 },
        ],
        [
          balances(['INR', -1480]),
          balances(['EUR', 12.5], ['INR', 620]),
          balances(['EUR', 30]),
          // Settled up: covers nothing.
          balances(),
        ],
      ),
    ).toEqual([
      // Two Groups each: ordered by currency.
      { currency: 'EUR', netMinor: 4250, youOweMinor: 0, owedToYouMinor: 4250, groupCount: 2 },
      {
        currency: 'INR',
        netMinor: -86_000,
        youOweMinor: 148_000,
        owedToYouMinor: 62_000,
        groupCount: 2,
      },
    ]);
  });

  it('puts the currency with the most Groups first', () => {
    const result = homeCurrencyBalances(
      [
        { currency: 'EUR', youOwe: 0, youAreOwed: 30 },
        { currency: 'INR', youOwe: 20, youAreOwed: 10 },
      ],
      [balances(['INR', -20]), balances(['INR', 10]), balances(['EUR', 30])],
    );
    expect(result.map(({ currency, groupCount }) => [currency, groupCount])).toEqual([
      ['INR', 2],
      ['EUR', 1],
    ]);
  });

  it('counts no Group for a balance of exactly zero, and nets what is owed both ways to zero', () => {
    expect(
      homeCurrencyBalances(
        [{ currency: 'INR', youOwe: 100, youAreOwed: 100 }],
        [balances(['INR', 100]), balances(['INR', -100]), balances(['INR', 0])],
      ),
    ).toEqual([
      { currency: 'INR', netMinor: 0, youOweMinor: 10_000, owedToYouMinor: 10_000, groupCount: 2 },
    ]);
  });

  it('reads exact minor units, restoring binary tails, and keeps each currency’s precision', () => {
    const [inr] = homeCurrencyBalances(
      [{ currency: 'INR', youOwe: 0.1 + 0.2, youAreOwed: 0 }],
      [balances(['INR', -(0.1 + 0.2)])],
    );
    expect(inr).toMatchObject({ netMinor: -30, youOweMinor: 30, groupCount: 1 });
    const [jpy] = homeCurrencyBalances(
      [{ currency: 'JPY', youOwe: 0, youAreOwed: 1500 }],
      [balances(['JPY', 1500])],
    );
    expect(jpy).toMatchObject({ netMinor: 1500, owedToYouMinor: 1500 });
  });

  it('refuses an amount it can’t read exactly, rather than round it', () => {
    expect(() =>
      homeCurrencyBalances([{ currency: 'INR', youOwe: 1.005, youAreOwed: 0 }], []),
    ).toThrow(MoneyValidationError);
    expect(() =>
      homeCurrencyBalances([{ currency: 'XYZ', youOwe: 1, youAreOwed: 0 }], []),
    ).toThrow();
  });

  it('is empty when the member owes and is owed nothing', () => {
    expect(homeCurrencyBalances([], [balances()])).toEqual([]);
  });
});
