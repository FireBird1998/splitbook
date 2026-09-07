/**
 * Unit tests for the pure due-period helper — the primary test seam for
 * recurring expense generation (v4 Phase 3). Covers month-length clamping,
 * startsOn/endsOn windows, pauses, catch-up, and no-backfill guarantees.
 */

import { describe, expect, it } from 'vitest';
import {
  expenseDateForPeriod,
  getDuePeriods,
  previousPeriod,
  toPeriod,
  type RecurringSchedule,
} from './recurring-due-periods';

function schedule(overrides: Partial<RecurringSchedule> = {}): RecurringSchedule {
  return {
    dayOfMonth: 15,
    startsOn: '2026-01-01T00:00:00.000Z',
    endsOn: null,
    isPaused: false,
    lastGeneratedFor: null,
    ...overrides,
  };
}

describe('toPeriod', () => {
  it('formats a date as zero-padded UTC YYYY-MM', () => {
    expect(toPeriod(new Date('2026-08-13T17:30:00.000Z'))).toBe('2026-08');
    expect(toPeriod(new Date('2026-01-01T00:00:00.000Z'))).toBe('2026-01');
    expect(toPeriod(new Date('2025-12-31T23:59:59.999Z'))).toBe('2025-12');
  });
});

describe('previousPeriod', () => {
  it('steps one month back, rolling over the year', () => {
    expect(previousPeriod('2026-08')).toBe('2026-07');
    expect(previousPeriod('2026-01')).toBe('2025-12');
  });
});

describe('expenseDateForPeriod', () => {
  it('lands on the configured day in long months', () => {
    expect(expenseDateForPeriod('2026-01', 31).toISOString()).toBe('2026-01-31T00:00:00.000Z');
    expect(expenseDateForPeriod('2026-08', 15).toISOString()).toBe('2026-08-15T00:00:00.000Z');
  });

  it('clamps day 31 to the last day of short months', () => {
    // 2026 is not a leap year; 2024 is.
    expect(expenseDateForPeriod('2026-02', 31).toISOString()).toBe('2026-02-28T00:00:00.000Z');
    expect(expenseDateForPeriod('2024-02', 31).toISOString()).toBe('2024-02-29T00:00:00.000Z');
    expect(expenseDateForPeriod('2026-04', 31).toISOString()).toBe('2026-04-30T00:00:00.000Z');
  });

  it('clamps out-of-range days defensively', () => {
    expect(expenseDateForPeriod('2026-08', 0).toISOString()).toBe('2026-08-01T00:00:00.000Z');
    expect(expenseDateForPeriod('2026-08', 45).toISOString()).toBe('2026-08-31T00:00:00.000Z');
  });

  it('rejects malformed periods', () => {
    expect(() => expenseDateForPeriod('2026-8', 15)).toThrow('Invalid period');
    expect(() => expenseDateForPeriod('2026-13', 15)).toThrow('Invalid period');
    expect(() => expenseDateForPeriod('august', 15)).toThrow('Invalid period');
  });
});

describe('getDuePeriods', () => {
  it('returns every eligible period from startsOn through the current month', () => {
    const due = getDuePeriods(schedule(), '2026-03');
    expect(due).toEqual(['2026-01', '2026-02', '2026-03']);
  });

  it('returns only the current period when the marker is one month behind', () => {
    const due = getDuePeriods(schedule({ lastGeneratedFor: '2026-02' }), '2026-03');
    expect(due).toEqual(['2026-03']);
  });

  it('catches up after missed months when lastGeneratedFor falls behind', () => {
    const due = getDuePeriods(schedule({ lastGeneratedFor: '2026-04' }), '2026-08');
    expect(due).toEqual(['2026-05', '2026-06', '2026-07', '2026-08']);
  });

  it('catches up across a year boundary', () => {
    const due = getDuePeriods(
      schedule({ startsOn: '2025-01-01', lastGeneratedFor: '2025-11' }),
      '2026-02',
    );
    expect(due).toEqual(['2025-12', '2026-01', '2026-02']);
  });

  it('returns nothing when the marker is current or ahead', () => {
    expect(getDuePeriods(schedule({ lastGeneratedFor: '2026-08' }), '2026-08')).toEqual([]);
    expect(getDuePeriods(schedule({ lastGeneratedFor: '2026-09' }), '2026-08')).toEqual([]);
  });

  it('returns nothing while paused', () => {
    expect(getDuePeriods(schedule({ isPaused: true }), '2026-08')).toEqual([]);
    expect(
      getDuePeriods(schedule({ isPaused: true, lastGeneratedFor: '2026-01' }), '2026-08'),
    ).toEqual([]);
  });

  it('never backfills periods whose expense date falls before startsOn', () => {
    // Created Jul 10 with day 1: July 1 is before the template existed, so the
    // first occurrence of the configured day on/after startsOn is Aug 1.
    expect(getDuePeriods(schedule({ dayOfMonth: 1, startsOn: '2026-07-10' }), '2026-08')).toEqual([
      '2026-08',
    ]);
    // Day 15: July 15 is on/after startsOn, so July is due.
    expect(getDuePeriods(schedule({ dayOfMonth: 15, startsOn: '2026-07-10' }), '2026-08')).toEqual([
      '2026-07',
      '2026-08',
    ]);
  });

  it('treats a startsOn exactly on the configured day as due that month', () => {
    expect(getDuePeriods(schedule({ dayOfMonth: 15, startsOn: '2026-07-15' }), '2026-07')).toEqual([
      '2026-07',
    ]);
  });

  it('returns nothing when startsOn is in the future', () => {
    expect(getDuePeriods(schedule({ startsOn: '2026-09-01' }), '2026-08')).toEqual([]);
    // Even with day clamping: day 31 in Aug clamps to Aug 31, still before Sep 1? No —
    // startsOn Sep 20 with day 31: Aug 31 < Sep 20, so August is not due either.
    expect(getDuePeriods(schedule({ dayOfMonth: 31, startsOn: '2026-09-20' }), '2026-08')).toEqual(
      [],
    );
  });

  it('honors endsOn as an inclusive boundary', () => {
    const due = getDuePeriods(
      schedule({ dayOfMonth: 1, startsOn: '2026-01-01', endsOn: '2026-03-31' }),
      '2026-08',
    );
    expect(due).toEqual(['2026-01', '2026-02', '2026-03']);
  });

  it('compares endsOn against the clamped expense date, not the month', () => {
    // endsOn Jul 10: day 15 lands Jul 15 (after end) — July excluded.
    expect(
      getDuePeriods(
        schedule({ dayOfMonth: 15, startsOn: '2026-01-01', endsOn: '2026-07-10' }),
        '2026-08',
      ),
    ).toEqual(['2026-01', '2026-02', '2026-03', '2026-04', '2026-05', '2026-06']);
    // day 5 lands Jul 5 (before end) — July included.
    expect(
      getDuePeriods(
        schedule({ dayOfMonth: 5, startsOn: '2026-06-01', endsOn: '2026-07-10' }),
        '2026-08',
      ),
    ).toEqual(['2026-06', '2026-07']);
    // endsOn exactly on the expense date is inclusive.
    expect(
      getDuePeriods(
        schedule({ dayOfMonth: 15, startsOn: '2026-07-01', endsOn: '2026-07-15' }),
        '2026-08',
      ),
    ).toEqual(['2026-07']);
  });

  it('returns nothing when endsOn precedes startsOn', () => {
    expect(
      getDuePeriods(schedule({ startsOn: '2026-07-10', endsOn: '2026-07-01' }), '2026-08'),
    ).toEqual([]);
  });

  it('combines the marker with the startsOn window (marker wins when later)', () => {
    // Marker is behind startsOn's month: startsOn still bounds the backfill.
    expect(
      getDuePeriods(
        schedule({ dayOfMonth: 1, startsOn: '2026-07-10', lastGeneratedFor: '2026-05' }),
        '2026-08',
      ),
    ).toEqual(['2026-08']);
  });

  it('treats a malformed stored marker as absent (defensive: old documents)', () => {
    const due = getDuePeriods(schedule({ lastGeneratedFor: 'not-a-period' }), '2026-02');
    expect(due).toEqual(['2026-01', '2026-02']);
  });

  it('clamps day 31 across short months during catch-up', () => {
    const due = getDuePeriods(
      schedule({ dayOfMonth: 31, startsOn: '2026-01-01', lastGeneratedFor: '2026-01' }),
      '2026-04',
    );
    expect(due).toEqual(['2026-02', '2026-03', '2026-04']);
    // And the materialized dates land on Feb 28 / Mar 31 / Apr 30.
    expect(due.map((p) => expenseDateForPeriod(p, 31).toISOString())).toEqual([
      '2026-02-28T00:00:00.000Z',
      '2026-03-31T00:00:00.000Z',
      '2026-04-30T00:00:00.000Z',
    ]);
  });

  it('returns nothing for a malformed current period', () => {
    expect(getDuePeriods(schedule(), '2026-8')).toEqual([]);
  });
});
