/**
 * The member's Groups as an assistant's page lists them (#620), against a real, isolated MongoDB
 * database (`splitbook-test-user-assistant-groups-route`), with a real session.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
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
vi.stubEnv('MCP_ENABLED', 'true');
vi.stubEnv('NEXT_PUBLIC_APP_URL', APP_URL);

const db = integrationTestDb('user-assistant-groups-route');
const { alex, sam } = DEMO_PERSONA_IDS;

let route: typeof import('./route');

beforeAll(async () => {
  await connectSignedIn(db);
  route = await import('./route');
});
beforeEach(async () => {
  await db.reset();
  await insertDemoPersonas();
});
afterAll(() => disconnectSignedIn(db));

const read = async (cookie = '') =>
  callRoute(route.GET, { method: 'GET', path: '/api/user/assistant-groups', cookie });

async function createGroup(name: string, admin: string, alternateCurrencies: string[] = []) {
  const group = await groupService.create(
    { name, category: 'home', defaultCurrency: 'INR', alternateCurrencies },
    admin,
  );
  return String(group._id);
}

describe('GET /api/user/assistant-groups', () => {
  it('lists the member’s Groups as the approval page does, rule and currencies included (#620)', async () => {
    const maple = await createGroup('Maple House', alex, ['EUR']);
    const lunch = await createGroup('Studio Lunch Club', sam);
    await groupService.addMember(lunch, alex);
    await groupService.setAssistantRule(lunch, 'not_allowed', sam);
    await createGroup('Sam’s Own Flat', sam);

    const answer = await read(await signIn('alex'));
    expect(answer.status).toBe(200);
    expect(
      answer.body.data.groups.map(
        ({ id, name, currencies, rule, ruleSetBy }: Record<string, unknown>) => ({
          id,
          name,
          currencies,
          rule,
          ruleSetBy,
        }),
      ),
    ).toEqual([
      {
        id: maple,
        name: 'Maple House',
        currencies: ['INR', 'EUR'],
        rule: 'allowed',
        ruleSetBy: null,
      },
      {
        id: lunch,
        name: 'Studio Lunch Club',
        currencies: ['INR'],
        rule: 'not_allowed',
        ruleSetBy: { id: sam, name: 'Sam Chen' },
      },
    ]);
  });

  it('answers only a signed-in member, and only where assistants can connect (#620)', async () => {
    expect((await read()).status).toBe(401);
    vi.stubEnv('MCP_ENABLED', 'false');
    try {
      expect((await read(await signIn('alex'))).status).toBe(404);
    } finally {
      vi.stubEnv('MCP_ENABLED', 'true');
    }
  });
});
