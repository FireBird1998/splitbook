import { describe, expect, it } from 'vitest';
import { getGroupTheme } from '@splitbook/shared/group-themes';
import { inTimeZone } from '@/lib/test-utils/time-zone';
import { groupDatesLabel, tripDateRange } from './group-dates';

describe('a Group’s dates, as its card and page show them (#437)', () => {
  it.each(['Pacific/Pago_Pago', 'UTC', 'Pacific/Kiritimati'])(
    'are the calendar days the Trip was given in %s',
    (zone) =>
      inTimeZone(zone, () => {
        const trip = getGroupTheme('trip');
        const start = '2026-09-01T00:00:00.000Z';
        const end = '2026-09-05T00:00:00.000Z';
        expect(groupDatesLabel(trip, start, end)).toBe('1 Sep 2026 – 5 Sep 2026');
        expect(groupDatesLabel(trip, start, null)).toBe('Starts 1 Sep 2026');
        expect(groupDatesLabel(getGroupTheme('home'), start, null)).toBeNull();
        expect(groupDatesLabel(getGroupTheme('home'), start, null, { tracking: true })).toBe(
          'Tracking since 1 Sep 2026',
        );
      }),
  );
});

describe('a Trip’s dates, short, as its strip shows them (#646)', () => {
  const day = (iso: string) => `${iso}T00:00:00.000Z`;

  it.each(['Pacific/Pago_Pago', 'UTC', 'Pacific/Kiritimati'])(
    'name the month and year once where the ends share them, in %s',
    (zone) =>
      inTimeZone(zone, () => {
        expect(tripDateRange(day('2026-09-17'), day('2026-09-20'))).toBe('17–20 Sep 2026');
        expect(tripDateRange(day('2026-09-28'), day('2026-10-02'))).toBe('28 Sep – 2 Oct 2026');
        expect(tripDateRange(day('2026-12-30'), day('2027-01-02'))).toBe(
          '30 Dec 2026 – 2 Jan 2027',
        );
      }),
  );

  it('show one day once, a start alone as when it starts, and nothing without a start', () => {
    expect(tripDateRange(day('2026-09-17'), day('2026-09-17'))).toBe('17 Sep 2026');
    expect(tripDateRange(day('2026-09-17'), null)).toBe('Starts 17 Sep 2026');
    expect(tripDateRange(null, day('2026-09-17'))).toBeNull();
  });

  it('never say Today or Yesterday', () => {
    const today = new Date();
    const iso = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
    expect(tripDateRange(day(iso), day(iso))).not.toMatch(/Today|Yesterday/);
  });
});
