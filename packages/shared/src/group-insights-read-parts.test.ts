import { describe, expect, it } from 'vitest';
import {
  parseGroupInsightsResponse,
  readGroupInsightsByTag,
  readGroupInsightsRecurring,
  readGroupInsightsWhoPaid,
} from './group-insights-read';

/*
 * The fields the Group insights read gained with #315, each decoded on its own: a malformed one
 * fails only its own card (`ok: false`), never the read, and the recurring Expenses card has
 * no data at all while recurring Expenses are switched off. A fictional Household's September
 * against the two Months before it.
 */

const alex = 'a00000000000000000000001';
const sam = 'a00000000000000000000002';
const priya = 'a00000000000000000000003';
const groceries = 'd00000000000000000000001';
const rent = 'e00000000000000000000001';

const response = {
  status: 200,
  data: {
    timeZone: 'Asia/Kolkata',
    month: '2026-09',
    compare: 2,
    firstMonth: '2026-03',
    currency: 'INR',
    window: { from: '2026-07-01', to: '2026-09-30' },
    months: [
      {
        month: '2026-07',
        spentMinor: 60000,
        expenseCount: 2,
        yourShareMinor: 20000,
        youPaidMinor: 0,
        recurringCount: 1,
      },
      {
        month: '2026-08',
        spentMinor: 60000,
        expenseCount: 2,
        yourShareMinor: 20000,
        youPaidMinor: 0,
        recurringCount: 1,
      },
      {
        month: '2026-09',
        spentMinor: 90000,
        expenseCount: 3,
        yourShareMinor: 30000,
        youPaidMinor: 30000,
        recurringCount: 1,
      },
    ],
    average: { monthCount: 2, spentMinor: 60000, yourShareMinor: 20000, youPaidMinor: 0 },
    change: { direction: 'up', differenceMinor: 30000, changePercent: 50 },
    biggestExpense: null,
    otherCurrencies: [],
    recurringExpenses: true,
    hasExpenses: true,
    byTag: {
      earlierMonths: ['2026-07', '2026-08'],
      tags: [
        {
          tagId: groceries,
          name: 'Groceries',
          spentMinor: 60000,
          expenseCount: 2,
          averageMinor: 30000,
          differenceMinor: 30000,
          direction: 'up',
          changePercent: 100,
        },
        {
          tagId: null,
          name: null,
          spentMinor: 30000,
          expenseCount: 1,
          averageMinor: 30000,
          differenceMinor: 0,
          direction: 'level',
          changePercent: 0,
        },
      ],
    },
    whoPaid: {
      members: [
        {
          id: priya,
          name: 'Priya Shah',
          isMember: true,
          paidMinor: 60000,
          shareMinor: 30000,
          netMinor: 30000,
        },
        {
          id: alex,
          name: 'Alex Rivera',
          isMember: true,
          paidMinor: 30000,
          shareMinor: 30000,
          netMinor: 0,
        },
        {
          id: sam,
          name: 'Sam Chen',
          isMember: false,
          paidMinor: 0,
          shareMinor: 30000,
          netMinor: -30000,
        },
      ],
    },
    recurring: {
      addedInMonth: { count: 1, spentMinor: 30000 },
      templates: [
        {
          id: rent,
          description: 'Rent',
          amountMinor: 30000,
          dayOfMonth: 5,
          paused: false,
          nextDate: '2026-10-05',
          addedOn: '2026-09-05',
          paidBy: [{ id: priya, name: 'Priya Shah' }],
        },
      ],
    },
  },
};

const REMOVE = Symbol('remove');
/** The decoded read of a copy of the response with the field at `path` set, or removed. */
function readWith(path: readonly (string | number)[], value: unknown) {
  const body = JSON.parse(JSON.stringify(response));
  let node = body.data as Record<string | number, unknown>;
  for (const key of path.slice(0, -1)) node = node[key] as Record<string | number, unknown>;
  if (value === REMOVE) delete node[path[path.length - 1]];
  else node[path[path.length - 1]] = value;
  return parseGroupInsightsResponse(body);
}
const read = () => readWith(['extra'], 1);

describe('the Month in detail (#315)', () => {
  it('decodes each part as sent', () => {
    expect(readGroupInsightsByTag(read())).toEqual({ ok: true, value: response.data.byTag });
    expect(readGroupInsightsWhoPaid(read())).toEqual({ ok: true, value: response.data.whoPaid });
    expect(readGroupInsightsRecurring(read())).toEqual({
      ok: true,
      value: response.data.recurring,
    });
  });

  it('accepts a Month with nothing earlier to compare, and no templates', () => {
    const body = JSON.parse(JSON.stringify(response));
    Object.assign(body.data, {
      firstMonth: '2026-09',
      window: { from: '2026-09-01', to: '2026-09-30' },
      months: [body.data.months[2]],
      average: null,
      change: null,
      byTag: {
        earlierMonths: [],
        tags: [
          {
            ...body.data.byTag.tags[0],
            averageMinor: null,
            differenceMinor: null,
            direction: null,
            changePercent: null,
          },
        ],
      },
      recurring: { addedInMonth: { count: 1, spentMinor: 30000 }, templates: [] },
    });
    const decoded = parseGroupInsightsResponse(body);
    expect(readGroupInsightsByTag(decoded).ok).toBe(true);
    expect(readGroupInsightsRecurring(decoded)).toMatchObject({ ok: true });
  });

  it('has no recurring data while recurring Expenses are off, whatever is sent', () => {
    expect(readGroupInsightsRecurring(readWith(['recurringExpenses'], false))).toBeNull();
    const off = readWith(['recurringExpenses'], false);
    expect(readGroupInsightsByTag(off).ok).toBe(true);
  });

  it.each([
    ['no By Tag', ['byTag'], REMOVE],
    ['a Tag id that is not an id', ['byTag', 'tags', 0, 'tagId'], 'groceries'],
    ['Spent by Tag in major units', ['byTag', 'tags', 0, 'spentMinor'], 600.5],
    ['an unknown direction', ['byTag', 'tags', 0, 'direction'], 'sideways'],
    ['an average that is not the read’s', ['byTag', 'earlierMonths'], ['2026-08']],
    ['two Untagged rows', ['byTag', 'tags', 0, 'tagId'], null],
  ])('fails only By Tag on %s', (_label, path, value) => {
    const decoded = readWith(path, value);
    expect(readGroupInsightsByTag(decoded)).toEqual({ ok: false });
    expect(readGroupInsightsWhoPaid(decoded).ok).toBe(true);
    expect(readGroupInsightsRecurring(decoded)?.ok).toBe(true);
  });

  it.each([
    ['no Who paid', ['whoPaid'], REMOVE],
    ['a member without a name', ['whoPaid', 'members', 0, 'name'], REMOVE],
    ['a negative share', ['whoPaid', 'members', 0, 'shareMinor'], -1],
    ['a net as text', ['whoPaid', 'members', 0, 'netMinor'], '30000'],
    ['Paids that miss the Month’s Spent', ['whoPaid', 'members', 0, 'paidMinor'], 59999],
    ['Shares that miss the Month’s Spent', ['whoPaid', 'members', 2, 'shareMinor'], 30001],
  ])('fails only Who paid on %s', (_label, path, value) => {
    const decoded = readWith(path, value);
    expect(readGroupInsightsWhoPaid(decoded)).toEqual({ ok: false });
    expect(readGroupInsightsByTag(decoded).ok).toBe(true);
  });

  it.each([
    ['no recurring data while switched on', ['recurring'], REMOVE],
    ['a day of the month over 31', ['recurring', 'templates', 0, 'dayOfMonth'], 32],
    ['a next date that is not a day', ['recurring', 'templates', 0, 'nextDate'], '5 October'],
    ['an amount in major units', ['recurring', 'templates', 0, 'amountMinor'], 300.5],
    ['a count that is not the Month’s', ['recurring', 'addedInMonth', 'count'], 2],
  ])('fails only the recurring card on %s', (_label, path, value) => {
    const decoded = readWith(path, value);
    expect(readGroupInsightsRecurring(decoded)).toEqual({ ok: false });
    expect(readGroupInsightsByTag(decoded).ok).toBe(true);
    expect(readGroupInsightsWhoPaid(decoded).ok).toBe(true);
  });
});
