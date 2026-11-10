import { onTestFinished } from 'vitest';
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
  online: boolean;
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
    toReview: null as unknown,
    notifications: null as unknown,
    connections: null as unknown,
    assistantGroups: null as unknown,
    home: { buckets: [] } as { buckets: unknown[]; groups?: unknown[] },
    balances: { [group._id]: { byCurrency: [] } } as Record<string, unknown>,
    expenses: { [group._id]: expensePage() } as Record<string, unknown>,
    expenseRecords: {} as Record<string, Record<string, unknown>>,
    activities: {} as Record<string, unknown[]>,
    tags: {} as Record<string, unknown>,
    settlements: { [group._id]: [] as unknown[] },
    rates: { [group._id]: {} } as Record<string, Record<string, unknown>>,
    tripSummaries: { [group._id]: { '': emptyTripSummary(group.defaultCurrency) } } as Record<
      string,
      Record<string, TripSummaryRead>
    >,
  };
  const unanswered: string[] = [];
  const expectedAbsences = new Set<string>();
  const matchesAbsence = (expected: string, actual: string) =>
    expected === actual || (!expected.includes('?') && expected === actual.split('?')[0]);
  const expectUnanswered = (method: string, path: string) => {
    if (!/^[A-Z]+$/.test(method) || !path.startsWith('/') || path.includes('*'))
      throw new Error('Name an exact method and path for an expected unanswered request.');
    expectedAbsences.add(`${method} ${path}`);
  };
  onTestFinished(() => {
    const unexpected = unanswered.filter(
      (actual) => ![...expectedAbsences].some((expected) => matchesAbsence(expected, actual)),
    );
    if (unexpected.length) throw new Error(`Unanswered requests: ${unexpected.join(' | ')}`);
    const unused = [...expectedAbsences].filter(
      (expected) => !unanswered.some((actual) => matchesAbsence(expected, actual)),
    );
    if (unused.length)
      throw new Error(`Expected unanswered requests were not sent: ${unused.join(' | ')}`);
  });
  const requests: FakeRequest[] = [];
  const sentViews = new Map<string, { query: boolean; method: boolean; rows: string[] }>();
  const label = (r: FakeRequest, query: boolean, method: boolean) =>
    (method ? r.method + ' ' : '') + (query ? r.path : r.url.pathname);
  const sent = ({ query = true, method = true } = {}) => {
    const key = `${query}:${method}`;
    let view = sentViews.get(key);
    if (!view) {
      view = { query, method, rows: requests.map((r) => label(r, query, method)) };
      sentViews.set(key, view);
    }
    return view.rows;
  };
  const replies: { method: string; path: string; answer: Answer; once: boolean }[] = [];
  const reply = (method: string, path: string, answer: Answer, { once = false } = {}) => {
    replies.unshift({ method, path, answer, once });
  };
  const holds: {
    method: string;
    path: string | RegExp;
    at: 'request' | 'reply';
    abortable: boolean;
    arrive(): void;
    wait: Promise<void>;
  }[] = [];
  const hold = (
    method: string,
    path: string | RegExp,
    { at = 'reply', abortable = false }: { at?: 'request' | 'reply'; abortable?: boolean } = {},
  ) => {
    let arrive!: () => void, release!: () => void, lose!: (error: Error) => void;
    const arrived = new Promise<void>((done) => {
      arrive = done;
    });
    const wait = new Promise<void>((done, reject) => {
      release = done;
      lose = reject;
    });
    holds.push({ method, path, at, abortable, arrive, wait });
    return {
      arrived,
      release: (fault?: 'lost-reply') =>
        fault ? lose(new TypeError('Network request failed')) : release(),
    };
  };
  let issued = 0,
    online = true;
  const auth = {
    sessions: new Map<string, SessionUser>(),
    issuedTo: new Map<string, SessionUser>(),
    expired: false,
    signInStatus: 200,
    signInCode: null as string | null,
    sessionPresent: true,
    sessionStatus: 200,
    signOutStatus: 200,
    bootstrap: {
      environment: 'staging',
      googleWebClientId: '123-test.apps.googleusercontent.com',
    } as unknown,
    expiresAt: '2030-01-01T00:00:00Z',
    secureCookies: false,
    rotate: false,
    cookie: (persona: PersonaId, sequence: number) =>
      `better-auth.session_token=${persona}-${sequence}.signature`,
    issue(persona: PersonaId, cookie?: string): string {
      const user = world.people[persona];
      const value = cookie ?? auth.cookie(persona, ++issued);
      auth.sessions.set(value, user);
      auth.issuedTo.set(value, user);
      return value;
    },
  };
  const fetch: MobileFetch = async (address, init) => {
    const url = new URL(address),
      method = init.method ?? 'GET';
    const request: FakeRequest = {
      url,
      method,
      at: Date.now(),
      online,
      path: url.pathname + url.search,
      headers: new Headers(init.headers),
      body: init.body ? JSON.parse(String(init.body)) : undefined,
      init,
    };
    requests.push(request);
    for (const { query, method, rows } of sentViews.values())
      rows.push(label(request, query, method));
    if (!online) throw new TypeError('Network request failed');
    const index = holds.findIndex(
      (h) =>
        (h.method === '*' || h.method === method) &&
        (typeof h.path === 'string' ? h.path === request.path : h.path.test(request.path)),
    );
    const held = index < 0 ? undefined : holds.splice(index, 1)[0];
    const waitForHold = () =>
      !held?.abortable
        ? held?.wait
        : new Promise<void>((resolve, reject) => {
            const abort = () => reject(new TypeError('Network request failed'));
            if (init.signal?.aborted) return abort();
            init.signal?.addEventListener('abort', abort);
            void held.wait.then(() => {
              init.signal?.removeEventListener('abort', abort);
              resolve();
            }, reject);
          });
    if (held?.at === 'request') {
      held.arrive();
      await waitForHold();
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
      if (url.pathname === '/.well-known/splitbook-mobile.json')
        return Response.json(auth.bootstrap);
      const readPaths = [
        '/api/auth/get-session',
        '/api/groups',
        '/api/user/balances',
        '/api/user/to-review',
        '/api/notifications/device',
        '/api/auth/mcp/connections',
        '/api/user/assistant-groups',
        ...world.groups.flatMap((g) =>
          [
            '',
            '/balances',
            '/expenses',
            '/settlements',
            '/rates',
            '/trip-summary',
            '/activity',
            '/tag-actions',
            ...Object.keys(world.expenseRecords[g._id] ?? {}).map((id) => '/expenses/' + id),
          ].map((suffix) => `/api/groups/${g._id}${suffix}`),
        ),
      ];
      const writePaths = [
        '/api/auth/demo-persona/sign-in',
        '/api/auth/sign-in/social',
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
      if (
        (url.pathname === '/api/auth/demo-persona/sign-in' ||
          url.pathname === '/api/auth/sign-in/social') &&
        method === 'POST'
      ) {
        if (auth.signInStatus !== 200)
          return Response.json(auth.signInCode ? { code: auth.signInCode } : {}, {
            status: auth.signInStatus,
          });
        const persona = (
          url.pathname.endsWith('/social')
            ? String(init.body).includes('sam')
              ? 'sam'
              : 'alex'
            : JSON.parse(String(init.body)).personaId
        ) as PersonaId;
        const user = world.people[persona];
        const cookie = auth.issue(
          persona,
          auth.secureCookies ? '__Secure-' + auth.cookie(persona, ++issued) : undefined,
        );
        return Response.json(
          { user },
          {
            headers: {
              'Set-Cookie': `${cookie}; Max-Age=2592000; Path=/; HttpOnly${auth.secureCookies ? '; Secure' : ''}`,
            },
          },
        );
      }
      const cookie = new Headers(init.headers).get('Cookie') ?? '';
      const user = auth.sessions.get(cookie);
      if (url.pathname === '/api/auth/sign-out' && method === 'POST') {
        if (auth.signOutStatus !== 200) return Response.json({}, { status: auth.signOutStatus });
        auth.sessions.delete(cookie);
        return Response.json({ success: true });
      }
      if (!user || auth.expired)
        return Response.json({ error: 'Unauthorized', code: 'UNAUTHORIZED' }, { status: 401 });
      if (url.pathname === '/api/auth/get-session' && auth.sessionStatus !== 200)
        return Response.json({}, { status: auth.sessionStatus });
      if (url.pathname === '/api/auth/get-session')
        return Response.json(
          auth.sessionPresent
            ? {
                user,
                session: { userId: user.id, expiresAt: auth.expiresAt },
              }
            : null,
        );
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
      if (url.pathname === '/api/auth/mcp/connections' && world.connections !== null)
        return Response.json(world.connections);
      if (url.pathname === '/api/user/assistant-groups' && world.assistantGroups !== null)
        return answer(world.assistantGroups);
      if (url.pathname === '/api/notifications/device' && world.notifications !== null)
        return answer(world.notifications);
      if (url.pathname === '/api/user/to-review' && world.toReview !== null)
        return answer(world.toReview);
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
        if (url.pathname === base + '/tag-actions')
          return answer(world.tags[found._id] ?? { canManage: false, tags: [] });
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
    // Refresh keeps the old token valid for reads already in flight, as Better Auth does.
    const previous = request.headers.get('Cookie');
    const holder = previous ? auth.sessions.get(previous) : undefined;
    let rotated: string | undefined;
    if (auth.rotate && holder) {
      auth.rotate = false;
      const persona = (Object.keys(world.people) as PersonaId[]).find(
        (p) => world.people[p] === holder,
      )!;
      rotated = auth.issue(persona);
    }
    const response = await respond();
    if (rotated && response.headers instanceof Headers)
      response.headers.set('Set-Cookie', rotated + '; Max-Age=2592000; Path=/; HttpOnly');
    if (held?.at === 'reply') {
      held.arrive();
      await waitForHold();
    }
    return response;
  };
  return {
    world,
    auth,
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
    expectUnanswered,
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
