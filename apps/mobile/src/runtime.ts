import { createFinancialReadStore } from './data/read-cache-storage';
import { createSettlementAttemptStore } from './data/settlement-storage';
import { randomUUID, getRandomBytes } from 'expo-crypto';
import { createExpenseDraftStore } from './data/expense-storage';
import { fetch } from 'expo/fetch';
import * as SecureStore from 'expo-secure-store';
import { createMobileController } from './data';
import { mobileConfig } from './config';
import { createGoogleIdentityProvider } from './google-identity';
import { createAppearanceController } from './data/appearance';

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
  label: googleSignInEnabled
    ? 'Private beta · staging ledger'
    : 'Local development · fictional data',
  apiOrigin: new URL(controllerConfig.apiBaseUrl).origin,
  webOrigin: new URL(controllerConfig.inviteOrigin ?? controllerConfig.authOrigin).origin,
};
// Appearance is a device preference: signing out must not reset it.
export const appearance = createAppearanceController({
  load: () => SecureStore.getItemAsync('splitbook.appearance'),
  save: (mode) => SecureStore.setItemAsync('splitbook.appearance', mode),
});
const expenseDrafts = createExpenseDraftStore(controllerConfig.apiBaseUrl);
const settlementAttempts = createSettlementAttemptStore(controllerConfig.apiBaseUrl);
const readCache = createFinancialReadStore(controllerConfig.apiBaseUrl);
const offlineIdentityKey = storageKey.replace('splitbook.session.', 'splitbook.offline-identity.');
const offlineIdentity = {
  load: async () => {
    const value = await SecureStore.getItemAsync(offlineIdentityKey);
    return value ? JSON.parse(value) : null;
  },
  save: (value: unknown) => SecureStore.setItemAsync(offlineIdentityKey, JSON.stringify(value)),
  clear: () => SecureStore.deleteItemAsync(offlineIdentityKey),
};
export const controller = createMobileController(controllerConfig, {
  googleSignIn: config?.googleWebClientId
    ? createGoogleIdentityProvider(
        config.googleWebClientId,
        async () => (await import('react-native-nitro-google-signin')).GoogleOneTapSignIn,
        () => Array.from(getRandomBytes(32), (byte) => byte.toString(16).padStart(2, '0')).join(''),
      )
    : undefined,
  fetch,
  readCache,
  offlineIdentity,
  expenseDrafts,
  settlementAttempts,
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
    owner: {
      load: () => SecureStore.getItemAsync(ownerKey),
      save: (accountId) => SecureStore.setItemAsync(ownerKey, accountId),
      clear: () => SecureStore.deleteItemAsync(ownerKey),
    },
    stores: [
      expenseDrafts,
      settlementAttempts,
      readCache,
      offlineIdentity,
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
