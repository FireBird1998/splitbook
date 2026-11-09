import { describe, expect, it } from 'vitest';
import { savedQueriesIn } from '../test-utils/saved-queries';
import { createSavedCopyQueue, createSavedReadEngine, rowPaths } from './saved-read-engine';
import { QueryClient } from '@tanstack/query-core';
import { expenseRecordKey, queryKeyPath } from '@splitbook/shared/query-keys';
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

function engineFixture() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, networkMode: 'always', gcTime: Infinity } },
  });
  const rows = savedQueriesIn(new Map());
  const group = '111111111111111111111111',
    expense = '222222222222222222222222';
  const account = { environment: 'http://local', accountId: 'account' };
  const key = expenseRecordKey(account, group, expense),
    path = queryKeyPath(key);
  const offline = { active: false, refreshedAt: null, message: null };
  const now = () => 1000;
  followInjectedClock({ now });
  const lease = {
    accountId: 'account',
    write: async <T>(op: () => Promise<T>) => op(),
    writeSavedCopy: async <T>(op: () => Promise<T>) => op(),
  };
  const engine = createSavedReadEngine(
    {
      client,
      rows,
      account: () => account,
      generation: () => 1,
      current: (owner) => owner === 1,
      lease: () => lease,
      owns: (id) => id === 'account',
      distrusted: () => -Infinity,
      distrust: () => undefined,
      savable: () => true,
      offline: () => false,
      read: async () => ({ title: 'Read answer' }),
      answered: () => undefined,
      now,
      snapshot: () => ({ offline }),
      publish: () => undefined,
      freshness: 30_000,
    },
    {
      path: queryKeyPath,
      readable: () => true,
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
      refusal: 'forbidden-only',
      preview: 'same-run-unanswered',
      automaticRefetch: false,
      cancelOnRemove: true,
      staleWhenOffline: true,
      recover: async () => undefined,
    },
  );
  return { client, rows, engine, key, path, group, stop: engine.listen() };
}
