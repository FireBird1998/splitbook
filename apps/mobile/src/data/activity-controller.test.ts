import { describe, expect, it } from 'vitest';
import { createMobileController } from './mobile-controller';
import type { FetchResponse } from './types';
const groupId = 'b00000000000000000000001';
const actor = 'a00000000000000000000001';
const expenseId = 'c00000000000000000000001';
const eventId = 'd00000000000000000000001';
const iso = '2026-09-28T12:00:00.000Z';
const user = { id: actor, name: 'Alex', email: 'alex@example.test', image: null };
const group = {
  _id: groupId,
  createdBy: actor,
  name: 'Shared home',
  category: 'home',
  defaultCurrency: 'INR',
  members: [{ user: { ...user, _id: actor }, role: 'admin', joinedAt: iso }],
  createdAt: iso,
  updatedAt: iso,
};
const event = {
  _id: eventId,
  group: groupId,
  actor: { _id: actor, name: 'Alex' },
  type: 'expense_added',
  createdAt: iso,
  metadata: { expenseId, description: 'Dinner', amount: 12.34, currency: 'INR' },
};
const page = (events: unknown[] = [event], pageNumber = 1, total = events.length) => ({
  status: 200,
  data: {
    activities: events,
    pagination: { page: pageNumber, limit: 20, total, totalPages: Math.ceil(total / 20) },
  },
});
const json = (value: unknown, status = 200) => Response.json(value, { status });
function setup(
  intercept: (
    url: URL,
    init: RequestInit,
  ) => FetchResponse | Promise<FetchResponse> | undefined = () => undefined,
) {
  let cookie: string | null = null;
  return createMobileController(
    {
      apiBaseUrl: 'http://localhost:4141',
      authOrigin: 'http://localhost:4141',
      developmentPersonaEnabled: true,
    },
    {
      credentials: {
        load: async () => cookie,
        save: async (value) => {
          cookie = value;
        },
        clear: async () => {
          cookie = null;
        },
      },
      fetch: async (url, init) => {
        const address = new URL(url),
          path = address.pathname;
        const override = intercept(address, init);
        if (override) return override;
        if (path.endsWith('/sign-in'))
          return new Response(JSON.stringify({ user }), {
            headers: { 'Set-Cookie': 'better-auth.session_token=alex.signature; Max-Age=2592000' },
          });
        if (path.endsWith('/get-session'))
          return json({ user, session: { userId: actor, expiresAt: '2030-01-01T00:00:00Z' } });
        if (path.endsWith('/sign-out')) return json({ success: true });
        if (path === '/api/groups') return json({ status: 200, data: [group] });
        if (path === `/api/groups/${groupId}`) return json({ status: 200, data: group });
        if (path.endsWith('/user/balances')) return json({ status: 200, data: { buckets: [] } });
        if (path.endsWith('/activity')) return json(page());
        return json({}, 404);
      },
    },
  );
}
describe('native Group Activity', () => {
  it('loads authorized backend events with actor, event time and currency-specific snapshot money', async () => {
    const controller = setup();
    await controller.signIn('alex');
    await controller.openActivity(groupId);
    expect(controller.getSnapshot()).toMatchObject({
      screen: 'group',
      destination: 'activity',
      activity: {
        groupId,
        status: 'ready',
        events: [
          {
            _id: eventId,
            actor: { name: 'Alex' },
            createdAt: iso,
            metadata: { amount: 12.34, currency: 'INR' },
          },
        ],
      },
    });
  });
  it('retains the historical removed member reference and action independently of current membership', async () => {
    const removedId = 'a00000000000000000000002';
    const controller = setup((url) =>
      url.pathname.endsWith('/activity')
        ? json(
            page([
              { ...event, type: 'member_left', metadata: { userId: removedId, method: 'removed' } },
            ]),
          )
        : undefined,
    );
    await controller.signIn('alex');
    await controller.openActivity(groupId);
    await controller.selectActivity(eventId);
    expect(controller.getSnapshot().activity).toMatchObject({
      status: 'ready',
      selected: { actor: { _id: actor }, metadata: { userId: removedId, method: 'removed' } },
      target: { status: 'none' },
    });
  });

  it('loads older events without duplicates and replaces the timeline on refresh to include recovered events', async () => {
    const older = {
      ...event,
      _id: 'd00000000000000000000002',
      type: 'group_created',
      metadata: {},
    };
    const recovered = {
      ...event,
      _id: 'd00000000000000000000003',
      type: 'settlement_recorded',
      metadata: { amount: 5, currency: 'INR', paidByName: 'Sam', paidToName: 'Alex' },
    };
    let repaired = false;
    const controller = setup((url) =>
      url.pathname.endsWith('/activity')
        ? json(
            url.searchParams.get('page') === '2'
              ? page([event, older], 2, 22)
              : page(repaired ? [recovered, event] : [event], 1, 22),
          )
        : undefined,
    );
    await controller.signIn('alex');
    await controller.openActivity(groupId);
    await controller.loadMoreActivity();
    expect(controller.getSnapshot().activity.events.map((e) => e._id)).toEqual([
      eventId,
      older._id,
    ]);
    repaired = true;
    await controller.refreshActivity();
    // #222, M1-3: a refresh reads both loaded pages again, and keeps them.
    expect(controller.getSnapshot().activity.events.map((e) => e._id)).toEqual([
      recovered._id,
      eventId,
      older._id,
    ]);
    expect(controller.getSnapshot().activity.pagination?.page).toBe(2);
  });

  it('rechecks membership on foreground and clears event content when access is revoked', async () => {
    let revoked = false;
    const controller = setup((url) =>
      revoked && url.pathname.endsWith('/activity') ? json({}, 403) : undefined,
    );
    await controller.signIn('alex');
    await controller.openActivity(groupId);
    revoked = true;
    await controller.refresh();
    expect(controller.getSnapshot()).toMatchObject({
      screen: 'group',
      destination: 'activity',
      activity: { status: 'denied', events: [], pagination: null },
    });
  });

  it('shows an immutable historical event beside the current deleted-record status without opening an editor', async () => {
    const controller = setup((url) =>
      url.pathname.endsWith(`/expenses/${expenseId}`)
        ? json({
            status: 200,
            data: {
              _id: expenseId,
              group: groupId,
              isDeleted: true,
              description: 'Dinner corrected later',
              updatedAt: iso,
            },
          })
        : undefined,
    );
    await controller.signIn('alex');
    await controller.openActivity(groupId);
    await controller.selectActivity(eventId);
    expect(controller.getSnapshot()).toMatchObject({
      screen: 'group',
      destination: 'activity',
      activity: {
        selected: { _id: eventId, metadata: { description: 'Dinner', amount: 12.34 } },
        target: { status: 'deleted', description: 'Dinner corrected later' },
      },
      expense: { draft: null },
    });
    await controller.back();
    expect(controller.getSnapshot().activity.selected).toBeNull();
    expect(controller.getSnapshot()).toMatchObject({ screen: 'group', destination: 'activity' });
  });

  it('retains explicitly stale history on an offline refresh, then recovers without inventing events', async () => {
    let offline = false;
    const controller = setup((url) => {
      if (offline && url.pathname.endsWith('/activity')) throw new Error('Offline');
      return undefined;
    });
    await controller.signIn('alex');
    await controller.openActivity(groupId);
    offline = true;
    await controller.refreshActivity();
    expect(controller.getSnapshot().activity).toMatchObject({
      status: 'error',
      events: [{ _id: eventId }],
      selected: null,
    });
    expect(controller.getSnapshot().activity.message).toContain('stale');
    await controller.selectActivity(eventId);
    expect(controller.getSnapshot().activity.selected).toBeNull();
    offline = false;
    await controller.refreshActivity();
    expect(controller.getSnapshot().activity.events).toHaveLength(1);
  });
  it.each([401, 403])(
    'removes event details when an authorized record read returns %s',
    async (status) => {
      const controller = setup((url) =>
        url.pathname.endsWith(`/expenses/${expenseId}`) ? json({}, status) : undefined,
      );
      await controller.signIn('alex');
      await controller.openActivity(groupId);
      await controller.selectActivity(eventId);
      expect(controller.getSnapshot().activity.events).toEqual([]);
      expect(controller.getSnapshot().activity.selected).toBeNull();
      expect(controller.getSnapshot().activity.status).toBe(status === 401 ? 'idle' : 'denied');
    },
  );
  it('keeps an unavailable record distinct from denied Group access', async () => {
    const controller = setup();
    await controller.signIn('alex');
    await controller.openActivity(groupId);
    await controller.selectActivity(eventId);
    expect(controller.getSnapshot().activity).toMatchObject({
      status: 'ready',
      selected: { _id: eventId },
      target: { status: 'unavailable' },
    });
  });
  it('ignores a delayed detail response after sign-out', async () => {
    let release!: (value: FetchResponse) => void, entered!: () => void;
    const dispatched = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const controller = setup((url) =>
      url.pathname.endsWith(`/expenses/${expenseId}`)
        ? new Promise((resolve) => {
            release = resolve;
            entered();
          })
        : undefined,
    );
    await controller.signIn('alex');
    await controller.openActivity(groupId);
    const reading = controller.selectActivity(eventId);
    await dispatched;
    await controller.signOut();
    release(
      json({
        status: 200,
        data: {
          _id: expenseId,
          group: groupId,
          description: 'Private',
          isDeleted: false,
          updatedAt: iso,
        },
      }),
    );
    await reading;
    expect(controller.getSnapshot().activity).toMatchObject({
      events: [],
      selected: null,
      groupId: null,
    });
  });
  it.each([
    { ...event, group: 'b00000000000000000000002' },
    { ...event, createdAt: 'yesterday' },
    { ...event, metadata: { amount: 1.001, currency: 'INR' } },
  ])(
    'rejects malformed or cross-Group events instead of presenting trustworthy history',
    async (invalid) => {
      const controller = setup((url) =>
        url.pathname.endsWith('/activity') ? json(page([invalid])) : undefined,
      );
      await controller.signIn('alex');
      await controller.openActivity(groupId);
      expect(controller.getSnapshot().activity).toMatchObject({ status: 'error', events: [] });
    },
  );
});
