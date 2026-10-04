import { describe, expect, it } from 'vitest';
import {
  enteredPayers,
  giveRest,
  minorAmountText,
  payerEntryProblem,
  payerRemainder,
  restRecipient,
  setPayerAmount,
  type PayerEntries,
} from './payer-remainder';

const [alex, sam, priya] = ['alex', 'sam', 'priya'];
const members = [alex, sam, priya];
const entries = (amount: string, payers: [string, string][], currency = 'INR'): PayerEntries => ({
  amount,
  currency,
  payers: payers.map(([user, value]) => ({ user, amount: value })),
});

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

describe('give the rest', () => {
  it('fills the remaining amount into the first member with nothing entered', () => {
    const draft = entries('1249.50', [
      [alex, '1000.00'],
      [sam, '200.00'],
    ]);
    expect(restRecipient(draft, members)).toBe(priya);
    expect(giveRest(draft, members)).toEqual({
      payers: [
        { user: alex, amount: '1000.00' },
        { user: sam, amount: '200.00' },
        { user: priya, amount: '49.50' },
      ],
    });
    const filled = { ...draft, ...giveRest(draft, members)! };
    expect(payerRemainder(filled).remainingMinor).toBe(0);
  });

  it('follows the Group’s order, and counts someone who entered 0 as having entered nothing', () => {
    const draft = entries('100', [
      [priya, '60'],
      [alex, '0'],
      [sam, ''],
    ]);
    expect(restRecipient(draft, members)).toBe(alex);
    expect(giveRest(draft, members)?.payers).toEqual([
      { user: priya, amount: '60' },
      { user: alex, amount: '40.00' },
      { user: sam, amount: '' },
    ]);
    expect(restRecipient(entries('100', []), members)).toBe(alex);
  });

  it('offers nothing when the total adds up, is exceeded, is unknown or an entry needs fixing', () => {
    const cases = [
      entries('100', [[alex, '100']]),
      entries('100', [[alex, '120']]),
      entries('', [[alex, '20']]),
      entries('100', [
        [alex, '20'],
        [sam, '1.234'],
      ]),
    ];
    for (const draft of cases) {
      expect(restRecipient(draft, members)).toBeNull();
      expect(giveRest(draft, members)).toBeNull();
    }
  });

  it('never gives the rest to someone outside the Group, or when everyone has an entry', () => {
    const everyone = entries('100', [
      [alex, '10'],
      [sam, '10'],
      [priya, '10'],
    ]);
    expect(restRecipient(everyone, members)).toBeNull();
    expect(restRecipient(entries('100', [['former', '10']]), [])).toBeNull();
  });
});
