import { afterEach, describe, expect, it, vi } from 'vitest';
import { expensePagePath, activityPagePath } from '@splitbook/shared/api-paths';
import { expenseMonthRange } from '@splitbook/shared/expense-day';
import { waitForSavedQueries } from './offline-checkpoint';
import { verifyOffline } from './verify-offline';

const alex = {
  id: 'a00000000000000000000001',
  name: 'Alex Rivera',
  email: 'alex@example.test',
  image: null,
};
const sam = {
  id: 'a00000000000000000000002',
  name: 'Sam Chen',
  email: 'sam@example.test',
  image: null,
};
const groupId = 'b00000000000000000000001';
const iso = '2026-08-01T00:00:00.000Z';
const group = {
  _id: groupId,
  name: 'Maple House',
  category: 'home',
  defaultCurrency: 'INR',
  createdBy: alex.id,
  createdAt: iso,
  updatedAt: iso,
  members: [alex, sam].map((user) => ({
    user: { ...user, _id: user.id },
    role: user === alex ? 'admin' : 'member',
    joinedAt: iso,
  })),
  tags: [{ _id: 'c00000000000000000000001', name: 'Food', createdAt: iso }],
};

/** The network edge only: controllers, account leases and file-backed Saved copies are real. */
function fictionalHttp(input: string, init: RequestInit = {}) {
  const url = new URL(input);
  const path = url.pathname;
  const method = init.method ?? 'GET';
  if (path.endsWith('/sign-in')) {
    const user = String(init.body).includes('alex') ? alex : sam;
    return new Response(JSON.stringify({ user }), {
      headers: {
        'Set-Cookie': `better-auth.session_token=${user === alex ? 'alex' : 'sam'}.signature; Path=/; HttpOnly`,
      },
    });
  }
  if (path.endsWith('/get-session')) {
    const user = new Headers(init.headers).get('Cookie')?.includes('alex.signature') ? alex : sam;
    return Response.json({
      user,
      session: { userId: user.id, expiresAt: '2030-01-01T00:00:00Z' },
    });
  }
  if (path.endsWith('/sign-out')) return Response.json({ success: true });
  if (path === '/api/groups')
    return Response.json(
      {
        status: method === 'POST' ? 201 : 200,
        data: method === 'POST' ? group : [group],
      },
      { status: method === 'POST' ? 201 : 200 },
    );
  if (path === '/api/user/balances')
    return Response.json({ status: 200, data: { buckets: [], groups: [] } });
  if (path.endsWith('/invite-link'))
    return Response.json(
      { status: 201, data: { inviteCode: 'fictional-invite' } },
      { status: 201 },
    );
  if (path === '/api/join/fictional-invite')
    return Response.json({ status: 201, data: group }, { status: 201 });
  if (path === `/api/groups/${groupId}`) return Response.json({ status: 200, data: group });
  if (path === `/api/groups/${groupId}/expenses`)
    return Response.json({
      status: 200,
      data: {
        expenses: [],
        pagination: { page: 1, limit: 20, total: 0, totalPages: 0 },
        summary: {
          count: 0,
          totalsByCurrency: [],
          userOwes: 0,
          userGetsBack: 0,
          byMember: [],
        },
      },
    });
  if (path === `/api/groups/${groupId}/balances`)
    return Response.json({
      status: 200,
      data: { byCurrency: [{ currency: 'INR', balances: [], debts: [] }] },
    });
  if (path === `/api/groups/${groupId}/activity`)
    return Response.json({
      status: 200,
      data: {
        activities: [
          {
            _id: 'd00000000000000000000001',
            group: groupId,
            type: 'group_created',
            actor: { _id: alex.id, name: alex.name },
            metadata: {},
            createdAt: iso,
          },
        ],
        pagination: { page: 1, limit: 20, total: 1, totalPages: 1 },
      },
    });
  throw new Error(`Unexpected fictional request ${method} ${path}`);
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

async function restartWithHeldWrites(skipStage?: number | 'all') {
  vi.stubEnv('MOBILE_VERIFY_URL', 'http://127.0.0.1:4145');
  vi.stubGlobal('fetch', async (input: string, init?: RequestInit) => fictionalHttp(input, init));
  const heldPaths = [
    '/api/user/balances',
    `/api/groups/${groupId}`,
    expensePagePath(groupId, {
      page: 1,
      limit: 20,
      includeMemberBreakdown: true,
      ...expenseMonthRange('2026-08'),
    }),
    activityPagePath(groupId, { page: 1, limit: 20 }),
  ];
  const releases = new Map<string, () => void>();
  const held = new Map(
    heldPaths.map((path) => [
      path,
      new Promise<void>((done) => {
        releases.set(path, done);
      }),
    ]),
  );
  let stage = 0;
  let reachedOfflineViews = false;
  await verifyOffline({
    waitForCopies: async (rows, account, paths) => {
      const currentStage = stage++;
      if (skipStage === 'all' || skipStage === currentStage) return;
      await waitForSavedQueries(rows, account, paths, 1_000);
    },
    writeSavedQuery: async (path, write) => {
      await held.get(path);
      await write();
    },
    // Only a checkpoint reading this exact row can release its disk write.
    // Other checkpoints, preview reads and offline fallback cannot free it.
    checkpointRead: (path) => releases.get(path)?.(),
    afterOfflineViews: () => {
      reachedOfflineViews = true;
      return 'stop';
    },
    beforeCleanup: () => {
      for (const release of releases.values()) release();
    },
  });
  return reachedOfflineViews;
}

describe('the actual offline verifier’s file-backed restart (#629)', () => {
  it.each([
    ['Home', 0, /Home after offline restart/],
    ['Month', 1, /Saved August Expenses after offline restart/],
    ['Activity', 2, /Expected values to be strictly equal/],
    ['all', 'all', /Home after offline restart/],
  ] as const)(
    'red-first: rejects offline restoration without the %s wait',
    async (_name, stage, message) => {
      await expect(restartWithHeldWrites(stage)).rejects.toThrow(message);
    },
  );

  it('restores Home, Group, Month and Activity only after their own file-backed checkpoints', async () => {
    expect(await restartWithHeldWrites()).toBe(true);
  });
});
