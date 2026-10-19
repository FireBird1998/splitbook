import { describe, expect, it } from 'vitest';
import { deviceLocale } from '../test-utils/device-locale';
import { inTimeZone } from '../test-utils/time-zone';
import { nearDay, recentDay, spellDay, spellMoment, spellTime } from './day-format';

// Monday 19 October 2026, mid-afternoon on this device.
const monday = new Date(2026, 9, 19, 13, 44);

describe('Android’s one day order (#640)', () => {
  it.each(['en-US', 'en-IN', 'en-GB'])('spells a day day-first on a %s phone', (locale) => {
    deviceLocale(locale);
    expect(spellDay(monday)).toBe('19 Oct');
    expect(spellDay(monday, { weekday: 'short' })).toBe('Mon 19 Oct');
    expect(spellDay(monday, { year: true })).toBe('19 Oct 2026');
    expect(spellDay(monday, { weekday: 'short', year: true })).toBe('Mon 19 Oct 2026');
    expect(spellDay(monday, { weekday: 'long', month: 'long', year: true })).toBe(
      'Monday 19 October 2026',
    );
  });

  it('keeps the device’s words and digits on the Gregorian calendar', () => {
    deviceLocale('fa-IR');
    expect(spellDay(monday, { weekday: 'long', month: 'long', year: true })).toBe(
      'دوشنبه ۱۹ اکتبر ۲۰۲۶',
    );
  });

  it('keeps the locale’s own order where the month is a number', () => {
    deviceLocale('ja-JP');
    expect(spellDay(monday, { weekday: 'short' })).toBe('10月19日(月)');
  });

  it('reads a calendar day stored at UTC midnight in UTC', () => {
    deviceLocale('en-US');
    expect(spellDay(new Date('2026-10-01T00:00:00.000Z'), { year: true, timeZone: 'UTC' })).toBe(
      '1 Oct 2026',
    );
  });

  it('follows the phone into another time zone, never the one a formatter was made in', async () => {
    deviceLocale('en-US');
    const noonUtc = new Date('2026-10-19T12:00:00.000Z');
    await inTimeZone('Pacific/Kiritimati', () => expect(spellDay(noonUtc)).toBe('20 Oct'));
    await inTimeZone('Pacific/Pago_Pago', () => expect(spellDay(noonUtc)).toBe('19 Oct'));
  });

  it('puts the time after the day', () => {
    deviceLocale('en-US');
    expect(spellMoment(monday)).toBe(`19 Oct, ${spellTime(monday)}`);
    expect(spellMoment(monday, { weekday: 'short', year: true })).toBe(
      `Mon 19 Oct 2026, ${spellTime(monday)}`,
    );
  });

  it('says Today and Yesterday by this device’s days, and dates the rest', () => {
    deviceLocale('en-US');
    const now = monday.getTime();
    expect(nearDay(new Date(2026, 9, 19, 0, 5), now)).toBe('Today');
    expect(nearDay(new Date(2026, 9, 18, 23, 55), now)).toBe('Yesterday');
    expect(nearDay(new Date(2026, 9, 17), now)).toBeNull();
    expect(recentDay(new Date(2026, 9, 18), now)).toBe('Yesterday');
    expect(recentDay(new Date(2026, 9, 17), now)).toBe('17 Oct 2026');
  });
});
