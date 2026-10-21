/**
 * HTTP tests for a Group's Assistant rule (#621), against a real, isolated MongoDB database
 * (`splitbook-test-group-assistant-rule-route`), with a real session (`signed-in-route.ts`).
 *
 * Only admins change the rule, each change records one Activity event naming the admin and the
 * rule, and only admins read which members' Connected assistants reach the Group.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import Activity from '@/lib/models/Activity';
import Group from '@/lib/models/Group';
import { DEMO_PERSONA_IDS } from '@/lib/demo-personas';
import { groupService } from '@/lib/services/group.service';
import { integrationTestDb } from '@/lib/test-utils/integration-db';
import {
  APP_URL,
  callRoute,
  connectSignedIn,
  disconnectSignedIn,
  insertDemoPersonas,
  signIn,
} from '@/lib/test-utils/signed-in-route';

vi.mock('next/headers', async () => (await import('@/lib/test-utils/signed-in-route')).nextHeaders);
// The reach list reads connections, which exist where assistants are switched on.
vi.stubEnv('MCP_ENABLED', 'true');
vi.stubEnv('NEXT_PUBLIC_APP_URL', APP_URL);

const db = integrationTestDb('group-assistant-rule-route');
const { alex, sam, priya } = DEMO_PERSONA_IDS;

let rule: typeof import('./route');
let reach: typeof import('../assistant-reach/route');
let adapter: Awaited<(typeof import('@/lib/auth'))['auth']['$context']>['adapter'];

beforeAll(async () => {
  await connectSignedIn(db);
  rule = await import('./route');
  reach = await import('../assistant-reach/route');
  adapter = (await (await import('@/lib/auth')).auth.$context).adapter;
});
beforeEach(async () => {
  await db.reset();
  await insertDemoPersonas();
});
afterAll(() => disconnectSignedIn(db));

/** Alex's Household, with Alex as its admin and Sam and Priya as members. */
async function mapleHouse() {
  const created = await groupService.create(
    { name: 'Maple House', category: 'home', defaultCurrency: 'INR', alternateCurrencies: [] },
    alex,
  );
  const groupId = String(created._id);
  await groupService.addMember(groupId, sam);
  await groupService.addMember(groupId, priya);
  return groupId;
}

const setRule = (groupId: string, cookie: string, value: unknown) =>
  callRoute(rule.PUT, {
    method: 'PUT',
    path: `/api/groups/${groupId}/assistant-rule`,
    params: { id: groupId },
    cookie,
    body: { rule: value },
  });

const readReach = (groupId: string, cookie: string) =>
  callRoute(reach.GET, {
    method: 'GET',
    path: `/api/groups/${groupId}/assistant-reach`,
    params: { id: groupId },
    cookie,
  });

/** A member's connection to an assistant, live unless its consent is for another generation. */
async function connect(
  userId: string,
  clientId: string,
  options: { name: string; lastUsedAt?: Date; excludedGroupIds?: string[]; revoked?: boolean },
) {
  await adapter.create({
    model: 'mcpConnection',
    data: {
      key: JSON.stringify([userId, clientId]),
      userId,
      clientId,
      generation: 'generation-now',
      createdAt: new Date('2026-10-01T00:00:00.000Z'),
      name: options.name,
      lastUsedAt: options.lastUsedAt ?? null,
      excludedGroupIds: options.excludedGroupIds ?? [],
    },
  });
  await adapter.create({
    model: 'oauthConsent',
    data: {
      userId,
      clientId,
      scopes: ['ledger:read'],
      referenceId: options.revoked ? 'generation-before' : 'generation-now',
      createdAt: new Date('2026-10-01T00:00:00.000Z'),
      updatedAt: new Date('2026-10-01T00:00:00.000Z'),
    },
  });
}

describe('a Group’s Assistant rule', () => {
  it('lets only admins change it (#621)', async () => {
    const groupId = await mapleHouse();
    expect((await setRule(groupId, await signIn('sam'), 'not_allowed')).status).toBe(403);
    expect((await Group.findById(groupId).lean())?.assistantRule ?? 'allowed').toBe('allowed');
    const changed = await setRule(groupId, await signIn('alex'), 'not_allowed');
    expect(changed.status).toBe(200);
    expect(changed.body.data).toEqual({ rule: 'not_allowed' });
    const stored = await Group.findById(groupId).lean();
    expect(stored?.assistantRule).toBe('not_allowed');
    expect(String(stored?.assistantRuleSetBy)).toBe(alex);
  });

  it('refuses a rule it doesn’t know (#621)', async () => {
    const groupId = await mapleHouse();
    for (const value of ['read_only', '', null])
      expect((await setRule(groupId, await signIn('alex'), value)).status, String(value)).toBe(422);
  });

  it('records one Activity event per change, naming the admin and the rule (#621)', async () => {
    const groupId = await mapleHouse();
    const cookie = await signIn('alex');
    await setRule(groupId, cookie, 'not_allowed');
    await setRule(groupId, cookie, 'not_allowed');
    await setRule(groupId, cookie, 'allowed');
    const events = await Activity.find({ group: groupId, type: 'assistant_rule_changed' })
      .sort({ createdAt: 1, _id: 1 })
      .lean();
    expect(events.map((event) => [String(event.actor), event.metadata?.rule])).toEqual([
      [alex, 'not_allowed'],
      [alex, 'allowed'],
    ]);
  });

  it('shows admins whose assistants reach the Group, and refuses the list to members (#621)', async () => {
    const groupId = await mapleHouse();
    const lastUsedAt = new Date('2026-10-20T09:30:00.000Z');
    await connect(sam, 'https://helper.example.test/client.json', {
      name: 'Fictional Helper',
      lastUsedAt,
    });
    // Out of reach: Priya left this Group out, and her other connection was disconnected.
    await connect(priya, 'https://left-out.example.test/client.json', {
      name: 'Left Out Helper',
      excludedGroupIds: [groupId],
    });
    await connect(priya, 'https://gone.example.test/client.json', {
      name: 'Disconnected Helper',
      revoked: true,
    });

    expect((await readReach(groupId, await signIn('sam'))).status).toBe(403);
    const admin = await signIn('alex');
    const listed = await readReach(groupId, admin);
    expect(listed.status).toBe(200);
    expect(listed.body.data).toEqual({
      reach: [
        {
          member: { id: sam, name: 'Sam Chen' },
          assistant: 'Fictional Helper',
          lastUsedAt: lastUsedAt.toISOString(),
        },
      ],
    });

    // The same list for the Group's id in capitals, which the route accepts.
    expect((await readReach(groupId.toUpperCase(), admin)).body.data).toEqual(listed.body.data);

    // Not allowed: no member's assistant reaches the Group.
    await setRule(groupId, admin, 'not_allowed');
    expect((await readReach(groupId, admin)).body.data).toEqual({ reach: [] });
  });
});
