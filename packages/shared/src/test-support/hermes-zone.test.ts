import { describe, expect, it } from 'vitest';
import { hermesZoneMoved } from './hermes-zone';

describe('Hermes after the phone’s zone moved while the app ran (#1283)', () => {
  it('reads dates in the zone the app started in, and formats them in the new one, as probed', () => {
    const before = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const restore = hermesZoneMoved('Asia/Kolkata', 'Pacific/Pago_Pago');
    try {
      const noon = new Date('2026-11-01T12:00:00');
      // The probe's values on the emulator.
      expect(noon.toISOString()).toBe('2026-11-01T06:30:00.000Z');
      expect(noon.getTimezoneOffset()).toBe(-330);
      expect(noon.getDate()).toBe(1);
      expect(noon.toLocaleDateString('en', { month: 'long' })).toBe('October');
      expect(Intl.DateTimeFormat().resolvedOptions().timeZone).toBe('Pacific/Pago_Pago');
      // A zone asked for is kept.
      expect(noon.toLocaleDateString('en', { month: 'long', timeZone: 'UTC' })).toBe('November');
    } finally {
      restore();
    }
    expect(Intl.DateTimeFormat().resolvedOptions().timeZone).toBe(before);
  });
});
