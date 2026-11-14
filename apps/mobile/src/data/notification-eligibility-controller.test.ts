import { expect, it, vi } from 'vitest';
import { testPhone, notificationNative } from '../test-utils/test-phone';
import { fakeSplitbook } from '../test-utils/fake-splitbook';
import { notificationHint, notificationPreferences } from '../test-utils/notification';
import { manualTimer, within } from '../test-utils/transport-faults';

const now = Date.parse('2026-11-14T06:30:00Z');
const path = '/api/notifications/device';
const failures = [
  ['HTTP 500', 'error', 'Couldn’t confirm notification settings. Retry.'],
  ['network', 'offline', 'Connect to confirm notification settings.'],
  ['timeout', 'offline', 'Connect to confirm notification settings.'],
  ['invalid body', 'error', 'Couldn’t confirm notification settings. Retry.'],
] as const;
type Failure = (typeof failures)[number][0];
async function enabledPhone(options: { monitor?: false } = {}) {
  const server = fakeSplitbook();
  server.world.notifications = { ...notificationPreferences };
  const timer = manualTimer();
  const native = notificationNative();
  const phone = testPhone(server, {
    ...options,
    now,
    parts: { notifications: native, timer: timer.timer },
  });
  const app = phone.open();
  await app.signIn('alex');
  await app.refreshNotifications();
  expect(app.getSnapshot().notifications).toMatchObject({
    status: 'ready',
    confirmed: notificationPreferences,
  });
  const envelope = notificationHint(server.world.people.alex.id, server.world.groups[0]._id, now);
  const reads = () => server.requests.filter((r) => r.method === 'GET' && r.url.pathname === path);
  async function fail<T>(failure: Failure, action: () => Promise<T>) {
    const before = reads().length;
    if (failure === 'HTTP 500')
      server.reply(
        'GET',
        path,
        () => Response.json({ error: 'Fictional server failure' }, { status: 500 }),
        { once: true },
      );
    else if (failure === 'invalid body')
      server.reply('GET', path, () => Response.json({ data: { enabled: true } }), { once: true });
    else server.fault('GET', path, failure === 'timeout' ? 'headers' : 'offline', { once: true });
    const pending = action();
    if (failure === 'timeout') {
      await vi.waitFor(() => expect(reads()).toHaveLength(before + 1));
      timer.elapse(20_000);
    }
    return pending;
  }
  const holdRead = () =>
    server.hold('GET', path + '?installationId=00000000-0000-4000-8000-000000000001');
  return { app, server, phone, native, envelope, fail, holdRead, reads };
}
it.each(failures)(
  'withholds a background alert after %s without disabling confirmed settings, and Retry recovers (%s)',
  async (failure, status, message) => {
    const { app, server, envelope, fail } = await enabledPhone();
    expect(await fail(failure, () => app.receiveNotification(envelope, { visible: false }))).toBe(
      false,
    );
    expect(app.getSnapshot().notifications).toEqual({
      status,
      confirmed: notificationPreferences,
      hasConfirmed: true,
      message,
    });
    await app.retryNotifications();
    expect(app.getSnapshot().notifications).toMatchObject({
      status: 'ready',
      confirmed: notificationPreferences,
      message: '',
    });
    // A refused receipt was never marked seen: this same event can pass a later fresh check.
    expect(await app.receiveNotification(envelope, { visible: false })).toBe(true);
    expect(server.requests.filter((r) => r.method === 'POST' && r.url.pathname === path)).toEqual(
      [],
    );
  },
);
it.each(failures)(
  'does not admit a tap after %s, and a later fresh tap works (%s)',
  async (failure, status, message) => {
    const { app, envelope, fail } = await enabledPhone();
    app.startCreate();
    await fail(failure, () => app.tapNotification(envelope));
    expect(app.getSnapshot()).toMatchObject({
      screen: 'create',
      heldNotification: null,
      notificationOpening: { status: 'idle' },
      notifications: { status, message, confirmed: notificationPreferences },
    });
    await app.tapNotification(envelope);
    expect(app.getSnapshot().notificationOpening.status).toBe('held');
    app.back();
    await app.openPendingNotification();
    expect(app.getSnapshot()).toMatchObject({
      screen: 'group',
      destination: 'activity',
      detail: { id: envelope.groupId, status: 'ready' },
      notificationOpening: { status: 'idle' },
    });
  },
);
it('an earlier receipt joins a newer successful Settings read in the same session', async () => {
  const { app, envelope, holdRead, reads } = await enabledPhone();
  const before = reads().length;
  const held = holdRead();
  const receipt = app.receiveNotification(envelope, { visible: false });
  await held.arrived;
  try {
    await app.refreshNotifications();
    // The older network request need not finish before its caller gets the fresh answer.
    expect(await within(receipt)).toBe(true);
  } finally {
    held.release();
  }
  expect(reads()).toHaveLength(before + 2);
});
it('a failed older notification check preserves a newer held widget update', async () => {
  const { app, server, envelope, holdRead } = await enabledPhone();
  app.startCreate();
  server.reply(
    'GET',
    path,
    () => Response.json({ error: 'Fictional server failure' }, { status: 500 }),
    { once: true },
  );
  const held = holdRead();
  const tap = app.tapNotification(envelope);
  await held.arrived;
  await app.openWidget('home');
  const owner = app.getSnapshot().heldNotification;
  expect(owner).not.toBeNull();
  expect(app.getSnapshot().heldNotificationSource).toBe('widget');
  held.release();
  await tap;
  expect(app.getSnapshot()).toMatchObject({
    screen: 'create',
    notificationOpening: { status: 'held' },
    heldNotificationSource: 'widget',
    notifications: { status: 'error' },
  });
  expect(app.getSnapshot().heldNotification).toBe(owner);
  app.back();
  await app.openPendingNotification();
  expect(app.getSnapshot()).toMatchObject({
    screen: 'groups',
    notificationOpening: { status: 'idle' },
  });
});
it.each(['receipt', 'tap'] as const)(
  'retires a %s checked under the previous account even after the next account confirms enabled settings',
  async (kind) => {
    const { app, server, envelope, holdRead } = await enabledPhone();
    const held = holdRead();
    const pending =
      kind === 'receipt'
        ? app.receiveNotification(envelope, { visible: false })
        : app.tapNotification(envelope);
    await held.arrived;
    await app.signOut();
    await app.signIn('sam');
    await app.refreshNotifications();
    held.release();
    const answer = await pending;
    if (kind === 'receipt') expect(answer).toBe(false);
    expect(app.getSnapshot()).toMatchObject({
      auth: { status: 'authenticated', user: { id: server.world.people.sam.id } },
      screen: 'groups',
      heldNotification: null,
      notificationOpening: { status: 'idle' },
      notifications: { status: 'ready', confirmed: notificationPreferences },
    });
  },
);
it('retires a receipt when the same account starts a replacement session during its check', async () => {
  const { app, envelope, holdRead } = await enabledPhone();
  const held = holdRead();
  const receipt = app.receiveNotification(envelope, { visible: false });
  await held.arrived;
  await app.signOut();
  await app.signIn('alex');
  await app.refreshNotifications();
  held.release();
  expect(await receipt).toBe(false);
  expect(app.getSnapshot().notifications.status).toBe('ready');
});
it('rejects an envelope that expires while its fresh controls are being read', async () => {
  const { app, phone, envelope, holdRead } = await enabledPhone();
  const held = holdRead();
  const receipt = app.receiveNotification(envelope, { visible: false });
  await held.arrived;
  phone.clock.now = now + 86_400_000;
  held.release();
  expect(await receipt).toBe(false);
});
it('withholds a receipt when the fresh permission read fails, without discarding confirmed settings', async () => {
  const { app, native, envelope } = await enabledPhone();
  native.permission.mockRejectedValueOnce(new Error('Fictional native permission read failure'));
  expect(await app.receiveNotification(envelope, { visible: false })).toBe(false);
  expect(app.getSnapshot().notifications).toMatchObject({
    status: 'error',
    confirmed: notificationPreferences,
  });
  expect(await app.receiveNotification(envelope, { visible: false })).toBe(true);
});
it('does not check or admit notifications while a member changes their consent', async () => {
  const { app, server, envelope } = await enabledPhone();
  server.reply(
    'POST',
    path,
    () =>
      Response.json({
        data: {
          ...notificationPreferences,
          enabled: false,
          expenseUpdates: false,
          payments: false,
          revision: 2,
        },
      }),
    { once: true },
  );
  const held = server.hold('POST', path);
  const disabling = app.disableNotifications();
  await held.arrived;
  expect(app.getSnapshot().notifications.status).toBe('pending');
  const before = server.requests.length;
  expect(await app.receiveNotification(envelope, { visible: false })).toBe(false);
  await app.tapNotification(envelope);
  expect(app.getSnapshot().heldNotification).toBeNull();
  expect(server.requests).toHaveLength(before);
  held.release();
  await disabling;
  expect(app.getSnapshot().notifications.confirmed.enabled).toBe(false);
});
it('a 401 during the fresh check ends the session and admits neither alert nor tap', async () => {
  const { app, server, envelope } = await enabledPhone();
  server.reply(
    'GET',
    path,
    () => Response.json({ error: 'Unauthorized', code: 'UNAUTHORIZED' }, { status: 401 }),
    { once: true },
  );
  expect(await app.receiveNotification(envelope, { visible: false })).toBe(false);
  await app.tapNotification(envelope);
  expect(app.getSnapshot()).toMatchObject({
    auth: { status: 'signed-out' },
    heldNotification: null,
    notificationOpening: { status: 'idle' },
  });
});
it('does not admit an alert or tap without the native notification module', async () => {
  const server = fakeSplitbook();
  server.world.notifications = notificationPreferences;
  const app = testPhone(server, { now, parts: { notifications: undefined } }).open();
  await app.signIn('alex');
  const envelope = notificationHint(server.world.people.alex.id, server.world.groups[0]._id, now);
  const before = server.requests.length;
  expect(await app.receiveNotification(envelope, { visible: false })).toBe(false);
  await app.tapNotification(envelope);
  expect(app.getSnapshot()).toMatchObject({
    heldNotification: null,
    notifications: { hasConfirmed: false, confirmed: { enabled: false } },
  });
  expect(server.requests).toHaveLength(before);
});
it('a fresh disabled answer replaces earlier enabled values and rejects both alert and tap', async () => {
  const { app, server, envelope } = await enabledPhone();
  server.world.notifications = {
    ...notificationPreferences,
    enabled: false,
    expenseUpdates: false,
    payments: false,
    revision: 2,
  };
  expect(await app.receiveNotification(envelope, { visible: false })).toBe(false);
  app.startCreate();
  await app.tapNotification(envelope);
  expect(app.getSnapshot()).toMatchObject({
    screen: 'create',
    heldNotification: null,
    notificationOpening: { status: 'idle' },
    notifications: { status: 'ready', confirmed: { enabled: false, revision: 2 } },
  });
});

it.each([2, 3])(
  'allows every envelope in a %s-notification burst without extra device GETs',
  async (count) => {
    const { app, envelope, holdRead, reads } = await enabledPhone();
    const before = reads().length;
    const pending: Promise<boolean>[] = [];
    const holds: ReturnType<typeof holdRead>[] = [];
    for (let i = 0; i < count; i++) {
      const held = holdRead();
      holds.push(held);
      pending.push(
        app.receiveNotification(
          { ...envelope, eventId: 'd0000000000000000000000' + (i + 1) },
          { visible: false },
        ),
      );
      await held.arrived;
    }
    holds.at(-1)!.release();
    expect(await pending.at(-1)).toBe(true);
    for (const held of holds) held.release();
    expect(await Promise.all(pending)).toEqual(Array(count).fill(true));
    expect(reads()).toHaveLength(before + count);
  },
);
it('allows simultaneous envelopes even when only the last read reaches the network', async () => {
  const { app, envelope, reads } = await enabledPhone();
  const before = reads().length;
  const results = await Promise.all(
    [1, 2, 3].map((i) =>
      app.receiveNotification(
        { ...envelope, eventId: 'd0000000000000000000000' + i },
        { visible: false },
      ),
    ),
  );
  expect(results).toEqual([true, true, true]);
  expect(reads()).toHaveLength(before + 1);
});
it.each(['HTTP 500', 'disabled'] as const)(
  'withholds both concurrent envelopes when the newer read answers %s',
  async (outcome) => {
    const { app, server, envelope, holdRead, reads } = await enabledPhone();
    const before = reads().length;
    const older = holdRead();
    const first = app.receiveNotification(envelope, { visible: false });
    await older.arrived;
    if (outcome === 'HTTP 500')
      server.reply(
        'GET',
        path,
        () => Response.json({ error: 'Fictional failure' }, { status: 500 }),
        { once: true },
      );
    else
      server.world.notifications = {
        ...notificationPreferences,
        enabled: false,
        expenseUpdates: false,
        payments: false,
        revision: 2,
      };
    const newer = holdRead();
    const second = app.receiveNotification(
      { ...envelope, eventId: 'd00000000000000000000002' },
      { visible: false },
    );
    await newer.arrived;
    newer.release();
    try {
      expect(await within(Promise.all([first, second]))).toEqual([false, false]);
    } finally {
      older.release();
    }
    expect(reads()).toHaveLength(before + 2);
    expect(app.getSnapshot().notifications).toMatchObject(
      outcome === 'HTTP 500'
        ? { status: 'error', confirmed: notificationPreferences }
        : { status: 'ready', confirmed: { enabled: false, revision: 2 } },
    );
  },
);
it.each(['receipt', 'tap'] as const)(
  'retires an in-flight %s when a disable is pending instead of joining a skipped read',
  async (kind) => {
    // The existing controller allows loading → pending; the flow table omits that transition.
    const { app, server, envelope, holdRead, reads } = await enabledPhone({ monitor: false });
    server.reply('POST', path, () =>
      Response.json({
        data: {
          ...notificationPreferences,
          enabled: false,
          expenseUpdates: false,
          payments: false,
          revision: 2,
        },
      }),
    );
    app.startCreate();
    const before = reads().length;
    const held = holdRead();
    const pending =
      kind === 'receipt'
        ? app.receiveNotification(envelope, { visible: false })
        : app.tapNotification(envelope);
    await held.arrived;
    const write = server.hold('POST', path);
    const disabling = app.disableNotifications();
    await write.arrived;
    try {
      await app.refreshNotifications();
      const answer = await within<boolean | void>(pending);
      if (kind === 'receipt') expect(answer).toBe(false);
      expect(app.getSnapshot()).toMatchObject({
        screen: 'create',
        heldNotification: null,
        notifications: { status: 'pending' },
      });
      expect(reads()).toHaveLength(before + 1);
    } finally {
      held.release();
      write.release();
      await disabling;
    }
  },
);
it('a category change retires an earlier check even if a later same-session read succeeds', async () => {
  // The existing controller allows loading → pending; the flow table omits that transition.
  const { app, server, envelope, holdRead } = await enabledPhone({ monitor: false });
  const held = holdRead();
  const receipt = app.receiveNotification(envelope, { visible: false });
  await held.arrived;
  server.world.notifications = { ...notificationPreferences, payments: false, revision: 2 };
  server.reply('POST', path, () => Response.json({ data: server.world.notifications }));
  try {
    await app.setNotificationCategory('payments', false);
    await app.refreshNotifications();
    expect(await within(receipt)).toBe(false);
    expect(app.getSnapshot().notifications).toMatchObject({
      status: 'ready',
      confirmed: { payments: false, expenseUpdates: true },
    });
  } finally {
    held.release();
  }
});
it('does not join the next account’s notification check when the account changes between receipts', async () => {
  const { app, server, envelope, holdRead } = await enabledPhone();
  const held = holdRead();
  const oldReceipt = app.receiveNotification(envelope, { visible: false });
  await held.arrived;
  try {
    await app.signOut();
    await app.signIn('sam');
    const nextEnvelope = notificationHint(server.world.people.sam.id, envelope.groupId, now);
    expect(await app.receiveNotification(nextEnvelope, { visible: false })).toBe(true);
    expect(await within(oldReceipt)).toBe(false);
    expect(app.getSnapshot().auth).toMatchObject({
      status: 'authenticated',
      user: { id: server.world.people.sam.id },
    });
  } finally {
    held.release();
  }
});
it.each(['enabled', 'HTTP 500', 'disabled'] as const)(
  'a notification tap joins a newer Settings read that answers %s',
  async (outcome) => {
    const { app, server, envelope, holdRead, reads } = await enabledPhone();
    app.startCreate();
    const before = reads().length;
    const held = holdRead();
    const tap = app.tapNotification(envelope);
    await held.arrived;
    if (outcome === 'HTTP 500')
      server.reply(
        'GET',
        path,
        () => Response.json({ error: 'Fictional failure' }, { status: 500 }),
        { once: true },
      );
    else if (outcome === 'disabled')
      server.world.notifications = {
        ...notificationPreferences,
        enabled: false,
        expenseUpdates: false,
        payments: false,
        revision: 2,
      };
    try {
      await app.refreshNotifications();
      await within(tap);
      expect(app.getSnapshot()).toMatchObject({
        screen: 'create',
        notificationOpening: { status: outcome === 'enabled' ? 'held' : 'idle' },
        ...(outcome === 'enabled'
          ? { heldNotificationSource: 'notification' }
          : { heldNotification: null }),
      });
      expect(reads()).toHaveLength(before + 2);
      if (outcome === 'enabled') {
        app.back();
        await app.openPendingNotification();
        expect(app.getSnapshot()).toMatchObject({
          screen: 'group',
          destination: 'activity',
          detail: { id: envelope.groupId },
        });
      }
    } finally {
      held.release();
    }
  },
);
