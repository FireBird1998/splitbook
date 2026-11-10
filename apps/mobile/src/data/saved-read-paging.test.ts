import { expect, it } from 'vitest';
import { InfiniteQueryObserver, QueryClient } from '@tanstack/query-core';
import { expensePageKey, queryKeyPath } from '@splitbook/shared/query-keys';
import { savedQueriesIn } from '../test-utils/saved-queries';
import { followInjectedClock } from '../test-utils/query-clock';
import { createSavedReadEngine, uniqueRows, STALE, type RefusalRule } from './saved-read-engine';
import { RequestError } from './transport';

type Wire = {
  items: { id: string; text: string }[];
  pagination: { page: number; totalPages: number };
};
function fixture(
  refusal: RefusalRule = 'forbidden-or-missing',
  reopen: 'fetching' | 'multiple-pages' = 'multiple-pages',
) {
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
    reopen,
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
    const requested: number[] = [],
      read = f.state.read;
    f.state.read = async (page) => {
      requested.push(page);
      return { ...(await read(page)), pagination: { page, totalPages: 7 } };
    };
    await f.client.fetchInfiniteQuery(f.options);
    for (let page = 2; page <= 5; page++) await f.paging.older(f.key, () => f.observer);
    expect(f.observer.getCurrentResult().data?.pageParams).toEqual([1, 2, 3, 4, 5]);
    expect(f.observer.getCurrentResult().hasPreviousPage).toBe(false);
    requested.length = 0;
    await f.paging.older(f.key, () => f.observer);
    expect(requested).toEqual([6]);
    expect(f.observer.getCurrentResult().data?.pageParams).toEqual([2, 3, 4, 5, 6]);
    expect(f.observer.getCurrentResult()).toMatchObject({
      status: 'success',
      hasPreviousPage: true,
    });
    expect(
      f.observer.getCurrentResult().data?.pages.flatMap((page) => (page.value as Wire).items),
    ).toEqual([
      { id: '2', text: 'Page 2' },
      { id: '3', text: 'Page 3' },
      { id: '4', text: 'Page 4' },
      { id: '5', text: 'Page 5' },
      { id: '6', text: 'Page 6' },
    ]);
    expect(f.observer.getCurrentResult().data?.pages.at(-1)?.value).toMatchObject({
      pagination: { page: 6, totalPages: 7 },
    });
    const normal = f.state.read;
    f.state.read = async (page) =>
      page === 1
        ? { items: [{ id: '1', text: 'Page one read again' }], pagination: { page, totalPages: 8 } }
        : normal(page);
    await f.paging.newer(f.key, () => f.observer);
    expect(f.observer.getCurrentResult().data?.pages[0].value).toMatchObject({
      items: [{ id: '1', text: 'Page one read again' }],
    });
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

it('keeps earlier pages when a later re-read fails, then retries that slot with Load older', async () => {
  const f = fixture();
  try {
    await f.client.fetchInfiniteQuery(f.options);
    await f.paging.older(f.key, () => f.observer);
    await f.paging.older(f.key, () => f.observer);
    const normal = f.state.read;
    f.state.read = async (page) => {
      if (page === 2) throw new RequestError('Server failure', 500);
      return normal(page);
    };
    await f.observer.refetch();
    const pages = f.observer.getCurrentResult().data?.pages;
    expect(pages?.map((page) => [page.page, page.source])).toEqual([
      [1, 'network'],
      [2, 'failed'],
    ]);
    expect(pages?.[1]).toMatchObject({ value: null, message: 'Could not load older.' });
    f.state.read = normal;
    await f.paging.older(f.key, () => f.observer);
    expect(
      f.observer.getCurrentResult().data?.pages.map((page) => [page.page, page.source]),
    ).toEqual([
      [1, 'network'],
      [2, 'network'],
    ]);
  } finally {
    f.stop();
  }
});

it.each(['forbidden-only', 'forbidden-or-missing'] as const)(
  'preserves a later-page 404 under %s',
  async (rule) => {
    const f = fixture(rule);
    try {
      await f.client.fetchInfiniteQuery(f.options);
      await f.paging.older(f.key, () => f.observer);
      const normal = f.state.read;
      f.state.read = async (page) => {
        if (page === 2) throw new RequestError('Gone', 404);
        return normal(page);
      };
      const result = await f.observer.refetch();
      if (rule === 'forbidden-only') {
        expect(result.error).toBeNull();
        expect(result.data?.pages[1]).toMatchObject({ page: 2, source: 'failed' });
      } else expect(result.error).toMatchObject({ status: 404 });
    } finally {
      f.stop();
    }
  },
);

it('keeps an offline page and its original time, always stale, with one wire row per page', async () => {
  const f = fixture();
  try {
    await f.client.fetchInfiniteQuery(f.options);
    await f.paging.older(f.key, () => f.observer);
    await f.engine.idle();
    expect(await f.rows.load('account', f.path(2))).toMatchObject({
      version: 1,
      accountId: 'account',
      path: f.path(2),
      groupId: '111111111111111111111111',
      refreshedAt: 1000,
      value: { pagination: { page: 2 } },
    });
    f.state.time = 2000;
    f.state.offline = true;
    f.state.read = async () => {
      throw new RequestError('Offline', 0, null, true, null, 'network');
    };
    await f.observer.refetch();
    expect(
      f.observer.getCurrentResult().data?.pages.map((page) => [page.source, page.refreshedAt]),
    ).toEqual([
      ['saved', 1000],
      ['saved', 1000],
    ]);
    f.state.offline = false;
    expect(f.engine.shared.staleTime(f.client.getQueryCache().find({ queryKey: f.key })!)).toBe(
      STALE,
    );
    expect((await f.rows.list!('account')).length).toBe(2);
  } finally {
    f.stop();
  }
});

it.each(['fetching', 'multiple-pages'] as const)(
  'reopens a fetching one-page window with %s policy',
  async (policy) => {
    const f = fixture('forbidden-or-missing', policy);
    let release!: () => void;
    const slow = new Promise<void>((resolve) => {
      release = resolve;
    });
    try {
      await f.client.fetchInfiniteQuery(f.options);
      const normal = f.state.read;
      f.state.read = async (page) => {
        await slow;
        return normal(page);
      };
      const older = f.paging.older(f.key, () => f.observer);
      f.paging.reopen(f.key);
      if (policy === 'fetching') expect(f.client.getQueryData(f.key)).toBeUndefined();
      else expect(f.client.getQueryData(f.key)).toMatchObject({ pageParams: [1] });
      release();
      await older;
    } finally {
      release();
      f.stop();
    }
  },
);

it('lists duplicate ids once, with the last value in its first position and stable unchanged rows', () => {
  const first = { id: 'a', text: 'A' },
    old = { id: 'b', text: 'old' },
    latest = { id: 'b', text: 'latest' },
    last = { id: 'c', text: 'C' };
  const pages = [
    [first, old],
    [latest, last],
  ];
  const result = uniqueRows(pages, (row) => row.id, []);
  expect(result).toEqual([
    { id: 'a', text: 'A' },
    { id: 'b', text: 'latest' },
    { id: 'c', text: 'C' },
  ]);
  expect(uniqueRows(pages, (row) => row.id, result)).toBe(result);
});

it('keeps Load older failures as errors rather than adding a failed page', async () => {
  const f = fixture();
  try {
    await f.client.fetchInfiniteQuery(f.options);
    f.state.read = async () => {
      throw new RequestError('Server failure', 500);
    };
    const result = await f.paging.older(f.key, () => f.observer);
    expect(result && result.error).toMatchObject({ status: 500 });
    expect(
      f.observer.getCurrentResult().data?.pages.map((page) => [page.page, page.source]),
    ).toEqual([[1, 'network']]);
  } finally {
    f.stop();
  }
});

it('reopens an idle newest window on page one without changing its verification time', async () => {
  const f = fixture();
  try {
    await f.client.fetchInfiniteQuery(f.options);
    await f.paging.older(f.key, () => f.observer);
    f.state.time = 2000;
    f.paging.reopen(f.key);
    expect(f.observer.getCurrentResult().data?.pageParams).toEqual([1]);
    expect(f.client.getQueryState(f.key)?.dataUpdatedAt).toBe(1000);
  } finally {
    f.stop();
  }
});

it('drops a slid window on a new open so the newest page can be read', async () => {
  const f = fixture();
  try {
    await f.client.fetchInfiniteQuery(f.options);
    for (let page = 2; page <= 6; page++) await f.paging.older(f.key, () => f.observer);
    f.paging.reopen(f.key);
    expect(f.client.getQueryData(f.key)).toBeUndefined();
  } finally {
    f.stop();
  }
});
