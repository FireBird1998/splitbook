import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getLocalMonthIsoRange } from '@splitbook/shared/date';
import { createMobileController } from './data/mobile-controller';
import type { FetchResponse } from './data/types';
import { refreshedLabel } from './ui/refresh-feedback';

// The real App tree renders through these host names; only native modules are replaced.
const native = vi.hoisted(() => ({
  appState: [] as ((state: string) => void)[],
  controller: undefined as unknown,
  appearance: { mode: 'light', status: 'ready', message: null },
}));
vi.mock('react-native', () => ({
  AccessibilityInfo: { sendAccessibilityEvent: vi.fn() },
  ActivityIndicator: 'ActivityIndicator',
  Alert: { alert: vi.fn() },
  AppState: {
    addEventListener: (_: string, listener: (state: string) => void) => {
      native.appState.push(listener);
      return { remove: () => native.appState.splice(native.appState.indexOf(listener), 1) };
    },
  },
  Appearance: { setColorScheme: vi.fn() },
  BackHandler: { addEventListener: () => ({ remove: () => undefined }) },
  KeyboardAvoidingView: 'KeyboardAvoidingView',
  Linking: {
    addEventListener: () => ({ remove: () => undefined }),
    getInitialURL: async () => null,
    openURL: vi.fn(),
  },
  Modal: 'Modal',
  Platform: { OS: 'android' },
  Pressable: 'Pressable',
  RefreshControl: 'RefreshControl',
  ScrollView: 'ScrollView',
  Share: { share: vi.fn() },
  StyleSheet: { create: <T,>(styles: T) => styles },
  Text: 'Text',
  TextInput: 'TextInput',
  View: 'View',
  useColorScheme: () => 'light',
}));
vi.mock('react-native-safe-area-context', () => ({
  SafeAreaProvider: 'SafeAreaProvider',
  SafeAreaView: 'SafeAreaView',
}));
vi.mock('react-native-nitro-google-signin', () => ({ GoogleSignInButton: 'GoogleSignInButton' }));
vi.mock('expo-status-bar', () => ({ StatusBar: 'StatusBar' }));
vi.mock('expo-linear-gradient', () => ({ LinearGradient: 'LinearGradient' }));
vi.mock('expo-font', () => ({ useFonts: () => [true, null] }));
vi.mock('@expo-google-fonts/outfit/400Regular', () => ({ Outfit_400Regular: 1 }));
vi.mock('@expo-google-fonts/outfit/500Medium', () => ({ Outfit_500Medium: 1 }));
vi.mock('@expo-google-fonts/outfit/600SemiBold', () => ({ Outfit_600SemiBold: 1 }));
vi.mock('@expo-google-fonts/outfit/700Bold', () => ({ Outfit_700Bold: 1 }));
vi.mock('@expo-google-fonts/ibm-plex-mono/500Medium', () => ({ IBMPlexMono_500Medium: 1 }));
vi.mock('@expo/vector-icons/Ionicons', () => ({
  default: Object.assign(() => null, { font: {} }),
}));
vi.mock('./runtime', () => ({
  get controller() {
    return native.controller;
  },
  appearance: {
    subscribe: () => () => undefined,
    getSnapshot: () => native.appearance,
    restore: async () => undefined,
    select: async () => undefined,
  },
  configurationReady: true,
  environment: {
    label: 'Local development · fictional data',
    apiOrigin: 'http://localhost:4138',
    webOrigin: 'http://localhost:4138',
  },
  googleSignInEnabled: false,
}));

const { default: App } = await import('../App');
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const user = { id: 'a00000000000000000000002', name: 'Sam Chen', email: 's@x.test', image: null };
const person = { _id: user.id, name: user.name, image: null };
const alex = { _id: 'a00000000000000000000001', name: 'Alex', image: null };
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
const page = (rows: unknown[]) => ({
  data: {
    expenses: rows,
    pagination: { page: 1, limit: 20, total: rows.length, totalPages: 1 },
    summary: {
      count: rows.length,
      totalsByCurrency: [{ currency: 'INR', totalAmount: 10 * rows.length }],
      userOwes: 0,
      userGetsBack: 0,
      byMember: [],
    },
  },
  status: 200,
});
const json = (body: unknown, status = 200) => Response.json(body, { status });
const september = expense('b00000000000000000000001', 'September groceries');
const august = expense('b00000000000000000000002', 'August rent');

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
        if (path.includes('/expenses?')) {
          const from = new URL(path, 'http://local').searchParams.get('dateFrom');
          return json(
            page(from === getLocalMonthIsoRange('2026-08').dateFrom ? [august] : [september]),
          );
        }
        if (path === `/api/groups/${groupId}/balances`)
          return json({
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
          });
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

/** Hold one matching request until released. */
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

let screen: ReactTestRenderer | null = null;
const consoleError = console.error;
beforeEach(() => {
  // Controller snapshots published between act scopes are the behaviour under test.
  vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
    const message = String(args[0]);
    if (message.includes('not wrapped in act') || message.includes('react-test-renderer')) return;
    consoleError(...args);
  });
});
afterEach(() => {
  act(() => screen?.unmount());
  screen = null;
  native.appState.length = 0;
  vi.restoreAllMocks();
});
const settle = (pending?: Promise<unknown>) =>
  act(async () => {
    await pending;
    for (let tick = 0; tick < 10; tick++) await new Promise((resolve) => setTimeout(resolve, 0));
  });

async function renderApp() {
  const harness = backend();
  await harness.controller.signIn('sam');
  native.controller = harness.controller;
  await act(async () => {
    screen = create(<App />);
  });
  await settle();
  const root = () => screen!.root;
  const isHost = (node: ReactTestInstance, name: string) => (node.type as unknown) === name;
  const text = () =>
    root()
      .findAll((node) => isHost(node, 'Text'))
      .flatMap((node) => node.children.filter((child) => typeof child === 'string'))
      .join('');
  const pressable = (label: string) =>
    root().find(
      (node) =>
        isHost(node, 'Pressable') && String(node.props.accessibilityLabel ?? '').startsWith(label),
    );
  const refreshControl = () =>
    root().find((node) => isHost(node, 'ScrollView') && node.props.refreshControl).props
      .refreshControl.props as { refreshing: boolean; onRefresh: () => void };
  return {
    ...harness,
    text,
    pressable,
    refreshControl,
    press: (label: string) => settle(Promise.resolve(pressable(label).props.onPress())),
    /** Android reports the app returning to the foreground. */
    foreground: () => native.appState.forEach((listener) => listener('active')),
  };
}

describe('App refresh rendering', () => {
  it('keeps the newest Month and never lists its Expenses under an older Month label', async () => {
    const app = await renderApp();
    await app.press('Open Maple House');
    expect(app.text()).toContain('September 2026');
    expect(app.text()).toContain('September groceries');

    const groupRead = hold();
    app.use((path) => (path === `/api/groups/${groupId}` ? groupRead.respond() : undefined));
    // Past the display freshness window, so the foreground refresh reads again.
    app.clock.now += 31_000;
    app.foreground();
    await groupRead.reached;
    await settle();
    app.use(() => undefined);
    await app.press('Previous month');
    expect(app.text()).toContain('August 2026');
    expect(app.text()).toContain('August rent');
    expect(app.text()).not.toContain('September groceries');

    groupRead.release(json({ data: group, status: 200 }));
    await settle();
    const shown = app.text();
    expect(shown).toContain('AUGUST 2026');
    expect(shown).toContain('August 2026 expense total');
    expect(shown).toContain('August rent');
    expect(shown).not.toContain('September');
  });

  it('keeps Expenses and Balances with their time, a message and a retry when the Group read fails', async () => {
    const app = await renderApp();
    await app.press('Open Maple House');
    const verifiedAt = refreshedLabel(app.clock.now);
    app.clock.now += 5 * 60_000;
    app.use((path) => (path === `/api/groups/${groupId}` ? json({}, 503) : undefined));
    await settle(Promise.resolve(app.refreshControl().onRefresh()));

    const shown = app.text();
    expect(shown).toContain(
      `The server could not complete this request. Please try again. Showing Maple House from ${verifiedAt}.`,
    );
    expect(shown).toContain('September groceries');
    expect(shown).toContain('September 2026 expense total');
    expect(shown).toContain('You owe Alex');
    expect(app.refreshControl().refreshing).toBe(false);

    // A retry is not a pull: it keeps the figures and shows the quiet header status only.
    const retried = hold();
    app.use((path) => (path === `/api/groups/${groupId}` ? retried.respond() : undefined));
    app.pressable('Retry Group').props.onPress();
    await retried.reached;
    await settle();
    expect(app.refreshControl().refreshing).toBe(false);
    expect(app.text()).toContain(`Saved ${verifiedAt} · updating`);
    expect(app.text()).toContain('September groceries');
    expect(app.text()).toContain('You owe Alex');

    app.use(() => undefined);
    retried.release(json({ data: group, status: 200 }));
    await settle();
    expect(app.text()).not.toContain('Showing Maple House from');
    expect(app.text()).not.toContain('· updating');
    expect(app.text()).toContain('September groceries');
    expect(app.refreshControl().refreshing).toBe(false);
  });

  it('reopens a recent Group without a request, then shows it with its time while it is read again', async () => {
    const app = await renderApp();
    const reads: string[] = [];
    app.use((path) => {
      reads.push(path);
      return undefined;
    });
    await app.press('Open Maple House');
    const verifiedAt = refreshedLabel(app.clock.now);
    await app.press('Back to Groups');
    reads.length = 0;

    // Within the display freshness window: shown at once, nothing read, no progress cue.
    app.clock.now += 20_000;
    await app.press('Open Maple House');
    app.foreground();
    await settle();
    expect(reads).toEqual([]);
    expect(app.text()).toContain('September groceries');
    expect(app.text()).not.toContain('· updating');

    // After it: the same figures stay, labelled with when they were verified.
    await app.press('Back to Groups');
    app.clock.now += 31_000;
    const groupRead = hold();
    app.use((path) => (path === `/api/groups/${groupId}` ? groupRead.respond() : undefined));
    await app.press('Open Maple House');
    await groupRead.reached;
    await settle();
    expect(app.text()).toContain(`Saved ${verifiedAt} · updating`);
    expect(app.text()).toContain('September groceries');
    expect(app.text()).toContain('You owe Alex');
    expect(app.refreshControl().refreshing).toBe(false);
    app.use(() => undefined);
    groupRead.release(json({ data: group, status: 200 }));
    await settle();
    expect(app.text()).not.toContain('· updating');
    expect(app.text()).toContain('September groceries');
  });

  it('turns on the pull indicator for a pull but never for an automatic refresh', async () => {
    const app = await renderApp();
    await app.press('Open Maple House');
    const expenses = hold();
    app.use((path) => (path.includes('/expenses?') ? expenses.respond() : undefined));

    const verifiedAt = refreshedLabel(app.clock.now);
    app.clock.now += 31_000;
    app.foreground();
    await expenses.reached;
    await settle();
    expect(app.refreshControl().refreshing).toBe(false);
    expect(app.text()).toContain(`Saved ${verifiedAt} · updating`);
    expect(app.text()).toContain('September groceries');
    expenses.release(json(page([september])));
    await settle();

    const pulled = hold();
    app.use((path) => (path.includes('/expenses?') ? pulled.respond() : undefined));
    app.refreshControl().onRefresh();
    await pulled.reached;
    await settle();
    expect(app.refreshControl().refreshing).toBe(true);
    expect(app.text()).not.toContain('· updating');
    expect(app.text()).toContain('September groceries');
    pulled.release(json(page([september])));
    await settle();
    expect(app.refreshControl().refreshing).toBe(false);
  });
});
