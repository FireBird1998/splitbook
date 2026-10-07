import { describe, expect, it } from 'vitest';
import { simplifyDebtsMinor, type MinorBalance } from '@splitbook/shared/debt-simplifier';
import type { SettlementLedger } from '@splitbook/shared/settlement-preview';
import { everyoneModel, phraseText, scaleEnd, type EveryonePerson } from './everyone-chart';

/*
 * The figures and words behind Balances' "Everyone" card (#313): the design canvas's Maple
 * House, and the cases it doesn't draw. Fictional people and amounts.
 */

const ALEX = 'a00000000000000000000001';
const SAM = 'a00000000000000000000002';
const PRIYA = 'a00000000000000000000003';
const SAM_OTHER = 'a00000000000000000000004';
const FORMER = 'a00000000000000000000005';

const people: EveryonePerson[] = [
  { id: ALEX, name: 'Alex Rivera' },
  { id: SAM, name: 'Sam Chen' },
  { id: PRIYA, name: 'Priya Shah' },
];

const ledgerOf = (balances: MinorBalance[]): SettlementLedger => ({
  balances,
  suggestions: simplifyDebtsMinor(balances),
});

/** You owe ₹1,480.00; Sam is owed ₹1,060.00 and Priya ₹420.00. */
const maple = ledgerOf([
  { userId: ALEX, amountMinor: -148000 },
  { userId: SAM, amountMinor: 106000 },
  { userId: PRIYA, amountMinor: 42000 },
]);

describe('everyoneModel', () => {
  it('reads as the canvas draws Maple House, from owed to owes', () => {
    const model = everyoneModel(maple, { currency: 'INR', viewerId: ALEX, people });
    expect(model.settled).toBe(false);
    expect(model.scale).toEqual({ negative: '−₹1.5K', positive: '+₹1.5K' });
    expect(
      model.rows.map((row) => ({
        name: row.name,
        amount: row.amount,
        position: row.position,
        settledBy: phraseText(row.settledBy),
        barWidth: row.barWidth,
      })),
    ).toEqual([
      {
        name: 'Sam Chen',
        amount: '+₹1,060.00',
        position: 'Gets back',
        settledBy: 'Gets ₹1,060.00 from you',
        barWidth: 35.33,
      },
      {
        name: 'Priya Shah',
        amount: '+₹420.00',
        position: 'Gets back',
        settledBy: 'Gets ₹420.00 from you',
        barWidth: 14,
      },
      {
        name: 'You',
        amount: '−₹1,480.00',
        position: 'Owes',
        settledBy: 'Pays Sam ₹1,060.00 and Priya ₹420.00',
        barWidth: 49.33,
      },
    ]);
  });

  it('sets every amount apart from the words, for the money font', () => {
    const [, , you] = everyoneModel(maple, { currency: 'INR', viewerId: ALEX, people }).rows;
    expect(you.settledBy).toEqual([
      { text: 'Pays Sam ' },
      { text: '₹1,060.00', money: true },
      { text: ' and Priya ' },
      { text: '₹420.00', money: true },
    ]);
    const [sam] = everyoneModel(maple, { currency: 'INR', viewerId: PRIYA, people }).rows;
    expect(sam.settledBy).toEqual([
      { text: 'Gets ' },
      { text: '₹1,060.00', money: true },
      { text: ' from Alex' },
    ]);
  });

  it('names the viewer You, and you in a sentence, whoever they are', () => {
    const rows = everyoneModel(maple, { currency: 'INR', viewerId: SAM, people }).rows;
    expect(rows.map((row) => row.name)).toEqual(['You', 'Priya Shah', 'Alex Rivera']);
    expect(rows.map((row) => phraseText(row.settledBy))).toEqual([
      'Gets ₹1,060.00 from Alex',
      'Gets ₹420.00 from Alex',
      'Pays you ₹1,060.00 and Priya ₹420.00',
    ]);
    // The avatar keeps the viewer's own initials.
    expect(rows[0].avatarName).toBe('Sam Chen');
  });

  it('lists three or more with commas, and says who pays someone owed by several', () => {
    const ledger = ledgerOf([
      { userId: ALEX, amountMinor: -3000 },
      { userId: SAM, amountMinor: -1000 },
      { userId: PRIYA, amountMinor: 4000 },
    ]);
    const rows = everyoneModel(ledger, { currency: 'INR', viewerId: ALEX, people }).rows;
    expect(phraseText(rows[0].settledBy)).toBe('Gets ₹30.00 from you and ₹10.00 from Sam');

    const four = ledgerOf([
      { userId: ALEX, amountMinor: -3000 },
      { userId: SAM, amountMinor: 1000 },
      { userId: PRIYA, amountMinor: 1000 },
      { userId: FORMER, amountMinor: 1000 },
    ]);
    const you = everyoneModel(four, {
      currency: 'INR',
      viewerId: ALEX,
      people: [...people, { id: FORMER, name: 'Dev Patel' }],
    }).rows.at(-1)!;
    expect(phraseText(you.settledBy)).toBe('Pays Sam ₹10.00, Priya ₹10.00 and Dev ₹10.00');
  });

  it('uses full names in a sentence when two people share a first name', () => {
    const ledger = ledgerOf([
      { userId: ALEX, amountMinor: -2000 },
      { userId: SAM, amountMinor: 1000 },
      { userId: SAM_OTHER, amountMinor: 1000 },
    ]);
    const rows = everyoneModel(ledger, {
      currency: 'INR',
      viewerId: ALEX,
      people: [...people, { id: SAM_OTHER, name: 'Sam Okafor' }],
    }).rows;
    expect(phraseText(rows.at(-1)!.settledBy)).toBe('Pays Sam Chen ₹10.00 and Sam Okafor ₹10.00');
  });

  it('shows a member with no position as settled up, with no bar and nobody settling', () => {
    const ledger = ledgerOf([
      { userId: ALEX, amountMinor: -500 },
      { userId: SAM, amountMinor: 500 },
    ]);
    const rows = everyoneModel(ledger, { currency: 'INR', viewerId: ALEX, people }).rows;
    expect(rows[1]).toMatchObject({
      name: 'Priya Shah',
      standing: 'settled',
      amount: '₹0.00',
      position: 'Settled up',
      settledBy: [],
      barWidth: 0,
    });
  });

  it('is settled when nobody owes anybody', () => {
    const model = everyoneModel(ledgerOf([]), { currency: 'INR', viewerId: ALEX, people });
    expect(model.settled).toBe(true);
    expect(model.rows.every((row) => row.standing === 'settled')).toBe(true);
  });

  it('keeps every amount exact in the currency shown, never converted', () => {
    const yen = ledgerOf([
      { userId: ALEX, amountMinor: -1235 },
      { userId: SAM, amountMinor: 1235 },
    ]);
    const model = everyoneModel(yen, { currency: 'JPY', viewerId: ALEX, people });
    expect(model.rows.map((row) => row.amount)).toEqual(['+¥1,235', '¥0', '−¥1,235']);
    expect(model.scale).toEqual({ negative: '−¥1.5K', positive: '+¥1.5K' });

    const euro = ledgerOf([
      { userId: SAM, amountMinor: 6000 },
      { userId: PRIYA, amountMinor: -6000 },
    ]);
    const rows = everyoneModel(euro, { currency: 'EUR', viewerId: SAM, people }).rows;
    expect(rows.map((row) => [row.amount, phraseText(row.settledBy)])).toEqual([
      ['+€60.00', 'Gets €60.00 from Priya'],
      ['€0.00', ''],
      ['−€60.00', 'Pays you €60.00'],
    ]);
  });

  it('draws the largest position to the scale’s end, and a tiny one still visibly', () => {
    const ledger = ledgerOf([
      { userId: ALEX, amountMinor: -100001 },
      { userId: SAM, amountMinor: 100000 },
      { userId: PRIYA, amountMinor: 1 },
    ]);
    const model = everyoneModel(ledger, { currency: 'INR', viewerId: ALEX, people });
    expect(model.scale.positive).toBe('+₹1.5K');
    const widths = Object.fromEntries(model.rows.map((row) => [row.name, row.barWidth]));
    expect(widths).toEqual({ 'Sam Chen': 33.33, 'Priya Shah': 1, You: 33.33 });
    // A position exactly at a round figure fills half the axis.
    const round = ledgerOf([
      { userId: ALEX, amountMinor: -10000 },
      { userId: SAM, amountMinor: 10000 },
    ]);
    expect(
      everyoneModel(round, { currency: 'INR', viewerId: ALEX, people }).rows.map(
        (row) => row.barWidth,
      ),
    ).toEqual([50, 0, 50]);
  });

  it('names someone it has no name for as a former member', () => {
    const ledger = ledgerOf([
      { userId: SAM, amountMinor: 700 },
      { userId: FORMER, amountMinor: -700 },
    ]);
    const rows = everyoneModel(ledger, { currency: 'INR', viewerId: ALEX, people }).rows;
    expect(rows.at(-1)).toMatchObject({ name: 'Former member', amount: '−₹7.00' });
    expect(phraseText(rows[0].settledBy)).toBe('Gets ₹7.00 from a former member');
  });
});

describe('scaleEnd', () => {
  it('rounds the largest position up to a round figure', () => {
    expect([0, 0.4, 1, 7, 12, 99, 100, 101, 1480, 2600, 74000].map(scaleEnd)).toEqual([
      1, 1, 1, 8, 15, 100, 100, 150, 1500, 3000, 80000,
    ]);
  });
});
