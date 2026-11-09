import { describe, expect, it } from 'vitest';
import { savedQueriesIn } from '../test-utils/saved-queries';
import {
  createSavedCopyQueue,
  createSavedReadEngine,
  rowPaths,
  parseOnce,
} from './saved-read-engine';
import { RequestError, Superseded } from './transport';
import type { RefusalRule, SavedReadPorts } from './saved-read-engine';
import type { MobileSnapshot } from './types';
import { QueryClient, QueryObserver, focusManager, onlineManager } from '@tanstack/query-core';
import { expenseRecordKey, queryKeyPath, type QueryKey } from '@splitbook/shared/query-keys';
import { followInjectedClock } from '../test-utils/query-clock';

describe('the saved-copy queue', () => {
  it('keeps the latest queued wire row per query', async () => {
    const rows = savedQueriesIn(new Map());
    const queue = createSavedCopyQueue();
    queue.push('/api/groups', () =>
      rows.save('account', '/api/groups', { time: 10, value: 'old' }),
    );
    queue.push('/api/groups', () =>
      rows.save('account', '/api/groups', { time: 20, value: 'new' }),
    );
    await queue.idle();
    expect(await rows.load('account', '/api/groups')).toEqual({ time: 20, value: 'new' });
  });
});

const deferred = () => {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
};

it('replaces a queued row behind a slow write without waiting for the discarded write', async () => {
  const rows = savedQueriesIn(new Map());
  const queue = createSavedCopyQueue();
  const started = deferred(),
    slow = deferred(),
    discarded = deferred();
  queue.push('/api/slow', async () => {
    started.resolve();
    await slow.promise;
    await rows.save('account', '/api/slow', { time: 10 });
  });
  await started.promise;
  queue.push('/api/groups', async () => {
    await discarded.promise;
    await rows.save('account', '/api/groups', { time: 20 });
  });
  queue.push('/api/groups', () => rows.save('account', '/api/groups', { time: 30 }));
  slow.resolve();
  try {
    await queue.idle();
    expect(await rows.load('account', '/api/groups')).toEqual({ time: 30 });
    expect(await rows.load('account', '/api/slow')).toEqual({ time: 10 });
  } finally {
    discarded.resolve();
  }
});

it('cancels waiting copies while allowing the running write to finish', async () => {
  const rows = savedQueriesIn(new Map());
  const queue = createSavedCopyQueue();
  const started = deferred(),
    slow = deferred();
  queue.push('/api/running', async () => {
    started.resolve();
    await slow.promise;
    await rows.save('account', '/api/running', { time: 10 });
  });
  await started.promise;
  queue.push('/api/groups', () => rows.save('account', '/api/groups', { time: 20 }));
  queue.cancel();
  slow.resolve();
  await queue.idle();
  expect(await rows.load('account', '/api/running')).toEqual({ time: 10 });
  expect(await rows.load('account', '/api/groups')).toBeNull();
});

it('drops just the named queued row and continues after a storage failure', async () => {
  const rows = savedQueriesIn(new Map());
  const queue = createSavedCopyQueue();
  queue.push('/api/failure', async () => {
    throw new Error('device unavailable');
  });
  queue.push('/api/drop', () => rows.save('account', '/api/drop', { time: 10 }));
  queue.push('/api/keep', () => rows.save('account', '/api/keep', { time: 20 }));
  queue.drop('/api/drop');
  await queue.idle();
  expect(await rows.load('account', '/api/drop')).toBeNull();
  expect(await rows.load('account', '/api/keep')).toEqual({ time: 20 });
});

describe('saved reads', () => {
  it('answers with wire JSON and saves its verification time through the query', async () => {
    const f = engineFixture();
    const answer = await f.client.fetchQuery({
      queryKey: f.key,
      queryFn: () => f.engine.read({ key: f.key, accept: () => undefined }),
    });
    await f.engine.idle();
    expect(answer).toEqual({
      source: 'network',
      refreshedAt: 1000,
      value: { title: 'Read answer' },
    });
    expect(await f.rows.load('account', f.path)).toEqual({
      version: 1,
      accountId: 'account',
      path: f.path,
      groupId: f.group,
      refreshedAt: 1000,
      value: { title: 'Read answer' },
    });
    f.stop();
    f.client.clear();
  });
});

function engineFixture(rule: RefusalRule = 'forbidden-only') {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, networkMode: 'always', gcTime: Infinity } },
  });
  const rows = savedQueriesIn(new Map());
  const group = '111111111111111111111111',
    expense = '222222222222222222222222';
  const initialRead: SavedReadPorts['read'] = async () => ({ title: 'Read answer' });
  const initialReport: SavedReadPorts['answered'] = () => undefined;
  const state = {
    accountId: 'account',
    generation: 1,
    signedIn: true,
    offline: false,
    kept: true,
    time: 1000,
    mark: -Infinity,
    notice: null as string | null,
    read: initialRead,
  };
  const account = () => ({ environment: 'http://local', accountId: state.accountId });
  const key = expenseRecordKey(account(), group, expense),
    path = queryKeyPath(key);
  const current = (owner: number) => state.signedIn && owner === state.generation;
  const now = () => state.time;
  followInjectedClock({ now });
  const journal = new Map<string, number>();
  const ports = {
    client,
    rows,
    account,
    generation: () => state.generation,
    current,
    lease: () =>
      state.signedIn
        ? {
            accountId: state.accountId,
            write: async <T>(op: () => Promise<T>) => op(),
            writeSavedCopy: async <T>(op: () => Promise<T>) => op(),
          }
        : null,
    owns: (id: string) => state.signedIn && id === state.accountId,
    distrusted: (key: QueryKey) =>
      Math.max(state.mark, journal.get(`${key[2]}:${key[0]}:${key[3]}`) ?? -Infinity),
    distrust: (accountId: string, scopes: string[]) => {
      for (const scope of scopes) journal.set(`${accountId}:${scope}`, Infinity);
    },
    savable: () => state.kept,
    offline: () => state.offline,
    read: (path: string, owner: number, signal?: AbortSignal) => state.read(path, owner, signal),
    answered: initialReport,
    now,
    snapshot: () => ({
      offline: { active: state.offline, refreshedAt: null, message: state.notice },
    }),
    publish: (next: Partial<MobileSnapshot>) => {
      state.notice = next.offline?.message ?? null;
    },
    freshness: 30_000,
  };
  const engine = createSavedReadEngine(ports, {
    path: (key, page) =>
      page === undefined ? queryKeyPath(key) : queryKeyPath(key) + '?page=' + page,
    readable: (_key, value) => !!value && typeof value === 'object' && 'title' in value,
    ownsKey: (key) => key[0] === 'ledger',
    rowScope: {
      groupId: (key) => key[3] as string,
      remove: async (store, id, group, known) => {
        for (const path of await rowPaths(store, id, known))
          if (path.startsWith(`/api/groups/${group}/`)) await store.remove(id, path);
      },
      pathGroup: (path) => /^\/api\/groups\/([^/]+)\//.exec(path)?.[1] ?? null,
      distrust: (key) => [`ledger:${key[3]}`],
    },
    refusal: rule,
    preview: 'same-run-unanswered',
    automaticRefetch: false,
    cancelOnRemove: true,
    staleWhenOffline: true,
  });
  const stop = engine.listen();
  const fetch = (accept: (value: unknown) => void | Promise<void> = () => undefined) => {
    const options = { queryKey: key, queryFn: () => engine.read({ key, accept }) };
    return engine.readNow(options, state.generation, () => false);
  };
  const seed = (refreshedAt = 500, value: unknown = { title: 'Saved answer' }) =>
    rows.save(state.accountId, path, {
      version: 1,
      accountId: state.accountId,
      path,
      groupId: group,
      refreshedAt,
      value,
    });
  return { client, rows, engine, key, path, group, state, ports, fetch, seed, stop };
}

it('restores a preview with its original time while the first read is pending', async () => {
  const f = engineFixture();
  await f.seed();
  const answer = deferredValue<unknown>();
  f.state.read = () => answer.promise;
  const reading = f.fetch();
  await f.engine.restore(f.key, 1);
  expect(f.client.getQueryData(f.key)).toEqual({
    source: 'saved',
    refreshedAt: 500,
    value: { title: 'Saved answer' },
  });
  answer.resolve({ title: 'New answer' });
  await reading;
  await f.engine.idle();
  f.stop();
  f.client.clear();
});

function deferredValue<T>() {
  let resolve!: (value: T) => void, reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

const offlineFailure = () => new RequestError('No connection', 0, null, true);

it('answers an offline restart from the saved wire row with its original time, never fresh', async () => {
  const f = engineFixture();
  await f.seed();
  f.state.read = async () => {
    throw offlineFailure();
  };
  f.state.offline = true;
  const answer = await f.fetch();
  expect(answer).toEqual({ source: 'saved', refreshedAt: 500, value: { title: 'Saved answer' } });
  expect(f.engine.shared.staleTime(f.client.getQueryCache().find({ queryKey: f.key })!)).toBe(
    -Infinity,
  );
  f.state.offline = false;
  f.state.read = async () => ({ title: 'Reconnected' });
  await f.fetch();
  await f.engine.idle();
  expect(await f.rows.load('account', f.path)).toMatchObject({
    refreshedAt: 1000,
    value: { title: 'Reconnected' },
  });
  f.stop();
  f.client.clear();
});

it.each([499, 500])(
  'refuses a saved row at time %i which is not newer than the distrust mark',
  async (time) => {
    const f = engineFixture();
    await f.seed(time);
    f.state.mark = 500;
    f.state.read = async () => {
      throw offlineFailure();
    };
    await expect(f.fetch()).rejects.toMatchObject({ code: 'OFFLINE_UNAVAILABLE' });
    expect(f.client.getQueryData(f.key)).toBeUndefined();
    f.stop();
    f.client.clear();
  },
);

it('does not restore an unreadable saved row or use it as an offline answer', async () => {
  const f = engineFixture();
  await f.seed(500, { wrong: 'format' });
  await f.engine.restore(f.key, 1);
  expect(f.client.getQueryData(f.key)).toBeUndefined();
  f.state.read = async () => {
    throw offlineFailure();
  };
  await expect(f.fetch()).rejects.toMatchObject({ code: 'OFFLINE_UNAVAILABLE' });
  f.stop();
  f.client.clear();
});

it('keeps a fallback invalidated and reports the saved verification time', async () => {
  const f = engineFixture();
  await f.seed();
  const reports: { path: string; saved?: number | null }[] = [];
  f.ports.answered = (path, saved) => {
    reports.push({ path, saved });
  };
  f.client.getQueryCache().build(f.client, { queryKey: f.key }).invalidate();
  f.state.read = async () => {
    throw offlineFailure();
  };
  await f.fetch();
  await Promise.resolve();
  expect(f.client.getQueryState(f.key)?.isInvalidated).toBe(true);
  expect(reports).toEqual([{ path: f.path, saved: 500 }]);
  f.stop();
  f.client.clear();
});

it.each(['sign-out', 'account-change', 'query-removal'] as const)(
  'refuses a late answer after %s',
  async (change) => {
    const f = engineFixture();
    const answer = deferredValue<unknown>();
    f.state.read = () => answer.promise;
    const reading = f.fetch();
    if (change === 'sign-out') f.state.signedIn = false;
    if (change === 'account-change') {
      f.state.accountId = 'another';
      f.state.generation++;
    }
    if (change === 'query-removal') f.client.removeQueries({ queryKey: f.key });
    const refused = expect(reading).rejects.toBeInstanceOf(Superseded);
    answer.resolve({ title: 'Late' });
    await refused;
    await f.engine.idle();
    expect(await f.rows.load('account', f.path)).toBeNull();
    f.stop();
    f.client.clear();
  },
);

it.each(['session-end', 'query-replacement'])(
  'rechecks ownership after asynchronous acceptance: %s',
  async (change) => {
    const f = engineFixture();
    const accepting = deferred(),
      started = deferred();
    const reading = f.fetch(async () => {
      started.resolve();
      await accepting.promise;
    });
    await started.promise;
    if (change === 'session-end') f.state.generation++;
    else f.client.removeQueries({ queryKey: f.key });
    const refused = expect(reading).rejects.toBeInstanceOf(Superseded);
    accepting.resolve();
    await refused;
    expect(f.client.getQueryData(f.key)).toBeUndefined();
    expect(await f.rows.load('account', f.path)).toBeNull();
    f.stop();
    f.client.clear();
  },
);

it('does not let a late disk preview replace a failed read', async () => {
  const f = engineFixture();
  await f.seed();
  const load = deferredValue<unknown>(),
    original = f.rows.load;
  f.rows.load = () => load.promise;
  const preview = f.engine.restore(f.key, 1);
  f.state.read = async () => {
    throw new RequestError('Server failure', 500);
  };
  await expect(f.fetch()).rejects.toMatchObject({ status: 500 });
  load.resolve(await original('account', f.path));
  await preview;
  expect(f.client.getQueryData(f.key)).toBeUndefined();
  f.stop();
  f.client.clear();
});

it('does not let a preview from an earlier run replace the newer unanswered run', async () => {
  const f = engineFixture();
  await f.seed();
  const load = deferredValue<unknown>(),
    answer = deferredValue<unknown>(),
    next = deferredValue<unknown>(),
    original = f.rows.load;
  f.rows.load = () => load.promise;
  f.state.read = () => answer.promise;
  const first = f.fetch().catch(() => undefined),
    preview = f.engine.restore(f.key, 1);
  await f.client.cancelQueries({ queryKey: f.key });
  f.state.read = () => next.promise;
  const second = f.fetch();
  load.resolve(await original('account', f.path));
  await preview;
  expect(f.client.getQueryData(f.key)).toBeUndefined();
  next.resolve({ title: 'New' });
  answer.resolve({ title: 'Old' });
  await Promise.all([first, second]);
  f.stop();
  f.client.clear();
});

it('checks preview distrust and current ownership again after disk loading', async () => {
  const f = engineFixture();
  await f.seed();
  const load = deferredValue<unknown>(),
    original = f.rows.load;
  f.rows.load = () => load.promise;
  const preview = f.engine.restore(f.key, 1);
  f.state.mark = Infinity;
  load.resolve(await original('account', f.path));
  await preview;
  expect(f.client.getQueryData(f.key)).toBeUndefined();
  f.stop();
  f.client.clear();
});

it.each([
  ['network', 1000, false, 30000],
  ['saved', 1000, false, -Infinity],
  ['network', 1001, false, -Infinity],
  ['network', 1000, true, -Infinity],
] as const)('freshness for %s at %i while offline=%s is %i', (source, time, offline, expected) => {
  const f = engineFixture();
  f.state.offline = offline;
  f.client.setQueryData(f.key, { source, refreshedAt: time, value: {} }, { updatedAt: time });
  expect(f.engine.shared.staleTime(f.client.getQueryCache().find({ queryKey: f.key })!)).toBe(
    expected,
  );
  f.stop();
  f.client.clear();
});

it.each(['forbidden-only', 'forbidden-or-missing'] as const)(
  'preserves the %s refusal rule and never saves a refusal',
  async (rule) => {
    const f = engineFixture(rule);
    expect(f.engine.refuses(new RequestError('Denied', 403))).toBe(true);
    expect(f.engine.refuses(new RequestError('Gone', 404))).toBe(rule === 'forbidden-or-missing');
    expect(f.engine.refuses(new RequestError('Failure', 500))).toBe(false);
    f.state.read = async () => {
      throw new RequestError('Gone', 404);
    };
    await expect(f.fetch()).rejects.toMatchObject({ status: 404 });
    await f.engine.idle();
    expect(await f.rows.load('account', f.path)).toBeNull();
    f.stop();
    f.client.clear();
  },
);

it.each(['forget', 'retain'] as const)(
  'removes a row that lands after its Group was removed by %s',
  async (removal) => {
    const f = engineFixture(),
      started = deferred(),
      slow = deferred(),
      save = f.rows.save;
    f.rows.save = async (...args) => {
      started.resolve();
      await slow.promise;
      await save(...args);
    };
    await f.fetch();
    await started.promise;
    if (removal === 'forget') await f.engine.forget('account', f.group);
    else await f.engine.retain('account', []);
    slow.resolve();
    await f.engine.idle();
    expect(await f.rows.load('account', f.path)).toBeNull();
    f.stop();
    f.client.clear();
  },
);

it('distrusts a late row whose removal fails, so it cannot answer offline', async () => {
  const f = engineFixture(),
    started = deferred(),
    slow = deferred(),
    save = f.rows.save,
    remove = f.rows.remove;
  f.rows.save = async (...args) => {
    started.resolve();
    await slow.promise;
    await save(...args);
  };
  f.rows.remove = async (account, path) => {
    if (await f.rows.load(account, path)) throw new Error('cannot remove');
    await remove(account, path);
  };
  await f.fetch();
  await started.promise;
  await f.engine.forget('account', f.group);
  slow.resolve();
  await f.engine.idle();
  expect(await f.rows.load('account', f.path)).toMatchObject({ value: { title: 'Read answer' } });
  f.state.read = async () => {
    throw offlineFailure();
  };
  await expect(f.fetch()).rejects.toMatchObject({ code: 'OFFLINE_UNAVAILABLE' });
  f.stop();
  f.client.clear();
});

it.each(['sign-out', 'account-change'] as const)(
  'cancels queued rows and drains the running row before the %s purge',
  async (change) => {
    const f = engineFixture(),
      started = deferred(),
      slow = deferred(),
      save = f.rows.save;
    f.rows.save = async (...args) => {
      started.resolve();
      await slow.promise;
      await save(...args);
    };
    await f.fetch();
    await started.promise;
    const next = expenseRecordKey(f.ports.account(), f.group, '333333333333333333333333');
    await f.client.fetchQuery({
      queryKey: next,
      queryFn: () => f.engine.read({ key: next, accept: () => undefined }),
    });
    if (change === 'sign-out') f.state.signedIn = false;
    else {
      f.state.accountId = 'another';
      f.state.generation++;
    }
    f.engine.reset();
    f.client.clear();
    slow.resolve();
    await f.engine.idle();
    expect(await f.rows.load('account', queryKeyPath(next))).toBeNull();
    // Account purge remains the caller's responsibility; it follows the saved-copy lane draining.
    await f.rows.clear();
    expect(await f.rows.list!('account')).toEqual([]);
    f.stop();
  },
);

it.each(['not-kept', 'query-replaced', 'account-owner-changed'] as const)(
  'checks %s at write time for a queued row',
  async (change) => {
    const f = engineFixture(),
      started = deferred(),
      slow = deferred(),
      save = f.rows.save;
    f.rows.save = async (...args) => {
      started.resolve();
      await slow.promise;
      await save(...args);
    };
    await f.fetch();
    await started.promise;
    const next = expenseRecordKey(f.ports.account(), f.group, '333333333333333333333333');
    await f.client.fetchQuery({
      queryKey: next,
      queryFn: () => f.engine.read({ key: next, accept: () => undefined }),
    });
    if (change === 'not-kept') f.state.kept = false;
    if (change === 'query-replaced') {
      f.client.removeQueries({ queryKey: next });
      f.client.getQueryCache().build(f.client, { queryKey: next });
    }
    if (change === 'account-owner-changed') f.state.accountId = 'another';
    slow.resolve();
    await f.engine.idle();
    expect(await f.rows.load('account', queryKeyPath(next))).toBeNull();
    f.stop();
    f.client.clear();
  },
);

it('publishes the existing offline-save notice without refusing the network answer', async () => {
  const f = engineFixture();
  f.rows.save = async () => {
    throw new Error('full device');
  };
  await expect(f.fetch()).resolves.toMatchObject({
    source: 'network',
    value: { title: 'Read answer' },
  });
  await f.engine.idle();
  expect(f.state.notice).toBe(
    'Could not save this view for offline use. Online data is still available.',
  );
  expect(f.state.signedIn).toBe(true);
  f.stop();
  f.client.clear();
});

it('aborts a removed query so a cancelled caller can finish without a transport answer', async () => {
  const f = engineFixture(),
    started = deferred();
  f.state.read = (_path, _owner, signal) =>
    new Promise((_resolve, reject) => {
      started.resolve();
      signal!.addEventListener('abort', () =>
        reject(new RequestError('Cancelled', 0, null, false, null, 'cancelled')),
      );
    });
  const reading = f.fetch(),
    refused = expect(reading).rejects.toBeInstanceOf(Superseded);
  await started.promise;
  f.client.removeQueries({ queryKey: f.key });
  await refused;
  expect(await f.rows.load('account', f.path)).toBeNull();
  f.stop();
  f.client.clear();
});

it('leaves unrelated Group rows in place when a scope is removed', async () => {
  const f = engineFixture();
  await f.seed();
  const other = '/api/groups/333333333333333333333333/expenses/444444444444444444444444';
  await f.rows.save('account', other, { title: 'Other Group' });
  await f.engine.forget('account', f.group);
  expect(await f.rows.load('account', f.path)).toBeNull();
  expect(await f.rows.load('account', other)).toEqual({ title: 'Other Group' });
  f.stop();
  f.client.clear();
});

it('parses once per wire object and scope, retaining falsy results too', () => {
  const parse = parseOnce((_value, scope) => ({ scope }));
  const wire = {};
  expect(parse(wire, 'record')).toBe(parse(wire, 'record'));
  expect(parse(wire, 'record')).not.toBe(parse(wire, 'history'));
  expect(parse(wire, 'record')).not.toBe(parse({}, 'record'));
  let result = 0;
  const nullable = parseOnce(() => (result++ === 0 ? null : 'parsed twice'));
  expect(nullable(wire, 'record')).toBeNull();
  expect(nullable(wire, 'record')).toBeNull();
});

it.each(['sign-out', 'account-change', 'query-removal'] as const)(
  'does not publish a disk preview overtaken by %s',
  async (change) => {
    const f = engineFixture();
    await f.seed();
    const load = deferredValue<unknown>(),
      original = f.rows.load;
    f.rows.load = () => load.promise;
    const preview = f.engine.restore(f.key, 1);
    if (change === 'sign-out') f.state.signedIn = false;
    if (change === 'account-change') {
      f.state.accountId = 'another';
      f.state.generation++;
    }
    if (change === 'query-removal') f.client.removeQueries({ queryKey: f.key });
    load.resolve(await original('account', f.path));
    await preview;
    expect(f.client.getQueryData(f.key)).toBeUndefined();
    f.stop();
    f.client.clear();
  },
);

it('saves each page as its own wire row with its own verification time', async () => {
  const f = engineFixture();
  const answer = await f.client.fetchInfiniteQuery({
    queryKey: f.key,
    queryFn: ({ pageParam }) =>
      f.engine.read({
        key: f.key,
        page: pageParam,
        accept: () => undefined,
        project: (copy) => ({ ...copy, page: pageParam }),
      }),
    initialPageParam: 1,
    getNextPageParam: () => undefined,
  });
  await f.engine.idle();
  expect(answer.pages).toEqual([
    { source: 'network', refreshedAt: 1000, value: { title: 'Read answer' }, page: 1 },
  ]);
  expect(await f.rows.load('account', f.path + '?page=1')).toEqual({
    version: 1,
    accountId: 'account',
    path: f.path + '?page=1',
    groupId: f.group,
    refreshedAt: 1000,
    value: { title: 'Read answer' },
  });
  expect(await f.rows.load('account', f.path)).toBeNull();
  f.stop();
  f.client.clear();
});

it('leaves automatic mount, focus and reconnect re-reads to the view', async () => {
  const f = engineFixture();
  await f.fetch();
  await f.engine.idle();
  f.state.time = 31_001;
  f.state.read = async () => ({ title: 'New answer' });
  f.client.mount();
  const observer = new QueryObserver(f.client, {
    ...f.engine.shared,
    queryKey: f.key,
    queryFn: () => f.engine.read({ key: f.key, accept: () => undefined }),
  });
  const stop = observer.subscribe(() => undefined);
  try {
    focusManager.setFocused(false);
    focusManager.setFocused(true);
    onlineManager.setOnline(false);
    onlineManager.setOnline(true);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(f.client.getQueryData(f.key)).toMatchObject({ value: { title: 'Read answer' } });
    await observer.refetch();
    expect(f.client.getQueryData(f.key)).toMatchObject({ value: { title: 'New answer' } });
  } finally {
    stop();
    observer.destroy();
    f.client.unmount();
    f.stop();
    f.client.clear();
  }
});
