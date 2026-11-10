/**
 * HTTP tests for removing a member and changing a member's role (#472) against a real, isolated
 * MongoDB database (`splitbook-test-group-member-route`), with a real session
 * (`signed-in-route.ts`).
 *
 * Only an admin removes members or changes roles. An admin leaves through leave, not removal,
 * and the last admin cannot be made a member. A member who owes or is owed is removed only once
 * they're settled up, as they would have to be to leave (#875).
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import Activity from '@/lib/models/Activity';
import { DEMO_PERSONA_IDS, type DemoPersonaKey } from '@/lib/demo-personas';
import { expenseService } from '@/lib/services/expense.service';
import { groupService } from '@/lib/services/group.service';
import { settlementService } from '@/lib/services/settlement.service';
import { integrationTestDb } from '@/lib/test-utils/integration-db';
import {
  callRoute,
  connectSignedIn,
  disconnectSignedIn,
  insertDemoPersonas,
  signIn,
} from '@/lib/test-utils/signed-in-route';

vi.mock('next/headers', async () => (await import('@/lib/test-utils/signed-in-route')).nextHeaders);

const db = integrationTestDb('group-member-route');
const { alex, sam, priya } = DEMO_PERSONA_IDS;

let member: typeof import('./route');
let group: typeof import('../../route');

beforeAll(async () => {
  await connectSignedIn(db);
  member = await import('./route');
  group = await import('../../route');
});
beforeEach(async () => {
  await db.reset();
  await insertDemoPersonas();
});
afterAll(() => disconnectSignedIn(db));

/** Alex's trip, with Alex as its only admin and these people as members. */
async function coorgWeekend(...members: string[]) {
  const created = await groupService.create(
    {
      name: 'Coorg Weekend',
      category: 'trip',
      defaultCurrency: 'INR',
      alternateCurrencies: ['EUR'],
    },
    alex,
  );
  const groupId = String(created._id);
  for (const user of members) await groupService.addMember(groupId, user);
  return groupId;
}

function removeMember(groupId: string, userId: string, cookie: string) {
  return callRoute(member.DELETE, {
    method: 'DELETE',
    path: `/api/groups/${groupId}/members/${userId}`,
    params: { id: groupId, userId },
    cookie,
  });
}

function changeRole(groupId: string, userId: string, cookie: string, role: 'admin' | 'member') {
  return callRoute(member.PATCH, {
    method: 'PATCH',
    path: `/api/groups/${groupId}/members/${userId}`,
    params: { id: groupId, userId },
    cookie,
    body: { role },
  });
}

async function readGroup(groupId: string, persona: DemoPersonaKey) {
  return callRoute(group.GET, {
    method: 'GET',
    path: `/api/groups/${groupId}`,
    params: { id: groupId },
    cookie: await signIn(persona),
  });
}

/** Each member's role, as the Group reads for Alex. */
async function roles(groupId: string) {
  const read = await readGroup(groupId, 'alex');
  expect(read.status).toBe(200);
  return read.body.data.members.map((entry: { user: { _id: string }; role: string }) => ({
    user: entry.user._id,
    role: entry.role,
  }));
}

const forbidden = { status: 403, body: { error: 'Forbidden', status: 403, code: 'FORBIDDEN' } };

/** `payer` pays `amount` in `currency`, shared equally by `between`. */
function pays(groupId: string, payer: string, amount: number, between: string[], currency = 'INR') {
  return expenseService.create(
    groupId,
    {
      description: 'Dinner',
      amount,
      currency,
      category: 'food',
      date: new Date('2026-10-20T12:00:00.000Z'),
      splitMethod: 'equal',
      tag: 'Food',
      paidBy: [{ user: payer, amount }],
      splitBetween: between.map((user) => ({ user })),
    },
    payer,
  );
}

function removals(groupId: string) {
  return Activity.find({ group: groupId, type: 'member_left' }).lean();
}

describe('DELETE /api/groups/[id]/members/[userId]', () => {
  it('lets Alex, the admin, remove Sam, who then cannot read the Group', async () => {
    const groupId = await coorgWeekend(sam);

    const removed = await removeMember(groupId, sam, await signIn('alex'));

    expect(removed).toEqual({
      status: 200,
      body: { data: { message: 'Member removed' }, status: 200 },
    });
    expect(await roles(groupId)).toEqual([{ user: alex, role: 'admin' }]);
    expect((await readGroup(groupId, 'sam')).status).toBe(403);
  });

  it('refuses a member who is not an admin', async () => {
    const groupId = await coorgWeekend(sam, priya);

    const refused = await removeMember(groupId, priya, await signIn('sam'));

    expect(refused).toEqual(forbidden);
    expect(await roles(groupId)).toEqual([
      { user: alex, role: 'admin' },
      { user: sam, role: 'member' },
      { user: priya, role: 'member' },
    ]);
  });

  it('refuses someone who is not in the Group', async () => {
    const groupId = await coorgWeekend(sam);

    const refused = await removeMember(groupId, sam, await signIn('priya'));

    expect(refused).toEqual(forbidden);
    expect(await roles(groupId)).toEqual([
      { user: alex, role: 'admin' },
      { user: sam, role: 'member' },
    ]);
  });

  it('sends an admin who removes themselves to leave instead', async () => {
    const groupId = await coorgWeekend(sam);

    const refused = await removeMember(groupId, alex, await signIn('alex'));

    expect(refused).toEqual({
      status: 400,
      body: {
        error: 'You cannot remove yourself. Use leave group instead.',
        status: 400,
        code: 'SELF_REMOVE',
      },
    });
  });
});

describe('removing a member who owes or is owed (#875)', () => {
  it('refuses while Priya owes, naming what she owes', async () => {
    const groupId = await coorgWeekend(sam, priya);
    await pays(groupId, alex, 900, [alex, sam, priya]);

    const refused = await removeMember(groupId, priya, await signIn('alex'));

    expect(refused).toEqual({
      status: 409,
      body: {
        error: 'Priya Shah owes ₹300.00 in this Group. Settle up before removing them.',
        status: 409,
        code: 'OPEN_BALANCE',
        balances: [{ currency: 'INR', amount: -300 }],
      },
    });
    expect(await roles(groupId)).toEqual([
      { user: alex, role: 'admin' },
      { user: sam, role: 'member' },
      { user: priya, role: 'member' },
    ]);
    expect(await removals(groupId)).toEqual([]);
  });

  it('says what she owes and is owed, in each currency', async () => {
    const groupId = await coorgWeekend(sam, priya);
    await pays(groupId, priya, 900, [alex, sam, priya]);
    await pays(groupId, sam, 25, [sam, priya], 'EUR');

    const refused = await removeMember(groupId, priya, await signIn('alex'));

    expect(refused).toEqual({
      status: 409,
      body: {
        error:
          'Priya Shah owes €12.50 and is owed ₹600.00 in this Group. Settle up before removing them.',
        status: 409,
        code: 'OPEN_BALANCE',
        balances: [
          { currency: 'EUR', amount: -12.5 },
          { currency: 'INR', amount: 600 },
        ],
      },
    });
  });

  it('says what a member who is only owed is owed', async () => {
    const groupId = await coorgWeekend(sam, priya);
    await pays(groupId, priya, 900, [alex, sam, priya]);

    const refused = await removeMember(groupId, priya, await signIn('alex'));

    expect(refused.status).toBe(409);
    expect(refused.body.error).toBe(
      'Priya Shah is owed ₹600.00 in this Group. Settle up before removing them.',
    );
  });

  it('removes her once she has settled up, and Activity names her', async () => {
    const groupId = await coorgWeekend(sam, priya);
    await pays(groupId, alex, 900, [alex, sam, priya]);
    await settlementService.create(groupId, { paidTo: alex, amount: 300, currency: 'INR' }, priya);

    const removed = await removeMember(groupId, priya, await signIn('alex'));

    expect(removed).toEqual({
      status: 200,
      body: { data: { message: 'Member removed' }, status: 200 },
    });
    expect(await roles(groupId)).toEqual([
      { user: alex, role: 'admin' },
      { user: sam, role: 'member' },
    ]);
    const [entry] = await removals(groupId);
    expect(String(entry.actor)).toBe(alex);
    expect(entry.metadata).toEqual({ userId: priya, userName: 'Priya Shah', method: 'removed' });
  });
});

describe('PATCH /api/groups/[id]/members/[userId]', () => {
  it('lets Alex make Sam an admin', async () => {
    const groupId = await coorgWeekend(sam);

    const promoted = await changeRole(groupId, sam, await signIn('alex'), 'admin');

    expect(promoted.status).toBe(200);
    expect(await roles(groupId)).toEqual([
      { user: alex, role: 'admin' },
      { user: sam, role: 'admin' },
    ]);
  });

  it('keeps the last admin an admin', async () => {
    const groupId = await coorgWeekend(sam);

    const refused = await changeRole(groupId, alex, await signIn('alex'), 'member');

    expect(refused).toEqual({
      status: 409,
      body: {
        error: 'Cannot demote the last admin. Promote another member first.',
        status: 409,
        code: 'LAST_ADMIN',
      },
    });
    expect(await roles(groupId)).toEqual([
      { user: alex, role: 'admin' },
      { user: sam, role: 'member' },
    ]);
  });

  it('refuses a role change from a member who is not an admin', async () => {
    const groupId = await coorgWeekend(sam);

    const refused = await changeRole(groupId, sam, await signIn('sam'), 'admin');

    expect(refused).toEqual(forbidden);
    expect(await roles(groupId)).toEqual([
      { user: alex, role: 'admin' },
      { user: sam, role: 'member' },
    ]);
  });
});
