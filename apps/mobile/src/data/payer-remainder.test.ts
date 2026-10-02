import { describe, expect, it } from 'vitest';
import {
  giveRest,
  minorAmountText,
  payerEntryError,
  payerRemainder,
  restRecipient,
  setPayerAmount,
} from './payer-remainder';

const [alex, sam, priya] = ['alex', 'sam', 'priya'];
const members = [alex, sam, priya];
const entries = (amount: string, payers: [string, string][], currency = 'INR') => ({
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
    ).toEqual({ totalMinor: 124950, assignedMinor: 120000, remainingMinor: 4950, errors: {} });
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
      errors: {},
    });
    expect(payerRemainder(entries('100', [])).remainingMinor).toBe(10000);
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
    expect(result.errors).toEqual({
      [alex]: 'INR amounts can have at most 2 decimal places. Nothing is rounded for you.',
      [sam]: 'Enter an amount of 0 or more.',
      [priya]: 'Use digits and one decimal point, such as 250.50.',
    });
    expect(payerEntryError('10000001', 'INR')).toBe('Enter an amount of at most 10,000,000.');
    expect(payerEntryError('0', 'INR')).toBeUndefined();
  });

  it('follows the currency’s precision', () => {
    expect(payerRemainder(entries('1000', [[alex, '400']], 'JPY')).remainingMinor).toBe(600);
    expect(payerEntryError('1.5', 'JPY')).toBe(
      'JPY amounts can’t include decimal places. Nothing is rounded for you.',
    );
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

  it('follows the Group’s order and skips anyone who entered something, even 0', () => {
    const draft = entries('100', [
      [priya, '60'],
      [alex, '0'],
      [sam, ''],
    ]);
    expect(restRecipient(draft, members)).toBe(sam);
    expect(giveRest(draft, members)?.payers).toEqual([
      { user: priya, amount: '60' },
      { user: alex, amount: '0' },
      { user: sam, amount: '40.00' },
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
