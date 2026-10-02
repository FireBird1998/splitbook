import { afterEach, describe, it, expect, vi } from 'vitest';
import {
  currentMonthKey,
  getLocalMonthIsoRange,
  localeFirstWeekday,
  monthGrid,
  shiftMonthKey,
  toInclusiveDateToBound,
} from './date';

describe('toInclusiveDateToBound', () => {
  it('widens a date-only string to end-of-day UTC so the final day is included', () => {
    const bound = toInclusiveDateToBound('2026-08-31');
    expect(bound.toISOString()).toBe('2026-08-31T23:59:59.999Z');

    // An expense late on the final day falls inside the range…
    expect(new Date('2026-08-31T23:30:00.000Z').getTime()).toBeLessThanOrEqual(bound.getTime());
    // …while one just after midnight does not.
    expect(new Date('2026-09-01T00:15:00.000Z').getTime()).toBeGreaterThan(bound.getTime());
  });

  it('respects a full ISO timestamp as-is', () => {
    const bound = toInclusiveDateToBound('2026-08-31T12:00:00.000Z');
    expect(bound.toISOString()).toBe('2026-08-31T12:00:00.000Z');
  });
});

describe('local calendar Months', () => {
  afterEach(() => vi.unstubAllEnvs());

  it('uses the local calendar date to choose the current Month', () => {
    vi.stubEnv('TZ', 'America/New_York');
    expect(currentMonthKey(new Date('2026-10-01T02:00:00.000Z'))).toBe('2026-09');
  });

  it.each([
    ['2026-12', 1, '2027-01'],
    ['2026-01', -1, '2025-12'],
    ['2026-03', -13, '2025-02'],
    ['2026-03', 0, '2026-03'],
  ])('shifts %s by %i calendar months to %s', (month, offset, expected) => {
    expect(shiftMonthKey(month, offset)).toBe(expected);
  });

  it.each([
    ['America/New_York', '2026-03', '2026-03-01T05:00:00.000Z', '2026-04-01T03:59:59.999Z'],
    ['America/New_York', '2026-11', '2026-11-01T04:00:00.000Z', '2026-12-01T04:59:59.999Z'],
    ['Asia/Kolkata', '2026-09', '2026-08-31T18:30:00.000Z', '2026-09-30T18:29:59.999Z'],
    ['UTC', '2024-02', '2024-02-01T00:00:00.000Z', '2024-02-29T23:59:59.999Z'],
  ])('returns inclusive bounds for %s Month %s', (timezone, month, dateFrom, dateTo) => {
    vi.stubEnv('TZ', timezone);
    expect(getLocalMonthIsoRange(month)).toEqual({ dateFrom, dateTo });
    const nextDay = new Date(new Date(dateTo).getTime() + 1);
    expect(nextDay.getDate()).toBe(1);
    expect(nextDay.getHours()).toBe(0);
    expect(nextDay.getMinutes()).toBe(0);
  });

  it.each(['2026-00', '2026-13', '2026-2', '0000-01', '2026-02-01', 'invalid'])(
    'rejects an invalid Month key %s before shifting or querying it',
    (month) => {
      expect(() => shiftMonthKey(month, 1)).toThrow('Choose a valid Month.');
      expect(() => getLocalMonthIsoRange(month)).toThrow('Choose a valid Month.');
    },
  );
});

describe('monthGrid', () => {
  afterEach(() => vi.unstubAllEnvs());

  type Grid = ReturnType<typeof monthGrid>;
  const days = (grid: Grid) => grid.weeks.map((week) => week.map((cell) => cell?.day ?? null));
  const flagged = (grid: Grid, flag: 'today' | 'selected') =>
    grid.weeks.flat().flatMap((cell) => (cell?.[flag] ? [cell.date] : []));

  it('lays out a Month in weeks from a Sunday start', () => {
    const grid = monthGrid('2026-09', { firstWeekday: 0, today: '2026-09-30' });
    expect(grid.weekdays).toEqual([0, 1, 2, 3, 4, 5, 6]);
    expect(days(grid)).toEqual([
      [null, null, 1, 2, 3, 4, 5],
      [6, 7, 8, 9, 10, 11, 12],
      [13, 14, 15, 16, 17, 18, 19],
      [20, 21, 22, 23, 24, 25, 26],
      [27, 28, 29, 30, null, null, null],
    ]);
    expect(grid.weeks[4][3]).toEqual({
      date: '2026-09-30',
      day: 30,
      weekday: 3,
      today: true,
      selected: false,
    });
  });

  it.each([
    [1, [1, 2, 3, 4, 5, 6, 0], [null, 1, 2, 3, 4, 5, 6]],
    [6, [6, 0, 1, 2, 3, 4, 5], [null, null, null, 1, 2, 3, 4]],
    [5, [5, 6, 0, 1, 2, 3, 4], [null, null, null, null, 1, 2, 3]],
    [2, [2, 3, 4, 5, 6, 0, 1], [1, 2, 3, 4, 5, 6, 7]],
  ] as const)('starts weeks on weekday %i', (firstWeekday, weekdays, firstWeek) => {
    const grid = monthGrid('2026-09', { firstWeekday, today: '2026-09-30' });
    expect(grid.weekdays).toEqual(weekdays);
    expect(days(grid)[0]).toEqual(firstWeek);
    for (const week of grid.weeks)
      week.forEach((cell, column) => {
        if (cell) expect(cell.weekday).toBe(weekdays[column]);
      });
  });

  it.each([
    ['2026-01', 31],
    ['2026-04', 30],
    ['2026-02', 28],
    ['2024-02', 29],
    ['2000-02', 29],
    ['2100-02', 28],
    ['2026-12', 31],
  ])('gives %s its %i days and pads each week to seven', (month, length) => {
    const grid = monthGrid(month, { firstWeekday: 1, today: '2026-09-30' });
    const cells = grid.weeks.flat().filter((cell) => cell !== null);
    expect(cells.map((cell) => cell.day)).toEqual(Array.from({ length }, (_, day) => day + 1));
    expect(cells.at(-1)!.date).toBe(`${month}-${length}`);
    for (const week of grid.weeks) expect(week).toHaveLength(7);
  });

  it('uses four to six weeks, as the Month needs', () => {
    const weeks = (month: string) =>
      monthGrid(month, { firstWeekday: 0, today: '2026-09-30' }).weeks.length;
    expect(weeks('2026-02')).toBe(4);
    expect(weeks('2026-09')).toBe(5);
    expect(weeks('2026-08')).toBe(6);
  });

  it('flags only today and the selection, and neither outside their Month', () => {
    const options = { firstWeekday: 1, today: '2026-09-30', selected: '2026-09-15' } as const;
    const september = monthGrid('2026-09', options);
    expect(flagged(september, 'today')).toEqual(['2026-09-30']);
    expect(flagged(september, 'selected')).toEqual(['2026-09-15']);
    const october = monthGrid('2026-10', options);
    expect(flagged(october, 'today')).toEqual([]);
    expect(flagged(october, 'selected')).toEqual([]);
    const both = monthGrid('2026-09', { ...options, selected: '2026-09-30' });
    expect(both.weeks.flat().filter((cell) => cell?.today && cell.selected)).toHaveLength(1);
  });

  it.each(['2026-02-30', '2026-02-29', '2026-2-3', '', undefined])(
    'selects nothing for %j',
    (selected) => {
      const grid = monthGrid('2026-02', { firstWeekday: 1, today: '2026-02-01', selected });
      expect(flagged(grid, 'selected')).toEqual([]);
    },
  );

  it.each(['Pacific/Kiritimati', 'America/Los_Angeles', 'Asia/Kolkata', 'UTC'])(
    'gives the same days in %s',
    (timezone) => {
      vi.stubEnv('TZ', timezone);
      const grid = monthGrid('2026-03', { firstWeekday: 0, today: '2026-03-08' });
      expect(days(grid)[0]).toEqual([1, 2, 3, 4, 5, 6, 7]);
      expect(grid.weeks[1][0]).toMatchObject({ date: '2026-03-08', weekday: 0, today: true });
    },
  );

  it('names the neighbouring Months within the years a Month key can hold', () => {
    const options = { firstWeekday: 1, today: '2026-09-30' } as const;
    expect(monthGrid('2026-01', options)).toMatchObject({ previous: '2025-12', next: '2026-02' });
    expect(monthGrid('2026-12', options)).toMatchObject({ previous: '2026-11', next: '2027-01' });
    expect(monthGrid('1000-01', options)).toMatchObject({ previous: null, next: '1000-02' });
    expect(monthGrid('9999-12', options)).toMatchObject({ previous: '9999-11', next: null });
  });

  it.each(['2026-13', '0999-12', '2026-09-01', ''])('rejects the Month key %j', (month) => {
    expect(() => monthGrid(month, { firstWeekday: 1, today: '2026-09-30' })).toThrow(
      'Choose a valid Month.',
    );
  });
});

describe('localeFirstWeekday', () => {
  it.each([
    ['en-IN', 0],
    ['hi-IN', 0],
    ['en-US', 0],
    ['ja-JP', 0],
    ['pt-BR', 0],
    ['zh-Hant-TW', 0],
    ['en_US', 0],
    ['en-GB', 1],
    ['de-DE', 1],
    ['en-AU', 1],
    ['zh-CN', 1],
    ['ar-AE', 1],
    ['ar-EG', 6],
    ['fa-IR', 6],
    ['dv-MV', 5],
    ['en', 1],
    ['es-419', 1],
    ['', 1],
  ] as const)('starts %j weeks on weekday %i by region', (locale, weekday) => {
    expect(localeFirstWeekday(locale)).toBe(weekday);
  });

  it.each([
    ['en-GB-u-fw-sun', 0],
    ['en-IN-u-ca-gregory-fw-mon', 1],
    ['en-US-u-fw-sat-nu-latn', 6],
    ['en-US-u-fw-xyz', 0],
  ] as const)('prefers the fw preference in %j', (locale, weekday) => {
    expect(localeFirstWeekday(locale)).toBe(weekday);
  });
});
