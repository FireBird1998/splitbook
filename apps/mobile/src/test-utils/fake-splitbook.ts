import type { TripSummaryRead } from '@splitbook/shared/trip-summary-read';
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
/** The common single-member INR Expense used by financial-view fixtures. */
export function expenseFixture(
  group: WireGroup,
  id = 'b00000000000000000000001',
  description = 'Groceries',
) {
  const member = group.members[0]!.user;
  const person = { _id: member._id, name: member.name, image: member.image ?? null };
  return {
    _id: id,
    group: group._id,
    description,
    currency: 'INR',
    amount: 10,
    amountMinor: 1000,
    moneyVersion: 1,
    category: 'food',
    tag: 'Shared',
    tagId: 'c00000000000000000000001',
    date: group.updatedAt,
    createdAt: group.updatedAt,
    updatedAt: group.updatedAt,
    paidBy: [{ user: person, amount: 10, amountMinor: 1000 }],
    splitBetween: [{ user: person, amount: 10, amountMinor: 1000 }],
    splitMethod: 'equal',
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

/** Activity and Expense history share the server’s 20-row page shape. */
export function activityPage(activities: unknown[] = [], page = 1) {
  return {
    activities: activities.slice((page - 1) * 20, page * 20),
    pagination: {
      page,
      limit: 20,
      total: activities.length,
      totalPages: Math.ceil(activities.length / 20),
    },
  };
}

function queryKey(path: string, query: Record<string, string | number> = {}) {
  const url = new URL(path, 'http://local');
  for (const [key, value] of Object.entries(query)) url.searchParams.set(key, String(value));
  url.searchParams.sort();
  return url.pathname + url.search;
}
/** Fixed read pages keyed by their query; an empty query is the path’s fallback page. */
export function pagesFor(
  path: string,
  pages: readonly (readonly [Record<string, string | number>, unknown])[],
) {
  return Object.fromEntries(pages.map(([query, data]) => [queryKey(path, query), data]));
}

/** A stable suggestion used by the payment fixtures, in the rate endpoint's wire shape. */
export const rateSuggestion = (from: string, to: string, rate: string) => ({
  from,
  to,
  rate,
  source: 'frankfurter',
  asOf: '2026-10-20',
  fetchedAt: '2026-10-21T00:30:00.000Z',
  ageDays: 1,
  attributionRequired: false,
  attribution: null,
  components: [],
});

function emptyTripSummary(currency: string): TripSummaryRead {
  return {
    timeZone: 'UTC',
    currency,
    tripDates: { start: null, end: null },
    window: null,
    dayCount: 0,
    tooManyDays: false,
    spentMinor: 0,
    expenseCount: 0,
    yourShareMinor: 0,
    youPaidMinor: 0,
    yourExpenseCount: 0,
    peopleCount: 0,
    perPersonPerDayMinor: null,
    days: [],
    dailyAverageMinor: null,
    beforeTrip: null,
    afterTrip: null,
    byTag: [],
    suggestedPayments: [],
    otherCurrencies: [],
    hasExpenses: false,
    currencies: [],
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
  at: number;
  headers: Headers;
  body: Record<string, unknown> | undefined;
  init: RequestInit;
}
type Answer = (
  request: FakeRequest,
) => FetchResponse | Promise<FetchResponse | undefined> | undefined;

export function fakeSplitbook() {
  const group = groupFixture();
  const world = {
    people: structuredClone(demoPeople) as Record<PersonaId, SessionUser>,
    groups: [group],
    pages: {} as Record<string, unknown>,
    groupsByAccount: {} as Record<string, WireGroup[]>,
    homeByAccount: {} as Record<string, unknown>,
    home: { buckets: [] } as { buckets: unknown[]; groups?: unknown[] },
    balances: { [group._id]: { byCurrency: [] } } as Record<string, unknown>,
    expenses: { [group._id]: expensePage() } as Record<string, unknown>,
    expenseRecords: {} as Record<string, Record<string, unknown>>,
    activities: {} as Record<string, unknown[]>,
    settlements: { [group._id]: [] as unknown[] },
    rates: { [group._id]: {} } as Record<string, Record<string, unknown>>,
    tripSummaries: { [group._id]: { '': emptyTripSummary(group.defaultCurrency) } } as Record<
      string,
      Record<string, TripSummaryRead>
    >,
  };
  const unanswered: string[] = [];
  const requests: FakeRequest[] = [];
  const sentViews = new Map<boolean, string[]>();
  const sent = ({ query = true } = {}) => {
    let view = sentViews.get(query);
    if (!view) {
      view = requests.map((r) => `${r.method} ${query ? r.path : r.url.pathname}`);
      sentViews.set(query, view);
    }
    return view;
  };
  const replies: { method: string; path: string; answer: Answer; once: boolean }[] = [];
  const reply = (method: string, path: string, answer: Answer, { once = false } = {}) => {
    replies.unshift({ method, path, answer, once });
  };
  const holds: {
    method: string;
    path: string | RegExp;
    at: 'request' | 'reply';
    arrive(): void;
    wait: Promise<void>;
  }[] = [];
  const hold = (
    method: string,
    path: string | RegExp,
    { at = 'reply' }: { at?: 'request' | 'reply' } = {},
  ) => {
    let arrive!: () => void, release!: () => void, lose!: (error: Error) => void;
    const arrived = new Promise<void>((done) => {
      arrive = done;
    });
    const wait = new Promise<void>((done, reject) => {
      release = done;
      lose = reject;
    });
    holds.push({ method, path, at, arrive, wait });
    return {
      arrived,
      release: (fault?: 'lost-reply') =>
        fault ? lose(new TypeError('Network request failed')) : release(),
    };
  };
  const sessions = new Map<string, PersonaId>();
  let issued = 0,
    online = true;
  const fetch: MobileFetch = async (address, init) => {
    const url = new URL(address),
      method = init.method ?? 'GET';
    const request: FakeRequest = {
      url,
      method,
      at: Date.now(),
      path: url.pathname + url.search,
      headers: new Headers(init.headers),
      body: init.body ? JSON.parse(String(init.body)) : undefined,
      init,
    };
    requests.push(request);
    for (const [query, view] of sentViews)
      view.push(`${method} ${query ? request.path : url.pathname}`);
    if (!online) throw new TypeError('Network request failed');
    const index = holds.findIndex(
      (h) =>
        (h.method === '*' || h.method === method) &&
        (typeof h.path === 'string' ? h.path === request.path : h.path.test(request.path)),
    );
    const held = index < 0 ? undefined : holds.splice(index, 1)[0];
    if (held?.at === 'request') {
      held.arrive();
      await held.wait;
    }
    const respond = async () => {
      // Replacements can observe a request and defer to its normal answer with undefined.
      for (const entry of [...replies]) {
        if (entry.method !== '*' && entry.method !== method) continue;
        if (entry.path !== '*' && entry.path !== url.pathname && entry.path !== request.path)
          continue;
        if (entry.once) replies.splice(replies.indexOf(entry), 1);
        const answer = await entry.answer(request);
        if (answer !== undefined) return answer;
      }
      const readPaths = [
        '/api/auth/get-session',
        '/api/groups',
        '/api/user/balances',
        ...world.groups.flatMap((g) =>
          [
            '',
            '/balances',
            '/expenses',
            '/settlements',
            '/rates',
            '/trip-summary',
            '/activity',
            ...Object.keys(world.expenseRecords[g._id] ?? {}).map((id) => '/expenses/' + id),
          ].map((suffix) => `/api/groups/${g._id}${suffix}`),
        ),
      ];
      const writePaths = [
        '/api/auth/demo-persona/sign-in',
        '/api/auth/sign-out',
        '/api/groups',
        ...world.groups.flatMap((g) =>
          ['/settlements', '/settlements/batch'].map((suffix) => `/api/groups/${g._id}${suffix}`),
        ),
      ];
      if (
        !(method === 'GET' && readPaths.includes(url.pathname)) &&
        !(method === 'POST' && writePaths.includes(url.pathname))
      ) {
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
      if (method === 'GET') {
        const page = world.pages[queryKey(request.path)] ?? world.pages[url.pathname];
        if (page !== undefined) return answer(page);
      }
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
        return answer(
          world.groupsByAccount[user.id] ??
            world.groups.filter((g) => g.members.some((m) => m.user._id === user.id)),
        );
      if (url.pathname === '/api/user/balances')
        return answer(world.homeByAccount[user.id] ?? world.home);
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
        if (url.pathname === base + '/trip-summary') {
          const currency = url.searchParams.get('currency') ?? '';
          const data =
            world.tripSummaries[found._id]?.[currency] ??
            emptyTripSummary(currency || found.defaultCurrency);
          return answer({ ...data, timeZone: url.searchParams.get('tz') ?? data.timeZone });
        }
        if (url.pathname === base + '/rates') {
          const pair = `${url.searchParams.get('from')}→${url.searchParams.get('to')}`;
          const suggestion = world.rates[found._id]?.[pair] ?? null;
          return answer(suggestion ? { suggestion } : { suggestion: null, reason: 'unavailable' });
        }
        if (url.pathname === base) return answer(found);
        if (url.pathname === base + '/balances') return answer(world.balances[found._id]);
        if (url.pathname === base + '/activity') {
          const id = url.searchParams.get('expenseId');
          const rows = (world.activities[found._id] ?? []).filter(
            (row) =>
              !id || (row as { metadata?: { expenseId?: string } }).metadata?.expenseId === id,
          );
          return answer(activityPage(rows, Number(url.searchParams.get('page') ?? 1)));
        }
        const expense =
          world.expenseRecords[found._id]?.[url.pathname.slice((base + '/expenses/').length)];
        if (url.pathname.startsWith(base + '/expenses/') && expense) return answer(expense);
        if (url.pathname === base + '/expenses') return answer(world.expenses[found._id]);
      }
      unanswered.push(`${method} ${url.pathname}${url.search}`);
      return Response.json({ error: 'Not found', code: 'NOT_FOUND' }, { status: 404 });
    };
    const response = await respond();
    if (held?.at === 'reply') {
      held.arrive();
      await held.wait;
    }
    return response;
  };
  return {
    world,
    get online() {
      return online;
    },
    set online(value: boolean) {
      online = value;
    },
    fetch,
    requests,
    sent,
    unanswered,
    reply,
    hold,
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
          if (kind === 'body-fails') return bodyFails();
          // A lost reply fails fetch after the request was logged as taken; no response headers arrive.
          if (kind === 'lost-reply') throw new TypeError('Network request failed');
          return Promise.reject(new TypeError('Network request failed'));
        },
        options,
      );
    },
  };
}
