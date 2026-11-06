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
      clears = 0;
    const boundary: NotificationNative = {
      installation: async () => ({ id, key }),
      permission: async () => 'granted',
      requestPermission: async () => {
        prompts++;
        return 'granted';
      },
      token: async () => 'fictional-device-token-' + suffix + '-' + id,
      clear: async () => {
        clears++;
      },
      openSettings: async () => {},
    };
    return { boundary, prompts: () => prompts, clears: () => clears };
  };
  const phone = (boundary: NotificationNative) => {
    let cookie: string | null = null;
    return createMobileController(
      { apiBaseUrl: origin, authOrigin: origin, developmentPersonaEnabled: true },
      {
        fetch: (url, init) => fetch(url, init),
        notifications: boundary,
        credentials: {
          load: async () => cookie,
          save: async (value) => {
            cookie = value;
          },
          clear: async () => {
            cookie = null;
          },
        },
      },
    );
  };
  const firstNative = native('one'),
    secondNative = native('two');
  const first = phone(firstNative.boundary),
    second = phone(secondNative.boundary);
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
    await first.refreshNotifications();
    assert.equal(first.getSnapshot().notifications.confirmed.enabled, false);
    assert.equal(first.getSnapshot().notifications.confirmed.expenseUpdates, false);
    assert.equal(JSON.stringify(first.getSnapshot()).includes('fictional-device-token-'), false);
    assert.equal(JSON.stringify(second.getSnapshot()).includes('fictional-device-token-'), false);
    console.log(
      'PASS notification Settings: two independent phones, explicit consent, category confirmation, account transition and token privacy.',
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
