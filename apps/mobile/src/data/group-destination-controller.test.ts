import { describe, expect, it } from 'vitest';
import { createMobileController } from './mobile-controller';
import type { GroupDestination } from './types';

const user = { id: 'a00000000000000000000002', name: 'Sam Chen', email: 'sam@example.test' };
const groupId = 'a00000000000000000000010';
const iso = '2026-09-27T10:00:00.000Z';
const person = { _id: user.id, name: user.name, image: null };
const group = {
  _id: groupId,
  createdBy: user.id,
  name: 'Maple House',
  category: 'home',
  defaultCurrency: 'INR',
  members: [{ user: { ...person, email: user.email }, role: 'member', joinedAt: iso }],
  createdAt: iso,
  updatedAt: iso,
};
const expensePage = {
  status: 200,
  data: {
    expenses: [],
    pagination: { page: 1, limit: 20, total: 0, totalPages: 0 },
    summary: {
      count: 0,
      totalAmount: 0,
      totalsByCurrency: [],
      userOwes: 0,
      userGetsBack: 0,
      byMember: [],
    },
  },
};
const balances = {
  status: 200,
  data: {
    currency: 'INR',
    balances: [],
    debts: [],
    byCurrency: [{ currency: 'INR', balances: [], debts: [] }],
    hasMixedCurrencies: false,
  },
};
const eventId = 'd00000000000000000000001';
const activityPage = {
  status: 200,
  data: {
    activities: [
      {
        _id: eventId,
        group: groupId,
        actor: { _id: user.id, name: user.name },
        type: 'expense_added',
        createdAt: iso,
        metadata: { description: 'Weekly groceries', amount: 1249.5, currency: 'INR' },
      },
    ],
    pagination: { page: 1, limit: 20, total: 1, totalPages: 1 },
  },
};
const json = (body: unknown, status = 200) => Response.json(body, { status });

function setup(hold?: (path: string) => Promise<void> | undefined) {
  let cookie: string | null = null;
  const calls: string[] = [];
  const controller = createMobileController(
    {
      apiBaseUrl: 'http://localhost:4138',
      authOrigin: 'http://localhost:4138',
      developmentPersonaEnabled: true,
    },
    {
      now: () => new Date(2026, 8, 27, 12).getTime(),
      credentials: {
        load: async () => cookie,
        save: async (value) => {
          cookie = value;
        },
        clear: async () => {
          cookie = null;
        },
      },
      fetch: async (url) => {
        const path = new URL(url).pathname + new URL(url).search;
        calls.push(path);
        await hold?.(path);
        if (path.endsWith('/sign-in'))
          return new Response(JSON.stringify({ user }), {
            headers: { 'Set-Cookie': 'better-auth.session_token=test.signature; Path=/; HttpOnly' },
          });
        if (path.endsWith('/get-session'))
          return json({ user, session: { userId: user.id, expiresAt: '2030-01-01T00:00:00Z' } });
        if (path === '/api/groups') return json({ status: 200, data: [group] });
        if (path === `/api/groups/${groupId}`) return json({ status: 200, data: group });
        if (path === '/api/user/balances') return json({ status: 200, data: { buckets: [] } });
        if (path.startsWith(`/api/groups/${groupId}/expenses?`)) return json(expensePage);
        if (path === `/api/groups/${groupId}/balances`) return json(balances);
        if (path.startsWith(`/api/groups/${groupId}/activity?`)) return json(activityPage);
        return json({}, 404);
      },
    },
  );
  /** The Group-scoped reads made since the last call. */
  const reads = () =>
    calls
      .splice(0)
      .filter((path) => path.startsWith(`/api/groups/${groupId}`))
      .map((path) =>
        path === `/api/groups/${groupId}`
          ? 'group'
          : path.slice(`/api/groups/${groupId}/`.length).split('?')[0],
      );
  return { controller, reads };
}

async function signedIn() {
  const setupResult = setup();
  await setupResult.controller.signIn('sam');
  setupResult.reads();
  return setupResult;
}

describe('Group destinations', () => {
  it('opens a Group on Expenses and reads Expenses then Balances, but not Activity', async () => {
    const { controller, reads } = await signedIn();
    await controller.openGroup(groupId);
    expect(controller.getSnapshot()).toMatchObject({ screen: 'group', destination: 'expenses' });
    expect(reads()).toEqual(['group', 'expenses', 'balances']);
  });

  it('switches between Expenses and Balances without reading anything again', async () => {
    const { controller, reads } = await signedIn();
    await controller.openGroup(groupId);
    reads();
    await controller.selectDestination('balances');
    expect(controller.getSnapshot().destination).toBe('balances');
    await controller.selectDestination('expenses');
    expect(controller.getSnapshot().destination).toBe('expenses');
    expect(reads()).toEqual([]);
    expect(controller.getSnapshot().financial.expenses.status).toBe('ready');
  });

  it('reads Activity the first time it is shown, then keeps it while switching', async () => {
    const { controller, reads } = await signedIn();
    await controller.openGroup(groupId);
    reads();
    await controller.selectDestination('activity');
    expect(reads()).toEqual(['activity']);
    expect(controller.getSnapshot().activity).toMatchObject({
      groupId,
      status: 'ready',
      events: [{ _id: eventId }],
    });
    await controller.selectDestination('balances');
    await controller.selectDestination('activity');
    expect(reads()).toEqual([]);
  });

  it('opens a Group on Activity reading only the Group and Activity; Expenses load on first switch', async () => {
    const { controller, reads } = await signedIn();
    await controller.openActivity(groupId);
    expect(controller.getSnapshot()).toMatchObject({
      screen: 'group',
      destination: 'activity',
      activity: { status: 'ready' },
    });
    expect(reads()).toEqual(['group', 'activity']);
    await controller.selectDestination('balances');
    expect(reads()).toEqual(['expenses', 'balances']);
    expect(controller.getSnapshot().financial.balances.status).toBe('ready');
  });

  it('reads the destination shown when a slow Group read completes', async () => {
    let release!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    let holding = false;
    const { controller, reads } = setup((path) =>
      holding && path === `/api/groups/${groupId}` ? held : undefined,
    );
    await controller.signIn('sam');
    reads();
    holding = true;
    const opening = controller.openGroup(groupId);
    await controller.selectDestination('activity');
    expect(controller.getSnapshot().destination).toBe('activity');
    release();
    await opening;
    expect(reads()).toEqual(['group', 'activity']);
  });

  it('pulling to refresh on Activity re-reads Activity only', async () => {
    const { controller, reads } = await signedIn();
    await controller.openActivity(groupId);
    reads();
    await controller.refresh('pull');
    expect(reads()).toEqual(['activity']);
  });

  it('re-reading the Group keeps its destination and reads Activity again on the next visit', async () => {
    const { controller, reads } = await signedIn();
    await controller.openGroup(groupId);
    await controller.selectDestination('activity');
    await controller.selectDestination('balances');
    reads();
    await controller.refresh();
    expect(controller.getSnapshot().destination).toBe('balances');
    expect(reads()).toEqual(['group', 'expenses', 'balances']);
    // Events stay readable until Activity is read again.
    expect(controller.getSnapshot().activity).toMatchObject({
      status: 'idle',
      events: [{ _id: eventId }],
    });
    await controller.selectDestination('activity');
    expect(reads()).toEqual(['activity']);
  });

  it('reopening the same Group keeps its destination; a later visit starts on Expenses', async () => {
    const { controller } = await signedIn();
    await controller.openGroup(groupId);
    await controller.selectDestination('balances');
    await controller.openGroup(groupId);
    expect(controller.getSnapshot().destination).toBe('balances');
    await controller.back();
    await controller.openGroup(groupId);
    expect(controller.getSnapshot().destination).toBe('expenses');
  });
});

describe('Back inside a Group', () => {
  it.each<GroupDestination>(['expenses', 'balances', 'activity'])(
    'returns Home from %s',
    async (destination) => {
      const { controller } = await signedIn();
      await controller.openGroup(groupId);
      await controller.selectDestination(destination);
      await controller.back();
      expect(controller.getSnapshot()).toMatchObject({
        screen: 'groups',
        detail: { id: null, data: null },
      });
    },
  );

  it('closes an open event detail before leaving the Group', async () => {
    const { controller } = await signedIn();
    await controller.openActivity(groupId);
    await controller.selectActivity(eventId);
    expect(controller.getSnapshot().activity.selected?._id).toBe(eventId);
    await controller.back();
    expect(controller.getSnapshot()).toMatchObject({
      screen: 'group',
      destination: 'activity',
      activity: { selected: null },
    });
    await controller.back();
    expect(controller.getSnapshot().screen).toBe('groups');
  });
});
