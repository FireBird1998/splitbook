import { describe, expect, it } from 'vitest';
import { recordedWhen } from './record-time';

// The Designer's review of #899: at 200% a payment's record read "Recorded by you · Fri 6 /
// Nov, 03:21". The day and month stay together, as "5 Nov 17:44" does (#895).
describe('when a payment was recorded', () => {
  it('reads "Fri 6 Nov, 03:21", its day and month joined by a no-break space', () => {
    expect(recordedWhen('2026-11-06T03:21:00')).toBe('Fri 6\u00a0Nov, 03:21');
  });
});
