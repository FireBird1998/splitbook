/**
 * HTTP tests for two admins changing roles at the same moment (#1261), against a real, isolated
 * MongoDB replica set (`splitbook-test-concurrent-role-changes`), with real sessions
 * (`signed-in-route.ts`).
 *
 * One request is held where it has read the Group and found its change allowed, while the other
 * runs to the end; then it goes on. The last-admin rule still holds: the held change is refused,
 * in the words it would get had it come second, and the Group keeps an admin.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import Activity from '@/lib/models/Activity';
import { DEMO_PERSONA_IDS, type DemoPersonaKey } from '@/lib/demo-personas';
import { groupService } from '@/lib/services/group.service';
import { integrationTestDb } from '@/lib/test-utils/integration-db';
import {
  callRoute,
  connectSignedIn,
  disconnectSignedIn,
  insertDemoPersonas,
  signIn,
} from '@/lib/test-utils/signed-in-route';

vi.mock('next/headers', async () => (await import('@/lib/test-utils/signed-in-route')).nextHeaders);

/** Holds the next Group write, once armed, until the test lets it go. */
const hold = vi.hoisted(() => {
  let armed: { reached: () => void; go: Promise<void> } | null = null;
  return {
    /** `waiting` resolves once a request is held; `release` lets it go on. */
    next() {
      let release!: () => void;
      let reached!: () => void;
      const go = new Promise<void>((resolve) => (release = resolve));
      const waiting = new Promise<void>((resolve) => (reached = resolve));
      armed = { reached, go };
      return { waiting, release };
    },
    async pass() {
      const current = armed;
      if (!current) return;
      armed = null;
      current.reached();
      await current.go;
    },
    reset() {
      armed = null;
    },
  };
});
vi.mock('@/lib/group-mutation', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/group-mutation')>();
  const withGroupMutation: typeof actual.withGroupMutation = async (...args) => {
    await hold.pass();
    return actual.withGroupMutation(...args);
  };
  return { ...actual, withGroupMutation };
});

const db = integrationTestDb('concurrent-role-changes');
const { alex, sam, priya } = DEMO_PERSONA_IDS;

let member: typeof import('./route');
let group: typeof import('../../route');
let leave: typeof import('../../leave/route');

beforeAll(async () => {
  await connectSignedIn(db);
  member = await import('./route');
  group = await import('../../route');
  leave = await import('../../leave/route');
});
beforeEach(async () => {
  hold.reset();
  await db.reset();
  await insertDemoPersonas();
});
afterAll(() => disconnectSignedIn(db));

/** Alex's trip with Sam and Priya, where Alex and Sam are the two admins. */
async function coorgWeekend() {
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
  await groupService.addMember(groupId, sam);
  await groupService.addMember(groupId, priya);
  await groupService.updateMemberRole(groupId, sam, 'admin', alex);
  return groupId;
}

async function changeRole(
  groupId: string,
  persona: DemoPersonaKey,
  userId: string,
  role: 'admin' | 'member',
) {
  return callRoute(member.PATCH, {
    method: 'PATCH',
    path: `/api/groups/${groupId}/members/${userId}`,
    params: { id: groupId, userId },
    cookie: await signIn(persona),
    body: { role },
  });
}

async function leaveGroup(groupId: string, persona: DemoPersonaKey) {
  return callRoute(leave.POST, {
    method: 'POST',
    path: `/api/groups/${groupId}/leave`,
    params: { id: groupId },
    cookie: await signIn(persona),
    body: {},
  });
}

/** `first` runs until it has read the Group and is about to write; `second` runs to the end. */
async function heldWhile<First, Second>(
  first: () => Promise<First>,
  second: () => Promise<Second>,
) {
  const held = hold.next();
  const firstAnswer = first();
  await held.waiting;
  const secondAnswer = await second();
  held.release();
  return [await firstAnswer, secondAnswer] as const;
}

/** Each member's role, as the Group reads for Priya, who stays in it throughout. */
async function roles(groupId: string) {
  const read = await callRoute(group.GET, {
    method: 'GET',
    path: `/api/groups/${groupId}`,
    params: { id: groupId },
    cookie: await signIn('priya'),
  });
  expect(read.status).toBe(200);
  return read.body.data.members.map((entry: { user: { _id: string }; role: string }) => ({
    user: entry.user._id,
    role: entry.role,
  }));
}

/** Who is an admin of the Group now. */
async function admins(groupId: string) {
  return (await roles(groupId))
    .filter((entry: { role: string }) => entry.role === 'admin')
    .map((entry: { user: string }) => entry.user);
}

/** The role changes Activity recorded after Sam was made an admin, as `[userId, old, new]`. */
async function roleChanges(groupId: string) {
  type Change = { userId: string; role: string };
  const entries = await Activity.find({ group: groupId, type: 'group_updated' })
    .sort({ createdAt: 1, _id: 1 })
    .lean<{ metadata: { changes: { memberRole?: { old: Change; new: Change } } } }[]>();
  return entries
    .map((entry) => entry.metadata.changes.memberRole)
    .filter((change) => change !== undefined)
    .map((change) => [change.new.userId, change.old.role, change.new.role])
    .slice(1);
}

const lastAdmin = {
  status: 409,
  body: {
    error: 'Coorg Weekend needs an admin. Make someone else an admin first.',
    status: 409,
    code: 'LAST_ADMIN',
  },
};
const forbidden = { status: 403, body: { error: 'Forbidden', status: 403, code: 'FORBIDDEN' } };

describe('two admins changing roles at the same moment (#1261)', () => {
  it('keeps Alex an admin when Sam steps down while Alex is stepping down', async () => {
    const groupId = await coorgWeekend();

    const [alexSteps, samSteps] = await heldWhile(
      () => changeRole(groupId, 'alex', alex, 'member'),
      () => changeRole(groupId, 'sam', sam, 'member'),
    );

    expect(await admins(groupId)).toEqual([alex]);
    expect(samSteps.status).toBe(200);
    expect(alexSteps).toEqual(lastAdmin);
    expect(await roleChanges(groupId)).toEqual([[sam, 'admin', 'member']]);
  });

  it('keeps Sam an admin when Sam makes Alex a member while Alex is making Sam one', async () => {
    const groupId = await coorgWeekend();

    const [alexDemotesSam, samDemotesAlex] = await heldWhile(
      () => changeRole(groupId, 'alex', sam, 'member'),
      () => changeRole(groupId, 'sam', alex, 'member'),
    );

    expect(await admins(groupId)).toEqual([sam]);
    expect(samDemotesAlex.status).toBe(200);
    expect(alexDemotesSam).toEqual(forbidden);
    expect(await roleChanges(groupId)).toEqual([[alex, 'admin', 'member']]);
  });

  it('does not let Alex make Priya an admin once Sam has made Alex a member', async () => {
    const groupId = await coorgWeekend();

    const [alexPromotesPriya, samDemotesAlex] = await heldWhile(
      () => changeRole(groupId, 'alex', priya, 'admin'),
      () => changeRole(groupId, 'sam', alex, 'member'),
    );

    expect(await admins(groupId)).toEqual([sam]);
    expect(samDemotesAlex.status).toBe(200);
    expect(alexPromotesPriya).toEqual(forbidden);
    expect(await roleChanges(groupId)).toEqual([[alex, 'admin', 'member']]);
  });

  it('keeps Sam an admin when Alex leaves while Sam is stepping down', async () => {
    const groupId = await coorgWeekend();

    const [samSteps, alexLeaves] = await heldWhile(
      () => changeRole(groupId, 'sam', sam, 'member'),
      () => leaveGroup(groupId, 'alex'),
    );

    expect(await admins(groupId)).toEqual([sam]);
    expect(alexLeaves.status).toBe(200);
    expect(samSteps).toEqual(lastAdmin);
  });

  it('keeps Alex an admin when Sam steps down while Alex is leaving', async () => {
    const groupId = await coorgWeekend();

    const [alexLeaves, samSteps] = await heldWhile(
      () => leaveGroup(groupId, 'alex'),
      () => changeRole(groupId, 'sam', sam, 'member'),
    );

    expect(await admins(groupId)).toEqual([alex]);
    expect(samSteps.status).toBe(200);
    expect(alexLeaves.status).toBe(409);
    expect(alexLeaves.body.code).toBe('LAST_ADMIN');
  });

  it('records the role each change replaced when Alex and Sam both make Priya a member', async () => {
    const groupId = await coorgWeekend();
    await groupService.updateMemberRole(groupId, priya, 'admin', alex);

    const [alexDemotesPriya, samDemotesPriya] = await heldWhile(
      () => changeRole(groupId, 'alex', priya, 'member'),
      () => changeRole(groupId, 'sam', priya, 'member'),
    );

    expect(samDemotesPriya.status).toBe(200);
    expect(alexDemotesPriya.status).toBe(200);
    expect(await admins(groupId)).toEqual([alex, sam]);
    expect(await roleChanges(groupId)).toEqual([
      [priya, 'member', 'admin'],
      [priya, 'admin', 'member'],
      [priya, 'member', 'member'],
    ]);
  });

  it('keeps one admin when both step down at once, with nothing held', async () => {
    const groupId = await coorgWeekend();

    const answers = await Promise.all([
      changeRole(groupId, 'alex', alex, 'member'),
      changeRole(groupId, 'sam', sam, 'member'),
    ]);

    expect(await admins(groupId)).toHaveLength(1);
    expect(answers.filter((answer) => answer.status === 200)).toHaveLength(1);
    expect(answers.find((answer) => answer.status !== 200)).toEqual(lastAdmin);
  });
});
