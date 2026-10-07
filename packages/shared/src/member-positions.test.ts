import { describe, expect, it } from 'vitest';
import { simplifyDebtsMinor, type MinorBalance } from './debt-simplifier';
import { everyoneSettled, memberPositions, positionStanding } from './member-positions';
import { settlementLedgerFromRead, type SettlementLedger } from './settlement-preview';

const YOU = 'a00000000000000000000001';
const SAM = 'a00000000000000000000002';
const PRIYA = 'a00000000000000000000003';
const DEV = 'a00000000000000000000004';
const FORMER = 'a00000000000000000000005';

/** A ledger whose suggestions are the ones Balances makes: the simplified debts. */
function ledgerOf(balances: MinorBalance[]): SettlementLedger {
  return { balances, suggestions: simplifyDebtsMinor(balances) };
}

/** The design canvas's Maple House: you owe 1,480.00; Sam is owed 1,060.00 and Priya 420.00. */
const maple = ledgerOf([
  { userId: YOU, amountMinor: -148000 },
  { userId: SAM, amountMinor: 106000 },
  { userId: PRIYA, amountMinor: 42000 },
]);

describe('positionStanding', () => {
  it('is owed above zero, owes below it and settled at zero', () => {
    expect(positionStanding(1)).toBe('owed');
    expect(positionStanding(-1)).toBe('owes');
    expect(positionStanding(0)).toBe('settled');
  });
});

describe('memberPositions', () => {
  it('gives each person their net and who settles with them, as the canvas draws Maple House', () => {
    expect(memberPositions(maple, [YOU, SAM, PRIYA])).toEqual([
      {
        userId: SAM,
        netMinor: 106000,
        standing: 'owed',
        settledBy: [{ userId: YOU, amountMinor: 106000 }],
      },
      {
        userId: PRIYA,
        netMinor: 42000,
        standing: 'owed',
        settledBy: [{ userId: YOU, amountMinor: 42000 }],
      },
      {
        userId: YOU,
        netMinor: -148000,
        standing: 'owes',
        settledBy: [
          { userId: SAM, amountMinor: 106000 },
          { userId: PRIYA, amountMinor: 42000 },
        ],
      },
    ]);
  });

  it('settles each person exactly: their parts add up to what they owe or are owed', () => {
    const ledger = ledgerOf([
      { userId: YOU, amountMinor: -100001 },
      { userId: SAM, amountMinor: 33334 },
      { userId: PRIYA, amountMinor: 33334 },
      { userId: DEV, amountMinor: 33333 },
    ]);
    for (const position of memberPositions(ledger)) {
      const settled = position.settledBy.reduce((total, part) => total + part.amountMinor, 0);
      expect(settled, position.userId).toBe(Math.abs(position.netMinor));
    }
  });

  it('lists a member the ledger doesn’t name as settled up, between owed and owes', () => {
    const positions = memberPositions(maple, [YOU, DEV, SAM, PRIYA]);
    expect(positions.map((position) => position.userId)).toEqual([SAM, PRIYA, DEV, YOU]);
    expect(positions[2]).toEqual({
      userId: DEV,
      netMinor: 0,
      standing: 'settled',
      settledBy: [],
    });
  });

  it('keeps someone the ledger names who isn’t a member, such as a former member who owes', () => {
    const ledger = ledgerOf([
      { userId: SAM, amountMinor: 2500 },
      { userId: FORMER, amountMinor: -2500 },
    ]);
    expect(memberPositions(ledger, [YOU, SAM])).toEqual([
      {
        userId: SAM,
        netMinor: 2500,
        standing: 'owed',
        settledBy: [{ userId: FORMER, amountMinor: 2500 }],
      },
      { userId: YOU, netMinor: 0, standing: 'settled', settledBy: [] },
      {
        userId: FORMER,
        netMinor: -2500,
        standing: 'owes',
        settledBy: [{ userId: SAM, amountMinor: 2500 }],
      },
    ]);
  });

  it('orders equal positions as the members are listed, then the ledger’s own order', () => {
    const ledger = ledgerOf([
      { userId: DEV, amountMinor: 500 },
      { userId: PRIYA, amountMinor: 500 },
      { userId: SAM, amountMinor: -500 },
      { userId: YOU, amountMinor: -500 },
    ]);
    expect(memberPositions(ledger, [YOU, PRIYA]).map((position) => position.userId)).toEqual([
      PRIYA,
      DEV,
      YOU,
      SAM,
    ]);
  });

  it('lists the largest part first, and equal parts in the members’ order', () => {
    const ledger: SettlementLedger = {
      balances: [
        { userId: YOU, amountMinor: -3000 },
        { userId: SAM, amountMinor: 1000 },
        { userId: PRIYA, amountMinor: 1000 },
        { userId: DEV, amountMinor: 1000 },
      ],
      suggestions: [
        { from: YOU, to: DEV, amountMinor: 1000 },
        { from: YOU, to: SAM, amountMinor: 1000 },
        { from: YOU, to: PRIYA, amountMinor: 1000 },
      ],
    };
    const [you] = memberPositions(ledger, [YOU, SAM, PRIYA, DEV]).slice(-1);
    expect(you.settledBy.map((part) => part.userId)).toEqual([SAM, PRIYA, DEV]);
  });

  it('adds up two suggestions between the same pair into one part', () => {
    const ledger: SettlementLedger = {
      balances: [
        { userId: YOU, amountMinor: -1500 },
        { userId: SAM, amountMinor: 1500 },
      ],
      suggestions: [
        { from: YOU, to: SAM, amountMinor: 1000 },
        { from: YOU, to: SAM, amountMinor: 500 },
      ],
    };
    expect(memberPositions(ledger).map((position) => position.settledBy)).toEqual([
      [{ userId: YOU, amountMinor: 1500 }],
      [{ userId: SAM, amountMinor: 1500 }],
    ]);
  });

  it('never says a settled person settles with anyone, even if a suggestion names them', () => {
    const ledger: SettlementLedger = {
      balances: [
        { userId: YOU, amountMinor: 0 },
        { userId: SAM, amountMinor: 0 },
      ],
      suggestions: [{ from: YOU, to: SAM, amountMinor: 100 }],
    };
    expect(memberPositions(ledger).every((position) => position.settledBy.length === 0)).toBe(true);
  });

  it('reads the Balances read through the shared ledger, in yen as in rupees', () => {
    const you = { _id: YOU, name: 'Alex Rivera' };
    const sam = { _id: SAM, name: 'Sam Chen' };
    const ledger = settlementLedgerFromRead(
      {
        balances: [
          { user: you, balance: -1200 },
          { user: sam, balance: 1200 },
        ],
        debts: [{ from: you, to: sam, amount: 1200 }],
      },
      'JPY',
    );
    expect(memberPositions(ledger, [YOU, SAM]).map((position) => position.netMinor)).toEqual([
      1200, -1200,
    ]);
  });

  it('is empty for an empty ledger with no members', () => {
    expect(memberPositions({ balances: [], suggestions: [] })).toEqual([]);
  });
});

describe('everyoneSettled', () => {
  it('is true when every position is zero, or there are none', () => {
    expect(everyoneSettled([])).toBe(true);
    expect(everyoneSettled(memberPositions(ledgerOf([]), [YOU, SAM]))).toBe(true);
    expect(
      everyoneSettled(
        memberPositions(
          ledgerOf([
            { userId: YOU, amountMinor: 0 },
            { userId: SAM, amountMinor: 0 },
          ]),
        ),
      ),
    ).toBe(true);
  });

  it('is false while anyone owes or is owed', () => {
    expect(everyoneSettled(memberPositions(maple))).toBe(false);
  });
});
