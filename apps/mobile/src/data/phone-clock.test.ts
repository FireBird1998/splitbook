import { describe, expect, it, onTestFinished, vi } from 'vitest';
import { hermesZoneMoved } from '@splitbook/shared/test-support/hermes-zone';
import { phoneClock, phoneDay, phoneHour, phoneMonth, phoneTimeZone } from './phone-clock';

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

// #1302: the clock that tells open screens when the day, hour or zone moves.
describe('the phone’s clock for open screens (#1302)', () => {
  const at = (hour: number, minute = 0, second = 0) =>
    new Date(2026, 10, 21, hour, minute, second).getTime();
  const listening = (listener = vi.fn()) => {
    const stop = phoneClock.subscribe(listener);
    onTestFinished(stop);
    return listener;
  };
  const fakeClock = (now: number) => {
    vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'], now });
    onTestFinished(() => {
      vi.useRealTimers();
      phoneClock.setInFront(true);
    });
  };

  it('tells its listeners when the hour or day moves, at the minute it moves, and not before', () => {
    fakeClock(at(23, 58, 30));
    const listener = listening();
    const before = phoneClock.now();
    expect(before).toMatchObject({ day: '2026-11-21', hour: 23 });
    vi.advanceTimersByTime(60_000);
    expect(listener).not.toHaveBeenCalled();
    expect(phoneClock.now()).toBe(before);
    vi.advanceTimersByTime(30_000);
    expect(listener).toHaveBeenCalledTimes(1);
    expect(phoneClock.now()).toMatchObject({ day: '2026-11-22', hour: 0 });
  });

  it('notices a zone change at the next minute', async () => {
    let restore = hermesZoneMoved('Asia/Kolkata', 'Asia/Kolkata');
    onTestFinished(() => restore());
    fakeClock(Date.parse('2026-11-21T08:00:30.000Z'));
    const listener = listening();
    expect(phoneClock.now()).toMatchObject({ day: '2026-11-21', hour: 13 });
    restore();
    restore = hermesZoneMoved('Asia/Kolkata', 'Pacific/Pago_Pago');
    // Each check is a turn of its own, as on the phone, so the zone is read afresh.
    await vi.advanceTimersByTimeAsync(30_000);
    expect(listener).toHaveBeenCalledTimes(1);
    expect(phoneClock.now()).toMatchObject({
      day: '2026-11-20',
      hour: 21,
      timeZone: 'Pacific/Pago_Pago',
    });
  });

  it('doesn’t check behind other apps, and checks at once back in front', () => {
    fakeClock(at(9, 59, 30));
    const listener = listening();
    phoneClock.setInFront(false);
    expect(vi.getTimerCount()).toBe(0);
    vi.setSystemTime(at(10, 30));
    expect(listener).not.toHaveBeenCalled();
    phoneClock.setInFront(true);
    expect(listener).toHaveBeenCalledTimes(1);
    expect(phoneClock.now()).toMatchObject({ hour: 10 });
    expect(vi.getTimerCount()).toBe(1);
  });

  it('stops checking when nothing listens', () => {
    fakeClock(at(12));
    const stop = phoneClock.subscribe(() => undefined);
    expect(vi.getTimerCount()).toBe(1);
    stop();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('tells its listeners of a move that a draw found before the check', async () => {
    fakeClock(at(9, 59, 30));
    const listener = listening();
    vi.setSystemTime(at(10, 0, 5));
    expect(phoneClock.now()).toMatchObject({ hour: 10 });
    expect(listener).not.toHaveBeenCalled();
    await Promise.resolve();
    expect(listener).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(60_000);
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('reads the clock anew for a screen drawn after a missed check', () => {
    fakeClock(at(9, 59, 30));
    listening();
    phoneClock.setInFront(false);
    vi.setSystemTime(at(10, 0, 5));
    expect(phoneClock.now()).toMatchObject({ hour: 10 });
  });
});
