import { describe, expect, it } from 'vitest';
import { exportPath } from './api-paths';
import {
  EXPORT_MAX_GROUPS,
  exportSlug,
  exportWindowSlug,
  isCalendarDay,
  isTimeZone,
  localCalendarDay,
  monthWindow,
  parseExportQuery,
  planExportFiles,
  type ExportRequest,
} from './export-request';

/*
 * The export read's request (#317): the query the server reads, the path the web page sends,
 * and the names of the files that come back.
 */

const MAPLE = 'b00000000000000000000001';
const GOA = 'b00000000000000000000002';

/** A query string as the server reads it. */
const values = (query: Record<string, string>) => ({
  get: (name: string) => (name in query ? query[name] : null),
});

/** The query of a path, decoded, as `URLSearchParams` would read it. */
function queryOf(path: string) {
  const [, query = ''] = path.split('?');
  return Object.fromEntries(
    query
      .split('&')
      .filter(Boolean)
      .map((pair) => pair.split('=').map(decodeURIComponent) as [string, string]),
  );
}

describe('reading a request', () => {
  it('reads the Groups, the window, what to include, the format and the time zone', () => {
    const parsed = parseExportQuery(
      values({
        groups: `${MAPLE},${GOA}`,
        from: '2026-09-01',
        to: '2026-09-30',
        include: 'history,payments',
        format: 'csv',
        tz: 'Asia/Kolkata',
      }),
    );
    expect(parsed).toEqual({
      success: true,
      data: {
        groupIds: [MAPLE, GOA],
        from: '2026-09-01',
        to: '2026-09-30',
        // Always in the documented order, however they were asked for.
        include: ['payments', 'history'],
        format: 'csv',
        timeZone: 'Asia/Kolkata',
      },
    });
  });

  it('is all time without a window, CSV and UTC by default, with nothing extra included', () => {
    expect(parseExportQuery(values({ groups: MAPLE }))).toEqual({
      success: true,
      data: { groupIds: [MAPLE], include: [], format: 'csv', timeZone: 'UTC' },
    });
  });

  it('names each Group once, in the order asked', () => {
    const parsed = parseExportQuery(values({ groups: `${GOA}, ${MAPLE},${GOA.toUpperCase()}` }));
    expect(parsed.success && parsed.data.groupIds).toEqual([GOA, MAPLE]);
  });

  it.each([
    ['no Groups', {}],
    ['an empty list of Groups', { groups: ' , ' }],
    ['a Group that is not an id', { groups: 'maple-house' }],
    [
      'too many Groups',
      {
        groups: Array.from({ length: EXPORT_MAX_GROUPS + 1 }, (_, n) =>
          n.toString(16).padStart(24, '0'),
        ).join(','),
      },
    ],
    ['a start without an end', { groups: MAPLE, from: '2026-09-01' }],
    ['an end without a start', { groups: MAPLE, to: '2026-09-30' }],
    ['an end before the start', { groups: MAPLE, from: '2026-09-30', to: '2026-09-01' }],
    ['a day that does not exist', { groups: MAPLE, from: '2026-02-01', to: '2026-02-31' }],
    ['a day that is not a day', { groups: MAPLE, from: '2026-9-1', to: '2026-09-30' }],
    ['an unknown include', { groups: MAPLE, include: 'payments,receipts' }],
    ['another format', { groups: MAPLE, format: 'xlsx' }],
    ['an unknown time zone', { groups: MAPLE, tz: 'Mars/Olympus_Mons' }],
  ])('refuses %s', (_, query) => {
    expect(parseExportQuery(values(query)).success).toBe(false);
  });

  it('allows a window of one day', () => {
    const parsed = parseExportQuery(
      values({ groups: MAPLE, from: '2026-09-14', to: '2026-09-14' }),
    );
    expect(parsed.success).toBe(true);
  });
});

describe('the path', () => {
  it('sends what the server reads back as the same request', () => {
    const request: ExportRequest = {
      groupIds: [MAPLE, GOA],
      from: '2026-09-01',
      to: '2026-09-30',
      include: ['payments', 'shares'],
      format: 'csv',
      timeZone: 'America/Argentina/Buenos_Aires',
    };
    const path = exportPath(request);
    expect(path.split('?')[0]).toBe('/api/export');
    expect(queryOf(path)).toEqual({
      groups: `${MAPLE},${GOA}`,
      from: '2026-09-01',
      to: '2026-09-30',
      include: 'payments,shares',
      format: 'csv',
      tz: 'America/Argentina/Buenos_Aires',
    });
    expect(parseExportQuery(values(queryOf(path)))).toEqual({ success: true, data: request });
  });

  it('leaves out the window for all time, and the includes when there are none', () => {
    const path = exportPath({
      groupIds: [MAPLE],
      include: [],
      format: 'csv',
      timeZone: 'UTC',
    });
    expect(path).toBe(`/api/export?groups=${MAPLE}&format=csv&tz=UTC`);
  });
});

describe('days and windows', () => {
  it('knows real calendar days and time zones', () => {
    expect(isCalendarDay('2028-02-29')).toBe(true);
    expect(isCalendarDay('2026-02-29')).toBe(false);
    expect(isCalendarDay('2026-09-01T00:00:00Z')).toBe(false);
    expect(isTimeZone('Asia/Kolkata')).toBe(true);
    expect(isTimeZone('UTC')).toBe(true);
    expect(isTimeZone('')).toBe(false);
    expect(isTimeZone('Not/AZone')).toBe(false);
  });

  it('gives a month’s first and last days, February and December included', () => {
    expect(monthWindow(2026, 9)).toEqual({ from: '2026-09-01', to: '2026-09-30' });
    expect(monthWindow(2028, 2)).toEqual({ from: '2028-02-01', to: '2028-02-29' });
    expect(monthWindow(2026, 12)).toEqual({ from: '2026-12-01', to: '2026-12-31' });
  });

  it('reads a local date as the device’s own calendar day', () => {
    expect(localCalendarDay(new Date(2026, 8, 30, 23, 59))).toBe('2026-09-30');
    expect(localCalendarDay(new Date(2026, 9, 1, 0, 0))).toBe('2026-10-01');
  });

  it('names a window: a month, a day, a range, or all time', () => {
    expect(exportWindowSlug({ from: '2026-09-01', to: '2026-09-30' })).toBe('2026-09');
    expect(exportWindowSlug({ from: '2026-09-14', to: '2026-09-14' })).toBe('2026-09-14');
    expect(exportWindowSlug({ from: '2026-09-01', to: '2026-09-15' })).toBe(
      '2026-09-01-to-2026-09-15',
    );
    expect(exportWindowSlug({ from: '2026-08-01', to: '2026-09-30' })).toBe(
      '2026-08-01-to-2026-09-30',
    );
    expect(exportWindowSlug({})).toBe('all-time');
  });
});

describe('file names', () => {
  it('turn a Group’s name into lower-case ASCII, accents folded', () => {
    expect(exportSlug('Maple House')).toBe('maple-house');
    expect(exportSlug('  Café Crew — Lisbon 2026! ')).toBe('cafe-crew-lisbon-2026');
    expect(exportSlug('Ünïcödé Ölbaum')).toBe('unicode-olbaum');
    expect(exportSlug('東京旅行')).toBe('group');
    expect(exportSlug('x'.repeat(80))).toHaveLength(48);
  });

  it('are one CSV for one Group without payments', () => {
    expect(
      planExportFiles(['Maple House'], { from: '2026-09-01', to: '2026-09-30', include: [] }),
    ).toEqual({
      files: [{ group: 0, kind: 'expenses', name: 'maple-house-2026-09-expenses.csv' }],
      download: 'maple-house-2026-09-expenses.csv',
      zipped: false,
    });
  });

  it('are a zip named after the Group when its payments come too', () => {
    const plan = planExportFiles(['Maple House'], { include: ['payments', 'shares'] });
    expect(plan.files.map((file) => file.name)).toEqual([
      'maple-house-all-time-expenses.csv',
      'maple-house-all-time-payments.csv',
    ]);
    expect(plan).toMatchObject({ download: 'maple-house-all-time.zip', zipped: true });
  });

  it('are a zip of every Group’s files, two Groups of one name told apart', () => {
    const plan = planExportFiles(['Goa Trip', 'Maple House', 'Goa trip', 'goa-trip-2'], {
      from: '2026-09-01',
      to: '2026-09-15',
      include: [],
    });
    expect(plan.files.map((file) => file.name)).toEqual([
      'goa-trip-2026-09-01-to-2026-09-15-expenses.csv',
      'maple-house-2026-09-01-to-2026-09-15-expenses.csv',
      'goa-trip-2-2026-09-01-to-2026-09-15-expenses.csv',
      'goa-trip-2-2-2026-09-01-to-2026-09-15-expenses.csv',
    ]);
    expect(plan.download).toBe('splitbook-4-groups-2026-09-01-to-2026-09-15.zip');
  });
});

it('refuses a period on an all-time JSON backup', () => {
  const request = new Map([
    ['groups', 'aaaaaaaaaaaaaaaaaaaaaaaa'],
    ['format', 'json'],
    ['from', '2026-09-01'],
    ['to', '2026-09-30'],
  ]);
  const values = { get: (key: string) => request.get(key) ?? null };
  expect(parseExportQuery(values).success).toBe(false);
  request.delete('from');
  request.delete('to');
  expect(parseExportQuery(values)).toMatchObject({ success: true, data: { format: 'json' } });
});
