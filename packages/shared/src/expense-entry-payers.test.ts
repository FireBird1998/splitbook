import { describe, expect, it } from 'vitest';
import {
  readExpenseEntry,
  type ExpenseEntry,
  minorAmountText,
  setPayerAmount,
} from './expense-entry';

type PayerEntries = Pick<ExpenseEntry, 'amount' | 'currency' | 'payers'>;
const [alex, sam, priya] = ['alex', 'sam', 'priya'];
const members = [alex, sam, priya];
const entries = (amount: string, payers: [string, string][], currency = 'INR'): PayerEntries => ({
  amount,
  currency,
  payers: payers.map(([user, value]) => ({ user, amount: value })),
});

const payerEntry = (value: PayerEntries): ExpenseEntry => ({
  ...value,
  description: 'Lunch',
  date: '2026-09-28',
  payerId: alex,
  multiPayer: true,
  splitMethod: 'equal',
  participantIds: members,
  splitValues: {},
  category: 'other',
  tagId: '',
  notes: '',
});
const readPayers = (value: PayerEntries) =>
  readExpenseEntry(payerEntry(value), { kind: 'new' }).payers;
const payerRemainder = (value: PayerEntries) => {
  const { totalMinor, remainingMinor, assignedMinor, problems } = readPayers(value);
  return { totalMinor, remainingMinor, assignedMinor, problems };
};
const enteredPayers = (payers: PayerEntries['payers']) =>
  readPayers({ amount: '100', currency: 'INR', payers }).entries;
const payerEntryProblem = (amount: string, currency: string) =>
  readPayers(entries('100', [[alex, amount]], currency)).problems[alex];

describe('payer remainder', () => {
  it('counts what is left of the total, exactly', () => {
    expect(
      payerRemainder(
        entries('1249.50', [
          [alex, '1000.00'],
          [sam, '200'],
        ]),
      ),
    ).toEqual({ totalMinor: 124950, assignedMinor: 120000, remainingMinor: 4950, problems: {} });
    expect(
      payerRemainder(
        entries('0.3', [
          [alex, '0.1'],
          [sam, '0.2'],
        ]),
      ).remainingMinor,
    ).toBe(0);
  });

  it('goes negative when more than the total is entered', () => {
    expect(
      payerRemainder(
        entries('100', [
          [alex, '80'],
          [sam, '30'],
        ]),
      ).remainingMinor,
    ).toBe(-1000);
  });

  it('treats a blank entry as no payment, and nothing entered as the whole total left', () => {
    expect(
      payerRemainder(
        entries('100', [
          [alex, ''],
          [sam, '  '],
        ]),
      ),
    ).toMatchObject({
      assignedMinor: 0,
      remainingMinor: 10000,
      problems: {},
    });
    expect(payerRemainder(entries('100', [])).remainingMinor).toBe(10000);
  });

  it('counts an entry of 0 as blank: that person is not a payer', () => {
    // #187: in either precision, 0 written any way leaves only the people who paid something.
    for (const [currency, zeros] of [
      ['INR', ['0', '0.00', '-0', '.0']],
      ['JPY', ['0', '00']],
    ] as const)
      for (const zero of zeros) {
        const draft = entries(
          '100',
          [
            [alex, zero],
            [sam, '100'],
            [priya, ''],
          ],
          currency,
        );
        expect(enteredPayers(draft.payers)).toEqual([{ user: sam, amount: '100' }]);
        expect(payerRemainder(draft)).toMatchObject({ remainingMinor: 0, problems: {} });
      }
    // Text that can't be read is still an entry, explained beside it.
    expect(enteredPayers(entries('100', [[alex, '0.001']]).payers)).toEqual([
      { user: alex, amount: '0.001' },
    ]);
  });

  it('has no remainder while the Expense amount is not valid', () => {
    for (const amount of ['', '0', '12.345', 'abc'])
      expect(payerRemainder(entries(amount, [[alex, '5']]))).toMatchObject({
        totalMinor: null,
        remainingMinor: null,
        assignedMinor: 500,
      });
  });

  it('leaves entries that cannot count out of the sum and says why, without rounding', () => {
    const result = payerRemainder(
      entries('100', [
        [alex, '10.005'],
        [sam, '-5'],
        [priya, '1.2.3'],
      ]),
    );
    expect(result.assignedMinor).toBe(0);
    expect(result.problems).toEqual({ [alex]: 'invalid', [sam]: 'negative', [priya]: 'invalid' });
    expect(payerEntryProblem('10000001', 'INR')).toBe('too-large');
    expect(payerEntryProblem('10000000', 'INR')).toBeUndefined();
    expect(payerEntryProblem('0', 'INR')).toBeUndefined();
    expect(payerEntryProblem('  ', 'INR')).toBeUndefined();
  });

  it('bounds an entry by the largest Expense amount in 0- and 2-decimal currencies', () => {
    expect(payerEntryProblem('88888888888888.01', 'INR')).toBe('too-large');
    expect(payerEntryProblem('10000000.01', 'INR')).toBe('too-large');
    expect(payerEntryProblem('10000000.00', 'INR')).toBeUndefined();
    expect(payerEntryProblem('10000001', 'JPY')).toBe('too-large');
    expect(payerEntryProblem('10000000', 'JPY')).toBeUndefined();
  });

  it('follows the currency’s precision', () => {
    expect(payerRemainder(entries('1000', [[alex, '400']], 'JPY')).remainingMinor).toBe(600);
    expect(payerEntryProblem('1.5', 'JPY')).toBe('invalid');
    expect(minorAmountText(600, 'JPY')).toBe('600');
    expect(minorAmountText(5, 'INR')).toBe('0.05');
    expect(minorAmountText(4950, 'INR')).toBe('49.50');
  });
});

describe('payer entries', () => {
  it('updates an entry, adds a new one, and removes a cleared one', () => {
    const payers = entries('10', [[alex, '6']]).payers;
    expect(setPayerAmount(payers, alex, '7')).toEqual([{ user: alex, amount: '7' }]);
    expect(setPayerAmount(payers, sam, '4')).toEqual([
      { user: alex, amount: '6' },
      { user: sam, amount: '4' },
    ]);
    expect(setPayerAmount(payers, alex, '')).toEqual([]);
    expect(setPayerAmount(payers, sam, '')).toEqual(payers);
  });
});

it.each([
  ['10.005', 'INR', 'INR amounts can have at most 2 decimal places. Nothing is rounded for you.'],
  ['1.5', 'JPY', 'Yen has no smaller unit. Enter a whole amount, like ¥2,500.'],
  ['1.2.3', 'INR', 'Use digits and one decimal point, such as 250.50.'],
  ['-5', 'INR', 'Enter an amount of 0 or more.'],
  ['10000001', 'INR', 'Enter an amount of at most 10,000,000.'],
  ['0', 'INR', undefined],
  ['  ', 'INR', undefined],
])('explains the payer box %s in %s without rounding', (amount, currency, words) => {
  expect(readPayers(entries('100', [[alex, amount]], currency)).errors[alex]).toBe(words);
});
