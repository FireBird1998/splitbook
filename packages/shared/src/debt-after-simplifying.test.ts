import { describe, expect, it } from 'vitest';
import { debtsAfterSimplifying, type CurrencyPayment } from './debt-after-simplifying';

/*
 * Balances' Before simplifying rows (#646, W3): what each Debt becomes once Suggested payments
 * simplify it. Only a Suggested payment between the same two people, the same way round and in
 * the same currency stands for a Debt; anything else is settled by the other payments.
 */

const pay = (from: string, to: string, amountMinor: number, currency = 'INR'): CurrencyPayment => ({
  from,
  to,
  currency,
  amountMinor,
});

describe('a Debt after simplifying', () => {
  it('becomes the Suggested payment between the same two people, the same way round', () => {
    expect(
      debtsAfterSimplifying(
        [pay('alex', 'sam', 88000), pay('alex', 'priya', 60000), pay('priya', 'sam', 18000)],
        [pay('alex', 'sam', 106000), pay('alex', 'priya', 42000)],
      ),
    ).toEqual([
      { kind: 'becomes', amountMinor: 106000 },
      { kind: 'becomes', amountMinor: 42000 },
      { kind: 'settled' },
    ]);
  });

  it('is settled by the other payments when the Suggested payment runs the other way', () => {
    expect(debtsAfterSimplifying([pay('alex', 'sam', 500)], [pay('sam', 'alex', 200)])).toEqual([
      { kind: 'settled' },
    ]);
  });

  it('is settled by the other payments when no Suggested payment names the pair', () => {
    expect(debtsAfterSimplifying([pay('alex', 'sam', 500)], [])).toEqual([{ kind: 'settled' }]);
    expect(debtsAfterSimplifying([pay('alex', 'sam', 500)], [pay('alex', 'priya', 500)])).toEqual([
      { kind: 'settled' },
    ]);
  });

  it('never pairs a Debt with a Suggested payment in another currency (#710)', () => {
    expect(
      debtsAfterSimplifying(
        [
          pay('alex', 'sam', 2000, 'EUR'),
          pay('alex', 'sam', 88000, 'INR'),
          pay('sam', 'alex', 2500, 'JPY'),
        ],
        [pay('alex', 'sam', 106000, 'INR'), pay('sam', 'alex', 2500, 'USD')],
      ),
    ).toEqual([{ kind: 'settled' }, { kind: 'becomes', amountMinor: 106000 }, { kind: 'settled' }]);
  });

  it('adds up exact minor units if a pair appears twice in a currency', () => {
    expect(
      debtsAfterSimplifying(
        [pay('alex', 'sam', 1)],
        [pay('alex', 'sam', Number.MAX_SAFE_INTEGER - 1), pay('alex', 'sam', 1)],
      ),
    ).toEqual([{ kind: 'becomes', amountMinor: Number.MAX_SAFE_INTEGER }]);
    expect(() =>
      debtsAfterSimplifying(
        [pay('alex', 'sam', 1)],
        [pay('alex', 'sam', Number.MAX_SAFE_INTEGER), pay('alex', 'sam', 1)],
      ),
    ).toThrow();
  });
});
