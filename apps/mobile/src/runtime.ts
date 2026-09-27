import { fetch } from 'expo/fetch';
import * as SecureStore from 'expo-secure-store';
import { createMobileController } from './data';
import { developmentConfig } from './config';

const config = developmentConfig(
  {
    mode: process.env.EXPO_PUBLIC_APP_ENV,
    apiUrl: process.env.EXPO_PUBLIC_API_URL,
    authOrigin: process.env.EXPO_PUBLIC_AUTH_ORIGIN,
  },
  __DEV__,
);
export const configurationReady = config !== null;

// The inert fallback only allows the setup screen to render. No restore is run.
const controllerConfig = config ?? {
  apiBaseUrl: 'http://127.0.0.1:4138',
  authOrigin: 'http://127.0.0.1:4138',
  developmentPersonaEnabled: false,
};
// Separate credentials even when two development servers share the same device.
const storageKey = `splitbook.session.${Array.from(controllerConfig.apiBaseUrl, (char) => char.charCodeAt(0).toString(16)).join('')}`;
export const controller = createMobileController(controllerConfig, {
  fetch,
  credentials: {
    load: () => SecureStore.getItemAsync(storageKey),
    save: (cookie) => SecureStore.setItemAsync(storageKey, cookie),
    clear: () => SecureStore.deleteItemAsync(storageKey),
  },
});
