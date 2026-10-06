import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const ALEX = 'a00000000000000000000001';
const SAM = 'a00000000000000000000002';

/** Each test gets a fresh document: the pinned account is per page load. */
async function freshDocument() {
  vi.resetModules();
  const reload = vi.fn();
  const assign = vi.fn();
  vi.stubGlobal('window', { location: { pathname: '/dashboard', search: '', reload, assign } });
  const apiFetch = await import('./api-fetch');
  const { fetcher } = await import('./fetcher');
  return { ...apiFetch, fetcher, reload, assign };
}

function answer(status: number, body: unknown = {}) {
  const fetchMock = vi.fn().mockResolvedValue(
    new Response(JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json' },
    }),
  );
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

function sentHeaders(fetchMock: ReturnType<typeof vi.fn>, call = 0) {
  return new Headers((fetchMock.mock.calls[call][1] as RequestInit | undefined)?.headers);
}

/** Settles with the promise's outcome, or 'pending' if it has not settled after the queue drains. */
async function outcome(promise: Promise<unknown>) {
  const pending = Symbol('pending');
  const result = await Promise.race([
    promise.then(
      (value) => ({ resolved: value }),
      (error: unknown) => ({ rejected: error }),
    ),
    new Promise((resolve) => setTimeout(() => resolve(pending), 20)),
  ]);
  return result === pending ? 'pending' : result;
}

const accountChanged = {
  error: 'The signed-in account changed in another tab. Reload this page to continue.',
  status: 419,
  code: 'ACCOUNT_CHANGED',
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('apiFetch', () => {
  let doc: Awaited<ReturnType<typeof freshDocument>>;
  beforeEach(async () => {
    doc = await freshDocument();
  });

  it('sends the pinned account with every API request, keeping the caller’s headers', async () => {
    doc.pinExpectedAccount(ALEX);
    const fetchMock = answer(201, { data: { _id: 'e1' } });
    const response = await doc.apiFetch('/api/groups/g1/expenses', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Idempotency-Key': 'k1' },
      body: '{}',
    });
    expect(response.status).toBe(201);
    expect(fetchMock.mock.calls[0][0]).toBe('/api/groups/g1/expenses');
    expect(fetchMock.mock.calls[0][1]).toMatchObject({ method: 'POST', body: '{}' });
    const headers = sentHeaders(fetchMock);
    expect(headers.get('X-Expected-Account')).toBe(ALEX);
    expect(headers.get('Idempotency-Key')).toBe('k1');
    expect(headers.get('Content-Type')).toBe('application/json');
  });

  it('keeps the first account pinned in the document and reports a different one', () => {
    expect(doc.pinExpectedAccount(ALEX)).toBe(true);
    expect(doc.pinExpectedAccount(ALEX)).toBe(true);
    expect(doc.pinExpectedAccount(SAM)).toBe(false);
    const fetchMock = answer(200);
    void doc.apiFetch('/api/user/balances');
    expect(sentHeaders(fetchMock).get('X-Expected-Account')).toBe(ALEX);
  });

  it('sends no expected account before a page pins one, or outside the app API', async () => {
    const fetchMock = answer(200);
    await doc.apiFetch('/api/join/abc');
    expect(sentHeaders(fetchMock).has('X-Expected-Account')).toBe(false);
    doc.pinExpectedAccount(ALEX);
    await doc.apiFetch('/api/auth/get-session');
    await doc.apiFetch('https://example.test/api/groups');
    expect(sentHeaders(fetchMock, 1).has('X-Expected-Account')).toBe(false);
    expect(sentHeaders(fetchMock, 2).has('X-Expected-Account')).toBe(false);
  });

  it('reloads on 419 and hands a write dialog neither a response nor an error', async () => {
    doc.pinExpectedAccount(ALEX);
    answer(419, accountChanged);
    const write = doc.apiFetch('/api/groups/g1/settlements', { method: 'POST', body: '{}' });
    expect(await outcome(write)).toBe('pending');
    expect(doc.reload).toHaveBeenCalledTimes(1);
    expect(doc.assign).not.toHaveBeenCalled();
  });

  it('does not race an intentional sign-out in this tab with a reload', async () => {
    doc.pinExpectedAccount(ALEX);
    doc.leaveExpectedAccount();
    answer(419, accountChanged);
    expect(await outcome(doc.apiFetch('/api/user/balances'))).toBe('pending');
    doc.reloadForAccountChange();
    expect(doc.reload).not.toHaveBeenCalled();
  });

  it('returns every other answer to the caller unchanged', async () => {
    doc.pinExpectedAccount(ALEX);
    answer(409, { error: 'Stale', code: 'STALE_REVISION' });
    const response = await doc.apiFetch('/api/groups/g1/expenses/e1', { method: 'PATCH' });
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ code: 'STALE_REVISION' });
    expect(doc.reload).not.toHaveBeenCalled();
  });
});

describe('fetcher through apiFetch', () => {
  let doc: Awaited<ReturnType<typeof freshDocument>>;
  beforeEach(async () => {
    doc = await freshDocument();
    doc.pinExpectedAccount(ALEX);
  });

  it('sends the expected account with SWR reads', async () => {
    const fetchMock = answer(200, { data: { buckets: [] } });
    await expect(doc.fetcher('/api/user/balances')).resolves.toEqual({ data: { buckets: [] } });
    expect(sentHeaders(fetchMock).get('X-Expected-Account')).toBe(ALEX);
  });

  it('passes no data and no error to SWR on 419, and reloads', async () => {
    answer(419, accountChanged);
    expect(await outcome(doc.fetcher('/api/user/balances'))).toBe('pending');
    expect(doc.reload).toHaveBeenCalledTimes(1);
    expect(doc.assign).not.toHaveBeenCalled();
  });

  it('still sends a signed-out session to /login on 401', async () => {
    answer(401, { error: 'Unauthorized', status: 401 });
    await expect(doc.fetcher('/api/user/balances')).rejects.toThrow('Unauthorized');
    expect(doc.assign).toHaveBeenCalledWith('/login?callbackUrl=%2Fdashboard');
    expect(doc.reload).not.toHaveBeenCalled();
  });

  it('notes when a read last answered, for Home’s "Updated" time, and only when it succeeded', async () => {
    const times = await import('./read-times');
    const heard = vi.fn();
    const stop = times.subscribeToAnswers(heard);
    expect(times.lastAnswered('/api/user/balances')).toBeNull();

    answer(500, { error: 'Internal diagnostic' });
    await expect(doc.fetcher('/api/user/balances')).rejects.toThrow();
    expect(times.lastAnswered('/api/user/balances')).toBeNull();
    expect(heard).not.toHaveBeenCalled();

    const before = Date.now();
    answer(200, { data: { buckets: [] } });
    await doc.fetcher('/api/user/balances');
    expect(times.lastAnswered('/api/user/balances')).toBeGreaterThanOrEqual(before);
    expect(times.lastAnswered('/api/invitations')).toBeNull();
    expect(heard).toHaveBeenCalledTimes(1);

    stop();
    await doc.fetcher('/api/user/balances');
    expect(heard).toHaveBeenCalledTimes(1);
  });
});
