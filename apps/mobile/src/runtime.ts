import { androidWidgetsEnabled } from './widgets-flag';
import { createWidgetsNative, createWidgetsStore } from './widgets-native';
import { createNotificationNative, readNotificationInstallation } from './notifications-native';
import { androidNotificationsEnabled } from './notifications-flag';
import { createSettlementAttemptStore } from './data/settlement-storage';
import { randomUUID, getRandomBytes } from 'expo-crypto';
import { createExpenseDraftStore } from './data/expense-storage';
import { createGroupCreationStore } from './data/group-creation-storage';
import { createAccountGroupRecordStore, createSignOutRecord } from './data/account-record-storage';
import NetInfo from '@react-native-community/netinfo';
import { fetch as nativeFetch } from 'expo/fetch';
import { httpResponseStore } from './http-response-store';
import * as SecureStore from 'expo-secure-store';
import { createMobileController } from './data';
import { mobileConfig } from './config';
import { createGoogleIdentityProvider } from './google-identity';
import { createAppearanceController } from './data/appearance';
import { SEPARATOR } from '@splitbook/shared/separator';
import { decodeStoredSession } from './data/cookies';
import type { NotificationAccess } from './data/notification-receipt';

// No marker survives a restart. Both app and headless notification requests wait for cleanup.
const httpStoreReady = httpResponseStore.clear();
// Startup may finish before any request is made; the request still observes a cleanup failure.
void httpStoreReady.catch(() => undefined);
const fetch: typeof nativeFetch = async (...args) => {
  await httpStoreReady;
  return nativeFetch(...args);
};

// Android normally uses native reachability; the library's HTTP fallback must not cache either.
NetInfo.configure({ reachabilityHeaders: { 'Cache-Control': 'no-store' } });

const config = mobileConfig(
  {
    mode: process.env.EXPO_PUBLIC_APP_ENV,
    apiUrl: process.env.EXPO_PUBLIC_API_URL,
    authOrigin: process.env.EXPO_PUBLIC_AUTH_ORIGIN,
    inviteOrigin: process.env.EXPO_PUBLIC_INVITE_ORIGIN,
    googleWebClientId: process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID,
  },
  __DEV__,
);
export const configurationReady = config !== null;
export const googleSignInEnabled = Boolean(config?.googleWebClientId);

// The inert fallback only allows the setup screen to render. No restore is run.
const controllerConfig = config ?? {
  apiBaseUrl: 'http://127.0.0.1:4138',
  authOrigin: 'http://127.0.0.1:4138',
  developmentPersonaEnabled: false,
};
// Separate credentials even when two development servers share the same device.
const storageKey = `splitbook.session.${Array.from(controllerConfig.apiBaseUrl, (char) => char.charCodeAt(0).toString(16)).join('')}`;
const invitationKey = `splitbook.invitation.${Array.from(controllerConfig.inviteOrigin ?? controllerConfig.authOrigin, (char) => char.charCodeAt(0).toString(16)).join('')}`;
const cleanupKey = storageKey.replace('splitbook.session.', 'splitbook.cleanup.');
const ownerKey = storageKey.replace('splitbook.session.', 'splitbook.account-owner.');
export const environment = {
  isProduction: config?.googleEnvironment === 'production',
  label: googleSignInEnabled
    ? config?.googleEnvironment === 'production'
      ? `Private beta${SEPARATOR}production ledger`
      : `Private beta${SEPARATOR}staging ledger`
    : `Local development${SEPARATOR}fictional data`,
  apiOrigin: new URL(controllerConfig.apiBaseUrl).origin,
  webOrigin: new URL(controllerConfig.inviteOrigin ?? controllerConfig.authOrigin).origin,
};
// Appearance is a device preference: signing out must not reset it.
export const appearance = createAppearanceController({
  load: () => SecureStore.getItemAsync('splitbook.appearance'),
  save: (mode) => SecureStore.setItemAsync('splitbook.appearance', mode),
});
const tagRequests = createAccountGroupRecordStore(controllerConfig.apiBaseUrl, 'tag-request');
const draftRequests = createAccountGroupRecordStore(controllerConfig.apiBaseUrl, 'draft-request');
const expenseDrafts = createExpenseDraftStore(controllerConfig.apiBaseUrl);
const settlementAttempts = createSettlementAttemptStore(controllerConfig.apiBaseUrl);
const groupCreations = createGroupCreationStore(controllerConfig.apiBaseUrl);
// The persister is the sole saved-copy store (ADR 0006, #223).
const savedQueries = createAccountGroupRecordStore(controllerConfig.apiBaseUrl, 'saved');
// Saved copies this device couldn't remove (#212): kept apart from the database that failed.
const untrustedKey = storageKey.replace('splitbook.session.', 'splitbook.untrusted-copies.');
const untrustedCopies = {
  load: async () => JSON.parse((await SecureStore.getItemAsync(untrustedKey)) ?? 'null'),
  save: (record: unknown) => SecureStore.setItemAsync(untrustedKey, JSON.stringify(record)),
  clear: () => SecureStore.deleteItemAsync(untrustedKey),
};
const financialCleanupKey = storageKey.replace(
  'splitbook.session.',
  'splitbook.financial-cleanup.',
);
const financialCleanup = {
  load: async () => JSON.parse((await SecureStore.getItemAsync(financialCleanupKey)) ?? 'null'),
  save: (record: unknown) => SecureStore.setItemAsync(financialCleanupKey, JSON.stringify(record)),
  clear: () => SecureStore.deleteItemAsync(financialCleanupKey),
};
const offlineIdentityKey = storageKey.replace('splitbook.session.', 'splitbook.offline-identity.');
const offlineIdentity = {
  load: async () => {
    const value = await SecureStore.getItemAsync(offlineIdentityKey);
    return value ? JSON.parse(value) : null;
  },
  save: (value: unknown) => SecureStore.setItemAsync(offlineIdentityKey, JSON.stringify(value)),
  clear: () => SecureStore.deleteItemAsync(offlineIdentityKey),
};
const notificationNative = androidNotificationsEnabled()
  ? createNotificationNative(controllerConfig.apiBaseUrl)
  : undefined;
export const controller = createMobileController(controllerConfig, {
  notifications: notificationNative,
  widgets: androidWidgetsEnabled() ? createWidgetsNative(controllerConfig.apiBaseUrl) : undefined,
  googleSignIn: config?.googleWebClientId
    ? createGoogleIdentityProvider(
        config.googleWebClientId,
        async () => (await import('react-native-nitro-google-signin')).GoogleOneTapSignIn,
        () => Array.from(getRandomBytes(32), (byte) => byte.toString(16).padStart(2, '0')).join(''),
      )
    : undefined,
  fetch,
  savedQueries,
  netInfo: NetInfo,
  offlineIdentity,
  tagRequests,
  draftRequests,
  expenseDrafts,
  settlementAttempts,
  groupCreations,
  newSubmissionKey: randomUUID,
  credentials: {
    load: () => SecureStore.getItemAsync(storageKey),
    save: (cookie) => SecureStore.setItemAsync(storageKey, cookie),
    clear: () => SecureStore.deleteItemAsync(storageKey),
  },
  pendingInvitation: {
    load: () => SecureStore.getItemAsync(invitationKey),
    save: (code) => SecureStore.setItemAsync(invitationKey, code),
    clear: () => SecureStore.deleteItemAsync(invitationKey),
  },
  accountLocal: {
    cleanupMarker: {
      load: async () => (await SecureStore.getItemAsync(cleanupKey)) !== null,
      mark: () => SecureStore.setItemAsync(cleanupKey, 'pending'),
      clear: () => SecureStore.deleteItemAsync(cleanupKey),
    },
    signOutRecord: createSignOutRecord(controllerConfig.apiBaseUrl),
    untrustedCopies,
    financialCleanup,
    owner: {
      load: () => SecureStore.getItemAsync(ownerKey),
      save: (accountId) => SecureStore.setItemAsync(ownerKey, accountId),
      clear: () => SecureStore.deleteItemAsync(ownerKey),
    },
    stores: [
      tagRequests,
      draftRequests,
      expenseDrafts,
      settlementAttempts,
      groupCreations,
      savedQueries,
      untrustedCopies,
      financialCleanup,
      offlineIdentity,
      // A build with widgets off must still purge copies kept by an earlier enabled build.
      ...(!androidWidgetsEnabled()
        ? [{ clear: () => createWidgetsStore(controllerConfig.apiBaseUrl).clear() }]
        : []),
      ...(googleSignInEnabled
        ? [
            {
              clear: async () => {
                const { GoogleOneTapSignIn } = await import('react-native-nitro-google-signin');
                await GoogleOneTapSignIn.signOut();
              },
            },
          ]
        : []),
    ],
  },
});

/**
 * The notification task's checks with no app running (#968): this phone's saved session,
 * sign-out marker and installation, and one controls read with them. The installation is only
 * read, never created. It never restores a session, purges, revokes or reads a ledger: those
 * wait for the app.
 */
export const notificationAccess: NotificationAccess | null =
  notificationNative && config
    ? {
        environment: controllerConfig.googleEnvironment ?? 'development',
        leaving: async () => (await SecureStore.getItemAsync(cleanupKey)) !== null,
        session: async () => {
          const saved = await SecureStore.getItemAsync(storageKey);
          return saved
            ? decodeStoredSession(saved, controllerConfig.apiBaseUrl.startsWith('https:'))
            : null;
        },
        installation: () => readNotificationInstallation(controllerConfig.apiBaseUrl),
        controls: async (installation, cookie) => {
          const response = await fetch(
            controllerConfig.apiBaseUrl +
              '/api/notifications/device?installationId=' +
              encodeURIComponent(installation.id),
            {
              headers: {
                Accept: 'application/json',
                'Cache-Control': 'no-store',
                'X-Installation-Key': installation.key,
                Origin: controllerConfig.authOrigin,
                Cookie: cookie,
              },
              credentials: 'omit',
              redirect: 'error',
              signal: AbortSignal.timeout(8_000),
            },
          );
          if (!response.ok) throw new Error('Notification controls unavailable');
          return response.json();
        },
      }
    : null;
