import { describe, expect, it, onTestFinished, vi } from 'vitest';
import { missingFromAppFont } from '../test-utils/app-font';
import { mockDeviceLocale } from '../test-utils/device-locale';
import { inTimeZone } from '../test-utils/time-zone';
import { nearDay, recentDay, spellDay, spellMoment, spellTime } from './day-format';

// Monday 19 October 2026, mid-afternoon on this device.
const monday = new Date(2026, 9, 19, 13, 44);

describe('Android’s one day order (#640)', () => {
  it.each(['en-US', 'en-IN', 'en-GB'])('spells a day day-first on a %s phone', (locale) => {
    mockDeviceLocale(locale);
    expect(spellDay(monday)).toBe('19 Oct');
    expect(spellDay(monday, { weekday: 'short' })).toBe('Mon 19 Oct');
    expect(spellDay(monday, { year: true })).toBe('19 Oct 2026');
    expect(spellDay(monday, { weekday: 'short', year: true })).toBe('Mon 19 Oct 2026');
    expect(spellDay(monday, { weekday: 'long', month: 'long', year: true })).toBe(
      'Monday 19 October 2026',
    );
  });

  it('keeps the device’s words and digits on the Gregorian calendar', () => {
    mockDeviceLocale('fa-IR');
    expect(spellDay(monday, { weekday: 'long', month: 'long', year: true })).toBe(
      'دوشنبه ۱۹ اکتبر ۲۰۲۶',
    );
  });

  it.each([
    ['es-ES', 'lun, 19 oct', 'lunes, 19 de octubre de 2026'],
    ['de-DE', 'Mo., 19. Okt.', 'Montag, 19. Oktober 2026'],
  ])('keeps a day-first %s phone’s own words between the parts', (locale, short, long) => {
    mockDeviceLocale(locale);
    expect(spellDay(monday, { weekday: 'short' })).toBe(short);
    expect(spellDay(monday, { weekday: 'long', month: 'long', year: true })).toBe(long);
  });

  it('keeps the locale’s own order where the month is a number', () => {
    mockDeviceLocale('ja-JP');
    expect(spellDay(monday, { weekday: 'short' })).toBe('10月19日(月)');
  });

  it('reads a calendar day stored at UTC midnight in UTC', () => {
    mockDeviceLocale('en-US');
    expect(spellDay(new Date('2026-10-01T00:00:00.000Z'), { year: true, timeZone: 'UTC' })).toBe(
      '1 Oct 2026',
    );
  });

  it('follows the phone into another time zone, never the one a formatter was made in', async () => {
    mockDeviceLocale('en-US');
    const noonUtc = new Date('2026-10-19T12:00:00.000Z');
    await inTimeZone('Pacific/Kiritimati', () => expect(spellDay(noonUtc)).toBe('20 Oct'));
    await inTimeZone('Pacific/Pago_Pago', () => expect(spellDay(noonUtc)).toBe('19 Oct'));
  });

  it('still spells a readable date on a platform that can’t split one into parts', () => {
    mockDeviceLocale('en-US');
    const parts = vi
      .spyOn(Intl.DateTimeFormat.prototype, 'formatToParts')
      .mockImplementation(() => {
        throw new TypeError('formatToParts is not supported');
      });
    onTestFinished(() => parts.mockRestore());
    expect(spellDay(monday, { weekday: 'short' })).toBe('Mon, Oct 19');
    expect(spellDay(monday, { weekday: 'long', month: 'long', year: true })).toBe(
      'Monday, October 19, 2026',
    );
    expect(parts).toHaveBeenCalled();
  });

  it('reads the phone’s locale and zone once a turn, however many days it spells', async () => {
    const readings = mockDeviceLocale('en-US');
    const full = (date: Date) => spellDay(date, { weekday: 'long', month: 'long', year: true });
    // Hermes builds a formatter for each reading, so a Month of days shares one.
    full(monday);
    await Promise.resolve();
    readings.mockClear();
    for (let day = 1; day <= 42; day++) full(new Date(2026, 9, day));
    expect(readings).toHaveBeenCalledTimes(1);
    // The next turn reads again, so a phone that changes zone or language is followed.
    await Promise.resolve();
    full(monday);
    expect(readings).toHaveBeenCalledTimes(2);
  });

  it('puts the time after the day', () => {
    mockDeviceLocale('en-US');
    expect(spellTime(monday)).toBe('1:44 PM');
    expect(spellMoment(monday)).toBe(`19 Oct, ${spellTime(monday)}`);
    expect(spellMoment(monday, { weekday: 'short', year: true })).toBe(
      `Mon 19 Oct 2026, ${spellTime(monday)}`,
    );
  });

  it('says Today and Yesterday by this device’s days, and dates the rest', () => {
    mockDeviceLocale('en-US');
    const now = monday.getTime();
    expect(nearDay(new Date(2026, 9, 19, 0, 5), now)).toBe('Today');
    expect(nearDay(new Date(2026, 9, 18, 23, 55), now)).toBe('Yesterday');
    expect(nearDay(new Date(2026, 9, 17), now)).toBeNull();
    expect(recentDay(new Date(2026, 9, 18), now)).toBe('Yesterday');
    expect(recentDay(new Date(2026, 9, 17), now)).toBe('17 Oct 2026');
  });
});

// #766: "Last used 11:02 AM" drew without its time at 130% on a 360dp phone. The device's clock
// put U+202F (narrow no-break space) before "AM", which the app's font lacks: Android measured
// the line in the app font and drew that space from a wider fallback, so it wrapped unseen.
describe('times and days in characters the app’s font draws (#766)', () => {
  /**
   * The phone's clock as Android's ICU spells it, with U+202F before AM and PM, as on the
   * emulator. Node's newer ICU has a plain space there.
   */
  function androidClock() {
    const { prototype } = Intl.DateTimeFormat;
    const format = Object.getOwnPropertyDescriptor(prototype, 'format')!;
    Object.defineProperty(prototype, 'format', {
      ...format,
      get(this: Intl.DateTimeFormat) {
        const spell = format.get!.call(this) as Intl.DateTimeFormat['format'];
        return (date?: Date | number) => spell(date).replace(/ (?=[ap]m\b)/gi, '\u202f');
      },
    });
    onTestFinished(() => {
      Object.defineProperty(prototype, 'format', format);
    });
  }

  it.each(['en-US', 'en-IN', 'en-GB', 'de-DE', 'es-ES', 'fr-FR'])('on a %s phone', (locale) => {
    mockDeviceLocale(locale);
    androidClock();
    for (const hour of [0, 9, 11, 12, 13, 23]) {
      const at = new Date(2026, 9, 19, hour, 2);
      for (const text of [
        spellTime(at),
        spellMoment(at),
        spellMoment(at, { weekday: 'long', month: 'long', year: true }),
      ])
        expect(missingFromAppFont(text), text).toEqual([]);
    }
  });
});
