import { describe, expect, it } from 'vitest';
import { counterReadings } from './figures/tour.js';

const sum = (values: number[]) => values.reduce((a, b) => a + b, 0);

/** Every frame a counter shows while settling, at 60 frames a second. */
function frames(readings: ReturnType<typeof counterReadings>, dt = 1 / 60) {
  const shown: number[][] = [readings.shown];
  for (let n = 0; n < 600 && !readings.settled(); n++) {
    readings.step(dt, false);
    shown.push(readings.shown);
  }
  return shown;
}

// #511: what a visitor reads on the figures' counters is true in every frame.
describe('the counters a figure animates', () => {
  it('move a payment between two tills in whole rupees, never past where they are heading', () => {
    // Fig 3's first payment: Alex pays You ₹500.
    const readings = counterReadings(4);
    readings.jump([50000, -10000, 30000, -70000]);
    readings.raiseAndLower(3, 0, 50000);
    const shown = frames(readings);
    expect(shown.length).toBeGreaterThan(10);
    for (const [you, priya, sam, alex] of shown) {
      expect(you).toBeGreaterThanOrEqual(0);
      expect(you).toBeLessThanOrEqual(50000);
      expect(alex).toBeGreaterThanOrEqual(-70000);
      expect(alex).toBeLessThanOrEqual(-20000);
      expect([priya, sam]).toEqual([-10000, 30000]);
    }
    expect(shown.every((frame) => frame.every((minor) => minor % 100 === 0))).toBe(true);
    expect(shown.at(-1)).toEqual([0, -10000, 30000, -20000]);
  });

  it('add up to the same total in every frame, with moves overlapping', () => {
    // Fig 1's chips for Dinner, paid by You: each lands a moment after the last.
    const readings = counterReadings(4);
    const shown: number[][] = [];
    for (const member of [3, 2, 1]) {
      readings.raiseAndLower(0, member, 30000);
      for (let n = 0; n < 12; n++) {
        readings.step(1 / 60, false);
        shown.push(readings.shown);
      }
    }
    shown.push(...frames(readings));
    expect(shown.map(sum).every((total) => total === 0)).toBe(true);
    // Each counter only ever moves one way: You up to +900, each other member down to −300.
    for (let i = 1; i < shown.length; i++) {
      expect(shown[i]![0]).toBeGreaterThanOrEqual(shown[i - 1]![0]!);
      for (const member of [1, 2, 3])
        expect(shown[i]![member]).toBeLessThanOrEqual(shown[i - 1]![member]!);
    }
    expect(shown.at(-1)).toEqual([90000, -30000, -30000, -30000]);
  });

  it('say where each counter is heading, and settle at once when shown calm', () => {
    const readings = counterReadings(2);
    readings.raiseAndLower(0, 1, 20000);
    expect(readings.targets).toEqual([20000, -20000]);
    expect(readings.settled()).toBe(false);
    readings.step(0, true);
    expect(readings.shown).toEqual([20000, -20000]);
    expect(readings.settled()).toBe(true);
  });

  it('jump to new readings at once, and ignore a move from a counter to itself', () => {
    const readings = counterReadings(2);
    readings.raiseAndLower(0, 1, 20000);
    readings.jump([0, 0]);
    readings.raiseAndLower(1, 1, 50000);
    expect(readings.settled()).toBe(true);
    expect(readings.shown).toEqual([0, 0]);
    expect(readings.targets).toEqual([0, 0]);
  });
});
