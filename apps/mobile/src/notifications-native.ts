import * as SecureStore from 'expo-secure-store';
import { randomUUID } from 'expo-crypto';
import { Linking, Platform } from 'react-native';
import type { NotificationNative } from './data/notification-controls';

const installationKey = (environment: string) =>
  'splitbook.notification-installation.' +
  Array.from(environment, (c) => c.charCodeAt(0).toString(16)).join('');

/** This phone's saved installation identity, or null when none is saved. Never writes. */
export async function readNotificationInstallation(
  environment: string,
): Promise<{ id: string; key: string } | null> {
  const saved = await SecureStore.getItemAsync(installationKey(environment));
  if (!saved) return null;
  const value: unknown = JSON.parse(saved);
  if (
    typeof value === 'object' &&
    value &&
    'id' in value &&
    'key' in value &&
    typeof value.id === 'string' &&
    typeof value.key === 'string'
  )
    return { id: value.id, key: value.key };
  throw new Error('Installation identity is unavailable');
}

/** The only boundary that obtains Android permissions and raw FCM tokens. */
export function createNotificationNative(environment: string): NotificationNative {
  let installation: Promise<{ id: string; key: string }> | null = null;
  const native = () => import('expo-notifications');
  const permission = (value: { granted: boolean; canAskAgain: boolean }) =>
    value.granted
      ? ('granted' as const)
      : value.canAskAgain
        ? ('denied' as const)
        : ('blocked' as const);
  return {
    installation: () => {
      installation ??= (async () => {
        const saved = await readNotificationInstallation(environment);
        if (saved) return saved;
        const value = { id: randomUUID(), key: randomUUID() + randomUUID() };
        await SecureStore.setItemAsync(installationKey(environment), JSON.stringify(value));
        return value;
      })().catch((error) => {
        installation = null;
        throw error;
      });
      return installation;
    },
    permission: async () => permission(await (await native()).getPermissionsAsync()),
    requestPermission: async () => {
      if (Platform.OS !== 'android') return 'blocked';
      const n = await native();
      await n.setNotificationChannelAsync('ledger-updates', {
        name: 'Expense updates and Payments',
        importance: n.AndroidImportance.DEFAULT,
      });
      const current = await n.getPermissionsAsync();
      return permission(current.granted ? current : await n.requestPermissionsAsync());
    },
    token: async () => {
      const token = await (await native()).getDevicePushTokenAsync();
      if (token.type !== 'android' || typeof token.data !== 'string')
        throw new Error('Android token unavailable');
      return token.data;
    },
    // FCM can rotate this phone's token at any time; the controller re-registers it (#844).
    onToken: (listener) => {
      let listening = true;
      let subscription: { remove(): void } | null = null;
      void native()
        .then((n) => {
          if (!listening) return;
          subscription = n.addPushTokenListener((token) => {
            if (listening && token.type === 'android' && typeof token.data === 'string')
              listener(token.data);
          });
        })
        .catch(() => undefined);
      return () => {
        listening = false;
        subscription?.remove();
      };
    },
    clear: async () => {
      const n = await native();
      await Promise.all([
        n.dismissAllNotificationsAsync(),
        n.cancelAllScheduledNotificationsAsync(),
      ]);
    },
    openSettings: () => Linking.openSettings(),
  };
}
