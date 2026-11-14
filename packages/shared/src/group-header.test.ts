import { describe, expect, it } from 'vitest';
import {
  readGroupHeader,
  HEADER_SCENES,
  headerTimeOfDay,
  headerCard,
  todayTripDay,
  tripDayCaption,
} from './group-header';

describe('a Group header', () => {
  it('starts Classic, with a remembered Beach scene following the clock', () => {
    expect(readGroupHeader()).toEqual({ style: 'classic', scene: 'beach', time: 'auto' });
    expect(HEADER_SCENES.map(({ name }) => name)).toEqual([
      'Beach',
      'Sakura',
      'Eco city',
      'Mountain village',
    ]);
  });
});

it.each([
  [0, 'night'],
  [4.999, 'night'],
  [5, 'morning'],
  [9.999, 'morning'],
  [10, 'day'],
  [16.999, 'day'],
  [17, 'sunset'],
  [19.999, 'sunset'],
  [20, 'night'],
  [23, 'night'],
] as const)('auto at local hour %s is %s', (hour, expected) => {
  expect(headerTimeOfDay('auto', hour)).toBe(expected);
  expect(headerTimeOfDay('sunset', hour)).toBe('sunset');
});

it('keeps remembered choices while Classic or the environment switch is off', () => {
  const scene = { style: 'scene', scene: 'sakura', time: 'sunset' } as const;
  expect(readGroupHeader(scene, false)).toEqual({ ...scene, style: 'classic' });
  expect(readGroupHeader({ ...scene, style: 'classic' })).toEqual({ ...scene, style: 'classic' });
  expect(scene.style).toBe('scene');
});

it.each(['home', 'couple', 'work', 'other'] as const)(
  'keeps %s card facts free of Trip-only facts',
  (category) => {
    expect(headerCard({ ...trip, category }, '2026-11-15')).toMatchObject({
      name: 'Goa Friends Trip',
      members: 2,
      currencies: ['INR', 'EUR'],
      trip: null,
    });
  },
);
const trip = {
  name: 'Goa Friends Trip',
  category: 'trip' as const,
  members: [{}, {}],
  defaultCurrency: 'INR',
  alternateCurrencies: ['EUR'],
  startDate: '2026-11-14T00:00:00.000Z',
  endDate: '2026-11-16T00:00:00.000Z',
};
it('gives a Trip its route, calendar dates and numbered days', () => {
  expect(headerCard(trip, '2026-11-15')).toEqual({
    name: 'Goa Friends Trip',
    theme: 'Trip',
    members: 2,
    currencies: ['INR', 'EUR'],
    trip: {
      route: { from: 'GOA', to: 'TRI' },
      start: '2026-11-14',
      end: '2026-11-16',
      days: ['2026-11-14', '2026-11-15', '2026-11-16'],
      today: 2,
      caption: 'Day 2 of 3',
    },
  });
});
it.each([
  ['2026-11-11', 'Starts in 3\u00a0days'],
  ['2026-11-13', 'Starts tomorrow'],
  ['2026-11-14', 'Day 1 of 3'],
  ['2026-11-16', 'Day 3 of 3'],
  ['2026-11-17', 'Trip over\u00a0· 3\u00a0days'],
  ['2027-01-01', 'Trip over\u00a0· 3\u00a0days'],
] as const)('on %s the day squares are captioned “%s”', (today, caption) => {
  expect(tripDayCaption(trip, today)).toBe(caption);
  expect(headerCard(trip, today).trip?.caption).toBe(caption);
});
it('says a one-day Trip is over in the singular, and nothing without both dates', () => {
  const oneDay = { ...trip, endDate: trip.startDate };
  expect(tripDayCaption(oneDay, '2026-11-20')).toBe('Trip over\u00a0· 1\u00a0day');
  expect(tripDayCaption({ ...trip, endDate: null }, '2026-11-15')).toBeNull();
});
it('says nothing about the days before the viewer’s own day is known', () => {
  expect(tripDayCaption(trip, '')).toBeNull();
  expect(headerCard(trip, '').trip).toMatchObject({ today: null, caption: null });
});
it.each([
  ['2026-11-13', null],
  ['2026-11-14', 1],
  ['2026-11-15', 2],
  ['2026-11-16', 3],
  ['2026-11-17', null],
] as const)('today %s highlights only a running Trip day', (today, expected) => {
  expect(todayTripDay(trip, today)).toBe(expected);
});
it('has no trip days without both dates', () => {
  expect(todayTripDay({ ...trip, endDate: null }, '2026-11-15')).toBeNull();
  expect(headerCard({ ...trip, startDate: null }, '2026-11-15').trip?.days).toEqual([]);
});

it.each([
  ['2026-11-13', null],
  ['2026-11-14', 1],
  ['2026-11-15', 2],
  ['2026-11-16', 3],
  ['2026-11-17', null],
] as const)('orders reversed stored Trip dates before highlighting %s', (today, expected) => {
  const reversed = { ...trip, startDate: trip.endDate, endDate: trip.startDate };
  expect(todayTripDay(reversed, today)).toBe(expected);
  expect(headerCard(reversed, '2026-11-15').trip).toMatchObject({
    start: '2026-11-14',
    end: '2026-11-16',
    days: ['2026-11-14', '2026-11-15', '2026-11-16'],
    today: 2,
  });
});
it.each([
  ['2026-04-30', 120],
  ['2026-05-01', 0],
  ['2036-01-01', 0],
] as const)('caps Trip day squares for a Trip ending %s', (endDate, length) => {
  const card = headerCard({ ...trip, startDate: '2026-01-01', endDate }, '2026-01-05');
  expect(card.trip?.days).toHaveLength(length);
  expect(card.trip?.today).toBe(5);
});
