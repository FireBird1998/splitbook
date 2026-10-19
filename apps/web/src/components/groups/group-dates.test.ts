import { describe, expect, it } from 'vitest';
import { getGroupTheme } from '@splitbook/shared/group-themes';
import { inTimeZone } from '@/lib/test-utils/time-zone';
import { groupDatesLabel } from './group-dates';

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
