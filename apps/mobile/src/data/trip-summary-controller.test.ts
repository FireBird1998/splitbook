import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { focusManager, onlineManager } from '@tanstack/query-core';
import { testPhone } from '../test-utils/test-phone';
import { fakeSplitbook, expensePage as emptyPage } from '../test-utils/fake-splitbook';

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
  const api = fakeSplitbook();
  api.world.people.alex = { ...alex, image: null };
  api.world.groups = groups;
  api.world.home = { buckets: [{ currency: 'INR', youOwe: 0, youAreOwed: 0 }] };
  const server = {
    get offline() {
      return !api.online;
    },
    set offline(value: boolean) {
      api.online = !value;
    },
    created: 0,
    offlineAfterPost: false,
  };
  for (const group of groups) {
    // Keep the old fixtures: empty Expense pages still carry nonzero all-time totals, and
    // even Bali receives the Lisbon & Tokyo summary. These are not new default-world rules.
    const totalsByCurrency =
      group._id === lisbonId
        ? Object.entries(spent).map(([currency, row]) => ({
            currency,
            totalAmount: row.spent / (currency === 'JPY' ? 1 : 100),
          }))
        : group._id === baliId
          ? [
              { currency: 'INR', totalAmount: 1200 },
              { currency: 'EUR', totalAmount: 40 },
            ]
          : [{ currency: 'INR', totalAmount: 0 }];
    const page = emptyPage();
    api.world.expenses[group._id] = { ...page, summary: { ...page.summary, totalsByCurrency } };
    api.world.balances[group._id] = { byCurrency: [{ currency: 'INR', balances: [], debts: [] }] };
    api.world.tripSummaries[group._id] = Object.fromEntries(
      ['', 'INR', 'EUR', 'JPY'].map((currency) => [
        currency,
        tripSummary(currency || null, decodeURIComponent(PHONE_ZONE)).data,
      ]),
    );
    // This file's minimal create acknowledgement and connection loss stay explicit. The world
    // is left alone, as before; only this fixture's request count and connection change.
    api.reply('POST', `/api/groups/${group._id}/expenses`, () => {
      server.created++;
      if (server.offlineAfterPost) server.offline = true;
      return json(
        {
          status: 201,
          data: { _id: `e${String(server.created).padStart(23, '0')}`, group: group._id },
        },
        201,
      );
    });
  }
  const phone = testPhone(api, {
    newSubmissionKey: () => `trip-summary-attempt-${String(server.created + 1).padStart(4, '0')}`,
    parts: {
      pendingInvitation: undefined,
      draftRequests: undefined,
      tagRequests: undefined,
      groupCreations: undefined,
      accountLocal: { financialCleanup: undefined, signOutRecord: undefined },
      netInfo: {
        addEventListener(listener) {
          listener({ isConnected: !server.offline });
          return () => undefined;
        },
      },
    },
    purge: ['savedQueries', 'expenseDrafts', 'settlementAttempts', 'untrustedCopies'],
  });
  const rows = phone.stores.savedQueries.records;
  const calls = api.requests;
  return {
    create: phone.open,
    server,
    rows,
    calls,
    tripReads: () =>
      calls.filter(({ path }) => path.startsWith(`${tripPath}?`)).map(({ path }) => path),
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

  // #868: rupees were never read on this phone, so it never kept them to lose.
  it('says a currency never read offline needs a connection, never that its copy is gone (#868)', async () => {
    const made = fixture();
    const controller = started(made);
    await controller.signIn('alex');
    await controller.openGroup(lisbonId);
    made.server.offline = true;
    await controller.chooseTripCurrency('INR');
    expect(controller.getSnapshot().financial.trip).toMatchObject({
      status: 'error',
      chosen: 'INR',
      message: 'Couldn’t load this trip’s figures in INR. Connect to see them.',
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
