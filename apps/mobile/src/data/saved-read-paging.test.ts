import { expect, it } from 'vitest';
import { InfiniteQueryObserver, QueryClient } from '@tanstack/query-core';
import { expensePageKey, queryKeyPath } from '@splitbook/shared/query-keys';
import { savedQueriesIn } from '../test-utils/saved-queries';
import { followInjectedClock } from '../test-utils/query-clock';
import { createSavedReadEngine, type RefusalRule } from './saved-read-engine';
import { RequestError } from './transport';

type Wire = {
  items: { id: string; text: string }[];
  pagination: { page: number; totalPages: number };
};
function fixture(refusal: RefusalRule = 'forbidden-or-missing') {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, networkMode: 'always', gcTime: Infinity } },
  });
  const rows = savedQueriesIn(new Map());
  const account = { environment: 'http://local', accountId: 'account' },
    group = '111111111111111111111111';
  const key = expensePageKey(account, group, { limit: 20 });
  const path = (page: number) => queryKeyPath(key).replace('/expenses?', `/expenses?page=${page}&`);
  const state = {
    time: 1000,
    offline: false,
    read: async (page: number): Promise<Wire> => ({
      items: [{ id: String(page), text: `Page ${page}` }],
      pagination: { page, totalPages: 8 },
    }),
  };
  followInjectedClock({ now: () => state.time });
  const engine = createSavedReadEngine(
    {
      client,
      rows,
      account: () => account,
      generation: () => 1,
      current: () => true,
      lease: () => ({
        accountId: 'account',
        write: async <T>(op: () => Promise<T>) => op(),
        writeSavedCopy: async <T>(op: () => Promise<T>) => op(),
      }),
      owns: () => true,
      distrusted: () => -Infinity,
      distrust: () => undefined,
      savable: () => true,
      offline: () => state.offline,
      freshness: 30000,
      read: (path) => state.read(Number(new URL(path, 'http://local').searchParams.get('page'))),
      answered: () => undefined,
      now: () => state.time,
      snapshot: () => ({ offline: { active: false, refreshedAt: null, message: null } }),
      publish: () => undefined,
    },
    {
      path: (_key, page = 1) => path(page),
      readable: (_key, value) => !!(value as Wire)?.pagination,
      ownsKey: () => true,
      rowScope: {
        groupId: () => group,
        remove: async (store, id, _group, known) => {
          for (const path of known) await store.remove(id, path);
        },
        pathGroup: () => group,
        distrust: () => [`ledger:${group}`],
      },
      refusal,
      preview: 'same-run-unanswered',
      automaticRefetch: false,
      cancelOnRemove: true,
      staleWhenOffline: true,
    },
  );
  const paging = engine.paging({
    pagination: (_key, value) => (value as Wire).pagination,
    failedMessage: () => 'Could not load older.',
    reopen: 'multiple-pages',
  });
  const options = {
    ...engine.shared,
    ...paging.options(key),
    queryKey: key,
    queryFn: (context: { queryKey: typeof key; pageParam: unknown }) =>
      paging.read(context, { accept: () => undefined }),
  };
  const observer = new InfiniteQueryObserver(client, options);
  const stopSaving = engine.listen();
  const stop = observer.subscribe(() => undefined);
  return {
    client,
    rows,
    engine,
    paging,
    observer,
    state,
    key,
    path,
    options,
    stop: () => {
      stop();
      observer.destroy();
      stopSaving();
      client.clear();
    },
  };
}

it('slides the five-page window and loads page one again with Load newer', async () => {
  const f = fixture();
  try {
    await f.client.fetchInfiniteQuery(f.options);
    for (let page = 2; page <= 6; page++) await f.paging.older(f.key, () => f.observer);
    expect(f.observer.getCurrentResult().data?.pageParams).toEqual([2, 3, 4, 5, 6]);
    await f.paging.newer(f.key, () => f.observer);
    expect(f.observer.getCurrentResult().data?.pageParams).toEqual([1, 2, 3, 4, 5]);
    await f.engine.idle();
    expect(await f.rows.load('account', f.path(6))).toMatchObject({
      refreshedAt: 1000,
      value: { items: [{ id: '6', text: 'Page 6' }] },
    });
  } finally {
    f.stop();
  }
});
