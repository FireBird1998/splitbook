import { describe, expect, it } from 'vitest';
import {
  TimeZoneError,
  addMonths,
  dayKeyInZone,
  isMonthKey,
  isTimeZone,
  lastMonths,
  monthKeyInZone,
  monthsBetween,
  monthsQueryRange,
  monthsWindow,
  readTimeZone,
  zonedDay,
} from './zoned-calendar';

/*
 * Months follow the zone the client names, never the runtime's: CI runs these in UTC and again
 * in Tongatapu, Kiritimati and Pago Pago (#227), and every expectation is the same.
 */

describe('time zones', () => {
  it.each([
    'Asia/Kolkata',
    'Asia/Calcutta',
    'America/Argentina/Buenos_Aires',
    'Pacific/Kiritimati',
    'Europe/London',
    'UTC',
    'Etc/GMT+5',
    'US/Pacific',
  ])('accepts the named zone %s, exactly as sent', (zone) => {
    expect(isTimeZone(zone)).toBe(true);
    expect(readTimeZone(zone)).toBe(zone);
  });

  it.each([
    ['an unknown zone', 'Mars/Phobos'],
    ['a fixed offset', '+05:30'],
    ['a fixed offset with GMT', 'GMT+5'],
    ['an empty name', ''],
    ['a name with spaces', 'Asia/ Kolkata'],
    ['a path', '../Asia/Kolkata'],
    ['a name too long to be a zone', `Asia/${'K'.repeat(64)}`],
    ['nothing', undefined],
    ['null', null],
    ['a number', 330],
  ])('refuses %s', (_label, zone) => {
    expect(isTimeZone(zone)).toBe(false);
    expect(() => readTimeZone(zone)).toThrow(TimeZoneError);
    expect(() => readTimeZone(zone)).toThrow('Send a named IANA time zone, such as Asia/Kolkata.');
  });

  it('refuses to bucket in an unknown zone', () => {
    expect(() => monthKeyInZone('2026-09-01T00:00:00Z', 'Mars/Phobos')).toThrow(TimeZoneError);
  });

  it('refuses an instant that is not a date', () => {
    expect(() => monthKeyInZone('not a date', 'UTC')).toThrow(RangeError);
    expect(() => monthKeyInZone(Number.NaN, 'UTC')).toThrow(RangeError);
  });
});

describe('the Month an instant falls in', () => {
  // Each pair: the last minute of September and the first of October, in that zone.
  it.each([
    ['UTC', '2026-09-30T23:59:00Z', '2026-10-01T00:00:00Z'],
    ['Asia/Kolkata (+05:30)', '2026-09-30T18:29:00Z', '2026-09-30T18:30:00Z'],
    ['Asia/Kathmandu (+05:45)', '2026-09-30T18:14:00Z', '2026-09-30T18:15:00Z'],
    ['Pacific/Kiritimati (+14)', '2026-09-30T09:59:00Z', '2026-09-30T10:00:00Z'],
    ['Pacific/Tongatapu (+13)', '2026-09-30T10:59:00Z', '2026-09-30T11:00:00Z'],
    ['Pacific/Chatham (+13:45, summer time)', '2026-09-30T10:14:00Z', '2026-09-30T10:15:00Z'],
    ['Pacific/Pago_Pago (−11)', '2026-10-01T10:59:00Z', '2026-10-01T11:00:00Z'],
    [
      'Australia/Sydney (+10, days before summer time)',
      '2026-09-30T13:59:00Z',
      '2026-09-30T14:00:00Z',
    ],
  ])('%s', (label, lastOfSeptember, firstOfOctober) => {
    const zone = label.split(' ')[0];
    expect(monthKeyInZone(lastOfSeptember, zone)).toBe('2026-09');
    expect(monthKeyInZone(firstOfOctober, zone)).toBe('2026-10');
  });

  it('puts one instant in different Months for different viewers', () => {
    const instant = '2026-10-01T00:00:00Z';
    expect(monthKeyInZone(instant, 'Asia/Kolkata')).toBe('2026-10');
    expect(monthKeyInZone(instant, 'America/New_York')).toBe('2026-09');
    expect(monthKeyInZone(instant, 'Pacific/Pago_Pago')).toBe('2026-09');
    expect(monthKeyInZone(instant, 'Pacific/Kiritimati')).toBe('2026-10');
  });

  it('crosses the year in the zone, not in UTC', () => {
    expect(monthKeyInZone('2026-12-31T14:59:00Z', 'Asia/Tokyo')).toBe('2026-12');
    expect(monthKeyInZone('2026-12-31T15:00:00Z', 'Asia/Tokyo')).toBe('2027-01');
    expect(monthKeyInZone('2027-01-01T04:59:00Z', 'America/New_York')).toBe('2026-12');
  });

  it('accepts a Date, an ISO timestamp and epoch milliseconds alike', () => {
    const instant = Date.UTC(2026, 8, 30, 18, 30);
    expect(monthKeyInZone(instant, 'Asia/Kolkata')).toBe('2026-10');
    expect(monthKeyInZone(new Date(instant), 'Asia/Kolkata')).toBe('2026-10');
    expect(monthKeyInZone(new Date(instant).toISOString(), 'Asia/Kolkata')).toBe('2026-10');
  });
});

describe('daylight saving at Month edges', () => {
  it('uses summer time at a Month edge and standard time at the next (New York)', () => {
    // March ends in summer time (−04), February in standard time (−05).
    expect(monthKeyInZone('2026-03-01T04:59:00Z', 'America/New_York')).toBe('2026-02');
    expect(monthKeyInZone('2026-03-01T05:00:00Z', 'America/New_York')).toBe('2026-03');
    expect(monthKeyInZone('2026-04-01T03:59:00Z', 'America/New_York')).toBe('2026-03');
    expect(monthKeyInZone('2026-04-01T04:00:00Z', 'America/New_York')).toBe('2026-04');
    // October ends in summer time; summer time ends on 1 November, so November ends in −05.
    expect(monthKeyInZone('2026-11-01T03:59:00Z', 'America/New_York')).toBe('2026-10');
    expect(monthKeyInZone('2026-11-01T04:00:00Z', 'America/New_York')).toBe('2026-11');
    expect(monthKeyInZone('2026-12-01T04:59:00Z', 'America/New_York')).toBe('2026-11');
    expect(monthKeyInZone('2026-12-01T05:00:00Z', 'America/New_York')).toBe('2026-12');
  });

  it('keeps the hour repeated on 1 November in November (New York)', () => {
    // 01:30 happens twice: first in summer time (05:30Z), then in standard time (06:30Z).
    expect(dayKeyInZone('2026-11-01T05:30:00Z', 'America/New_York')).toBe('2026-11-01');
    expect(dayKeyInZone('2026-11-01T06:30:00Z', 'America/New_York')).toBe('2026-11-01');
  });

  it('keeps the first hour of a Month, when it repeats, in that Month (Havana)', () => {
    // Summer time ends at 01:00 on 1 November 2026, so 00:00–00:59 happens twice.
    expect(monthKeyInZone('2026-11-01T03:59:00Z', 'America/Havana')).toBe('2026-10');
    expect(monthKeyInZone('2026-11-01T04:30:00Z', 'America/Havana')).toBe('2026-11');
    expect(monthKeyInZone('2026-11-01T05:30:00Z', 'America/Havana')).toBe('2026-11');
  });

  it('starts a Month whose midnight was skipped at the first instant after the gap (Asunción)', () => {
    // Summer time began at midnight on 1 October 2023: 23:59 on 30 September, then 01:00.
    expect(dayKeyInZone('2023-10-01T03:59:00Z', 'America/Asuncion')).toBe('2023-09-30');
    expect(dayKeyInZone('2023-10-01T04:00:00Z', 'America/Asuncion')).toBe('2023-10-01');
    expect(monthKeyInZone('2023-10-01T04:00:00Z', 'America/Asuncion')).toBe('2023-10');
  });

  it('follows the southern hemisphere, where summer time spans the new year (Sydney)', () => {
    // April starts in summer time (+11); October starts days before it begins (+10).
    expect(monthKeyInZone('2026-03-31T12:59:00Z', 'Australia/Sydney')).toBe('2026-03');
    expect(monthKeyInZone('2026-03-31T13:00:00Z', 'Australia/Sydney')).toBe('2026-04');
  });

  it('starts April in summer time and November in winter time (London)', () => {
    expect(monthKeyInZone('2026-03-31T22:59:00Z', 'Europe/London')).toBe('2026-03');
    expect(monthKeyInZone('2026-03-31T23:00:00Z', 'Europe/London')).toBe('2026-04');
    expect(monthKeyInZone('2026-10-31T23:59:00Z', 'Europe/London')).toBe('2026-10');
    expect(monthKeyInZone('2026-11-01T00:00:00Z', 'Europe/London')).toBe('2026-11');
  });
});

describe('days', () => {
  it('reads the calendar day as numbers', () => {
    expect(zonedDay('2026-09-30T18:30:00Z', 'Asia/Kolkata')).toEqual({
      year: 2026,
      month: 10,
      day: 1,
    });
  });

  it('pads the day key', () => {
    expect(dayKeyInZone('2026-02-05T12:00:00Z', 'UTC')).toBe('2026-02-05');
  });
});

describe('Month arithmetic', () => {
  it.each([
    ['2026-10', -5, '2026-05'],
    ['2026-01', -1, '2025-12'],
    ['2025-12', 1, '2026-01'],
    ['2026-03', -27, '2023-12'],
    ['2026-10', 0, '2026-10'],
  ])('%s moved by %i is %s', (month, offset, expected) => {
    expect(addMonths(month, offset)).toBe(expected);
  });

  it.each(['2026-13', '2026-1', 'October', ''])('refuses the Month %j', (month) => {
    expect(() => addMonths(month, 1)).toThrow(RangeError);
  });

  it('refuses a Month outside four-digit years', () => {
    expect(() => addMonths('9999-12', 1)).toThrow(RangeError);
    expect(() => addMonths('0000-01', -1)).toThrow(RangeError);
  });

  it.each(['2026-09', '2025-12', '0001-01', '9999-12'])('reads %s as a Month', (month) => {
    expect(isMonthKey(month)).toBe(true);
  });

  it.each([
    '2026-13',
    '2026-00',
    '2026-9',
    '2026-09-01',
    ' 2026-09',
    'September',
    '',
    202609,
    null,
  ])('does not read %j as a Month', (value) => {
    expect(isMonthKey(value)).toBe(false);
  });

  it('lists the Months between two, both included, across the year', () => {
    expect(monthsBetween('2025-11', '2026-02')).toEqual([
      '2025-11',
      '2025-12',
      '2026-01',
      '2026-02',
    ]);
    expect(monthsBetween('2026-09', '2026-09')).toEqual(['2026-09']);
    expect(monthsBetween('9999-11', '9999-12')).toEqual(['9999-11', '9999-12']);
  });

  it('lists none when the first Month is after the last, and refuses a malformed one', () => {
    expect(monthsBetween('2026-10', '2026-09')).toEqual([]);
    expect(() => monthsBetween('2026-13', '2026-09')).toThrow(RangeError);
    expect(() => monthsBetween('2026-01', 'soon')).toThrow(RangeError);
  });
});

describe('the last Months', () => {
  it('ends with the Month now falls in, in the zone', () => {
    const now = '2026-09-30T20:00:00Z';
    expect(lastMonths(6, { now, timeZone: 'Asia/Kolkata' })).toEqual([
      '2026-05',
      '2026-06',
      '2026-07',
      '2026-08',
      '2026-09',
      '2026-10',
    ]);
    expect(lastMonths(6, { now, timeZone: 'UTC' })).toEqual([
      '2026-04',
      '2026-05',
      '2026-06',
      '2026-07',
      '2026-08',
      '2026-09',
    ]);
  });

  it('crosses the year', () => {
    expect(lastMonths(3, { now: '2027-01-15T12:00:00Z', timeZone: 'UTC' })).toEqual([
      '2026-11',
      '2026-12',
      '2027-01',
    ]);
  });

  it('refuses a count below one', () => {
    expect(() => lastMonths(0, { now: Date.now(), timeZone: 'UTC' })).toThrow(RangeError);
    expect(() => lastMonths(1.5, { now: Date.now(), timeZone: 'UTC' })).toThrow(RangeError);
  });
});

describe('windows', () => {
  it('states the first and last calendar days', () => {
    expect(
      monthsWindow(['2026-05', '2026-06', '2026-07', '2026-08', '2026-09', '2026-10']),
    ).toEqual({ from: '2026-05-01', to: '2026-10-31' });
    expect(monthsWindow(['2026-09'])).toEqual({ from: '2026-09-01', to: '2026-09-30' });
    expect(monthsWindow(['2028-02'])).toEqual({ from: '2028-02-01', to: '2028-02-29' });
    expect(monthsWindow(['2100-02'])).toEqual({ from: '2100-02-01', to: '2100-02-28' });
    expect(monthsWindow(['2000-02'])).toEqual({ from: '2000-02-01', to: '2000-02-29' });
  });

  it('selects every instant of the Months in every zone, then a Month keeps its own', () => {
    const months = ['2026-09', '2026-10'];
    const { from, to } = monthsQueryRange(months);
    for (const zone of ['Pacific/Kiritimati', 'Pacific/Pago_Pago', 'Etc/GMT+12', 'UTC']) {
      // The range's own edges fall outside the Months in every zone, so the Months lie inside.
      for (const edge of [from.getTime(), to.getTime() - 1])
        expect(months).not.toContain(monthKeyInZone(edge, zone));
    }
    expect(from.toISOString()).toBe('2026-08-31T00:00:00.000Z');
    expect(to.toISOString()).toBe('2026-11-02T00:00:00.000Z');
  });
});
