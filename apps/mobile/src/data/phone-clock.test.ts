import { describe, expect, it, onTestFinished, vi } from 'vitest';
import { hermesZoneMoved } from '@splitbook/shared/test-support/hermes-zone';
import { phoneDay, phoneHour, phoneMonth, phoneTimeZone } from './phone-clock';

// #1298: the app started in India and the phone moved to Pago Pago while it ran. Hermes keeps
// India for its dates (#1283), while Intl follows the phone. At 08:00 UTC on 1 Dec it is 1:30 PM
// on 1 Dec in India and 9:00 PM on 30 Nov in Pago Pago.
describe('the phone’s day, Month and hour (#1298)', () => {
  const moment = Date.parse('2026-12-01T08:00:00.000Z');

  it('follow the phone’s zone, not the zone the app started in', () => {
    onTestFinished(hermesZoneMoved('Asia/Kolkata', 'Pacific/Pago_Pago'));
    expect(new Date(moment).getDate()).toBe(1);
    expect(phoneTimeZone()).toBe('Pacific/Pago_Pago');
    expect(phoneDay(moment)).toBe('2026-11-30');
    expect(phoneDay(new Date(moment))).toBe('2026-11-30');
    expect(phoneDay('2026-12-01T08:00:00.000Z')).toBe('2026-11-30');
    expect(phoneMonth(moment)).toBe('2026-11');
    expect(phoneHour(moment)).toBe(21);
  });

  it('are now’s unless a moment is given', () => {
    onTestFinished(hermesZoneMoved('Asia/Kolkata', 'Pacific/Pago_Pago'));
    vi.useFakeTimers({ toFake: ['Date'], now: moment });
    onTestFinished(() => {
      vi.useRealTimers();
    });
    expect([phoneDay(), phoneMonth(), phoneHour()]).toEqual(['2026-11-30', '2026-11', 21]);
  });

  it('read midnight as hour 0', () => {
    onTestFinished(hermesZoneMoved('Asia/Kolkata', 'Pacific/Pago_Pago'));
    // 00:00 on 1 Dec in Pago Pago (UTC−11).
    expect(phoneHour(Date.parse('2026-12-01T11:00:00.000Z'))).toBe(0);
    expect(phoneDay(Date.parse('2026-12-01T11:00:00.000Z'))).toBe('2026-12-01');
  });

  it('fall back to Date’s own zone on a platform whose Intl names no zone', () => {
    onTestFinished(hermesZoneMoved('Asia/Kolkata', 'Pacific/Pago_Pago'));
    const resolved = Intl.DateTimeFormat.prototype.resolvedOptions;
    const spy = vi
      .spyOn(Intl.DateTimeFormat.prototype, 'resolvedOptions')
      .mockImplementation(function (this: Intl.DateTimeFormat) {
        return { ...resolved.call(this), timeZone: undefined as unknown as string };
      });
    onTestFinished(() => spy.mockRestore());
    expect(phoneTimeZone()).toBeUndefined();
    expect(phoneDay(moment)).toBe('2026-12-01');
    expect(phoneHour(moment)).toBe(13);
  });
});
