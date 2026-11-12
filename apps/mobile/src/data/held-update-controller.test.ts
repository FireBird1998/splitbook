import { describe, expect, it } from 'vitest';
import { fakeSplitbook } from '../test-utils/fake-splitbook';
import { notificationHint, notificationPreferences } from '../test-utils/notification';
import { notificationNative, testPhone } from '../test-utils/test-phone';

const now = Date.UTC(2026, 10, 12, 12);

function setup() {
  const server = fakeSplitbook();
  server.world.notifications = { ...notificationPreferences };
  const phone = testPhone(server, { now, parts: { notifications: notificationNative() } });
  const controller = phone.open();
  const groupId = server.world.groups[0]._id;
  const hint = notificationHint(server.world.people.alex.id, groupId, now);
  return { server, phone, controller, groupId, hint };
}

async function refusedNotificationAfterNewTap() {
  const { server, controller: c, groupId, hint } = setup();
  await c.signIn('alex');
  let reads = 0;
  let arrived!: () => void, release!: () => void;
  const navigating = new Promise<void>((resolve) => {
    arrived = resolve;
  });
  const reply = new Promise<void>((resolve) => {
    release = resolve;
  });
  server.reply('GET', `/api/groups/${groupId}`, async () => {
    if (++reads === 2) {
      arrived();
      await reply;
    }
    return Response.json(
      { code: 'FORBIDDEN', error: 'You no longer have access to this Group.' },
      { status: 403 },
    );
  });
  const older = c.tapNotification(hint);
  try {
    await navigating;
    c.startCreate();
    c.updateCreation({ name: 'Keep this unfinished Group' });
    const form = c.getSnapshot().creation;
    await c.openWidget('choose-group');
    expect(c.getSnapshot()).toMatchObject({
      screen: 'create',
      notificationOpening: { status: 'held' },
      heldNotificationSource: 'widget',
    });
    release();
    await older;
    expect(c.getSnapshot().creation).toBe(form);
    expect(c.getSnapshot().screen).toBe('create');
    return c;
  } finally {
    release();
    await older;
  }
}

describe('held-update rules before extraction (#1158)', () => {
  // A normal test exercises the same setup/protection/form invariants: an unrelated
  // regression must fail normally rather than being swallowed by the expected failure.
  it('preserves the newer unfinished form through the refused-notification race', async () => {
    const c = await refusedNotificationAfterNewTap();
    expect(c.getSnapshot().creation.draft.name).toBe('Keep this unfinished Group');
  });

  // #1162: the older refused open must not erase a newer accepted tap.
  it('keeps a newer widget destination offered after an older refused notification finishes navigating', async () => {
    const c = await refusedNotificationAfterNewTap();
    expect(c.getSnapshot()).toMatchObject({
      screen: 'create',
      notificationOpening: { status: 'held' },
      heldNotificationSource: 'widget',
    });
    c.back();
    await c.openPendingNotification();
    expect(c.getSnapshot()).toMatchObject({
      screen: 'groups',
      widgetPicker: true,
      notificationOpening: { status: 'idle' },
      heldNotification: null,
    });
  });
  it.each(['expired', 'category-off'] as const)(
    'drops a notification that becomes %s while held, without opening its Group',
    async (reason) => {
      const { server, phone, controller: c, hint } = setup();
      await c.signIn('alex');
      c.startCreate();
      await c.tapNotification(hint);
      expect(c.getSnapshot().notificationOpening.status).toBe('held');
      if (reason === 'expired') phone.clock.now += 86_400_000;
      else {
        server.world.notifications = {
          ...notificationPreferences,
          expenseUpdates: false,
          revision: 2,
        };
        await c.refreshNotifications();
        expect(c.getSnapshot().notifications.confirmed.expenseUpdates).toBe(false);
      }
      c.back();
      await c.openPendingNotification();
      expect(c.getSnapshot()).toMatchObject({
        screen: 'groups',
        detail: { id: null, data: null },
        heldNotification: null,
        notificationOpening: { status: 'idle' },
      });
    },
  );
  it.each(['expired', 'category-off'] as const)(
    'drops a notification that becomes %s while its access check is in flight',
    async (reason) => {
      const { server, phone, controller: c, groupId, hint } = setup();
      await c.signIn('alex');
      c.startCreate();
      await c.tapNotification(hint);
      c.back();
      const held = server.hold('GET', `/api/groups/${groupId}`);
      const opening = c.openPendingNotification();
      try {
        await held.arrived;
        expect(c.getSnapshot().notificationOpening.status).toBe('opening');
        if (reason === 'expired') phone.clock.now += 86_400_000;
        else {
          server.world.notifications = {
            ...notificationPreferences,
            expenseUpdates: false,
            revision: 2,
          };
          await c.refreshNotifications();
          expect(c.getSnapshot().notifications.confirmed.expenseUpdates).toBe(false);
        }
        held.release();
        await opening;
        expect(c.getSnapshot()).toMatchObject({
          screen: 'groups',
          detail: { id: null, data: null },
          heldNotification: null,
          notificationOpening: { status: 'idle' },
        });
      } finally {
        held.release();
        await opening;
      }
    },
  );
  describe.each(['notification', 'widget'] as const)('%s open in flight', (source) => {
    it.each(['sign-out', '401', 'account-switch'] as const)(
      'drops the held destination on %s and ignores the late answer',
      async (reset) => {
        const { server, controller: c, groupId, hint } = setup();
        await c.signIn('alex');
        c.startCreate();
        if (source === 'notification') await c.tapNotification(hint);
        else await c.openWidget({ kind: 'group', groupId });
        c.back();
        const held = server.hold('GET', `/api/groups/${groupId}`);
        const opening = c.openPendingNotification();
        try {
          await held.arrived;
          expect(c.getSnapshot().notificationOpening.status).toBe('opening');
          if (reset === 'sign-out') await c.signOut();
          else if (reset === '401') {
            server.auth.expired = true;
            await c.refreshHome();
          } else await c.signIn('sam');
          const auth = c.getSnapshot().auth;
          expect(auth).toMatchObject(
            reset === 'account-switch'
              ? { status: 'authenticated', user: { id: server.world.people.sam.id } }
              : { status: 'signed-out', user: null },
          );
          expect(c.getSnapshot()).toMatchObject({
            screen: 'groups',
            detail: { id: null, data: null },
            heldNotification: null,
            heldNotificationNotice: null,
            heldNotificationSource: null,
            notificationOpening: { status: 'idle' },
          });
          held.release();
          await opening;
          expect(c.getSnapshot().auth).toEqual(auth);
          expect(c.getSnapshot()).toMatchObject({
            screen: 'groups',
            detail: { id: null, data: null },
            heldNotification: null,
            heldNotificationNotice: null,
            heldNotificationSource: null,
            notificationOpening: { status: 'idle' },
          });
          const settled = c.getSnapshot();
          await c.openPendingNotification();
          expect(c.getSnapshot()).toBe(settled);
        } finally {
          held.release();
          await opening;
        }
      },
    );
  });
});
