import { bodyFails, gatewayReply, hangUntilAborted, type GatewayBody } from './transport-faults';
import { parseAmountMinor } from '@splitbook/shared/exact-money';
import type { FetchResponse, MobileFetch, PersonaId, SessionUser } from '../data/types';

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

/** Populate a recorded payment from its request, without applying anything to a ledger. */
export function recordedSettlement(
  body: Record<string, unknown>,
  group: WireGroup,
  creator = group.members[0]!.user,
) {
  return {
    _id: 'c00000000000000000000001',
    group: group._id,
    createdBy: creator,
    ...body,
    paidBy: group.members.find((m) => m.user._id === body.paidBy)?.user,
    paidTo: group.members.find((m) => m.user._id === body.paidTo)?.user,
    amountMinor: parseAmountMinor(body.amount as number, body.currency as string),
    moneyVersion: 1,
    createdAt: group.updatedAt,
    updatedAt: group.updatedAt,
  };
}
export function recordedBatch(
  body: {
    paidBy: string;
    paidTo: string;
    paidCurrency: string;
    settlements: Record<string, unknown>[];
  },
  group: WireGroup,
  creator = group.members[0]!.user,
) {
  const settlements = body.settlements.map((row, index) => ({
    ...recordedSettlement(
      {
        paidBy: body.paidBy,
        paidTo: body.paidTo,
        note: '',
        ...row,
        ...(row.amountPaidMinor === undefined ? {} : { paidCurrency: body.paidCurrency }),
      },
      group,
      creator,
    ),
    _id: `c${String(index + 1).padStart(23, '0')}`,
    pairDebtBeforeMinor: -parseAmountMinor(row.amount as number, row.currency as string),
    pairDebtAfterMinor: 0,
  }));
  return {
    paidCurrency: body.paidCurrency,
    totalPaidMinor: settlements.reduce(
      (sum, row) =>
        sum + ((row as { amountPaidMinor?: number }).amountPaidMinor ?? row.amountMinor),
      0,
    ),
    settlements,
  };
}

export interface FakeRequest {
  url: URL;
  method: string;
  path: string;
  headers: Headers;
  body: Record<string, unknown> | undefined;
  init: RequestInit;
}
type Answer = (request: FakeRequest) => FetchResponse | Promise<FetchResponse> | undefined;

export function fakeSplitbook() {
  const group = groupFixture();
  const world = {
    people: structuredClone(demoPeople) as Record<PersonaId, SessionUser>,
    groups: [group],
    home: { buckets: [] as unknown[] },
    balances: { [group._id]: { byCurrency: [] } } as Record<string, unknown>,
    expenses: { [group._id]: expensePage() },
    settlements: { [group._id]: [] as unknown[] },
    rates: { [group._id]: {} } as Record<string, Record<string, unknown>>,
  };
  const unanswered: string[] = [];
  const requests: FakeRequest[] = [];
  const replies: { method: string; path: string; answer: Answer; once: boolean }[] = [];
  const reply = (method: string, path: string, answer: Answer, { once = false } = {}) => {
    replies.unshift({ method, path, answer, once });
  };
  const sessions = new Map<string, PersonaId>();
  let issued = 0;
  const fetch: MobileFetch = async (address, init) => {
    const url = new URL(address),
      method = init.method ?? 'GET';
    const request: FakeRequest = {
      url,
      method,
      path: url.pathname + url.search,
      headers: new Headers(init.headers),
      body: init.body ? JSON.parse(String(init.body)) : undefined,
      init,
    };
    requests.push(request);
    // Replacements can observe a request and defer to its normal answer with undefined.
    for (const entry of [...replies]) {
      if (entry.method !== '*' && entry.method !== method) continue;
      if (entry.path !== '*' && entry.path !== url.pathname && entry.path !== request.path)
        continue;
      if (entry.once) replies.splice(replies.indexOf(entry), 1);
      const answer = entry.answer(request);
      if (answer !== undefined) return answer;
    }
    if (!url.pathname.startsWith('/api/')) {
      unanswered.push(`${method} ${request.path}`);
      return Response.json({ error: 'Not found', code: 'NOT_FOUND' }, { status: 404 });
    }
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
    if (url.pathname === '/api/groups' && method === 'POST') {
      const body = request.body!;
      return Response.json(
        {
          status: 201,
          data: groupFixture({
            ...body,
            _id: 'b00000000000000000000009',
            createdBy: user.id,
            members: [
              {
                user: { _id: user.id, name: user.name, email: user.email, image: user.image },
                role: 'admin',
                joinedAt: iso,
              },
            ],
          }),
        },
        { status: 201 },
      );
    }
    if (url.pathname === '/api/groups')
      return answer(world.groups.filter((g) => g.members.some((m) => m.user._id === user.id)));
    if (url.pathname === '/api/user/balances') return answer(world.home);
    const found = world.groups.find((g) => url.pathname.startsWith(`/api/groups/${g._id}`));
    if (found) {
      const base = `/api/groups/${found._id}`;
      if (url.pathname === base + '/settlements' && method === 'POST')
        return Response.json(
          {
            status: 201,
            data: recordedSettlement(request.body!, found, { _id: user.id, name: user.name }),
          },
          { status: 201 },
        );
      if (url.pathname === base + '/settlements/batch' && method === 'POST')
        return Response.json(
          {
            status: 201,
            data: recordedBatch(request.body as Parameters<typeof recordedBatch>[0], found, {
              _id: user.id,
              name: user.name,
            }),
          },
          { status: 201 },
        );
      if (method !== 'GET') {
        unanswered.push(`${method} ${request.path}`);
        return Response.json({ code: 'NOT_FOUND' }, { status: 404 });
      }
      if (url.pathname === base + '/settlements') return answer(world.settlements[found._id]);
      if (url.pathname === base + '/rates') {
        const pair = `${url.searchParams.get('from')}→${url.searchParams.get('to')}`;
        const suggestion = world.rates[found._id]?.[pair] ?? null;
        return answer(suggestion ? { suggestion } : { suggestion: null, reason: 'unavailable' });
      }
      if (url.pathname === base) return answer(found);
      if (url.pathname === base + '/balances') return answer(world.balances[found._id]);
      if (url.pathname === base + '/expenses') return answer(world.expenses[found._id]);
    }
    unanswered.push(`${method} ${url.pathname}${url.search}`);
    return Response.json({ error: 'Not found', code: 'NOT_FOUND' }, { status: 404 });
  };
  return {
    world,
    fetch,
    requests,
    unanswered,
    reply,
    fault(
      method: string,
      path: string,
      kind:
        | 'offline'
        | 'lost-reply'
        | 'body-fails'
        | 'headers'
        | 'body'
        | { status: number; body: GatewayBody },
      options = {},
    ) {
      reply(
        method,
        path,
        ({ init }) => {
          if (typeof kind === 'object') return gatewayReply(kind.status, kind.body);
          if (kind === 'headers' || kind === 'body') return hangUntilAborted(init, kind);
          if (kind === 'lost-reply' || kind === 'body-fails') return bodyFails();
          return Promise.reject(new TypeError('Network request failed'));
        },
        options,
      );
    },
  };
}
