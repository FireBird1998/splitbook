import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { changesAccountGroups, lostGroupId } from './group-access';

const ACTOR = 'a00000000000000000000002';
const LOST = 'b00000000000000000000001';
const KEPT = 'c00000000000000000000001';
const EXPENSE = 'd00000000000000000000001';
/** Home's latest changes across the account's Groups (#309), as the card reads them. */
const LATEST_CHANGES = '/api/user/activity?limit=10';
/** Home's spending chart (#307), as its card asks for it. */
const SPENDING = '/api/user/spending?months=6&tz=Asia%2FKolkata';

describe('lostGroupId: which refused read means the account lost a Group', () => {
  it.each([
    ['GET', `/api/groups/${LOST}`, 403],
    ['GET', `/api/groups/${LOST}`, 404],
    ['GET', `/api/groups/${LOST}/expenses?sortBy=date&sortOrder=desc&page=1&limit=20`, 403],
    ['GET', `/api/groups/${LOST}/expenses?page=1&limit=1`, 403],
    ['GET', `/api/groups/${LOST}/expenses/${EXPENSE}`, 403],
    ['GET', `/api/groups/${LOST}/expenses/check-duplicate?description=Tea`, 403],
    ['GET', `/api/groups/${LOST}/balances`, 403],
    ['GET', `/api/groups/${LOST}/settlements`, 403],
    ['GET', `/api/groups/${LOST}/activity?page=1&limit=50`, 403],
    ['GET', `/api/groups/${LOST}/recurring`, 403],
    ['get', `/api/groups/${LOST}/balances`, 403],
  ])('%s %s answered %i loses the Group', (method, path, status) => {
    expect(lostGroupId(method, path, status)).toBe(LOST);
  });

  it.each([
    // A deleted or unknown Expense, not the Group.
    ['GET', `/api/groups/${LOST}/expenses/${EXPENSE}`, 404],
    ['GET', `/api/groups/${LOST}/balances`, 404],
    // On a write, 403 can mean "not an admin" (or "not a party to this payment").
    ['POST', `/api/groups/${LOST}/expenses`, 403],
    ['PATCH', `/api/groups/${LOST}`, 403],
    ['PATCH', `/api/groups/${LOST}/expenses/${EXPENSE}`, 403],
    ['DELETE', `/api/groups/${LOST}/members/${ACTOR}`, 403],
    ['POST', `/api/groups/${LOST}/settlements`, 403],
    ['DELETE', `/api/groups/${LOST}`, 404],
    // An outage or a server fault says nothing about access.
    ['GET', `/api/groups/${LOST}/expenses?page=1&limit=20`, 503],
    ['GET', `/api/groups/${LOST}`, 503],
    ['GET', `/api/groups/${LOST}`, 500],
    // Signed out: the page goes to /login instead.
    ['GET', `/api/groups/${LOST}`, 401],
    ['GET', `/api/groups/${LOST}/expenses`, 401],
    ['GET', `/api/groups/${LOST}/expenses`, 200],
    // Not a Group's path.
    ['GET', '/api/groups', 403],
    ['GET', '/api/user/balances', 403],
    ['GET', '/api/invitations', 404],
    ['GET', '/api/groups/not-a-group-id/expenses', 403],
    ['GET', `/api/groupsx/${LOST}`, 403],
    ['GET', `/api/groups/${LOST}0/expenses`, 403],
  ])('%s %s answered %i keeps the Group', (method, path, status) => {
    expect(lostGroupId(method, path, status)).toBeNull();
  });
});

describe('changesAccountGroups: which answer refreshes the sidebar’s Groups and balances (#303)', () => {
  it.each([
    ['POST', '/api/groups', 201],
    ['PATCH', `/api/groups/${KEPT}`, 200],
    ['POST', `/api/groups/${KEPT}/expenses`, 201],
    ['PUT', `/api/groups/${KEPT}/expenses/${EXPENSE}`, 200],
    ['DELETE', `/api/groups/${KEPT}/expenses/${EXPENSE}`, 200],
    ['POST', `/api/groups/${KEPT}/settlements`, 201],
    ['DELETE', `/api/groups/${KEPT}/members/${ACTOR}`, 200],
    ['POST', `/api/invitations/${EXPENSE}`, 200],
    ['POST', '/api/join/synthetic-code', 200],
  ])('%s %s answered %i does', (method, path, status) => {
    expect(changesAccountGroups(method, path, status)).toBe(true);
  });

  it.each([
    // Reads change nothing; their polls keep themselves current.
    ['GET', `/api/groups/${KEPT}/expenses`, 200],
    ['GET', '/api/user/balances', 200],
    // Refused or failed writes change nothing.
    ['POST', `/api/groups/${KEPT}/expenses`, 403],
    ['POST', `/api/groups/${KEPT}/settlements`, 409],
    ['PATCH', `/api/groups/${KEPT}`, 500],
    // Not about Groups.
    ['PATCH', '/api/user/profile', 200],
    ['POST', '/api/groupsx', 200],
  ])('%s %s answered %i does not', (method, path, status) => {
    expect(changesAccountGroups(method, path, status)).toBe(false);
  });
});

/** localStorage as a page sees it. */
class MemoryStorage implements Storage {
  private items = new Map<string, string>();
  get length() {
    return this.items.size;
  }
  clear() {
    this.items.clear();
  }
  key(index: number) {
    return [...this.items.keys()][index] ?? null;
  }
  getItem(key: string) {
    return this.items.get(key) ?? null;
  }
  setItem(key: string, value: string) {
    this.items.set(key, value);
  }
  removeItem(key: string) {
    this.items.delete(key);
  }
}

/**
 * Each test gets a fresh document, signed in as ACTOR: the lost Groups and
 * the pinned account are per page load. `swr` itself loads once for the file
 * (vi.resetModules does not reload node_modules), so its cache is emptied.
 */
async function freshDocument() {
  vi.resetModules();
  const storage = new MemoryStorage();
  vi.stubGlobal('window', {
    location: {
      pathname: `/groups/${LOST}`,
      search: '',
      reload: vi.fn(),
      assign: vi.fn(),
    },
    localStorage: storage,
  });
  const swr = await import('swr');
  const { fetchGroupRead, groupReadKey, readWebGroupResponse } = await import('./group-read');
  const { apiFetch, pinExpectedAccount } = await import('./utils/api-fetch');
  const { fetcher, HttpResponseError } = await import('./utils/fetcher');
  const { listSettlementAttempts, recordSettlement } = await import('./settlement-attempts');
  pinExpectedAccount(ACTOR);
  const cache = swr.SWRConfig.defaultValue.cache;
  for (const key of [...cache.keys()]) cache.delete(key);
  return {
    ...swr,
    cache,
    storage,
    fetchGroupRead,
    groupReadKey,
    readWebGroupResponse,
    apiFetch,
    fetcher,
    HttpResponseError,
    listSettlementAttempts,
    recordSettlement,
  };
}

const groupPayload = (id: string) => ({
  data: {
    _id: id,
    name: 'Synthetic lantern trip',
    createdBy: ACTOR,
    defaultCurrency: 'INR',
    category: 'trip',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-02T00:00:00.000Z',
    members: [
      {
        user: { _id: ACTOR, name: 'Sam', email: 'sam@example.test' },
        role: 'member',
        joinedAt: '2026-01-01T00:00:00.000Z',
      },
    ],
  },
  status: 200,
});

const reply = (status: number, body: unknown = { error: 'Forbidden', status }) =>
  new Response(JSON.stringify(body), { status });

function answer(status: number, body?: unknown) {
  const fetchMock = vi.fn(async () => reply(status, body));
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

describe('losing a Group deletes what this tab holds for it', () => {
  let doc: Awaited<ReturnType<typeof freshDocument>>;
  const lostContent = [
    `/api/groups/${LOST}/expenses?sortBy=date&sortOrder=desc&page=1&limit=20`,
    `/api/groups/${LOST}/expenses?page=1&limit=1`,
    `/api/groups/${LOST}/expenses/${EXPENSE}`,
    `/api/groups/${LOST}/balances`,
    `/api/groups/${LOST}/settlements`,
    `/api/groups/${LOST}/activity?page=1&limit=50`,
    `/api/groups/${LOST}/recurring`,
  ];
  const keptContent = [
    `/api/groups/${KEPT}/expenses?page=1&limit=1`,
    `/api/groups/${KEPT}/balances`,
    '/api/invitations',
  ];
  const keys = () => ({
    groupList: doc.groupReadKey(ACTOR, '/api/groups'),
    lostGroup: doc.groupReadKey(ACTOR, `/api/groups/${LOST}`),
    keptGroup: doc.groupReadKey(ACTOR, `/api/groups/${KEPT}`),
  });
  /** Account-wide reads that list every Group, the lost one included. */
  const accountReads = () => [keys().groupList, '/api/user/balances', LATEST_CHANGES, SPENDING];

  /**
   * Leave an entry the way a mounted `useSWR` hook leaves it: SWR records the
   * hook's own key beside the state (`_k`), and key filters only see entries
   * that carry one. `group-access.hooks.test.ts` mounts real hooks.
   */
  function remember(key: string | readonly unknown[], state: { data?: unknown; error?: unknown }) {
    doc.cache.set(doc.unstable_serialize(key), { ...state, _k: key } as never);
  }
  const stateOf = (key: string | readonly unknown[]) => {
    const { _k, ...state } = (doc.cache.get(doc.unstable_serialize(key)) ?? {}) as Record<
      string,
      unknown
    >;
    void _k;
    return state;
  };
  const allEntries = () => {
    const { lostGroup, keptGroup } = keys();
    return Object.fromEntries(
      [...accountReads(), lostGroup, keptGroup, ...lostContent, ...keptContent].map((key) => [
        doc.unstable_serialize(key),
        stateOf(key),
      ]),
    );
  };

  beforeEach(async () => {
    doc = await freshDocument();
    const { groupList, lostGroup, keptGroup } = keys();
    remember(groupList, { data: { data: [{ _id: LOST }, { _id: KEPT }] } });
    remember('/api/user/balances', {
      data: { data: { groups: [{ groupId: LOST }] } },
    });
    remember(LATEST_CHANGES, {
      data: { activities: [{ group: { _id: LOST, name: 'Synthetic lantern trip' } }], limit: 10 },
    });
    remember(SPENDING, {
      data: { data: { groups: [{ groupId: LOST, name: 'Synthetic lantern trip' }] } },
    });
    remember(lostGroup, {
      data: { data: { _id: LOST, name: 'Synthetic lantern trip' } },
    });
    remember(keptGroup, {
      data: { data: { _id: KEPT, name: 'Synthetic kept trip' } },
    });
    for (const key of lostContent) remember(key, { data: { data: { verified: key } } });
    // A refresh that already failed once still holds the verified rows beside its error.
    remember(lostContent[0], {
      data: {
        data: { expenses: [{ description: 'Synthetic lantern dinner' }] },
      },
      error: new Error('Expenses could not be refreshed'),
    });
    for (const key of keptContent) remember(key, { data: { data: { verified: key } } });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function expectLost() {
    expect(stateOf(keys().lostGroup)).toEqual({
      data: { denied: true },
      error: undefined,
    });
    for (const key of [...lostContent, ...accountReads()])
      expect(stateOf(key)).toEqual({ data: undefined, error: undefined });
  }

  function expectKept(before: ReturnType<typeof allEntries>) {
    const after = allEntries();
    for (const key of [keys().keptGroup, ...keptContent].map((key) => doc.unstable_serialize(key)))
      expect(after[key]).toEqual(before[key]);
  }

  const readLostGroup = () =>
    doc.fetchGroupRead(`/api/groups/${LOST}`, (payload) =>
      doc.readWebGroupResponse(payload, ACTOR, LOST),
    );

  it.each(lostContent)(
    'a 403 on the read %s replaces the Group read with a denial and deletes the rest',
    async (path) => {
      const before = allEntries();
      answer(403);
      await expect(doc.fetcher(path)).rejects.toMatchObject({ status: 403 });
      expectLost();
      expectKept(before);
    },
  );

  it('a 403 on a read made outside SWR (the duplicate check) loses the Group too', async () => {
    const before = allEntries();
    answer(403);
    const response = await doc.apiFetch(
      `/api/groups/${LOST}/expenses/check-duplicate?description=Tea&amount=10`,
    );
    expect(response.status).toBe(403);
    expectLost();
    expectKept(before);
  });

  it.each([403, 404])(
    'a Group read answered %i is a denial and deletes the Group’s other entries',
    async (status) => {
      const before = allEntries();
      answer(status);
      await expect(readLostGroup()).resolves.toEqual({ denied: true });
      expectLost();
      expectKept(before);
    },
  );

  it('clears the cached Group list and the account’s balances, so no page shows the lost Group from them', async () => {
    answer(403);
    await expect(doc.fetcher(lostContent[3])).rejects.toThrow();
    for (const key of accountReads())
      expect(stateOf(key)).toEqual({ data: undefined, error: undefined });
    expect(stateOf('/api/invitations')).toEqual({
      data: { data: { verified: '/api/invitations' } },
    });
  });

  it('forgets the signed-in account’s unconfirmed payments in that Group only (#198)', async () => {
    const payment = {
      paidBy: ACTOR,
      paidTo: KEPT.replace('c', 'a'),
      amount: 123.45,
      currency: 'INR',
      note: '',
      paidByName: 'Sam',
      paidToName: 'Priya',
    };
    const lostReply = async (): Promise<Response> => {
      throw new TypeError('Failed to fetch');
    };
    for (const groupId of [LOST, KEPT])
      await doc.recordSettlement({
        storage: doc.storage,
        accountId: ACTOR,
        groupId,
        newKey: () => `synthetic-key-${groupId}`,
        post: lostReply,
        payment,
      });
    const attempts = (groupId: string) => doc.listSettlementAttempts(doc.storage, ACTOR, groupId);
    expect(attempts(LOST)).toHaveLength(1);

    answer(403);
    await expect(doc.fetcher(lostContent[3])).rejects.toThrow();
    await vi.waitFor(() => expect(attempts(LOST)).toEqual([]));
    expect(attempts(KEPT)).toHaveLength(1);
  });

  it.each([
    ['a missing Expense', 'GET', `/api/groups/${LOST}/expenses/${EXPENSE}`, 404],
    ['a refused Expense write', 'POST', `/api/groups/${LOST}/expenses`, 403],
    ['a refused Group settings write', 'PATCH', `/api/groups/${LOST}`, 403],
    ['a refused member removal', 'DELETE', `/api/groups/${LOST}/members/${KEPT}`, 403],
    ['an outage on the Expense list', 'GET', `/api/groups/${LOST}/expenses?page=1&limit=20`, 503],
    ['an outage on the Group read', 'GET', `/api/groups/${LOST}`, 503],
  ])('%s keeps everything cached', async (_name, method, path, status) => {
    const before = allEntries();
    answer(status);
    if (method === 'GET') await expect(doc.fetcher(path)).rejects.toMatchObject({ status });
    else expect((await doc.apiFetch(path, { method })).status).toBe(status);
    expect(allEntries()).toEqual(before);
  });

  describe('when the account can read the Group again', () => {
    const refused = lostContent[3];
    /** What SWR records once the refused read rejects, after the Group was forgotten. */
    const refusal = () => ({
      error: new doc.HttpResponseError('Forbidden', 403),
    });

    beforeEach(async () => {
      answer(403);
      await expect(doc.fetcher(refused)).rejects.toThrow();
      remember(refused, refusal());
    });

    it('the first good read of the Group itself clears what the refused read left', async () => {
      answer(200, groupPayload(LOST));
      await expect(readLostGroup()).resolves.toMatchObject({
        data: { _id: LOST },
      });
      for (const key of lostContent)
        expect(stateOf(key)).toEqual({ data: undefined, error: undefined });
    });

    it('only the first good read does, so later polls keep what was read since', async () => {
      answer(200, groupPayload(LOST));
      await readLostGroup();
      remember(refused, {
        data: { data: { verified: 'after access returned' } },
      });
      answer(200, groupPayload(LOST));
      await readLostGroup();
      expect(stateOf(refused)).toEqual({
        data: { data: { verified: 'after access returned' } },
      });
    });

    it('a good read of another Group, or of something under the lost one, reopens nothing', async () => {
      answer(200, groupPayload(KEPT));
      await doc.fetchGroupRead(`/api/groups/${KEPT}`, (payload) =>
        doc.readWebGroupResponse(payload, ACTOR, KEPT),
      );
      answer(200, { data: {} });
      await doc.fetcher(`/api/groups/${LOST}/settlements`);
      expect(stateOf(refused)).toEqual({
        error: expect.objectContaining({ status: 403 }),
      });
    });
  });

  it('a 2xx for the Group that was sent before the loss reopens nothing', async () => {
    let answerLateRead!: () => void;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string) => {
        if (input !== `/api/groups/${LOST}`) return reply(403);
        await new Promise<void>((resolve) => (answerLateRead = resolve));
        return reply(200, groupPayload(LOST));
      }),
    );
    const lateRead = readLostGroup();
    await expect(doc.fetcher(lostContent[3])).rejects.toThrow();
    remember(lostContent[3], {
      error: new doc.HttpResponseError('Forbidden', 403),
    });
    answerLateRead();
    await expect(lateRead).resolves.toMatchObject({ data: { _id: LOST } });
    // It says nothing about access now: what the refused read left stays…
    expect(stateOf(lostContent[3])).toEqual({
      error: expect.objectContaining({ status: 403 }),
    });
    // …until a read sent after the loss succeeds.
    answer(200, groupPayload(LOST));
    await readLostGroup();
    expect(stateOf(lostContent[3])).toEqual({
      data: undefined,
      error: undefined,
    });
  });

  it('a good read of a Group never lost keeps its content', async () => {
    const before = allEntries();
    answer(200, groupPayload(LOST));
    await expect(readLostGroup()).resolves.toMatchObject({
      data: { _id: LOST },
    });
    expect(allEntries()).toEqual(before);
  });

  it('never touches the cache on the server, where every request shares it', async () => {
    vi.stubGlobal('window', undefined);
    const before = allEntries();
    answer(403);
    await expect(doc.fetcher(lostContent[0])).rejects.toMatchObject({
      status: 403,
    });
    expect(allEntries()).toEqual(before);
  });
});
