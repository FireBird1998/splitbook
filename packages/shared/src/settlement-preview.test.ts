import { describe, expect, it } from 'vitest';
import { CURRENCIES, getCurrencyPrecision } from './currency';
import { simplifyDebtsMinor } from './debt-simplifier';
import { MoneyValidationError, parseAmountMinor, toMajorAmount } from './exact-money';
import {
  previewSettlement,
  settlementLedgerFromRead,
  suggestedSettlementMinor,
  type SettlementLedger,
} from './settlement-preview';

const YOU = 'a00000000000000000000001';
const SAM = 'a00000000000000000000002';
const PRIYA = 'a00000000000000000000003';
const DEV = 'a00000000000000000000004';

/** The design canvas's Maple House: you owe 1,480.00; Sam is owed 1,060.00 and Priya 420.00. */
const maple: SettlementLedger = {
  balances: [
    { userId: YOU, amountMinor: -148000 },
    { userId: SAM, amountMinor: 106000 },
    { userId: PRIYA, amountMinor: 42000 },
  ],
  suggestions: [
    { from: YOU, to: SAM, amountMinor: 106000 },
    { from: YOU, to: PRIYA, amountMinor: 42000 },
  ],
};

describe('suggestedSettlementMinor', () => {
  it('is the suggested payment from the payer to the payee', () => {
    expect(suggestedSettlementMinor(maple, YOU, SAM)).toBe(106000);
    expect(suggestedSettlementMinor(maple, YOU, PRIYA)).toBe(42000);
  });

  it('is 0 when nothing is suggested in that direction, including the reverse of a suggestion', () => {
    expect(suggestedSettlementMinor(maple, SAM, YOU)).toBe(0);
    expect(suggestedSettlementMinor(maple, SAM, PRIYA)).toBe(0);
    expect(suggestedSettlementMinor(maple, YOU, DEV)).toBe(0);
  });

  it('is 0 everywhere in a settled Group', () => {
    expect(suggestedSettlementMinor({ balances: [], suggestions: [] }, YOU, SAM)).toBe(0);
  });

  it('refuses the same person on both sides, or a missing one', () => {
    expect(() => suggestedSettlementMinor(maple, YOU, YOU)).toThrow(MoneyValidationError);
    expect(() => suggestedSettlementMinor(maple, YOU, '')).toThrow(MoneyValidationError);
    expect(() => suggestedSettlementMinor(maple, '', SAM)).toThrow(MoneyValidationError);
  });
});

describe('previewSettlement', () => {
  it('paying exactly the suggestion settles the payee and is no overpayment', () => {
    expect(previewSettlement(maple, { paidBy: YOU, paidTo: SAM, amountMinor: 106000 })).toEqual({
      amountMinor: 106000,
      suggestedMinor: 106000,
      overpays: false,
      overpaidMinor: 0,
      paidBy: { userId: YOU, beforeMinor: -148000, afterMinor: -42000 },
      paidTo: { userId: SAM, beforeMinor: 106000, afterMinor: 0 },
    });
  });

  it('paying less than suggested leaves both still open, and is no overpayment', () => {
    const preview = previewSettlement(maple, { paidBy: YOU, paidTo: PRIYA, amountMinor: 10000 });
    expect(preview).toMatchObject({ overpays: false, overpaidMinor: 0, suggestedMinor: 42000 });
    expect(preview?.paidBy.afterMinor).toBe(-138000);
    expect(preview?.paidTo.afterMinor).toBe(32000);
  });

  it('one minor unit over the suggestion overpays by exactly that unit', () => {
    const preview = previewSettlement(maple, { paidBy: YOU, paidTo: SAM, amountMinor: 106001 });
    expect(preview).toMatchObject({ overpays: true, overpaidMinor: 1 });
    expect(preview?.paidTo.afterMinor).toBe(-1);
  });

  it('paying more than suggested states how much more and where each side stands after', () => {
    // The canvas's warning: ₹140.00 more than suggested, and you'd still owe ₹280.00.
    const preview = previewSettlement(maple, { paidBy: YOU, paidTo: SAM, amountMinor: 120000 });
    expect(preview).toEqual({
      amountMinor: 120000,
      suggestedMinor: 106000,
      overpays: true,
      overpaidMinor: 14000,
      paidBy: { userId: YOU, beforeMinor: -148000, afterMinor: -28000 },
      paidTo: { userId: SAM, beforeMinor: 106000, afterMinor: -14000 },
    });
  });

  it('a payer who goes past zero ends up owed', () => {
    const preview = previewSettlement(maple, { paidBy: YOU, paidTo: PRIYA, amountMinor: 200000 });
    expect(preview?.paidBy.afterMinor).toBe(52000);
    expect(preview?.overpaidMinor).toBe(158000);
  });

  it('any payment nobody suggested overpays by all of it, whichever way it runs', () => {
    // Sam is owed, so Sam paying you only adds to what you owe.
    expect(previewSettlement(maple, { paidBy: SAM, paidTo: YOU, amountMinor: 5000 })).toEqual({
      amountMinor: 5000,
      suggestedMinor: 0,
      overpays: true,
      overpaidMinor: 5000,
      paidBy: { userId: SAM, beforeMinor: 106000, afterMinor: 111000 },
      paidTo: { userId: YOU, beforeMinor: -148000, afterMinor: -153000 },
    });
    expect(previewSettlement(maple, { paidBy: SAM, paidTo: PRIYA, amountMinor: 1 })).toMatchObject({
      overpays: true,
      overpaidMinor: 1,
    });
  });

  it('someone with no balance yet starts from zero', () => {
    const preview = previewSettlement(maple, { paidBy: DEV, paidTo: YOU, amountMinor: 2500 });
    expect(preview?.paidBy).toEqual({ userId: DEV, beforeMinor: 0, afterMinor: 2500 });
    expect(preview?.paidTo).toEqual({ userId: YOU, beforeMinor: -148000, afterMinor: -150500 });
  });

  it('keeps the Group in balance: what the payer gains, the payee loses', () => {
    for (const amountMinor of [1, 999, 42000, 106000, 120000, 9_999_999]) {
      const preview = previewSettlement(maple, { paidBy: YOU, paidTo: SAM, amountMinor })!;
      expect(preview.paidBy.afterMinor - preview.paidBy.beforeMinor).toBe(amountMinor);
      expect(preview.paidTo.beforeMinor - preview.paidTo.afterMinor).toBe(amountMinor);
    }
  });

  it('a zero or negative amount is no payment', () => {
    expect(previewSettlement(maple, { paidBy: YOU, paidTo: SAM, amountMinor: 0 })).toBeNull();
    expect(previewSettlement(maple, { paidBy: YOU, paidTo: SAM, amountMinor: -0 })).toBeNull();
    expect(previewSettlement(maple, { paidBy: YOU, paidTo: SAM, amountMinor: -100 })).toBeNull();
  });

  it('refuses amounts that are not whole minor units, and the same person on both sides', () => {
    for (const amountMinor of [0.5, 1060.25, Number.NaN, Infinity, 2 ** 53]) {
      expect(() => previewSettlement(maple, { paidBy: YOU, paidTo: SAM, amountMinor })).toThrow(
        MoneyValidationError,
      );
    }
    expect(() => previewSettlement(maple, { paidBy: SAM, paidTo: SAM, amountMinor: 100 })).toThrow(
      MoneyValidationError,
    );
  });

  it('agrees with the simplified debts: paying every suggestion settles everyone', () => {
    const balances = [
      { userId: YOU, amountMinor: -70001 },
      { userId: SAM, amountMinor: 50000 },
      { userId: PRIYA, amountMinor: 30002 },
      { userId: DEV, amountMinor: -10001 },
    ];
    const suggestions = simplifyDebtsMinor(balances);
    const net = new Map(balances.map((balance) => [balance.userId, balance.amountMinor]));
    // Record each suggestion in turn, previewing it against the balances as they stand then.
    for (const suggestion of suggestions) {
      const now = [...net].map(([userId, amountMinor]) => ({ userId, amountMinor }));
      const preview = previewSettlement(
        { balances: now, suggestions },
        { paidBy: suggestion.from, paidTo: suggestion.to, amountMinor: suggestion.amountMinor },
      )!;
      expect(preview.overpays).toBe(false);
      net.set(suggestion.from, preview.paidBy.afterMinor);
      net.set(suggestion.to, preview.paidTo.afterMinor);
    }
    expect([...net.values()]).toEqual([0, 0, 0, 0]);
  });
});

describe('settlementLedgerFromRead', () => {
  it('reads the Balances read in exact minor units, people populated or by id', () => {
    const ledger = settlementLedgerFromRead(
      {
        balances: [
          { user: { _id: YOU, name: 'Alex Rivera' }, balance: -1480 },
          { user: SAM, balance: 1060 },
          { user: { _id: PRIYA }, balance: 420 },
        ],
        debts: [
          { from: { _id: YOU }, to: { _id: SAM }, amount: 1060 },
          { from: YOU, to: PRIYA, amount: 420 },
        ],
      },
      'INR',
    );
    expect(ledger).toEqual(maple);
  });

  it('leaves out people the read sends as null, and copes with a read without figures', () => {
    expect(
      settlementLedgerFromRead(
        {
          balances: [
            { user: null, balance: -5 },
            { user: SAM, balance: 5 },
          ],
          debts: [{ from: null, to: SAM, amount: 5 }],
        },
        'USD',
      ),
    ).toEqual({ balances: [{ userId: SAM, amountMinor: 500 }], suggestions: [] });
    expect(settlementLedgerFromRead({}, 'INR')).toEqual({ balances: [], suggestions: [] });
  });

  it('keeps the old calculator’s binary tails exact, and refuses amounts finer than the currency', () => {
    expect(
      settlementLedgerFromRead({ balances: [{ user: SAM, balance: 0.1 + 0.2 }] }, 'INR').balances,
    ).toEqual([{ userId: SAM, amountMinor: 30 }]);
    expect(() =>
      settlementLedgerFromRead({ balances: [{ user: SAM, balance: 1.5 }] }, 'JPY'),
    ).toThrow(MoneyValidationError);
  });

  it('uses every currency’s own minor unit, end to end', () => {
    for (const { code } of CURRENCIES) {
      const precision = getCurrencyPrecision(code);
      expect([0, 2]).toContain(precision);
      // 1,234 major units owed, plus the smallest unit the currency has.
      const owed = toMajorAmount(1234 * 10 ** precision + 1, code);
      const ledger = settlementLedgerFromRead(
        {
          balances: [
            { user: YOU, balance: -owed },
            { user: SAM, balance: owed },
          ],
          debts: [{ from: YOU, to: SAM, amount: owed }],
        },
        code,
      );
      const suggested = suggestedSettlementMinor(ledger, YOU, SAM);
      expect(suggested).toBe(parseAmountMinor(owed, code));
      expect(
        previewSettlement(ledger, { paidBy: YOU, paidTo: SAM, amountMinor: suggested }),
      ).toMatchObject({
        overpays: false,
        paidBy: { afterMinor: 0 },
        paidTo: { afterMinor: 0 },
      });
      // One smallest unit more is an overpayment of exactly one unit, in every currency.
      expect(
        previewSettlement(ledger, { paidBy: YOU, paidTo: SAM, amountMinor: suggested + 1 }),
      ).toMatchObject({ overpays: true, overpaidMinor: 1, paidTo: { afterMinor: -1 } });
    }
  });
});
