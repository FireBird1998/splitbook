import { afterEach, describe, it, expect, vi } from 'vitest';
import {
  currentMonthKey,
  getLocalMonthIsoRange,
  shiftMonthKey,
  toInclusiveDateToBound,
} from './date';

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

describe('local calendar Months', () => {
  afterEach(() => vi.unstubAllEnvs());

  it('uses the local calendar date to choose the current Month', () => {
    vi.stubEnv('TZ', 'America/New_York');
    expect(currentMonthKey(new Date('2026-10-01T02:00:00.000Z'))).toBe('2026-09');
  });

  it.each([
    ['2026-12', 1, '2027-01'],
    ['2026-01', -1, '2025-12'],
    ['2026-03', -13, '2025-02'],
    ['2026-03', 0, '2026-03'],
  ])('shifts %s by %i calendar months to %s', (month, offset, expected) => {
    expect(shiftMonthKey(month, offset)).toBe(expected);
  });

  it.each([
    ['America/New_York', '2026-03', '2026-03-01T05:00:00.000Z', '2026-04-01T03:59:59.999Z'],
    ['America/New_York', '2026-11', '2026-11-01T04:00:00.000Z', '2026-12-01T04:59:59.999Z'],
    ['Asia/Kolkata', '2026-09', '2026-08-31T18:30:00.000Z', '2026-09-30T18:29:59.999Z'],
    ['UTC', '2024-02', '2024-02-01T00:00:00.000Z', '2024-02-29T23:59:59.999Z'],
  ])('returns inclusive bounds for %s Month %s', (timezone, month, dateFrom, dateTo) => {
    vi.stubEnv('TZ', timezone);
    expect(getLocalMonthIsoRange(month)).toEqual({ dateFrom, dateTo });
    const nextDay = new Date(new Date(dateTo).getTime() + 1);
    expect(nextDay.getDate()).toBe(1);
    expect(nextDay.getHours()).toBe(0);
    expect(nextDay.getMinutes()).toBe(0);
  });

  it.each(['2026-00', '2026-13', '2026-2', '0000-01', '2026-02-01', 'invalid'])(
    'rejects an invalid Month key %s before shifting or querying it',
    (month) => {
      expect(() => shiftMonthKey(month, 1)).toThrow('Choose a valid Month.');
      expect(() => getLocalMonthIsoRange(month)).toThrow('Choose a valid Month.');
    },
  );
});
