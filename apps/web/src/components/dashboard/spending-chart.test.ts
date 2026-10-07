import { describe, expect, it } from 'vitest';
import type { UserSpendingRead } from '@splitbook/shared/user-spending-read';
import {
  compactMoney,
  explainTrend,
  monthLabel,
  spendingChartModel,
  valueAxis,
} from './spending-chart';

const maple = 'b00000000000000000000001';
const goa = 'b00000000000000000000002';
const MONTHS = ['2026-08', '2026-09', '2026-10'];
const groupName = (groupId: string) => (groupId === goa ? 'Goa Friends Trip' : 'Maple House');

const read: UserSpendingRead = {
  timeZone: 'Asia/Kolkata',
  months: MONTHS,
  window: { from: '2026-08-01', to: '2026-10-31' },
  groups: [
    { groupId: maple, name: 'Maple House' },
    { groupId: goa, name: 'Goa Friends Trip' },
  ],
  currencies: [
    {
      currency: 'INR',
      totalMinor: 30001,
      expenseCount: 3,
      months: [
        { month: '2026-08', shareMinor: 10000, byGroup: [{ groupId: maple, shareMinor: 10000 }] },
        // A Month the read left out is shown as zero.
        {
          month: '2026-10',
          shareMinor: 20001,
          byGroup: [
            { groupId: goa, shareMinor: 20000 },
            { groupId: maple, shareMinor: 1 },
          ],
        },
      ],
    },
    {
      currency: 'JPY',
      totalMinor: 1500,
      expenseCount: 1,
      months: MONTHS.map((month) => ({
        month,
        shareMinor: month === '2026-09' ? 1500 : 0,
        byGroup: month === '2026-09' ? [{ groupId: goa, shareMinor: 1500 }] : [],
      })),
    },
  ],
};

describe('labels', () => {
  it('names Months without any time zone shifting them', () => {
    expect(monthLabel('2026-01', 'short')).toBe('Jan');
    expect(monthLabel('2026-12', 'long')).toBe('December 2026');
    expect(monthLabel('2026-03', 'name')).toBe('March');
  });

  it('shortens axis amounts', () => {
    expect(compactMoney(10000, 'INR')).toBe('₹10K');
    expect(compactMoney(7500, 'INR')).toBe('₹7.5K');
    expect(compactMoney(0, 'EUR')).toBe('€0');
  });
});

describe('the value axis', () => {
  it.each([
    [2960, 4000, [0, 1000, 2000, 3000, 4000]],
    [45468.02, 60000, [0, 15000, 30000, 45000, 60000]],
    [9420, 12000, [0, 3000, 6000, 9000, 12000]],
    [8000, 10000, [0, 2500, 5000, 7500, 10000]],
    [0.5, 0.6, [0, 0.15, 0.3, 0.45, 0.6]],
  ])('fits %d under a round top of %d, in four steps', (highest, max, ticks) => {
    const axis = valueAxis(highest);
    expect(axis.max).toBeCloseTo(max);
    axis.ticks.forEach((tick, index) => expect(tick).toBeCloseTo(ticks[index]));
    // Room above the tallest column for its figure.
    expect(axis.max).toBeGreaterThanOrEqual(highest * 1.15);
  });

  it('still draws an axis with nothing to show', () => {
    expect(valueAxis(0)).toEqual({ max: 4, ticks: [0, 1, 2, 3, 4] });
  });
});

describe("one currency's figures", () => {
  it('builds a row per Month from exact minor units, the current Month last', () => {
    const model = spendingChartModel(read)!;
    expect(model.currency).toBe('INR');
    expect(model.currencies).toEqual(['INR', 'JPY']);
    expect(model.rows.map((row) => [row.short, row.amount, row.text, row.current])).toEqual([
      ['Aug', 100, '₹100.00', false],
      ['Sep', 0, '₹0.00', false],
      ['Oct', 200.01, '₹200.01', true],
    ]);
    expect(model.rows[2].parts).toEqual([
      { groupId: goa, name: 'Goa Friends Trip', amount: 200, text: '₹200.00' },
      { groupId: maple, name: 'Maple House', amount: 0.01, text: '₹0.01' },
    ]);
  });

  it('orders the table’s Group columns by their total, largest first', () => {
    expect(spendingChartModel(read)!.groups.map((group) => group.name)).toEqual([
      'Goa Friends Trip',
      'Maple House',
    ]);
  });

  it('switches to another currency the member has, in its own precision', () => {
    const model = spendingChartModel(read, 'JPY')!;
    expect(model.currency).toBe('JPY');
    expect(model.rows.map((row) => row.text)).toEqual(['¥0', '¥1,500', '¥0']);
  });

  it('falls back to the first currency when the chosen one has no spending', () => {
    expect(spendingChartModel(read, 'EUR')!.currency).toBe('INR');
  });

  it('is null when there is no spending at all', () => {
    expect(spendingChartModel({ ...read, currencies: [] })).toBeNull();
  });
});

describe('the explanation', () => {
  const options = { currency: 'INR', groupName, earlierMonths: 5 };

  it('names the Group behind a rise', () => {
    expect(
      explainTrend(
        {
          kind: 'up',
          month: '2026-09',
          totalMinor: 942000,
          groupId: goa,
          groupShareMinor: 328000,
        },
        options,
      ),
    ).toBe('September is up because of Goa Friends Trip: ₹3,280.00 of your ₹9,420.00.');
  });

  it('compares a quieter Month with the average of the Months before it', () => {
    expect(
      explainTrend(
        { kind: 'down', month: '2026-09', totalMinor: 210000, averageMinor: 638083 },
        options,
      ),
    ).toBe('So far, September is below your average of ₹6,380.83 for the 5 months before.');
    expect(
      explainTrend(
        { kind: 'level', month: '2026-09', totalMinor: 500, averageMinor: 500 },
        { ...options, earlierMonths: 1 },
      ),
    ).toBe('September matches your average of ₹5.00 for the month before.');
  });

  it('says when nothing has happened yet, and says nothing without a comparison', () => {
    expect(explainTrend({ kind: 'none', month: '2026-10' }, options)).toBe(
      'Nothing in October yet.',
    );
    expect(explainTrend(null, options)).toBeNull();
  });
});
