import type { APIRequestContext } from '@playwright/test';
import { DEMO_PERSONA_IDS } from '../src/lib/demo-personas';
import { groupInsightsPath, groupBalancesPath } from '@splitbook/shared/api-paths';
import {
  parseGroupInsightsResponse,
  readGroupInsightsByTag,
  readGroupInsightsRecurring,
  readGroupInsightsWhoPaid,
} from '@splitbook/shared/group-insights-read';
import {
  test,
  expect,
  dataOf,
  expensePath,
  generatedExpense,
  joinGroup,
  observeLedger,
} from './fixtures';

/*
 * The Group insights read (#314) through real HTTP: Better Auth sessions, the route, and
 * MongoDB. Members read it; everyone else gets exactly the refusal the Group's other reads
 * give (here, Balances), and a refused read changes nothing: not the Expense, its history, or
 * either Group's Activity. Fixture Groups and Expenses are made through requests.
 */

// UTC: the recurring template adds its Expense on the 1st of the UTC month, so in this zone
// both Expenses are always in the current Month, whenever the suite runs.
const query = { compare: 6, timeZone: 'UTC' } as const;
const insights = (groupId: string) => groupInsightsPath(groupId, query);

async function answer(actor: APIRequestContext, path: string) {
  const response = await actor.get(path, { maxRedirects: 0 });
  return { status: response.status(), body: await response.json() };
}

test('insights read: a member reads their Group’s Month, exact, including a recurring Expense', async ({
  ledger,
}) => {
  await generatedExpense(ledger);
  const read = parseGroupInsightsResponse(
    await (await ledger.sam.get(insights(ledger.groupB))).json(),
  );
  const month = read.months.at(-1)!;
  // Priya's ₹1,200.00 rent, and the ₹1,200.00 the recurring template added, both hers alone.
  expect(month).toMatchObject({ spentMinor: 240000, expenseCount: 2, yourShareMinor: 0 });
  expect(read).toMatchObject({ currency: 'INR', compare: 6, timeZone: 'UTC' });
  expect(read.recurringExpenses).toBe(true);
  expect(month.recurringCount).toBe(1);
  expect(read.biggestExpense?.paidBy).toEqual([{ id: DEMO_PERSONA_IDS.priya, name: 'Priya Shah' }]);
  // The Month in detail (#315): by Tag, who paid against their share, and the template.
  const byTag = readGroupInsightsByTag(read);
  expect(byTag.ok && byTag.value.tags.reduce((sum, tag) => sum + tag.spentMinor, 0)).toBe(240000);
  const whoPaid = readGroupInsightsWhoPaid(read);
  expect(whoPaid.ok && whoPaid.value.members.find((member) => member.paidMinor > 0)).toMatchObject({
    id: DEMO_PERSONA_IDS.priya,
    name: 'Priya Shah',
    paidMinor: 240000,
    shareMinor: 240000,
  });
  const recurring = readGroupInsightsRecurring(read);
  expect(recurring?.ok && recurring.value.addedInMonth).toEqual({ count: 1, spentMinor: 120000 });
  expect(recurring?.ok && recurring.value.templates).toHaveLength(1);
  // Names only: never a member's email.
  expect(JSON.stringify(read)).not.toContain('@');
});

for (const scenario of ['outsider', 'removed', 'left', 'missing', 'anonymous'] as const) {
  test(`insights read: denies ${scenario} access, exactly as Balances does, without side effects`, async ({
    ledger,
  }) => {
    let actor = ledger.alex;
    let groupId = ledger.groupB;
    if (scenario === 'removed') {
      // Establish access, then revoke it while keeping the same session.
      await dataOf(await ledger.sam.get(insights(ledger.groupB)));
      await dataOf(
        await ledger.priya.delete(`/api/groups/${ledger.groupB}/members/${DEMO_PERSONA_IDS.sam}`),
      );
      expect((await (await ledger.sam.get('/api/auth/get-session')).json()).user.id).toBe(
        DEMO_PERSONA_IDS.sam,
      );
      actor = ledger.sam;
    } else if (scenario === 'left') {
      // Alex joins Priya's Group, then leaves it (settled: she shares nothing).
      await joinGroup(ledger.priya, ledger.alex, ledger.groupB);
      await dataOf(await ledger.alex.get(insights(ledger.groupB)));
      await dataOf(await ledger.alex.post(`/api/groups/${ledger.groupB}/leave`));
    } else if (scenario === 'missing') {
      groupId = 'f00000000000000000000000';
    } else if (scenario === 'anonymous') {
      actor = ledger.anonymous;
    }

    const before = await observeLedger(ledger, ledger.expenseB);
    const refused = await answer(actor, insights(groupId));
    if (scenario === 'anonymous') {
      expect(refused).toEqual({ status: 401, body: { error: 'Unauthorized', status: 401 } });
    } else {
      expect(refused).toEqual({ status: 403, body: { error: 'Forbidden', status: 403 } });
    }
    expect(refused).toEqual(await answer(actor, groupBalancesPath(groupId)));
    // A bad query tells a non-member nothing more.
    expect((await answer(actor, `/api/groups/${groupId}/insights?tz=Mars%2FPhobos`)).status).toBe(
      refused.status,
    );
    expect(await observeLedger(ledger, ledger.expenseB)).toEqual(before);
    expect(
      (await dataOf(await ledger.priya.get(expensePath(ledger.groupB, ledger.expenseB)))).isDeleted,
    ).toBe(false);
  });
}
