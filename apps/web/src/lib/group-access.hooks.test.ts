import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactTestRenderer } from 'react-test-renderer';
import type { SWRResponse } from 'swr';

/*
 * #201 with mounted hooks: the Group page's own reads (`useGroup` and bare
 * `useSWR` keys through `fetcher`) rendered by react-test-renderer, against a
 * fake server that answers each request as things stood when it was sent.
 */

const ACTOR = 'a00000000000000000000002';

// `swr` loads once for the whole file (vi.resetModules does not reload
// node_modules), and so does its cache with its in-flight and dedupe state.
// Each test therefore reads a Group of its own.
let groups = 0;
let LOST = '';
let groupPath = '';
let listPath = '';
let balancesPath = '';
function nextGroup() {
  LOST = `b${String((groups += 1)).padStart(23, '0')}`;
  groupPath = `/api/groups/${LOST}`;
  listPath = `${groupPath}/expenses?sortBy=date&sortOrder=desc&page=1&limit=20`;
  balancesPath = `${groupPath}/balances`;
}

const groupPayload = () => ({
  data: {
    _id: LOST,
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
const listPayload = { data: { expenses: [{ description: 'Synthetic lantern dinner' }] } };
const balancesPayload = { data: { balances: [{ user: { _id: ACTOR }, balance: -555.5 }] } };

const reply = (status: number, body: unknown) => new Response(JSON.stringify(body), { status });

/** Sam's access, and every request the page sends, decided when it is sent. */
function fakeServer() {
  const server = {
    member: true,
    sent: [] as string[],
    /** Paths whose next answer waits for `release`. */
    hold: new Set<string>(),
    held: new Map<string, () => void>(),
    release(path: string) {
      server.held.get(path)?.();
      server.held.delete(path);
    },
    /** Requests sent since `mark()`. */
    since: 0,
    mark() {
      server.since = server.sent.length;
    },
    sentSinceMark: () => server.sent.slice(server.since),
  };
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string) => {
      server.sent.push(input);
      const member = server.member;
      if (server.hold.delete(input))
        await new Promise<void>((resolve) => server.held.set(input, resolve));
      if (!member) return reply(403, { error: 'Forbidden', status: 403 });
      if (input === groupPath) return reply(200, groupPayload());
      if (input === listPath) return reply(200, listPayload);
      if (input === balancesPath) return reply(200, balancesPayload);
      return reply(404, { error: 'Not found' });
    }),
  );
  return server;
}

type Read = Pick<SWRResponse, 'data' | 'error' | 'isValidating'>;
type Seen = {
  group: ReturnType<typeof import('./hooks/use-groups').useGroup>;
  list: Read;
  balances: Read;
};

/** A fresh document with the Group page's reads mounted. */
async function mountGroupPage() {
  vi.resetModules();
  vi.stubGlobal('window', {
    location: { pathname: `/groups/${LOST}`, search: '', reload: vi.fn(), assign: vi.fn() },
  });
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const { createElement, useLayoutEffect } = await import('react');
  const { act, create } = await import('react-test-renderer');
  const swr = await import('swr');
  const { useGroup } = await import('./hooks/use-groups');
  const { fetcher } = await import('./utils/fetcher');
  const seen = {} as Seen;
  const report = (next: Seen) => Object.assign(seen, next);
  /** Reads what it reports while rendering, so SWR re-renders it when any of it changes. */
  const read = ({ data, error, isValidating }: SWRResponse): Read => ({
    data,
    error,
    isValidating,
  });
  function GroupPageReads({ onRender }: { onRender: (seen: Seen) => void }) {
    const group = useGroup(ACTOR, LOST);
    const list = read(swr.default(listPath, fetcher));
    const balances = read(swr.default(balancesPath, fetcher));
    useLayoutEffect(() => {
      onRender({ group, list, balances });
    });
    return null;
  }
  let renderer!: ReactTestRenderer;
  await act(async () => {
    renderer = create(createElement(GroupPageReads, { onRender: report }));
  });
  /** Let requests answer and SWR settle, until `check` holds. */
  const until = async (check: () => boolean) => {
    for (let turn = 0; turn < 100 && !check(); turn += 1)
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 2));
      });
    expect(check()).toBe(true);
  };
  /** What a poll does: revalidate one mounted read. */
  const poll = (key: string) =>
    act(async () => {
      void swr.mutate(key);
    });
  const loaded = () =>
    Boolean(seen.group.data && seen.list.data && seen.balances.data) &&
    !seen.list.error &&
    !seen.balances.error;
  const denied = () => !seen.group.data && Boolean(seen.group.error);
  const settled = () =>
    !seen.group.isValidating && !seen.list.isValidating && !seen.balances.isValidating;
  return { act, seen, renderer, until, poll, loaded, denied, settled };
}

describe('losing a Group, with the Group page’s reads mounted', () => {
  let server: ReturnType<typeof fakeServer>;
  let page: Awaited<ReturnType<typeof mountGroupPage>>;

  beforeEach(async () => {
    nextGroup();
    server = fakeServer();
    page = await mountGroupPage();
    await page.until(page.loaded);
  });

  afterEach(async () => {
    await page.act(async () => page.renderer.unmount());
    vi.unstubAllGlobals();
  });

  it('the first refused poll denies the Group and empties its other reads, without reading the Group', async () => {
    server.member = false;
    server.mark();
    await page.poll(listPath);
    await page.until(() => page.denied() && page.settled());
    expect(page.seen.group.error?.message).toBe(
      'Group access could not be verified. Please retry.',
    );
    expect(page.seen.list.data).toBeUndefined();
    expect(page.seen.balances.data).toBeUndefined();
    expect(server.sentSinceMark()).toEqual([listPath]);
  });

  it('a 2xx sent before the loss and answered after it brings nothing back', async () => {
    server.hold.add(balancesPath);
    await page.poll(balancesPath);
    server.member = false;
    await page.poll(listPath);
    await page.until(page.denied);
    server.release(balancesPath);
    await page.until(page.settled);
    expect(page.seen.balances.data).toBeUndefined();
    expect(page.denied()).toBe(true);
  });

  it('Retry once Sam is back reads the Group’s content again, past the refused read’s error', async () => {
    server.member = false;
    await page.poll(listPath);
    await page.until(() => page.denied() && Boolean(page.seen.list.error));
    server.member = true;
    server.mark();
    await page.act(async () => {
      void page.seen.group.mutate();
    });
    await page.until(page.loaded);
    expect(server.sentSinceMark()).toEqual(expect.arrayContaining([listPath, balancesPath]));
  });

  it('a Group read sent before the loss and answered after it keeps the Group denied and reads nothing', async () => {
    server.hold.add(groupPath);
    await page.act(async () => {
      void page.seen.group.mutate();
    });
    server.member = false;
    await page.poll(listPath);
    await page.until(page.denied);
    server.mark();
    server.release(groupPath);
    await page.until(page.settled);
    expect(page.denied()).toBe(true);
    expect(server.sentSinceMark()).toEqual([]);
    // A Retry sent after the loss still reopens the Group once Sam is back.
    server.member = true;
    await page.act(async () => {
      void page.seen.group.mutate();
    });
    await page.until(page.loaded);
  });
});

describe('a write, with the shell sidebar’s reads mounted (#303)', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('refetches the Group list and the balances once a write goes through, and not after a refusal', async () => {
    nextGroup();
    const sent: string[] = [];
    let writeStatus = 403;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string, init?: RequestInit) => {
        const method = init?.method ?? 'GET';
        sent.push(`${method} ${input}`);
        if (method !== 'GET') return reply(writeStatus, { data: {}, status: writeStatus });
        if (input === '/api/groups')
          return reply(200, { data: [groupPayload().data], status: 200 });
        if (input === '/api/user/balances')
          return reply(200, { data: { buckets: [], groups: [] }, status: 200 });
        return reply(404, { error: 'Not found' });
      }),
    );
    vi.resetModules();
    vi.stubGlobal('window', {
      location: { pathname: groupPath, search: '', reload: vi.fn(), assign: vi.fn() },
    });
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    const { createElement, useLayoutEffect } = await import('react');
    const { act, create } = await import('react-test-renderer');
    const swr = await import('swr');
    const { useGroups } = await import('./hooks/use-groups');
    const { fetcher } = await import('./utils/fetcher');
    const { apiFetch } = await import('./utils/api-fetch');
    const seen: { groups?: unknown; balances?: unknown } = {};
    /** The two reads the sidebar mounts on every page. */
    function SidebarReads({ onRender }: { onRender: (next: typeof seen) => void }) {
      const groups = useGroups(ACTOR).data;
      const balances = swr.default('/api/user/balances', fetcher).data;
      useLayoutEffect(() => {
        onRender({ groups, balances });
      });
      return null;
    }
    let renderer!: ReactTestRenderer;
    await act(async () => {
      renderer = create(
        createElement(SidebarReads, { onRender: (next) => Object.assign(seen, next) }),
      );
    });
    const until = async (check: () => boolean) => {
      for (let turn = 0; turn < 100 && !check(); turn += 1)
        await act(async () => {
          await new Promise((resolve) => setTimeout(resolve, 2));
        });
      expect(check()).toBe(true);
    };
    const accountReads = () =>
      sent.filter((request) => ['GET /api/groups', 'GET /api/user/balances'].includes(request));
    try {
      await until(() => Boolean(seen.groups && seen.balances));

      // Refused: nothing changed, so nothing is read again.
      sent.length = 0;
      await act(async () => {
        await apiFetch(`${groupPath}/expenses`, { method: 'POST' });
      });
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 20));
      });
      expect(accountReads()).toEqual([]);

      writeStatus = 201;
      sent.length = 0;
      await act(async () => {
        await apiFetch(`${groupPath}/settlements`, { method: 'POST' });
      });
      await until(() => accountReads().length === 2);
      expect(accountReads().sort()).toEqual(['GET /api/groups', 'GET /api/user/balances']);
    } finally {
      await act(async () => renderer.unmount());
    }
  });
});
