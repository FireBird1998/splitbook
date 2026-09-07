import { describe, it, expect } from 'vitest';
import { toInclusiveDateToBound } from './date';

describe('toInclusiveDateToBound', () => {
  it('widens a date-only string to end-of-day UTC so the final day is included', () => {
    const bound = toInclusiveDateToBound('2026-08-31');
    expect(bound.toISOString()).toBe('2026-08-31T23:59:59.999Z');

    // An expense late on the final day falls inside the range…
    expect(new Date('2026-08-31T23:30:00.000Z').getTime()).toBeLessThanOrEqual(bound.getTime());
    // …while one just after midnight does not.
    expect(new Date('2026-09-01T00:15:00.000Z').getTime()).toBeGreaterThan(bound.getTime());
  });

  it('respects a full ISO timestamp as-is', () => {
    const bound = toInclusiveDateToBound('2026-08-31T12:00:00.000Z');
    expect(bound.toISOString()).toBe('2026-08-31T12:00:00.000Z');
  });
});
