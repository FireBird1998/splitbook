import { describe, expect, it } from 'vitest';
import {
  activityPagePath,
  expenseHistoryPath,
  groupActivityPath,
  expensePagePath,
  expenseRecordPath,
  groupBalancesPath,
  groupInsightsPath,
  groupPath,
  groupsPath,
  homeBalancesPath,
  invitationsPath,
  recurringExpensesPath,
  searchPath,
  settlementsPath,
  tripSummaryPath,
  userActivityPath,
  userSpendingPath,
} from './api-paths';
import { getLocalMonthIsoRange } from './date';
import type { ExpenseFilters } from './types';

const groupId = 'b00000000000000000000001';
const expenseId = 'c00000000000000000000001';

/** The query of a path, decoded the way the server reads it, in order. */
function queryOf(path: string): [string, string][] {
  const [, query = '', ...rest] = path.split('?');
  expect(rest).toEqual([]);
  if (!query) return [];
  return query.split('&').map((pair) => {
    const parts = pair.split('=');
    expect(parts).toHaveLength(2);
    return [decodeURIComponent(parts[0]), decodeURIComponent(parts[1])];
  });
}

/** How URLSearchParams writes an ISO time, as Android's controller sends it today. */
function formEncodedIso(value: string) {
  expect(value).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  return value.replaceAll(':', '%3A');
}

describe("the paths Android's controller builds today", () => {
  // One call site each in apps/mobile/src/data/mobile-controller.ts at 6b49c42.
  it('the Groups list, Home, a Group and its Balances', () => {
    expect(groupsPath()).toBe('/api/groups');
    expect(homeBalancesPath()).toBe('/api/user/balances');
    expect(groupPath(groupId)).toBe(`/api/groups/${groupId}`);
    expect(groupBalancesPath(groupId)).toBe(`/api/groups/${groupId}/balances`);
  });

  it('an Expense page without a Month', () => {
    expect(expensePagePath(groupId, { page: 3, limit: 20, includeMemberBreakdown: true })).toBe(
      `/api/groups/${groupId}/expenses?page=3&limit=20&includeMemberBreakdown=1`,
    );
  });

  it('an Expense page for a Household Month', () => {
    expect(
      expensePagePath(groupId, {
        page: 1,
        limit: 20,
        includeMemberBreakdown: true,
        dateFrom: '2026-08-31T18:30:00.000Z',
        dateTo: '2026-09-30T18:29:59.999Z',
      }),
    ).toBe(
      `/api/groups/${groupId}/expenses?page=1&limit=20&includeMemberBreakdown=1` +
        '&dateFrom=2026-08-31T18%3A30%3A00.000Z&dateTo=2026-09-30T18%3A29%3A59.999Z',
    );
  });

  it.each(['2026-01', '2026-09', '2026-12'])(
    'an Expense page for the Month %s, as getLocalMonthIsoRange gives it in this zone',
    (month) => {
      const { dateFrom, dateTo } = getLocalMonthIsoRange(month);
      expect(
        expensePagePath(groupId, {
          page: 2,
          limit: 20,
          includeMemberBreakdown: true,
          dateFrom,
          dateTo,
        }),
      ).toBe(
        `/api/groups/${groupId}/expenses?page=2&limit=20&includeMemberBreakdown=1` +
          `&dateFrom=${formEncodedIso(dateFrom)}&dateTo=${formEncodedIso(dateTo)}`,
      );
    },
  );

  it('an Activity page and an Expense history page', () => {
    expect(activityPagePath(groupId, { page: 2, limit: 20 })).toBe(
      `/api/groups/${groupId}/activity?page=2&limit=20`,
    );
    expect(activityPagePath(groupId, { expenseId, page: 1, limit: 20 })).toBe(
      `/api/groups/${groupId}/activity?expenseId=${expenseId}&page=1&limit=20`,
    );
  });

  it('every page of a Group’s Activity, as one query reads them', () => {
    expect(groupActivityPath(groupId, 20)).toBe(`/api/groups/${groupId}/activity?limit=20`);
  });

  it('every page of an Expense history, as one query reads them', () => {
    expect(expenseHistoryPath(groupId, expenseId, 20)).toBe(
      `/api/groups/${groupId}/activity?expenseId=${expenseId}&limit=20`,
    );
  });

  it('an Expense record', () => {
    expect(expenseRecordPath(groupId, expenseId)).toBe(
      `/api/groups/${groupId}/expenses/${expenseId}`,
    );
  });
});

describe('the reads only the web makes', () => {
  it('invitations, Settlements and recurring Expenses', () => {
    expect(invitationsPath()).toBe('/api/invitations');
    expect(settlementsPath(groupId)).toBe(`/api/groups/${groupId}/settlements`);
    expect(recurringExpensesPath(groupId)).toBe(`/api/groups/${groupId}/recurring`);
  });

  it('a search, with the query as it is searched', () => {
    expect(searchPath('goa')).toBe('/api/search?q=goa');
    expect(searchPath('  Kerala   sadya ')).toBe('/api/search?q=Kerala%20sadya');
    expect(searchPath('rent & bills?')).toBe('/api/search?q=rent%20%26%20bills%3F');
    expect(queryOf(searchPath('a=b&q=c#d'))).toEqual([['q', 'a=b&q=c#d']]);
    expect(searchPath('किराया')).toBe(`/api/search?q=${encodeURIComponent('किराया')}`);
  });

  it('no query for an empty search', () => {
    expect(searchPath('')).toBe('/api/search');
    expect(searchPath('   ')).toBe('/api/search');
  });

  it('the page sizes it asks for', () => {
    expect(expensePagePath(groupId, { page: 1, limit: 1 })).toBe(
      `/api/groups/${groupId}/expenses?page=1&limit=1`,
    );
    expect(activityPagePath(groupId, { page: 1, limit: 50 })).toBe(
      `/api/groups/${groupId}/activity?page=1&limit=50`,
    );
  });

  it("Home's latest changes across Groups, with or without a size", () => {
    expect(userActivityPath({ limit: 10 })).toBe('/api/user/activity?limit=10');
    expect(userActivityPath()).toBe('/api/user/activity');
    expect(queryOf(userActivityPath({ limit: 50 }))).toEqual([['limit', '50']]);
  });
});

describe("Home's spending chart (#307)", () => {
  it('sends the Month count and the time zone, encoded', () => {
    const path = userSpendingPath({ months: 6, timeZone: 'Asia/Kolkata' });
    expect(path).toBe('/api/user/spending?months=6&tz=Asia%2FKolkata');
    expect(queryOf(path)).toEqual([
      ['months', '6'],
      ['tz', 'Asia/Kolkata'],
    ]);
  });

  it('keeps a zone with a plus sign intact', () => {
    expect(queryOf(userSpendingPath({ months: 12, timeZone: 'Etc/GMT+5' }))).toEqual([
      ['months', '12'],
      ['tz', 'Etc/GMT+5'],
    ]);
  });
});

describe("a Group's insights (#314)", () => {
  const groupId = 'b00000000000000000000001';

  it('sends the Month, the earlier-Month count and the time zone, encoded', () => {
    const path = groupInsightsPath(groupId, {
      month: '2026-09',
      compare: 6,
      timeZone: 'Asia/Kolkata',
    });
    expect(path).toBe(`/api/groups/${groupId}/insights?month=2026-09&compare=6&tz=Asia%2FKolkata`);
    expect(queryOf(path)).toEqual([
      ['month', '2026-09'],
      ['compare', '6'],
      ['tz', 'Asia/Kolkata'],
    ]);
  });

  it('leaves out a Month and a count that are not set, so the server’s defaults apply', () => {
    expect(groupInsightsPath(groupId, { timeZone: 'Etc/GMT+5' })).toBe(
      `/api/groups/${groupId}/insights?tz=Etc%2FGMT%2B5`,
    );
  });

  it('refuses a Group id that would change the route', () => {
    expect(() => groupInsightsPath('..', { timeZone: 'UTC' })).toThrow(RangeError);
    expect(groupInsightsPath('a/b', { timeZone: 'UTC' })).toBe('/api/groups/a%2Fb/insights?tz=UTC');
  });
});

describe("a Trip's summary (#316)", () => {
  const groupId = 'b00000000000000000000001';

  it('sends the time zone, encoded', () => {
    const path = tripSummaryPath(groupId, { timeZone: 'Asia/Kolkata' });
    expect(path).toBe(`/api/groups/${groupId}/trip-summary?tz=Asia%2FKolkata`);
    expect(queryOf(path)).toEqual([['tz', 'Asia/Kolkata']]);
    expect(tripSummaryPath(groupId, { timeZone: 'Etc/GMT+5' })).toBe(
      `/api/groups/${groupId}/trip-summary?tz=Etc%2FGMT%2B5`,
    );
  });

  it('refuses a Group id that would change the route', () => {
    expect(() => tripSummaryPath('..', { timeZone: 'UTC' })).toThrow(RangeError);
    expect(tripSummaryPath('a/b', { timeZone: 'UTC' })).toBe(
      '/api/groups/a%2Fb/trip-summary?tz=UTC',
    );
  });
});

describe('Expense page filters', () => {
  // Every filter apps/web/src/app/api/groups/[id]/expenses/route.ts reads.
  const everyFilter: Required<ExpenseFilters> = {
    quickFilter: 'thisMonth',
    dateFrom: '2026-09-01T00:00:00.000Z',
    dateTo: '2026-09-30T23:59:59.999Z',
    category: 'food',
    tag: 'Rent',
    tagId: 'd00000000000000000000001',
    search: 'masala dosa',
    paidByUser: 'a00000000000000000000001',
    owedByUser: 'a00000000000000000000002',
    sortBy: 'amount',
    sortOrder: 'asc',
    page: 4,
    limit: 50,
    includeMemberBreakdown: true,
    involvesUser: 'a00000000000000000000003',
    amountMin: '500',
    amountMax: '1249.50',
    includeRecurringCount: true,
  };

  it('sends every filter the server reads', () => {
    expect(Object.fromEntries(queryOf(expensePagePath(groupId, everyFilter)))).toEqual({
      quickFilter: 'thisMonth',
      dateFrom: '2026-09-01T00:00:00.000Z',
      dateTo: '2026-09-30T23:59:59.999Z',
      category: 'food',
      tag: 'Rent',
      tagId: 'd00000000000000000000001',
      search: 'masala dosa',
      paidByUser: 'a00000000000000000000001',
      owedByUser: 'a00000000000000000000002',
      sortBy: 'amount',
      sortOrder: 'asc',
      page: '4',
      limit: '50',
      includeMemberBreakdown: '1',
      involvesUser: 'a00000000000000000000003',
      amountMin: '500',
      amountMax: '1249.50',
      includeRecurringCount: '1',
    });
  });

  it('sends the filters #310 added after every older one, so older paths are unchanged', () => {
    expect(
      expensePagePath(groupId, {
        page: 1,
        limit: 50,
        search: 'rent',
        sortBy: 'amount',
        sortOrder: 'asc',
        involvesUser: 'a00000000000000000000001',
        amountMin: '0.5',
        includeRecurringCount: true,
      }),
    ).toBe(
      `/api/groups/${groupId}/expenses?page=1&limit=50&search=rent&sortBy=amount&sortOrder=asc` +
        '&involvesUser=a00000000000000000000001&amountMin=0.5&includeRecurringCount=1',
    );
    expect(expensePagePath(groupId, { page: 1, includeRecurringCount: false, amountMax: '' })).toBe(
      `/api/groups/${groupId}/expenses?page=1`,
    );
  });

  it('sends the same query whatever order the filters are given in', () => {
    const reversed = Object.fromEntries(Object.entries(everyFilter).reverse()) as ExpenseFilters;
    expect(expensePagePath(groupId, reversed)).toBe(expensePagePath(groupId, everyFilter));
  });

  it('sends only the filters that are set', () => {
    expect(expensePagePath(groupId)).toBe(`/api/groups/${groupId}/expenses`);
    expect(
      expensePagePath(groupId, {
        page: 1,
        search: '',
        category: undefined,
        includeMemberBreakdown: false,
      }),
    ).toBe(`/api/groups/${groupId}/expenses?page=1`);
    expect(activityPagePath(groupId, { page: 1, limit: 20, expenseId: undefined })).toBe(
      `/api/groups/${groupId}/activity?page=1&limit=20`,
    );
  });
});

describe('encoding', () => {
  const values = [
    'two words',
    'tea & toast',
    'a=b',
    'why?',
    '#3',
    'flat 2/14',
    '1+1',
    '100%',
    '%41',
    'café',
    '₹500',
    'चाय',
    '🍕 night',
    '  padded  ',
  ];

  it.each(values)('sends %j as typed, in every query value', (value) => {
    const filters: ExpenseFilters = {
      quickFilter: value,
      dateFrom: value,
      dateTo: value,
      category: value,
      tag: value,
      tagId: value,
      search: value,
      paidByUser: value,
      owedByUser: value,
    };
    const query = queryOf(expensePagePath(groupId, filters));
    expect(query).toHaveLength(Object.keys(filters).length);
    expect(Object.fromEntries(query)).toEqual(filters);
    expect(queryOf(activityPagePath(groupId, { expenseId: value, page: 1, limit: 20 }))).toEqual([
      ['expenseId', value],
      ['page', '1'],
      ['limit', '20'],
    ]);
  });

  it('sends a broken character in a query value as U+FFFD instead of failing', () => {
    expect(queryOf(expensePagePath(groupId, { search: 'tea\uD800' }))).toEqual([
      ['search', 'tea\uFFFD'],
    ]);
  });

  it.each(['a/b', 'a?b', 'x/y?z#w', 'a b', '%2F', 'chai-\u2615', 'pizza-\uD83C\uDF55'])(
    'keeps the id %j inside its own segment',
    (id) => {
      const segments = (path: string) => {
        expect(path).not.toContain('?');
        expect(path).not.toContain('#');
        return path.split('/').map(decodeURIComponent);
      };
      expect(segments(groupPath(id))).toEqual(['', 'api', 'groups', id]);
      expect(segments(groupBalancesPath(id))).toEqual(['', 'api', 'groups', id, 'balances']);
      expect(segments(settlementsPath(id))).toEqual(['', 'api', 'groups', id, 'settlements']);
      expect(segments(recurringExpensesPath(id))).toEqual(['', 'api', 'groups', id, 'recurring']);
      expect(segments(expenseRecordPath(id, id))).toEqual([
        '',
        'api',
        'groups',
        id,
        'expenses',
        id,
      ]);
      expect(segments(expensePagePath(id))).toEqual(['', 'api', 'groups', id, 'expenses']);
      expect(segments(activityPagePath(id, { page: 1, limit: 20 }).split('?')[0])).toEqual([
        '',
        'api',
        'groups',
        id,
        'activity',
      ]);
    },
  );

  it.each(['', '.', '..'])('refuses the id %j, which would change the route', (id) => {
    expect(() => groupPath(id)).toThrow(RangeError);
    expect(() => expenseRecordPath(groupId, id)).toThrow(RangeError);
  });

  // U+FFFD in its place would make two different ids one path.
  it.each(['a\uD800', '\uDC00b', 'a\uDBFF\uDBFFb'])(
    'refuses the id %j, which has a broken character',
    (id) => {
      expect(() => groupPath(id)).toThrow(RangeError);
      expect(() => groupBalancesPath(id)).toThrow(RangeError);
      expect(() => expenseRecordPath(groupId, id)).toThrow(RangeError);
    },
  );
});
