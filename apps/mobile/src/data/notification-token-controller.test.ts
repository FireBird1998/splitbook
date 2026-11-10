import { describe, expect, it, vi } from 'vitest';
import { testPhone, notificationNative } from '../test-utils/test-phone';
import { fakeSplitbook } from '../test-utils/fake-splitbook';
import type { MobileDependencies, MobileTimer } from './types';

/**
 * Registration maintenance at the controller/native seam (#844): a native token change, or the
 * same session restored, keeps an opted-in phone's binding current, under the consent it already
 * has. The fake server answers as `POST /api/notifications/device` does: a maintenance update
 * applies only to this session's binding while it is still on.
 */
const alex = {
  id: 'a00000000000000000000001',
  name: 'Alex',
  email: 'alex@example.test',
  image: null,
};
const sam = { id: 'a00000000000000000000002', name: 'Sam', email: 'sam@example.test', image: null };
const groupId = 'b00000000000000000000001';
const iso = '2026-09-28T12:00:00.000Z';
const group = (member: typeof alex) => ({
  _id: groupId,
  createdBy: member.id,
  name: 'Shared home',
  category: 'home',
  defaultCurrency: 'INR',
  tags: [],
  members: [{ user: { ...member, _id: member.id }, role: 'admin', joinedAt: iso }],
  createdAt: iso,
  updatedAt: iso,
});
const json = (value: unknown, status = 200, cookie?: string) =>
  new Response(JSON.stringify(value), {
    status,
    headers: {
      'Content-Type': 'application/json',
      ...(cookie ? { 'Set-Cookie': `better-auth.session_token=${cookie}; Max-Age=2592000` } : {}),
    },
  });
const networkFailure = () => Promise.reject(new TypeError('Network request failed'));
interface Registration {
  session: string;
  account: string;
  enabled: boolean;
  expenseUpdates: boolean;
  payments: boolean;
  revision: number;
  binding: string;
  activation: string;
  token: string;
}
type Post = Record<string, unknown> & { cookie: string };

/** One phone, its server and its saved session; each `app()` is a fresh process of the app. */
function phone() {
  let registration: Registration | null = null;
  let ids = 0;
  const posts: Post[] = [];
  let gets = 0;
  const server = {
    /** Replaces the device route's answer to a POST, before the fake applies it. */
    post: null as null | ((body: Post) => Promise<Response> | null),
    signedIn: alex,
  };
  const state = (): Record<string, unknown> =>
    registration
      ? {
          available: true,
          enabled: registration.enabled,
          expenseUpdates: registration.expenseUpdates,
          payments: registration.payments,
          revision: registration.revision,
          activation: registration.activation,
          binding: registration.binding,
          expenseActivation: registration.activation,
          expenseCutoff: iso,
          paymentCutoff: iso,
        }
      : {
          available: true,
          enabled: false,
          expenseUpdates: false,
          payments: false,
          revision: 0,
          activation: null,
          expenseCutoff: null,
          paymentCutoff: null,
        };
  const answerDevice = async (init: RequestInit, cookie: string) => {
    const mine = registration?.session === cookie;
    if (init.method !== 'POST') {
      gets++;
      if (!registration || mine) return json({ data: state() });
      return json({ data: { ...state(), enabled: false, expenseUpdates: false, payments: false } });
    }
    const body = { ...JSON.parse(String(init.body)), cookie } as Post;
    posts.push(body);
    const replaced = server.post?.(body);
    if (replaced) return replaced;
    if (body.revision !== (registration?.revision ?? 0))
      return json({ error: 'Notification settings changed. Retry.' }, 409);
    if (body.maintenance) {
      if (!registration || !mine || !registration.enabled)
        return json({ error: 'Notification settings changed. Retry.' }, 409);
      if (registration.token !== body.token)
        registration = {
          ...registration,
          token: String(body.token),
          revision: registration.revision + 1,
        };
      return json({ data: state() });
    }
    const enabling = body.enabled === true && !(mine && registration?.enabled);
    const id = () => `00000000-0000-4000-8000-${String(++ids).padStart(12, '0')}`;
    registration = {
      session: cookie,
      account: server.signedIn.id,
      enabled: body.enabled === true,
      expenseUpdates: body.enabled === true && (enabling || body.expenseUpdates !== false),
      payments: body.enabled === true && (enabling || body.payments !== false),
      revision: (registration?.revision ?? 0) + 1,
      binding: mine && registration ? registration.binding : id(),
      activation: enabling || !registration ? id() : registration.activation,
      token: typeof body.token === 'string' ? body.token : (registration?.token ?? ''),
    };
    return json({ data: state() });
  };
  const backend = fakeSplitbook();
  backend.world.people.alex = alex;
  backend.world.people.sam = sam;
  backend.auth.cookie = (persona, sequence) =>
    `better-auth.session_token=${backend.world.people[persona].name}-${sequence}.signature`;
  Object.defineProperty(backend.world, 'groups', { get: () => [group(server.signedIn)] });
  backend.reply('*', '*', ({ url, init, body, headers }) => {
    const path = url.pathname;
    if (path === '/api/auth/demo-persona/sign-in') {
      server.signedIn = body?.personaId === 'sam' ? sam : alex;
      return undefined;
    }
    if (['/api/auth/get-session', '/api/auth/sign-out'].includes(path)) return undefined;
    const cookie =
      /better-auth\.session_token=([^;]+)/.exec(headers.get('Cookie') ?? '')?.[1] ?? '';
    if (path === '/api/notifications/device') return answerDevice(init, cookie);
    if (path === '/api/groups' || path === '/api/user/balances') return undefined;
    return json({ data: {} });
  });
  const phoneDevice = testPhone(backend, {
    origin: 'http://localhost:4144',
    parts: {
      savedQueries: undefined,
      offlineIdentity: undefined,
      pendingInvitation: undefined,
      expenseDrafts: undefined,
      settlementAttempts: undefined,
      draftRequests: undefined,
      tagRequests: undefined,
      groupCreations: undefined,
      netInfo: undefined,
      newSubmissionKey: undefined,
      accountLocal: undefined,
    },
  });
  /**
   * Like expo-notifications, every token read also announces that token to the push token
   * listener: during the read (`'during'`) or just after it returns (`'after'`).
   */
  const app = (
    native: Partial<NonNullable<MobileDependencies['notifications']>> = {},
    timer?: MobileTimer,
    announce: 'during' | 'after' = 'after',
  ) => {
    let listener: ((token: string) => void) | null = null;
    const notifications = {
      ...notificationNative({
        installation: {
          id: '00000000-0000-4000-8000-000000000844',
          key: 'private-installation-proof-844844844',
        },
        token: 'private-token-1',
      }),
      onToken: vi.fn((next: (token: string) => void) => {
        listener = next;
        return () => {
          if (listener === next) listener = null;
        };
      }),
      ...native,
    };
    const read = notifications.token;
    notifications.token = vi.fn(async () => {
      const token = await read();
      if (announce === 'during') listener?.(token);
      else setTimeout(() => listener?.(token), 0);
      return token;
    });
    const controller = phoneDevice.open({ parts: { notifications, timer } });

    return {
      controller,
      notifications,
      /** The native token-change callback, as expo-notifications' push token listener calls it. */
      rotate: (token: string) => listener?.(token),
      listening: () => listener !== null,
    };
  };
  return {
    app,
    posts,
    server,
    maintenance: () => posts.filter((post) => post.maintenance === true),
    /** `GET /api/notifications/device` requests so far. */
    gets: () => gets,
    registration: () => registration,
  };
}
const held = <T>() => {
  let release!: (value: T) => void;
  const promise = new Promise<T>((resolve) => {
    release = resolve;
  });
  return { promise, release };
};
/** Lets every queued promise callback run. */
const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 0));
/** Requests keep their 20-second timeout; every other wait, such as a retry's, is 1 ms. */
const quickRetries: MobileTimer = (run, ms) => {
  const timeout = setTimeout(run, ms === 20_000 ? ms : 1);
  return () => clearTimeout(timeout);
};
/** Opted in on one app process, signed in and enabled through Settings. */
async function optedIn(device = phone(), timer?: MobileTimer) {
  const first = device.app({}, timer);
  await first.controller.signIn('alex');
  await first.controller.enableNotifications();
  expect(first.controller.getSnapshot().notifications.confirmed.enabled).toBe(true);
  return { device, first };
}

describe('a token change keeps an opted-in phone registered (#844)', () => {
  it('a native token change re-registers under the existing consent, with no permission prompt', async () => {
    const { device, first } = await optedIn();
    const before = first.controller.getSnapshot().notifications.confirmed;
    first.rotate('private-token-2');
    await vi.waitFor(() => expect(device.maintenance()).toHaveLength(1));
    expect(device.maintenance()[0]).toMatchObject({
      enabled: true,
      token: 'private-token-2',
      revision: before.revision,
      maintenance: true,
    });
    expect(device.maintenance()[0]).not.toHaveProperty('expenseUpdates');
    await vi.waitFor(() =>
      expect(first.controller.getSnapshot().notifications.confirmed.revision).toBe(
        before.revision + 1,
      ),
    );
    expect(first.controller.getSnapshot().notifications.confirmed).toMatchObject({
      enabled: true,
      binding: before.binding,
      expenseActivation: before.expenseActivation,
    });
    expect(device.registration()?.token).toBe('private-token-2');
    expect(first.notifications.requestPermission).toHaveBeenCalledOnce();
    expect(JSON.stringify(first.controller.getSnapshot())).not.toContain('private-token');
  });
  it('restoring the same session registers the current token without a prompt', async () => {
    const { device } = await optedIn();
    const next = device.app({ token: vi.fn(async () => 'private-token-after-restart') });
    expect(next.controller.getSnapshot().notifications.hasConfirmed).toBe(false);
    await next.controller.restore();
    await vi.waitFor(() => expect(device.maintenance()).toHaveLength(1));
    expect(device.maintenance()[0]).toMatchObject({ token: 'private-token-after-restart' });
    await vi.waitFor(() =>
      expect(device.registration()?.token).toBe('private-token-after-restart'),
    );
    expect(next.notifications.requestPermission).not.toHaveBeenCalled();
    expect(next.controller.getSnapshot().notifications.hasConfirmed).toBe(true);
    expect(next.controller.getSnapshot().notifications.confirmed.enabled).toBe(true);
    expect(JSON.stringify(next.controller.getSnapshot())).not.toContain('private-token');
  });
  it('a phone that never opted in, or that Android now blocks, uploads no token and is never prompted', async () => {
    const device = phone();
    const first = device.app();
    await first.controller.signIn('alex');
    first.rotate('private-token-2');
    await first.controller.restore();
    await settle();
    expect(device.posts).toHaveLength(0);
    await first.controller.enableNotifications();
    const blocked = device.app({ permission: vi.fn(async () => 'blocked' as const) });
    await blocked.controller.restore();
    blocked.rotate('private-token-3');
    await settle();
    expect(device.maintenance()).toHaveLength(0);
    expect(blocked.notifications.requestPermission).not.toHaveBeenCalled();
    expect(blocked.controller.getSnapshot().notifications.status).toBe('blocked');
  });
  it('a new sign-in of the same account starts off and uploads nothing', async () => {
    const { device, first } = await optedIn();
    await first.controller.signOut();
    await first.controller.signIn('alex');
    first.rotate('private-token-2');
    await settle();
    expect(device.maintenance()).toHaveLength(0);
    expect(first.controller.getSnapshot().notifications.confirmed.enabled).toBe(false);
  });
});

describe('a token read is not a token change (#844)', () => {
  it.each(['during', 'after'] as const)(
    'a cold start with an unchanged token reads the controls once and posts at most once (announced %s the read)',
    async (announce) => {
      const { device } = await optedIn();
      const posts = device.posts.length;
      const gets = device.gets();
      const next = device.app({}, undefined, announce);
      await next.controller.restore();
      await vi.waitFor(() => expect(device.maintenance()).toHaveLength(1));
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(device.gets() - gets).toBe(1);
      expect(device.posts.length - posts).toBeLessThanOrEqual(1);
      expect(next.controller.getSnapshot().notifications).toMatchObject({
        status: 'ready',
        confirmed: { enabled: true },
      });
    },
  );
  it('an Enable’s own token read starts no maintenance', async () => {
    const device = phone();
    const first = device.app({}, undefined, 'during');
    await first.controller.signIn('alex');
    const gets = device.gets();
    await first.controller.enableNotifications();
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(device.maintenance()).toHaveLength(0);
    expect(device.gets() - gets).toBe(0);
  });
  it('a different token announced during a maintenance read is still registered', async () => {
    const { device } = await optedIn();
    // FCM rotates while maintenance is reading the token it had.
    const next = device.app({
      token: vi.fn(async () => {
        next.rotate('private-token-rotated');
        return 'private-token-1';
      }),
    });
    await next.controller.restore();
    await vi.waitFor(() => expect(device.registration()?.token).toBe('private-token-rotated'));
  });
});

describe('maintenance retries are bounded and guarded by the session that asked (#844)', () => {
  it('retries a network failure a bounded number of times, then waits for the next change', async () => {
    const { device, first } = await optedIn(phone(), quickRetries);
    device.server.post = (body) => (body.maintenance ? networkFailure() : null);
    first.rotate('private-token-2');
    await vi.waitFor(() => expect(device.maintenance()).toHaveLength(3));
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(device.maintenance()).toHaveLength(3);
    device.server.post = null;
    first.rotate('private-token-3');
    await vi.waitFor(() => expect(device.registration()?.token).toBe('private-token-3'));
  });
  it('a refused maintenance is not retried; the phone reads its controls again', async () => {
    const { device, first } = await optedIn();
    device.server.post = (body) =>
      body.maintenance
        ? Promise.resolve(json({ error: 'Notification settings changed.' }, 409))
        : null;
    first.rotate('private-token-2');
    await vi.waitFor(() => expect(device.maintenance()).toHaveLength(1));
    await settle();
    await settle();
    expect(device.maintenance()).toHaveLength(1);
    expect(first.controller.getSnapshot().notifications.status).toBe('ready');
  });
  it.each(['Turn off', 'sign-out', 'another account', 'disposal'] as const)(
    'a token that arrives after %s is never uploaded',
    async (late) => {
      const { device } = await optedIn();
      const token = held<string>();
      const next = device.app({ token: vi.fn(() => token.promise) });
      const restoring = next.controller.restore();
      await vi.waitFor(() => expect(next.notifications.token).toHaveBeenCalled());
      if (late === 'Turn off') await next.controller.disableNotifications();
      if (late === 'sign-out') await next.controller.signOut();
      if (late === 'another account') {
        await next.controller.signOut();
        await next.controller.signIn('sam');
      }
      if (late === 'disposal') next.controller.dispose();
      token.release('private-late-token');
      await restoring;
      await settle();
      expect(device.maintenance()).toHaveLength(0);
      expect(device.registration()?.token).toBe('private-token-1');
      if (late !== 'Turn off')
        expect(next.controller.getSnapshot().notifications.confirmed.enabled).toBe(false);
    },
  );
  it('a reply that arrives after sign-out changes nothing, and a pending retry never fires', async () => {
    const { device, first } = await optedIn(phone(), quickRetries);
    const reply = held<Response>();
    device.server.post = (body) => (body.maintenance ? reply.promise : null);
    first.rotate('private-token-2');
    await vi.waitFor(() => expect(device.maintenance()).toHaveLength(1));
    await first.controller.signOut();
    reply.release(json({ error: 'Unavailable' }, 503));
    await settle();
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(device.maintenance()).toHaveLength(1);
    expect(first.controller.getSnapshot().notifications.confirmed.enabled).toBe(false);
  });
  it('disposal stops listening for native token changes', async () => {
    const { first } = await optedIn();
    expect(first.listening()).toBe(true);
    first.controller.dispose();
    expect(first.listening()).toBe(false);
  });
});

describe('two installations at the controller/native seam (#844)', () => {
  it('rotation on one phone leaves the other phone’s registration and switches alone', async () => {
    const one = await optedIn();
    const two = await optedIn();
    await two.first.controller.setNotificationCategory('expenseUpdates', false);
    one.first.rotate('private-token-one-2');
    await vi.waitFor(() => expect(one.device.registration()?.token).toBe('private-token-one-2'));
    expect(one.device.registration()?.expenseUpdates).toBe(true);
    expect(two.device.registration()).toMatchObject({
      token: 'private-token-1',
      expenseUpdates: false,
    });
    expect(two.device.maintenance()).toHaveLength(0);
  });
});

describe('an old binding cannot open or alert on this phone after a session change (#844)', () => {
  const envelope = (account: typeof alex, registration: Registration) => {
    const occurred = Date.now() - 1000;
    return {
      version: 2,
      eventId: 'd00000000000000000000844',
      kind: 'expense_added',
      groupId,
      recordId: 'c00000000000000000000844',
      accountId: account.id,
      environment: 'development',
      binding: registration.binding,
      activation: registration.activation,
      occurredAt: new Date(occurred).toISOString(),
      expiresAt: new Date(occurred + 86_400_000).toISOString(),
    };
  };
  it('sign-out clears alerts; another account, then the same account signed in again, reject the old tap', async () => {
    const { device, first } = await optedIn();
    const old = envelope(alex, device.registration()!);
    expect(await first.controller.receiveNotification(old, { visible: false })).toBe(true);
    await first.controller.signOut();
    expect(first.notifications.clear).toHaveBeenCalled();
    await first.controller.signIn('sam');
    const screen = first.controller.getSnapshot().screen;
    expect(await first.controller.receiveNotification(old, { visible: false })).toBe(false);
    await first.controller.tapNotification(old);
    expect(first.controller.getSnapshot()).toMatchObject({
      screen,
      notificationOpening: { status: 'idle' },
    });
    await first.controller.signOut();
    await first.controller.signIn('alex');
    expect(await first.controller.receiveNotification(old, { visible: false })).toBe(false);
    await first.controller.enableNotifications();
    // A fresh opt-in is a new binding: the old one's tap still opens nothing.
    expect(device.registration()!.binding).not.toBe(old.binding);
    await first.controller.tapNotification(old);
    expect(first.controller.getSnapshot()).toMatchObject({
      screen,
      notificationOpening: { status: 'idle' },
    });
    expect(
      await first.controller.receiveNotification(envelope(alex, device.registration()!), {
        visible: false,
      }),
    ).toBe(true);
    expect(JSON.stringify(first.controller.getSnapshot())).not.toContain('private-token');
  });
});
