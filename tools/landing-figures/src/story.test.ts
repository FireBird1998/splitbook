import { describe, expect, it } from 'vitest';
import { story } from './story.ts';

// The worked example every landing figure tells (spec #443).
describe('the landing story', () => {
  it('leaves You +₹500, Priya −₹100, Sam +₹300 and Alex −₹700 after Dinner, Cab and Groceries', () => {
    const { steps } = story();
    expect(steps.at(-1)?.after).toEqual({ you: 50000, priya: -10000, sam: 30000, alex: -70000 });
  });

  it('leaves five debts between the four, each pair netted to one cord', () => {
    expect(story().debts).toEqual([
      { from: 'priya', to: 'you', amountMinor: 30000 },
      { from: 'you', to: 'sam', amountMinor: 10000 },
      { from: 'alex', to: 'you', amountMinor: 30000 },
      { from: 'alex', to: 'priya', amountMinor: 20000 },
      { from: 'alex', to: 'sam', amountMinor: 20000 },
    ]);
  });

  it('settles up in three payments that clear every balance', () => {
    const { steps, transfers } = story();
    expect(transfers).toEqual([
      { from: 'alex', to: 'you', amountMinor: 50000 },
      { from: 'alex', to: 'sam', amountMinor: 20000 },
      { from: 'priya', to: 'sam', amountMinor: 10000 },
    ]);
    const left = { ...steps.at(-1)!.after };
    for (const t of transfers) {
      left[t.from] += t.amountMinor;
      left[t.to] -= t.amountMinor;
    }
    expect(left).toEqual({ you: 0, priya: 0, sam: 0, alex: 0 });
  });

  it('cuts each Expense into one chip per share, the leading chip for the farthest bin', () => {
    const chips = story().steps.map((step) => step.chips.map((c) => `${c.to}:${c.amountMinor}`));
    expect(chips).toEqual([
      ['alex:30000', 'sam:30000', 'priya:30000', 'you:30000'],
      ['alex:20000', 'sam:20000', 'priya:20000'],
      ['alex:20000', 'sam:20000', 'priya:20000', 'you:20000', 'you:20000'],
    ]);
  });

  it('keeps the four counters adding up to zero after every Expense', () => {
    for (const step of story().steps) {
      expect(Object.values(step.after).reduce((a, b) => a + b, 0)).toBe(0);
    }
  });
});
