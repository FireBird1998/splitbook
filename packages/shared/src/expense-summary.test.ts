import { describe, expect, it } from 'vitest';
import { computeMemberBreakdown, computeUserOweGetBack } from './expense-summary';

const A = 'a00000000000000000000001';
const B = 'a00000000000000000000002';
const C = 'a00000000000000000000003';

function sum(
  rows: Array<{ paid: number; share: number; net: number }>,
  key: 'paid' | 'share' | 'net',
) {
  return Math.round(rows.reduce((total, row) => total + row[key], 0) * 100) / 100;
}

describe('computeMemberBreakdown', () => {
  it('accumulates multi-payer expenses with uneven splits', () => {
    const rows = computeMemberBreakdown(
      [
        // A and B co-pay 300; A owes 200 of it, B owes 100.
        {
          paidBy: [
            { user: A, amount: 120 },
            { user: B, amount: 180 },
          ],
          splitBetween: [
            { user: A, amount: 200 },
            { user: B, amount: 100 },
          ],
        },
        // C pays 90, split three ways.
        {
          paidBy: [{ user: C, amount: 90 }],
          splitBetween: [
            { user: A, amount: 30 },
            { user: B, amount: 30 },
            { user: C, amount: 30 },
          ],
        },
      ],
      [A, B, C],
    );

    expect(rows).toEqual([
      { userId: A, paid: 120, share: 230, net: 110 },
      { userId: B, paid: 180, share: 130, net: -50 },
      { userId: C, paid: 90, share: 30, net: -60 },
    ]);
    expect(sum(rows, 'paid')).toBe(390);
    expect(sum(rows, 'share')).toBe(390);
    expect(sum(rows, 'net')).toBe(0);
  });

  it('gives a member who is in splits but never paid a positive net', () => {
    const rows = computeMemberBreakdown(
      [
        {
          paidBy: [{ user: A, amount: 100 }],
          splitBetween: [
            { user: A, amount: 50 },
            { user: B, amount: 50 },
          ],
        },
      ],
      [A, B],
    );

    expect(rows.find((row) => row.userId === B)).toEqual({
      userId: B,
      paid: 0,
      share: 50,
      net: 50,
    });
  });

  it('gives a member who paid but is not in any split a negative net', () => {
    const rows = computeMemberBreakdown(
      [
        // A covers a 60 expense that is entirely B's share.
        {
          paidBy: [{ user: A, amount: 60 }],
          splitBetween: [{ user: B, amount: 60 }],
        },
      ],
      [A, B],
    );

    expect(rows.find((row) => row.userId === A)).toEqual({
      userId: A,
      paid: 60,
      share: 0,
      net: -60,
    });
    expect(sum(rows, 'net')).toBe(0);
  });

  it('keeps nets summing to zero under rounding', () => {
    // 100 split three ways with cent leftovers.
    const rows = computeMemberBreakdown(
      [
        {
          paidBy: [{ user: A, amount: 100 }],
          splitBetween: [
            { user: A, amount: 33.34 },
            { user: B, amount: 33.33 },
            { user: C, amount: 33.33 },
          ],
        },
      ],
      [A, B, C],
    );

    expect(Math.abs(sum(rows, 'net'))).toBeLessThanOrEqual(0.01);
    expect(sum(rows, 'paid')).toBe(100);
    expect(sum(rows, 'share')).toBe(100);
  });

  it('returns all-zero rows for an empty window, in member order', () => {
    const rows = computeMemberBreakdown([], [B, A, C]);

    expect(rows).toEqual([
      { userId: B, paid: 0, share: 0, net: 0 },
      { userId: A, paid: 0, share: 0, net: 0 },
      { userId: C, paid: 0, share: 0, net: 0 },
    ]);
  });

  it('handles populated user objects ({ _id }) as well as raw ids', () => {
    const rows = computeMemberBreakdown(
      [
        {
          paidBy: [{ user: { _id: A }, amount: 40 }],
          splitBetween: [{ user: { _id: B }, amount: 40 }],
        },
      ],
      [A, B],
    );

    expect(rows.find((row) => row.userId === A)?.paid).toBe(40);
    expect(rows.find((row) => row.userId === B)?.share).toBe(40);
  });
});

describe('computeUserOweGetBack', () => {
  const expenses = [
    // A paid 100, split evenly A/B — B owes 50 into the window.
    {
      paidBy: [{ user: A, amount: 100 }],
      splitBetween: [
        { user: A, amount: 50 },
        { user: B, amount: 50 },
      ],
    },
    // B paid 30, entirely A's share — A owes 30.
    {
      paidBy: [{ user: B, amount: 30 }],
      splitBetween: [{ user: A, amount: 30 }],
    },
  ];

  it('computes owe and get-back from the same pass', () => {
    const a = computeUserOweGetBack(expenses, A);
    expect(a.userOwes).toBe(30);
    expect(a.userGetsBack).toBe(50);

    const b = computeUserOweGetBack(expenses, B);
    expect(b.userOwes).toBe(50);
    expect(b.userGetsBack).toBe(30);
  });

  it('returns zeroes for a user with no activity', () => {
    const result = computeUserOweGetBack(expenses, C);
    expect(result).toEqual({ userOwes: 0, userGetsBack: 0 });
  });
});
