import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { focusManager, onlineManager } from '@tanstack/query-core';
import { createMobileController } from './mobile-controller';
import type { FetchResponse } from './types';

/** The phone's zone as the app reads it, so these paths hold in every zone CI runs (#730). */
const PHONE_ZONE = encodeURIComponent(Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC');

// #730: a Trip in more than one currency reads its Trip summary (#729) beside its Expenses, so
// the All time card switches between its currencies, as the web's Trip summary does, nothing
// converted. These checks drive the controller's public commands and look only at the requests
// sent, the snapshot and the rows saved on this device (ADR 0006).

const alex = { id: 'a00000000000000000000001', name: 'Alex', email: 'alex@example.test' };
const sam = { id: 'a00000000000000000000002', name: 'Sam', email: 'sam@example.test' };
const lisbonId = 'b00000000000000000000001';
const goaId = 'b00000000000000000000002';
const mapleId = 'b00000000000000000000003';
const baliId = 'b00000000000000000000004';
const tagId = 'c00000000000000000000001';
const iso = '2026-10-02T06:30:00.000Z';
const person = (user: typeof alex) => ({ _id: user.id, name: user.name, image: null });
const groupOf = (_id: string, name: string, category: string, alternateCurrencies: string[]) => ({
  _id,
  createdBy: alex.id,
  name,
  description: '',
  category,
  defaultCurrency: 'INR',
  alternateCurrencies,
  members: [alex, sam].map((user) => ({
    user: { ...person(user), email: user.email },
    role: 'member',
    joinedAt: iso,
  })),
  tags: [{ _id: tagId, name: 'Food', isArchived: false, createdAt: iso }],
  startDate: '2026-10-02T00:00:00.000Z',
  endDate: '2026-10-12T00:00:00.000Z',
  createdAt: iso,
  updatedAt: iso,
});
/** Rupees, with euros and yen. */
const lisbon = groupOf(lisbonId, 'Lisbon & Tokyo', 'trip', ['EUR', 'JPY']);
/** Rupees only. */
const goa = groupOf(goaId, 'Goa Weekend', 'trip', []);
const maple = groupOf(mapleId, 'Maple House', 'home', ['EUR']);
/** An older Trip: no extra currencies listed, but Expenses in rupees and euros (T10). */
const bali = groupOf(baliId, 'Bali Getaway', 'trip', []);
const groups = [lisbon, goa, maple, bali];
const json = (body: unknown, status = 200) => Response.json(body, { status });
const tripPath = `/api/groups/${lisbonId}/trip-summary`;

/** What Lisbon & Tokyo spent in each currency, and Alex's share and payments in it. */
const spent: Record<string, { count: number; spent: number; share: number; paid: number }> = {
  INR: { count: 3, spent: 4_860_000, share: 1_620_000, paid: 2_000_000 },
  EUR: { count: 11, spent: 124_000, share: 40_000, paid: 60_000 },
  JPY: { count: 24, spent: 186_000, share: 62_000, paid: 70_400 },
};
/** The Trip summary as the server sends it: in `currency`, else the one with the most Expenses. */
const tripSummary = (currency: string | null, timeZone: string) => {
  const shown = currency ?? 'JPY';
  const figures = spent[shown] ?? { count: 0, spent: 0, share: 0, paid: 0 };
  return {
    status: 200,
    data: {
      timeZone,
      currency: shown,
      tripDates: { start: '2026-10-02', end: '2026-10-12' },
      window: null,
      dayCount: 0,
      tooManyDays: false,
      spentMinor: figures.spent,
      expenseCount: figures.count,
      yourShareMinor: figures.share,
      youPaidMinor: figures.paid,
      yourExpenseCount: 1,
      peopleCount: 2,
      perPersonPerDayMinor: null,
      days: [],
      dailyAverageMinor: null,
      beforeTrip: null,
      afterTrip: null,
      byTag: [],
      suggestedPayments: [],
      otherCurrencies: [],
      hasExpenses: true,
      currencies: ['INR', 'EUR', 'JPY'].map((code) => ({
        currency: code,
        expenseCount: spent[code]!.count,
        spentMinor: spent[code]!.spent,
      })),
    },
  };
};

function fixture() {
  /** `offlineAfterPost`: the connection drops as soon as a save's POST is answered. */
  const server = { offline: false, created: 0, offlineAfterPost: false };
  let cookie: string | null = null,
    owner: string | null = null,
    cleanup = false;
  const rows = new Map<string, unknown>(),
    drafts = new Map<string, unknown>(),
    attempts = new Map<string, unknown>();
  const calls: { method: string; path: string }[] = [];
  const records = (map: Map<string, unknown>) => ({
    load: async (account: string, key: string) => structuredClone(map.get(account + key) ?? null),
    save: async (account: string, key: string, value: unknown) => {
      map.set(account + key, structuredClone(value));
    },
    remove: async (account: string, key: string) => {
      map.delete(account + key);
    },
    clear: async () => {
      map.clear();
    },
    list: async (account: string) =>
      [...map]
        .filter(([key]) => key.startsWith(account))
        .map(([key, value]) => ({
          groupId: key.slice(account.length),
          value: structuredClone(value),
        })),
  });
  const untrusted = { value: null as unknown },
    identity = { value: null as unknown };
  const untrustedCopies = {
    load: async () => structuredClone(untrusted.value),
    save: async (value: unknown) => {
      untrusted.value = structuredClone(value);
    },
    clear: async () => {
      untrusted.value = null;
    },
  };
  const savedQueries = {
    ...records(rows),
    keys: async (account: string) =>
      [...rows.keys()]
        .filter((key) => key.startsWith(account))
        .map((key) => key.slice(account.length)),
  };
  const respond = (path: string, init: RequestInit): FetchResponse => {
    const method = init.method ?? 'GET';
    if (path.endsWith('/sign-in'))
      return new Response(JSON.stringify({ user: alex }), {
        headers: { 'Set-Cookie': 'better-auth.session_token=alex.signature; Path=/; HttpOnly' },
      });
    if (path.endsWith('/sign-out')) return json({ success: true });
    if (path.endsWith('/get-session'))
      return json({
        user: { ...alex, image: null },
        session: { userId: alex.id, expiresAt: '2030-01-01T00:00:00Z' },
      });
    if (path === '/api/groups') return json({ status: 200, data: groups });
    if (path === '/api/user/balances')
      return json({
        status: 200,
        data: { buckets: [{ currency: 'INR', youOwe: 0, youAreOwed: 0 }] },
      });
    const id = /^\/api\/groups\/([a-f\d]{24})/.exec(path)?.[1];
    const group = groups.find(({ _id }) => _id === id);
    if (!id || !group) return json({}, 404);
    if (path === `/api/groups/${id}`) return json({ status: 200, data: group });
    if (path.startsWith(`/api/groups/${id}/activity?`))
      return json({
        status: 200,
        data: { activities: [], pagination: { page: 1, limit: 20, total: 0, totalPages: 0 } },
      });
    if (path.startsWith(`/api/groups/${id}/expenses?`))
      return json({
        status: 200,
        data: {
          expenses: [],
          pagination: { page: 1, limit: 20, total: 0, totalPages: 0 },
          summary: {
            count: 0,
            totalsByCurrency:
              id === lisbonId
                ? Object.entries(spent).map(([currency, row]) => ({
                    currency,
                    totalAmount: row.spent / (currency === 'JPY' ? 1 : 100),
                  }))
                : id === baliId
                  ? [
                      { currency: 'INR', totalAmount: 1200 },
                      { currency: 'EUR', totalAmount: 40 },
                    ]
                  : [{ currency: 'INR', totalAmount: 0 }],
            userOwes: 0,
            userGetsBack: 0,
            byMember: [],
          },
        },
      });
    if (path === `/api/groups/${id}/expenses` && method === 'POST') {
      server.created += 1;
      // The reply arrives; every request after it can't reach the server.
      if (server.offlineAfterPost) server.offline = true;
      return json(
        { status: 201, data: { _id: `e${String(server.created).padStart(23, '0')}`, group: id } },
        201,
      );
    }
    if (path === `/api/groups/${id}/balances`)
      return json({
        status: 200,
        data: { byCurrency: [{ currency: 'INR', balances: [], debts: [] }] },
      });
    if (path.startsWith(`/api/groups/${id}/trip-summary?`)) {
      const query = new URL(path, 'http://local').searchParams;
      return json(tripSummary(query.get('currency'), query.get('tz') ?? ''));
    }
    return json({}, 404);
  };
  const create = () =>
    createMobileController(
      {
        apiBaseUrl: 'http://localhost:4138',
        authOrigin: 'http://localhost:4138',
        developmentPersonaEnabled: true,
      },
      {
        newSubmissionKey: () =>
          `trip-summary-attempt-${String(server.created + 1).padStart(4, '0')}`,
        credentials: {
          load: async () => cookie,
          save: async (value) => {
            cookie = value;
          },
          clear: async () => {
            cookie = null;
          },
        },
        savedQueries,
        netInfo: {
          addEventListener: (listener) => {
            listener({ isConnected: !server.offline });
            return () => undefined;
          },
        },
        offlineIdentity: {
          load: async () => structuredClone(identity.value),
          save: async (value) => {
            identity.value = structuredClone(value);
          },
          clear: async () => {
            identity.value = null;
          },
        },
        expenseDrafts: records(drafts),
        settlementAttempts: records(attempts),
        accountLocal: {
          owner: {
            load: async () => owner,
            save: async (value) => {
              owner = value;
            },
            clear: async () => {
              owner = null;
            },
          },
          cleanupMarker: {
            load: async () => cleanup,
            mark: async () => {
              cleanup = true;
            },
            clear: async () => {
              cleanup = false;
            },
          },
          untrustedCopies,
          stores: [savedQueries, records(drafts), records(attempts), untrustedCopies],
        },
        fetch: async (url, init) => {
          const path = new URL(url).pathname + new URL(url).search;
          calls.push({ method: init.method ?? 'GET', path });
          if (server.offline) throw new TypeError('Network request failed');
          return respond(path, init);
        },
      },
    );
  return {
    create,
    server,
    rows,
    calls,
    /** The Trip summary reads sent, as paths. */
    tripReads: () =>
      calls.filter(({ path }) => path.startsWith(`${tripPath}?`)).map(({ path }) => path),
    /** This phone's saved Trip summaries of Lisbon & Tokyo, by path. */
    savedTrips: () =>
      [...rows.keys()]
        .filter((key) => key.startsWith(`${alex.id}${tripPath}?`))
        .map((key) => key.slice(alex.id.length)),
  };
}

let controllers: ReturnType<ReturnType<typeof fixture>['create']>[] = [];
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(Date.parse('2026-10-12T10:42:00.000Z'));
  focusManager.setFocused(true);
  onlineManager.setOnline(true);
});
afterEach(() => {
  for (const controller of controllers) controller.dispose();
  controllers = [];
  vi.useRealTimers();
});
const started = (made: ReturnType<typeof fixture>) => {
  const controller = made.create();
  controllers.push(controller);
  return controller;
};

describe('a Trip in several currencies reads its Trip summary (#730)', () => {
  it('reads it after the Expenses, in the phone’s time zone, opening on the currency with the most Expenses', async () => {
    const made = fixture();
    const controller = started(made);
    await controller.signIn('alex');
    await controller.openGroup(lisbonId);
    expect(made.tripReads()).toEqual([`${tripPath}?tz=${PHONE_ZONE}`]);
    const paths = made.calls.map(({ path }) => path);
    const expenses = paths.findIndex((path) =>
      path.startsWith(`/api/groups/${lisbonId}/expenses?`),
    );
    expect(paths.indexOf(`${tripPath}?tz=${PHONE_ZONE}`)).toBeGreaterThan(expenses);
    expect(controller.getSnapshot().financial.trip).toMatchObject({
      status: 'ready',
      chosen: null,
      restored: false,
      refreshedAt: Date.parse('2026-10-12T10:42:00.000Z'),
      data: {
        currency: 'JPY',
        spentMinor: 186_000,
        yourShareMinor: 62_000,
        youPaidMinor: 70_400,
        currencies: [
          { currency: 'INR', expenseCount: 3, spentMinor: 4_860_000 },
          { currency: 'EUR', expenseCount: 11, spentMinor: 124_000 },
          { currency: 'JPY', expenseCount: 24, spentMinor: 186_000 },
        ],
      },
    });
  });

  it('reads the currency chosen on its own, keeping the one chosen while it is read', async () => {
    const made = fixture();
    const controller = started(made);
    await controller.signIn('alex');
    await controller.openGroup(lisbonId);
    await controller.chooseTripCurrency('EUR');
    expect(made.tripReads()).toEqual([
      `${tripPath}?tz=${PHONE_ZONE}`,
      `${tripPath}?tz=${PHONE_ZONE}&currency=EUR`,
    ]);
    expect(controller.getSnapshot().financial.trip).toMatchObject({
      status: 'ready',
      chosen: 'EUR',
      data: { currency: 'EUR', spentMinor: 124_000, yourShareMinor: 40_000, youPaidMinor: 60_000 },
    });
  });

  it('reads no Trip summary for a Trip in one currency, nor for a Household', async () => {
    const made = fixture();
    const controller = started(made);
    await controller.signIn('alex');
    await controller.openGroup(goaId);
    await controller.back();
    await controller.openGroup(mapleId);
    expect(made.calls.filter(({ path }) => path.includes('/trip-summary'))).toEqual([]);
    expect(controller.getSnapshot().financial.trip).toBeUndefined();
  });

  it('keeps a saved copy, shown with its own time when the phone opens it offline', async () => {
    const made = fixture();
    const first = started(made);
    await first.signIn('alex');
    await first.openGroup(lisbonId);
    const readAt = Date.now();
    await vi.waitFor(() => expect(made.savedTrips()).toEqual([`${tripPath}?tz=${PHONE_ZONE}`]));
    first.dispose();
    made.server.offline = true;
    vi.setSystemTime(readAt + 60 * 60_000);
    const restarted = started(made);
    await restarted.restore();
    await restarted.openGroup(lisbonId);
    expect(restarted.getSnapshot().financial.trip).toMatchObject({
      restored: true,
      refreshedAt: readAt,
      data: { currency: 'JPY', spentMinor: 186_000 },
    });
  });

  it('is removed with the Trip’s ledger after a change, and read again', async () => {
    const made = fixture();
    const controller = started(made);
    await controller.signIn('alex');
    await controller.openGroup(lisbonId);
    await vi.waitFor(() => expect(made.savedTrips()).toHaveLength(1));
    const before = made.tripReads().length;
    await controller.openExpense(lisbonId);
    await controller.updateExpenseDraft({ amount: '4200', description: 'Ramen', tagId });
    await controller.saveExpense();
    await vi.waitFor(() => expect(made.tripReads().length).toBe(before + 1));
    expect(controller.getSnapshot().financial.trip).toMatchObject({ status: 'ready' });
  });

  // The Tester's mutant T4 drops the Trip summary rows from the ledger rows a change removes.
  it('leaves no copy from before a change, even when the read after it fails offline', async () => {
    const made = fixture();
    const first = started(made);
    await first.signIn('alex');
    await first.openGroup(lisbonId);
    await vi.waitFor(() => expect(made.savedTrips()).toHaveLength(1));
    await first.openExpense(lisbonId);
    await first.updateExpenseDraft({ amount: '4200', description: 'Ramen', tagId });
    // Saved, and the connection drops before the Trip summary is read again after it.
    made.server.offlineAfterPost = true;
    await first.saveExpense();
    await vi.waitFor(() => expect(made.server.created).toBe(1));
    first.dispose();
    const restarted = started(made);
    await restarted.restore();
    await restarted.openGroup(lisbonId);
    const trip = restarted.getSnapshot().financial.trip;
    // Nothing from before the change: never the pre-change ¥186,000.
    expect(trip?.data).toBeNull();
    expect(trip).toMatchObject({ status: 'error' });
    expect(trip?.message).toContain('not saved on this device');
    expect(made.savedTrips()).toEqual([]);
  });

  // T10: an older Trip lists no extra currency, but its Expenses are in more than one.
  it('reads the summary of an older Trip whose Expenses are in several currencies', async () => {
    const made = fixture();
    const controller = started(made);
    await controller.signIn('alex');
    await controller.openGroup(baliId);
    expect(made.calls.map(({ path }) => path)).toContain(
      `/api/groups/${baliId}/trip-summary?tz=${PHONE_ZONE}`,
    );
    expect(controller.getSnapshot().financial.trip).toMatchObject({ status: 'ready' });
  });

  it('is cleared from this phone at sign-out', async () => {
    const made = fixture();
    const controller = started(made);
    await controller.signIn('alex');
    await controller.openGroup(lisbonId);
    await vi.waitFor(() => expect(made.savedTrips()).toHaveLength(1));
    await controller.signOut();
    expect(made.savedTrips()).toEqual([]);
  });
});
