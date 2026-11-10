import type { MobileFetch, PersonaId, SessionUser } from '../data/types';

/** The personas and ids most controller suites use. Each fake gets its own mutable world. */
export const demoPeople = {
  alex: {
    id: 'a00000000000000000000001',
    name: 'Alex Rivera',
    email: 'alex@example.test',
    image: null,
  },
  sam: { id: 'a00000000000000000000002', name: 'Sam Chen', email: 'sam@example.test', image: null },
  priya: {
    id: 'a00000000000000000000003',
    name: 'Priya Shah',
    email: 'priya@example.test',
    image: null,
  },
};
const iso = '2026-09-28T12:00:00.000Z';
export interface WireGroup {
  _id: string;
  createdBy: string;
  name: string;
  category: string;
  defaultCurrency: string;
  alternateCurrencies?: string[];
  members: {
    user: { _id: string; name: string; email?: string; image?: string | null };
    role: string;
    joinedAt: string;
  }[];
  createdAt: string;
  updatedAt: string;
}
export function groupFixture(overrides: Partial<WireGroup> = {}): WireGroup {
  return {
    _id: 'b00000000000000000000001',
    createdBy: demoPeople.alex.id,
    name: 'Maple House',
    category: 'home',
    defaultCurrency: 'INR',
    members: Object.values(demoPeople).map(({ id, ...user }) => ({
      user: { _id: id, ...user },
      role: 'member',
      joinedAt: iso,
    })),
    createdAt: iso,
    updatedAt: iso,
    ...overrides,
  };
}
export function expensePage(expenses: unknown[] = [], page = 1) {
  return {
    expenses,
    pagination: {
      page,
      limit: 20,
      total: expenses.length,
      totalPages: Math.ceil(expenses.length / 20),
    },
    summary: {
      count: expenses.length,
      totalsByCurrency: [],
      userOwes: 0,
      userGetsBack: 0,
      byMember: [],
    },
  };
}

export function fakeSplitbook() {
  const group = groupFixture();
  const world = {
    people: structuredClone(demoPeople) as Record<PersonaId, SessionUser>,
    groups: [group],
    home: { buckets: [] as unknown[] },
    balances: { [group._id]: { byCurrency: [] } } as Record<string, unknown>,
    expenses: { [group._id]: expensePage() },
  };
  const unanswered: string[] = [];
  const sessions = new Map<string, PersonaId>();
  let issued = 0;
  const fetch: MobileFetch = async (address, init) => {
    const url = new URL(address),
      method = init.method ?? 'GET';
    if (url.pathname === '/api/auth/demo-persona/sign-in' && method === 'POST') {
      const persona = JSON.parse(String(init.body)).personaId as PersonaId;
      const user = world.people[persona];
      const cookie = `better-auth.session_token=${persona}-${++issued}.signature`;
      sessions.set(cookie, persona);
      return Response.json(
        { user },
        { headers: { 'Set-Cookie': `${cookie}; Max-Age=2592000; Path=/; HttpOnly` } },
      );
    }
    const cookie = new Headers(init.headers).get('Cookie') ?? '';
    const persona = sessions.get(cookie);
    if (url.pathname === '/api/auth/sign-out' && method === 'POST') {
      sessions.delete(cookie);
      return Response.json({ success: true });
    }
    if (!persona)
      return Response.json({ error: 'Unauthorized', code: 'UNAUTHORIZED' }, { status: 401 });
    const user = world.people[persona];
    if (url.pathname === '/api/auth/get-session')
      return Response.json({
        user,
        session: { userId: user.id, expiresAt: '2030-01-01T00:00:00Z' },
      });
    const answer = (data: unknown) => Response.json({ status: 200, data });
    if (url.pathname === '/api/groups')
      return answer(world.groups.filter((g) => g.members.some((m) => m.user._id === user.id)));
    if (url.pathname === '/api/user/balances') return answer(world.home);
    const found = world.groups.find((g) => url.pathname.startsWith(`/api/groups/${g._id}`));
    if (found && method === 'GET') {
      const base = `/api/groups/${found._id}`;
      if (url.pathname === base) return answer(found);
      if (url.pathname === base + '/balances') return answer(world.balances[found._id]);
      if (url.pathname === base + '/expenses') return answer(world.expenses[found._id]);
    }
    unanswered.push(`${method} ${url.pathname}${url.search}`);
    return Response.json({ error: 'Not found', code: 'NOT_FOUND' }, { status: 404 });
  };
  return { world, fetch, unanswered };
}
