import { beforeEach, describe, expect, it, vi } from 'vitest';
import mongoose from 'mongoose';
import { headers } from 'next/headers';
import { auth } from '@/lib/auth';
import { balanceService } from '@/lib/services/balance.service';
import { groupService } from '@/lib/services/group.service';
import { expenseService } from '@/lib/services/expense.service';

vi.mock('next/headers', () => ({ headers: vi.fn() }));
vi.mock('@/lib/auth', () => ({ auth: { api: { getSession: vi.fn() } } }));
vi.mock('@/lib/services/balance.service', () => ({
  balanceService: { getUserBalances: vi.fn() },
}));
vi.mock('@/lib/services/group.service', () => ({ groupService: { isMember: vi.fn() } }));
vi.mock('@/lib/services/expense.service', () => ({ expenseService: { create: vi.fn() } }));
vi.mock('@/lib/services/recurring-expense.service', () => ({ recurringExpenseService: {} }));

const { getAuthUser, readJson, routeIds, serverError } = await import('./api-response');
const { DatabaseUnavailableError } = await import('@/lib/mongodb-client');
const balancesRoute = await import('@/app/api/user/balances/route');
const expensesRoute = await import('@/app/api/groups/[id]/expenses/route');

const ALEX = 'a00000000000000000000001';
const SAM = 'a00000000000000000000002';
const GROUP = 'a00000000000000000000010';

describe('serverError', () => {
  it('uses the same typed conflict for an optimistic database revision race', async () => {
    const cause = new Error('Revision race');
    cause.name = 'VersionError';
    const response = serverError(cause);
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ code: 'STALE_REVISION', status: 409 });
  });

  it('answers a service access denial as 403 rather than a server failure', async () => {
    const response = serverError(new Error('FORBIDDEN'));
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: 'Forbidden', code: 'FORBIDDEN', status: 403 });
  });

  it('answers recurring Expenses being switched off as 409 RECURRING_EXPENSES_OFF', async () => {
    const response = serverError(new Error('RECURRING_EXPENSES_OFF'));
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      error: 'Recurring Expenses are turned off.',
      code: 'RECURRING_EXPENSES_OFF',
      status: 409,
    });
  });

  it('keeps unknown failures as a generic 500', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const response = serverError(new Error('Something unexpected'));
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: 'Internal server error', status: 500 });
  });

  it('keeps the server’s own faults as 500 and logs them, never as bad input (#539)', async () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
    logged.mockClear();
    const bsonFault = new Error(
      'input must be a 24 character hex string, 12 byte Uint8Array, or an integer',
    );
    bsonFault.name = 'BSONError';
    const faults = [
      // JSON the server parses itself, such as a stored record.
      new SyntaxError('Unexpected token } in JSON at position 1'),
      // A stored reference that is not an id, failing to cast or to build an ObjectId.
      new mongoose.Error.CastError('ObjectId', 'null', '_id'),
      bsonFault,
    ];
    for (const fault of faults) expect(serverError(fault).status, fault.message).toBe(500);
    expect(logged.mock.calls.map(([, fault]) => fault)).toEqual(faults);
  });

  // The owner's decision of 2026-11-05 (#826, #858, #862): never "Internal server error".
  it.each([
    [
      'a server selection that timed out',
      () =>
        new mongoose.mongo.MongoServerSelectionError('Server selection timed out after 5000 ms', {
          servers: new Map(),
        } as never),
    ],
    ['a connection that broke', () => new mongoose.mongo.MongoNetworkError('read ECONNRESET')],
    // A save's transaction whose connection kept dropping can run out of its 2 s before the
    // driver gives up on the connection: the database still gave no answer.
    [
      'a transaction that ran out of time with no answer',
      () => new mongoose.mongo.MongoOperationTimeoutError('Timed out during socket read (1ms)'),
    ],
    [
      'the one retry’s failure',
      () => new DatabaseUnavailableError(new mongoose.mongo.MongoNetworkError('read ECONNRESET')),
    ],
  ])(
    'answers %s as 503 DATABASE_UNAVAILABLE, in the owner’s words, and logs only the driver’s description',
    async (_, make) => {
      const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
      logged.mockClear();
      const response = serverError(make());
      expect(response.status).toBe(503);
      expect(await response.json()).toEqual({
        error: 'Couldn’t reach Splitbook. Try again.',
        code: 'DATABASE_UNAVAILABLE',
        status: 503,
      });
      expect(logged.mock.calls).toEqual([
        ['Database unreachable:', expect.stringMatching(/^Mongo/)],
      ]);
    },
  );
});

describe('routeIds (#539)', () => {
  it('passes the ids in the address through', async () => {
    const ids = { id: GROUP, expenseId: 'A00000000000000000000099' };
    expect(await routeIds(Promise.resolve(ids))).toEqual(ids);
  });

  it('refuses an address with one id that is not one as INVALID_ID, answered 400', async () => {
    for (const id of ['not-an-id', 'a0000000000000000000001', 'a00000000000000000000010x']) {
      const refused = routeIds(Promise.resolve({ id: GROUP, expenseId: id }));
      await expect(refused, id).rejects.toThrow('INVALID_ID');
    }
    const response = serverError(new Error('INVALID_ID'));
    expect(await response.json()).toEqual({ error: 'Invalid id', status: 400, code: 'INVALID_ID' });
  });
});

describe('readJson (#539)', () => {
  const request = (body: string) =>
    new Request('http://localhost/api/groups', { method: 'POST', body });

  it('reads a JSON body', async () => {
    expect(await readJson(request('{"name":"Lakeview Flat"}'))).toEqual({ name: 'Lakeview Flat' });
  });

  it('refuses a body that is not JSON as INVALID_JSON', async () => {
    await expect(readJson(request('{"name":'))).rejects.toThrow('INVALID_JSON');
  });

  it('leaves any other failure to read the body as the server’s fault', async () => {
    const used = request('{}');
    await used.text();
    await expect(readJson(used)).rejects.toThrow(TypeError);
  });
});

describe('getAuthUser and the page’s expected account', () => {
  /** The browser holds Sam's session; the page may say which account it was rendered for. */
  function request(expectedAccount?: string) {
    vi.mocked(headers).mockResolvedValue(
      new Headers(expectedAccount === undefined ? {} : { 'X-Expected-Account': expectedAccount }),
    );
    vi.mocked(auth.api.getSession).mockResolvedValue({
      user: { id: SAM, name: 'Sam Chen', email: 'sam.demo@splitbook.local', image: null },
    } as never);
  }

  const readBalances = () => balancesRoute.GET(new Request('http://127.0.0.1/api/user/balances'));
  const expenseBody = JSON.stringify({ description: 'Synthetic dinner' });
  const postExpense = () =>
    expensesRoute.POST(
      new Request(`http://127.0.0.1/api/groups/${GROUP}/expenses`, {
        method: 'POST',
        body: expenseBody,
      }),
      { params: Promise.resolve({ id: GROUP }) },
    );

  beforeEach(() => {
    vi.mocked(balanceService.getUserBalances)
      .mockReset()
      .mockResolvedValue({ buckets: [] } as never);
    vi.mocked(groupService.isMember).mockReset().mockResolvedValue(false);
    vi.mocked(expenseService.create).mockReset();
  });

  it('answers 419 ACCOUNT_CHANGED with no data, before any read, when the session is another account', async () => {
    request(ALEX);
    await expect(getAuthUser()).rejects.toThrow('ACCOUNT_CHANGED');

    const read = await readBalances();
    expect(read.status).toBe(419);
    const body = await read.json();
    expect(body).toMatchObject({ code: 'ACCOUNT_CHANGED', status: 419 });
    expect(body).not.toHaveProperty('data');
    expect(balanceService.getUserBalances).not.toHaveBeenCalled();
  });

  it('answers 419 before a write checks membership or records anything', async () => {
    request(ALEX);
    const write = await postExpense();
    expect(write.status).toBe(419);
    const body = await write.json();
    expect(body).toMatchObject({ code: 'ACCOUNT_CHANGED', status: 419 });
    expect(body).not.toHaveProperty('data');
    expect(groupService.isMember).not.toHaveBeenCalled();
    expect(expenseService.create).not.toHaveBeenCalled();
  });

  it('treats a present but empty expected account as a different account', async () => {
    request('');
    expect((await readBalances()).status).toBe(419);
    expect(balanceService.getUserBalances).not.toHaveBeenCalled();
  });

  it('serves the session user as before when the expected account matches', async () => {
    request(SAM);
    await expect(getAuthUser()).resolves.toEqual({
      id: SAM,
      name: 'Sam Chen',
      email: 'sam.demo@splitbook.local',
      image: null,
    });
    const read = await readBalances();
    expect(read.status).toBe(200);
    expect(await read.json()).toEqual({ data: { buckets: [] }, status: 200 });
    expect(balanceService.getUserBalances).toHaveBeenCalledWith(SAM);
    expect((await postExpense()).status).toBe(403);
    expect(groupService.isMember).toHaveBeenCalledWith(GROUP, SAM);
  });

  it('serves the session user as before when no expected account is sent', async () => {
    request();
    await expect(getAuthUser()).resolves.toMatchObject({ id: SAM });
    const read = await readBalances();
    expect(read.status).toBe(200);
    expect(balanceService.getUserBalances).toHaveBeenCalledWith(SAM);
    expect((await postExpense()).status).toBe(403);
    expect(groupService.isMember).toHaveBeenCalledWith(GROUP, SAM);
  });

  it('still answers 401 for a signed-out browser that sends an expected account', async () => {
    vi.mocked(headers).mockResolvedValue(new Headers({ 'X-Expected-Account': ALEX }));
    vi.mocked(auth.api.getSession).mockResolvedValue(null as never);
    await expect(getAuthUser()).resolves.toBeNull();
    expect((await readBalances()).status).toBe(401);
  });
});

// A server page's layout reads the session first (#826): a database it can't reach fails the page
// with the error its boundary knows by digest (`app/error.tsx`), never as an unknown fault.
describe('getAuthUser when the database can’t be reached', () => {
  it('throws a DatabaseUnavailableError, caused by what the session read met', async () => {
    const cause = new mongoose.mongo.MongoServerSelectionError(
      'Server selection timed out after 5000 ms',
      { servers: new Map() } as never,
    );
    vi.mocked(headers).mockResolvedValue(new Headers());
    vi.mocked(auth.api.getSession).mockRejectedValue(cause);
    const thrown = await getAuthUser().catch((error: unknown) => error);
    expect(thrown).toBeInstanceOf(DatabaseUnavailableError);
    expect(thrown).toMatchObject({ digest: 'DATABASE_UNAVAILABLE', cause });
  });

  it('passes the one retry’s own error on as it is, and any other failure too', async () => {
    const unavailable = new DatabaseUnavailableError(new mongoose.mongo.MongoNetworkError('x'));
    vi.mocked(headers).mockResolvedValue(new Headers());
    vi.mocked(auth.api.getSession).mockRejectedValueOnce(unavailable);
    await expect(getAuthUser()).rejects.toBe(unavailable);
    const other = new Error('Something unexpected');
    vi.mocked(auth.api.getSession).mockRejectedValueOnce(other);
    await expect(getAuthUser()).rejects.toBe(other);
  });
});
