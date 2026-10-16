import { describe, expect, it } from 'vitest';
import { inTimeZone } from '@/lib/test-utils/time-zone';
import { parseMonthParam } from './MonthCycleBar';

describe('a Month in the Expenses list (#437)', () => {
  it.each(['Pacific/Pago_Pago', 'UTC', 'Pacific/Kiritimati'])(
    'holds the Expenses dated in it, by its first and last calendar days, in %s',
    (zone) =>
      inTimeZone(zone, () => {
        expect(parseMonthParam('2026-09')).toMatchObject({
          key: '2026-09',
          dateFrom: '2026-09-01',
          dateTo: '2026-09-30',
          label: 'September 2026',
        });
      }),
  );
});
