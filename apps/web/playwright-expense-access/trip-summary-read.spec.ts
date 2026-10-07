import type { APIRequestContext } from '@playwright/test';
import { DEMO_PERSONA_IDS } from '../src/lib/demo-personas';
import { groupBalancesPath, tripSummaryPath } from '@splitbook/shared/api-paths';
import { parseTripSummaryResponse } from '@splitbook/shared/trip-summary-read';
import { test, expect, dataOf, joinGroup, observeLedger, type Ledger } from './fixtures';

/*
 * The Trip summary read (#316) through real HTTP: Better Auth sessions, the route, and MongoDB.
 * Members of a Trip read it; everyone else gets exactly the refusal the Group's other reads
 * give (here, Balances), and a refused read changes nothing: not the Trip's Expenses, its
 * Activity, or the other Groups' ledger. A Group of another Theme is refused with NOT_A_TRIP.
 * Fixture Groups and Expenses are made through requests.
 */

const PRIYA = DEMO_PERSONA_IDS.priya;
const SAM = DEMO_PERSONA_IDS.sam;
const summary = (groupId: string) => tripSummaryPath(groupId, { timeZone: 'UTC' });

async function answer(actor: APIRequestContext, path: string) {
  const response = await actor.get(path, { maxRedirects: 0 });
  return { status: response.status(), body: await response.json() };
}

/** A three-day Trip of Priya's that Sam has joined, with one Expense on its second day. */
async function synthTrip(ledger: Ledger) {
  const trip = await dataOf(
    await ledger.priya.post('/api/groups', {
      data: {
        name: 'Synthetic access trip',
        category: 'trip',
        defaultCurrency: 'INR',
        startDate: '2026-09-17',
        endDate: '2026-09-19',
      },
    }),
    201,
  );
  await joinGroup(ledger.priya, ledger.sam, trip._id);
  await dataOf(
    await ledger.priya.post(`/api/groups/${trip._id}/expenses`, {
      data: {
        description: 'Synthetic ferry tickets',
        amount: 1001.01,
        currency: 'INR',
        category: 'transport',
        tag: 'Transport',
        date: '2026-09-18',
        paidBy: [{ user: PRIYA, amount: 1001.01 }],
        splitMethod: 'equal',
        splitBetween: [{ user: PRIYA }, { user: SAM }],
      },
    }),
    201,
  );
  return trip._id as string;
}

async function observeTrip(ledger: Ledger, tripId: string) {
  return {
    ledger: await observeLedger(ledger, ledger.expenseB),
    expenses: await dataOf(await ledger.priya.get(`/api/groups/${tripId}/expenses`)),
    activity: await dataOf(await ledger.priya.get(`/api/groups/${tripId}/activity`)),
  };
}

test('trip summary read: a member reads their Trip, exact, named without an email', async ({
  ledger,
}) => {
  const tripId = await synthTrip(ledger);
  const read = parseTripSummaryResponse(await (await ledger.sam.get(summary(tripId))).json());

  expect(read).toMatchObject({
    currency: 'INR',
    tripDates: { start: '2026-09-17', end: '2026-09-19' },
    dayCount: 3,
    spentMinor: 100101,
    expenseCount: 1,
    youPaidMinor: 0,
    peopleCount: 2,
  });
  // An equal split of ₹1,001.01 leaves one paisa over: Sam's share is one half or the other.
  expect([50050, 50051]).toContain(read.yourShareMinor);
  expect(read.days.map((day) => day.spentMinor)).toEqual([0, 100101, 0]);
  expect(read.days[1].biggest).toEqual([
    expect.objectContaining({ description: 'Synthetic ferry tickets', amountMinor: 100101 }),
  ]);
  expect(read.suggestedPayments).toEqual([
    {
      from: { id: SAM, name: 'Sam Chen' },
      to: { id: PRIYA, name: 'Priya Shah' },
      amountMinor: read.yourShareMinor,
    },
  ]);
  expect(read.byTag).toEqual([expect.objectContaining({ name: 'Transport', percent: 100 })]);
  // Names only: never a member's email.
  expect(JSON.stringify(read)).not.toContain('@');
});

test('trip summary read: a member of a Group that isn’t a Trip is refused clearly, without side effects', async ({
  ledger,
}) => {
  const before = await observeLedger(ledger, ledger.expenseB);
  expect(await answer(ledger.priya, summary(ledger.groupB))).toEqual({
    status: 409,
    body: { error: 'Only a Trip has a Trip summary.', code: 'NOT_A_TRIP', status: 409 },
  });
  // Someone outside it still gets the Group reads' refusal, which says nothing of its Theme.
  expect(await answer(ledger.alex, summary(ledger.groupB))).toEqual(
    await answer(ledger.alex, groupBalancesPath(ledger.groupB)),
  );
  expect(await observeLedger(ledger, ledger.expenseB)).toEqual(before);
});

for (const scenario of ['outsider', 'removed', 'left', 'missing', 'anonymous'] as const) {
  test(`trip summary read: denies ${scenario} access, exactly as Balances does, without side effects`, async ({
    ledger,
  }) => {
    const tripId = await synthTrip(ledger);
    let actor = ledger.alex;
    let groupId = tripId;
    if (scenario === 'removed') {
      // Establish access, then revoke it while keeping the same session.
      await dataOf(await ledger.sam.get(summary(tripId)));
      await dataOf(await ledger.priya.delete(`/api/groups/${tripId}/members/${SAM}`));
      expect((await (await ledger.sam.get('/api/auth/get-session')).json()).user.id).toBe(SAM);
      actor = ledger.sam;
    } else if (scenario === 'left') {
      // Alex joins Priya's Trip, then leaves it (settled: he shares nothing).
      await joinGroup(ledger.priya, ledger.alex, tripId);
      await dataOf(await ledger.alex.get(summary(tripId)));
      await dataOf(await ledger.alex.post(`/api/groups/${tripId}/leave`));
    } else if (scenario === 'missing') {
      groupId = 'f00000000000000000000000';
    } else if (scenario === 'anonymous') {
      actor = ledger.anonymous;
    }

    const before = await observeTrip(ledger, tripId);
    const refused = await answer(actor, summary(groupId));
    if (scenario === 'anonymous') {
      expect(refused).toEqual({ status: 401, body: { error: 'Unauthorized', status: 401 } });
    } else {
      expect(refused).toEqual({ status: 403, body: { error: 'Forbidden', status: 403 } });
    }
    expect(refused).toEqual(await answer(actor, groupBalancesPath(groupId)));
    // A bad query tells a non-member nothing more.
    expect(
      (await answer(actor, `/api/groups/${groupId}/trip-summary?tz=Mars%2FPhobos`)).status,
    ).toBe(refused.status);
    expect(await observeTrip(ledger, tripId)).toEqual(before);
  });
}
