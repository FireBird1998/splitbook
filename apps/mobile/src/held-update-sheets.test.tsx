import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, expect, it, vi } from 'vitest';
import { fakeSplitbook } from './test-utils/fake-splitbook';
import { testPhone, until } from './test-utils/test-phone';
import { unbroken } from './test-utils/layout';
import { RecordPaymentSheet } from './ui/record-payment-sheet';
import { TagManager } from './ui/tag-manager';

const runtime = vi.hoisted(() => ({
  controller: undefined as unknown,
  appearance: { mode: 'light', status: 'ready', message: null },
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
// The App keeps its real rendering and subscribes to the phone's real controller.
vi.mock('./runtime', () => ({
  get controller() {
    return runtime.controller;
  },
  appearance: {
    subscribe: () => () => undefined,
    getSnapshot: () => runtime.appearance,
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
let screen: ReactTestRenderer | undefined;
afterEach(() => {
  act(() => screen?.unmount());
  screen = undefined;
  vi.unstubAllEnvs();
});

async function setup() {
  vi.stubEnv('EXPO_PUBLIC_ANDROID_NOTIFICATIONS_ENABLED', 'false');
  vi.stubEnv('EXPO_PUBLIC_ANDROID_WIDGETS_ENABLED', 'true');
  const server = fakeSplitbook();
  const groupId = server.world.groups[0]._id;
  const { alex, sam } = server.world.people;
  server.world.balances[groupId] = {
    byCurrency: [
      {
        currency: 'INR',
        balances: [
          { user: { _id: alex.id, name: alex.name }, balance: -10 },
          { user: { _id: sam.id, name: sam.name }, balance: 10 },
        ],
        debts: [
          {
            from: { _id: alex.id, name: alex.name },
            to: { _id: sam.id, name: sam.name },
            amount: 10,
          },
        ],
      },
    ],
  };
  const phone = testPhone(server, { now: Date.UTC(2026, 10, 12, 12) });
  const controller = phone.open();
  runtime.controller = controller;
  await act(async () => {
    screen = create(<App />, {
      createNodeMock: () => ({ scrollTo: () => undefined, focus: () => undefined }),
    });
  });
  await act(async () => {
    await until(controller, (state) => state.auth.status === 'signed-out');
    await controller.signIn('alex');
    await controller.openGroup(groupId);
  });
  const text = () =>
    unbroken(
      screen!.root
        .findAll((node) => (node.type as unknown) === 'Text')
        .flatMap((node) => node.children.filter((child) => typeof child === 'string'))
        .join(''),
    );
  return { controller, groupId, alex, sam, text };
}

// #1158: the real App holds the tap, but the payment sheet has no notice host.
// Keep this expected failure until a separate notice change is approved.
it.fails(
  'shows the held widget notice on the payment sheet without changing the payment (#1158)',
  async () => {
    const { controller: c, groupId, alex, sam, text } = await setup();
    await act(async () => {
      await c.selectDestination('balances');
      await c.openRecordPayment(alex.id, sam.id, 'INR');
      c.updateSettlement({ amount: '5', note: 'Already paid outside Splitbook' });
    });
    expect(screen!.root.findByType(RecordPaymentSheet).props.visible).toBe(true);
    expect(c.getSnapshot().settlement).toMatchObject({
      status: 'editing',
      draft: { amount: '5', note: 'Already paid outside Splitbook' },
    });
    expect(text()).toContain('Amount paid');
    expect(text()).toContain('Sam Chen');
    const payment = c.getSnapshot().settlement;
    await act(async () => c.openWidget('home'));
    expect(c.getSnapshot()).toMatchObject({
      screen: 'settlement',
      notificationOpening: { status: 'held' },
      heldNotificationSource: 'widget',
    });
    expect(c.getSnapshot().settlement).toBe(payment);
    expect(c.getSnapshot().heldNotification).not.toBeNull();
    expect(text()).toContain('Widget held until you finish');
  },
);

// #1158: the Tags sheet also holds the tap without rendering its acknowledgement.
// This pins the gap without adding a notice or changing the sheet in this ticket.
it.fails('shows the held widget notice on the Tags sheet without closing it (#1158)', async () => {
  const { controller: c, groupId, text } = await setup();
  await act(async () => c.openTags(groupId));
  await act(async () => until(c, (state) => !!state.tagManager.snapshot && !state.tagManager.busy));
  expect(screen!.root.findByType(TagManager).props.groupId).toBe(groupId);
  const tags = c.getSnapshot().tagManager;
  await act(async () => c.openWidget('home'));
  expect(c.getSnapshot()).toMatchObject({
    screen: 'group',
    tagsOpenFor: groupId,
    notificationOpening: { status: 'held' },
    heldNotificationSource: 'widget',
  });
  expect(c.getSnapshot().tagManager).toBe(tags);
  expect(c.getSnapshot().heldNotification).not.toBeNull();
  expect(text()).toContain('Widget held until you finish');
});
