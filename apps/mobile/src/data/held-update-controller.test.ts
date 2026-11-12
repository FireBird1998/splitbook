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

describe('held-update rules before extraction (#1158)', () => {
  it('keeps a newer widget destination offered after an older refused notification finishes navigating', async () => {
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
    } finally {
      release();
      await older;
    }
  });
});
