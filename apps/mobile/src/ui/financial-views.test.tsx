import { useSyncExternalStore } from 'react';
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createMobileController, type MobileController } from '../data/mobile-controller';
import type { FetchResponse } from '../data/types';
import { GroupFinancialViews, HomeBalances, RefreshStatus } from './financial-views';
import { refreshFeedback, refreshedLabel } from './refresh-feedback';

// Host stand-ins keep the props and text Android receives.
vi.mock('react-native', () => ({
  ActivityIndicator: 'ActivityIndicator',
  Pressable: 'Pressable',
  StyleSheet: { create: <T,>(styles: T) => styles },
  Text: 'Text',
  View: 'View',
}));
vi.mock('@expo/vector-icons/Ionicons', () => ({ default: 'Ionicons' }));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const user = { id: 'a00000000000000000000002', name: 'Sam Chen', email: 's@x.test', image: null };
const alex = { _id: 'a00000000000000000000001', name: 'Alex', image: null };
const person = { _id: user.id, name: user.name, image: null };
const groupId = 'a00000000000000000000010';
const iso = '2026-09-27T10:00:00.000Z';
const group = {
  _id: groupId,
  createdBy: user.id,
  name: 'Maple House',
  category: 'home',
  defaultCurrency: 'INR',
  members: [{ user: { ...person, email: user.email }, role: 'member', joinedAt: iso }],
  createdAt: iso,
  updatedAt: iso,
};
const expense = (id: string, description: string) => ({
  _id: id,
  group: groupId,
  description,
  currency: 'INR',
  amount: 10,
  amountMinor: 1000,
  moneyVersion: 1,
  category: 'food',
  tag: 'Shared',
  tagId: 'c00000000000000000000001',
  date: iso,
  createdAt: iso,
  updatedAt: iso,
  paidBy: [{ user: person, amount: 10, amountMinor: 1000 }],
  splitBetween: [{ user: person, amount: 10, amountMinor: 1000 }],
  splitMethod: 'equal',
});
const page = (rows: unknown[], pageNumber = 1, total = rows.length) => ({
  data: {
    expenses: rows,
    pagination: { page: pageNumber, limit: 20, total, totalPages: Math.ceil(total / 20) },
    summary: {
      count: total,
      totalsByCurrency: [{ currency: 'INR', totalAmount: 10 * total }],
      userOwes: 0,
      userGetsBack: 0,
      byMember: [],
    },
  },
  status: 200,
});
const balances = {
  data: {
    currency: 'INR',
    balances: [],
    debts: [],
    byCurrency: [
      {
        currency: 'INR',
        balances: [{ user: person, balance: -30 }],
        debts: [{ from: person, to: alex, amount: 30 }],
      },
    ],
  },
  status: 200,
};
const json = (body: unknown, status = 200) => Response.json(body, { status });

type Handler = (path: string) => FetchResponse | Promise<FetchResponse> | undefined;
function backend() {
  let cookie: string | null = null;
  const clock = { now: new Date(2026, 8, 27, 12).getTime() };
  let handler: Handler = () => undefined;
  const controller = createMobileController(
    {
      apiBaseUrl: 'http://localhost:4138',
      authOrigin: 'http://localhost:4138',
      developmentPersonaEnabled: true,
    },
    {
      now: () => clock.now,
      credentials: {
        load: async () => cookie,
        save: async (value) => {
          cookie = value;
        },
        clear: async () => {
          cookie = null;
        },
      },
      fetch: async (url) => {
        const path = new URL(url).pathname + new URL(url).search;
        const override = handler(path);
        if (override) return override;
        if (path.endsWith('/sign-in'))
          return new Response(JSON.stringify({ user }), {
            headers: { 'Set-Cookie': 'better-auth.session_token=test.signature; Path=/; HttpOnly' },
          });
        if (path.endsWith('/get-session'))
          return json({ user, session: { userId: user.id, expiresAt: '2030-01-01T00:00:00Z' } });
        if (path === '/api/groups') return json({ data: [group], status: 200 });
        if (path === `/api/groups/${groupId}`) return json({ data: group, status: 200 });
        if (path === '/api/user/balances')
          return json({
            data: { buckets: [{ currency: 'INR', youOwe: 30, youAreOwed: 0 }] },
            status: 200,
          });
        if (path.includes('/expenses?'))
          return json(page([expense('b00000000000000000000001', 'Groceries')]));
        if (path === `/api/groups/${groupId}/balances`) return json(balances);
        return json({}, 404);
      },
    },
  );
  return {
    controller,
    clock,
    use(next: Handler) {
      handler = next;
    },
  };
}

function Screen({ controller }: { controller: MobileController }) {
  const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot);
  const noop = () => undefined;
  return (
    <>
      <RefreshStatus visible={refreshFeedback(state).quiet} />
      {state.screen === 'groups' ? (
        <HomeBalances state={state.home} onRefresh={noop} />
      ) : state.detail.data ? (
        <GroupFinancialViews
          group={state.detail.data}
          currentUserId={user.id}
          state={state.financial}
          onSelectMonth={noop}
          onRefreshExpenses={noop}
          onRefreshBalances={noop}
          onLoadMore={noop}
          onOpenExpense={noop}
        />
      ) : null}
    </>
  );
}

let screen: ReactTestRenderer | null = null;
afterEach(() => {
  act(() => screen?.unmount());
  screen = null;
});
/** Let published snapshots render; controller work runs outside act so mid-refresh states are observable. */
const flush = () => act(async () => {});
const settle = (pending: Promise<unknown>) =>
  act(async () => {
    await pending;
  });
// Controller snapshots published between act scopes are the behavior under test.
const consoleError = console.error;
vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
  if (String(args[0]).includes('not wrapped in act')) return;
  consoleError(...args);
});
async function render(controller: MobileController) {
  await act(async () => {
    screen = create(<Screen controller={controller} />);
  });
  return () => screen!.root;
}
const isHost = (node: ReactTestInstance, name: string) => (node.type as unknown) === name;
const text = (root: ReactTestInstance) =>
  root
    .findAll((node) => isHost(node, 'Text'))
    .flatMap((node) => node.children.filter((child) => typeof child === 'string'))
    .join('');
const spinners = (root: ReactTestInstance) =>
  root.findAll((node) => isHost(node, 'ActivityIndicator')).length;
const buttons = (root: ReactTestInstance) =>
  root
    .findAll((node) => isHost(node, 'Pressable'))
    .map((node) => node.props.accessibilityLabel as string);
/** Hold one request until released. */
function hold() {
  let release!: (response: FetchResponse) => void;
  let arrived!: () => void;
  const reached = new Promise<void>((resolve) => {
    arrived = resolve;
  });
  const response = new Promise<FetchResponse>((resolve) => {
    release = resolve;
  });
  return {
    respond: () => {
      arrived();
      return response;
    },
    reached,
    release,
  };
}

describe('rendered refresh feedback', () => {
  it('shows section placeholders only for a first load without matching content', async () => {
    const { controller, use } = backend();
    await controller.signIn('sam');
    const expenses = hold();
    use((path) => (path.includes('/expenses?') ? expenses.respond() : undefined));
    const root = await render(controller);
    const opening = controller.openGroup(groupId);
    await expenses.reached;
    await flush();
    expect(text(root())).toContain('Loading running balances…');
    expect(text(root())).toContain('Loading September 2026 expenses…');
    expect(text(root())).not.toContain('Updating…');
    expect(spinners(root())).toBe(2);
    await expenses.release(json(page([expense('b00000000000000000000001', 'Groceries')])));
    await settle(opening);
    expect(spinners(root())).toBe(0);
  });

  it('keeps the Group readable during an automatic refresh with one quiet cue and unverified Balances', async () => {
    const { controller, clock, use } = backend();
    await controller.signIn('sam');
    await controller.openGroup(groupId);
    const verifiedAt = clock.now;
    clock.now += 5 * 60_000;
    const expenses = hold();
    use((path) => (path.includes('/expenses?') ? expenses.respond() : undefined));
    const root = await render(controller);
    const refresh = controller.refresh('background');
    await expenses.reached;
    await flush();
    const shown = text(root());
    expect(shown.match(/Updating…/g)).toHaveLength(1);
    expect(spinners(root())).toBe(0);
    expect(shown).toContain('Groceries');
    expect(shown).toContain('September 2026 expense total');
    expect(shown).toContain('You owe Alex');
    expect(shown).toContain(
      `Updating running balances. These figures are from ${refreshedLabel(verifiedAt)} and may change.`,
    );
    await expenses.release(
      json(
        page([
          expense('b00000000000000000000001', 'Groceries'),
          expense('b00000000000000000000002', 'Rent'),
        ]),
      ),
    );
    await settle(refresh);
    expect(text(root())).toContain('Rent');
    expect(text(root())).not.toContain('Updating');
  });

  it('keeps figures with their original time and a retry when an automatic refresh fails', async () => {
    const { controller, clock, use } = backend();
    await controller.signIn('sam');
    await controller.openGroup(groupId);
    const verifiedAt = refreshedLabel(clock.now);
    clock.now += 5 * 60_000;
    use((path) => (path.includes('/expenses?') ? json({}, 503) : undefined));
    const root = await render(controller);
    await act(async () => {
      await controller.refresh('background');
    });
    const shown = text(root());
    expect(shown).toContain('Groceries');
    expect(shown).toContain('You owe Alex');
    expect(shown).toContain(
      `The server could not complete this request. Please try again. Showing September 2026 expenses from ${verifiedAt}.`,
    );
    expect(shown).toContain(
      `Could not update running balances. Please try again. Showing running balances from ${verifiedAt}.`,
    );
    expect(buttons(root())).toEqual(
      expect.arrayContaining(['Retry expenses', 'Retry running balances']),
    );
  });

  it('keeps Home figures on screen and explains a failed automatic refresh', async () => {
    const { controller, clock, use } = backend();
    await controller.signIn('sam');
    const verifiedAt = refreshedLabel(clock.now);
    use((path) => (path === '/api/user/balances' ? json({}, 503) : undefined));
    const root = await render(controller);
    await act(async () => {
      await controller.refresh('background');
    });
    expect(text(root())).toContain('You owe');
    expect(text(root())).toContain(`Showing your balances from ${verifiedAt}.`);
    expect(buttons(root())).toContain('Retry Home balances');
    expect(spinners(root())).toBe(0);
  });

  it('shows a pagination footer instead of refresh cues while the next page loads', async () => {
    const rows = Array.from({ length: 21 }, (_, index) =>
      expense(`b${String(index + 1).padStart(23, '0')}`, `Item ${index + 1}`),
    );
    const { controller, use } = backend();
    const next = hold();
    use((path) =>
      path.includes('/expenses?')
        ? path.includes('page=2')
          ? next.respond()
          : json(page(rows.slice(0, 20), 1, 21))
        : undefined,
    );
    await controller.signIn('sam');
    await controller.openGroup(groupId);
    const root = await render(controller);
    const more = controller.loadMoreExpenses();
    await next.reached;
    await flush();
    expect(text(root())).toContain('Loading more expenses…');
    expect(text(root())).not.toContain('Updating…');
    expect(spinners(root())).toBe(1);
    expect(buttons(root())).not.toContain('Load more expenses');
    expect(text(root())).toContain('Item 20');
    await next.release(json(page(rows.slice(20), 2, 21)));
    await settle(more);
    expect(text(root())).toContain('Item 21');
  });
});
