/** Per-phone Settings -> controller -> authenticated HTTP -> real MongoDB; only native calls are substituted. */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createMobileController } from '../src/data/mobile-controller';
import { localOrigin } from './verification-origin';
import { reportVerifierFailure } from './verify-report';
import type { NotificationNative } from '../src/data/notification-controls';

async function verify() {
  const origin = localOrigin();
  const native = (suffix: string) => {
    const id = randomUUID(),
      key = randomUUID() + randomUUID();
    let prompts = 0,
      clears = 0,
      generation = 1;
    let listener: ((token: string) => void) | null = null;
    const current = () => 'fictional-device-token-' + suffix + '-' + generation + '-' + id;
    const boundary: NotificationNative = {
      installation: async () => ({ id, key }),
      permission: async () => 'granted',
      requestPermission: async () => {
        prompts++;
        return 'granted';
      },
      token: async () => current(),
      onToken: (next) => {
        listener = next;
        return () => {
          if (listener === next) listener = null;
        };
      },
      clear: async () => {
        clears++;
      },
      openSettings: async () => {},
    };
    return {
      boundary,
      prompts: () => prompts,
      clears: () => clears,
      /** FCM rotates this phone's token; the native listener tells the running app (#844). */
      rotate: (tell = true) => {
        generation++;
        if (tell) listener?.(current());
      },
    };
  };
  /** A phone's saved session cookie, which outlives one process of the app. */
  const savedSession = () => {
    let cookie: string | null = null;
    return {
      load: async () => cookie,
      save: async (value: string) => {
        cookie = value;
      },
      clear: async () => {
        cookie = null;
      },
    };
  };
  const confirmedAfter = async (
    controller: ReturnType<typeof createMobileController>,
    check: (
      confirmed: ReturnType<typeof first.getSnapshot>['notifications']['confirmed'],
    ) => boolean,
  ) => {
    for (let attempt = 0; attempt < 100; attempt++) {
      await controller.refreshNotifications();
      const { confirmed } = controller.getSnapshot().notifications;
      if (check(confirmed)) return confirmed;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    throw new Error('The notification registration did not change as expected.');
  };
  const phone = (boundary: NotificationNative, credentials = savedSession()) => {
    return createMobileController(
      { apiBaseUrl: origin, authOrigin: origin, developmentPersonaEnabled: true },
      {
        fetch: (url, init) => fetch(url, init),
        notifications: boundary,
        credentials,
      },
    );
  };
  const firstNative = native('one'),
    secondNative = native('two');
  const secondSession = savedSession();
  const first = phone(firstNative.boundary);
  let second = phone(secondNative.boundary, secondSession);
  try {
    await first.signIn('alex');
    await second.signIn('alex');
    assert.equal(first.getSnapshot().auth.status, 'authenticated');
    assert.equal(second.getSnapshot().auth.status, 'authenticated');
    first.openSettings();
    second.openSettings();
    await first.refreshNotifications();
    await second.refreshNotifications();
    assert.equal(firstNative.prompts(), 0);
    assert.equal(secondNative.prompts(), 0);
    assert.equal(first.getSnapshot().notifications.confirmed.enabled, false);
    assert.equal(second.getSnapshot().notifications.confirmed.enabled, false);
    await first.enableNotifications();
    assert.equal(first.getSnapshot().notifications.confirmed.enabled, true);
    await second.refreshNotifications();
    assert.equal(second.getSnapshot().notifications.confirmed.enabled, false);
    await second.enableNotifications();
    // Token rotation (#844): the running app re-registers under the consent it already has.
    const enabled = second.getSnapshot().notifications.confirmed;
    secondNative.rotate();
    const rotated = await confirmedAfter(second, (c) => c.revision === enabled.revision + 1);
    assert.equal(rotated.binding, enabled.binding);
    assert.equal(rotated.expenseActivation, enabled.expenseActivation);
    assert.equal(rotated.expenseCutoff, enabled.expenseCutoff);
    // The same session restored in a new process, after a rotation it missed while not running.
    second.dispose();
    secondNative.rotate(false);
    second = phone(secondNative.boundary, secondSession);
    await second.restore();
    const restored = await confirmedAfter(second, (c) => c.revision === rotated.revision + 1);
    assert.equal(restored.enabled, true);
    assert.equal(restored.binding, enabled.binding);
    assert.equal(restored.expenseActivation, enabled.expenseActivation);
    assert.equal(secondNative.prompts(), 1);
    await first.setNotificationCategory('payments', false);
    await second.refreshNotifications();
    assert.equal(first.getSnapshot().notifications.confirmed.payments, false);
    assert.equal(second.getSnapshot().notifications.confirmed.payments, true);
    await first.disableNotifications();
    assert.equal(first.getSnapshot().notifications.confirmed.enabled, false);
    await second.refreshNotifications();
    assert.equal(second.getSnapshot().notifications.confirmed.enabled, true);
    await first.signOut();
    assert.ok(firstNative.clears() > 0);
    await first.signIn('sam');
    // Another account's token change on this phone revives nothing (#844).
    firstNative.rotate();
    await new Promise((resolve) => setTimeout(resolve, 200));
    await first.refreshNotifications();
    assert.equal(first.getSnapshot().notifications.confirmed.enabled, false);
    assert.equal(first.getSnapshot().notifications.confirmed.expenseUpdates, false);
    assert.equal(JSON.stringify(first.getSnapshot()).includes('fictional-device-token-'), false);
    assert.equal(JSON.stringify(second.getSnapshot()).includes('fictional-device-token-'), false);
    console.log(
      'PASS notification Settings: two independent phones, explicit consent, category confirmation, token rotation, same-session restoration, account transition and token privacy.',
    );
  } finally {
    await first.signOut();
    await second.signOut();
  }
}
verify().catch((error) => {
  reportVerifierFailure(error);
  process.exitCode = 1;
});
