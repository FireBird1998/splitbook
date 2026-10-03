import 'tsx/cjs';
import type { ExpoConfig } from 'expo/config';
import { androidInvitationFilters } from './src/config';

const development = process.env.EXPO_PUBLIC_APP_ENV === 'development';
const staging = process.env.EXPO_PUBLIC_APP_ENV === 'staging';
const appIdentifier = development
  ? 'com.splitbook.app.dev'
  : staging
    ? 'com.splitbook.app.staging'
    : 'com.splitbook.app';

export default {
  name: development ? 'SplitBook Dev' : staging ? 'SplitBook Staging' : 'SplitBook',
  slug: 'splitbook',
  version: '0.1.0',
  orientation: 'portrait',
  userInterfaceStyle: 'automatic',
  scheme: development ? 'splitbook-dev' : staging ? 'splitbook-staging' : 'splitbook',
  ios: { bundleIdentifier: appIdentifier },
  android: {
    package: appIdentifier,
    // Off until react-native#58407 is fixed in the React Native version in use. Opted in,
    // Android 13–15 never forward Back to the app, so it leaves from every screen, even mid-save.
    predictiveBackGestureEnabled: false,
    intentFilters: androidInvitationFilters({
      mode: process.env.EXPO_PUBLIC_APP_ENV,
      inviteOrigin: process.env.EXPO_PUBLIC_INVITE_ORIGIN,
      authOrigin: process.env.EXPO_PUBLIC_AUTH_ORIGIN,
    }),
  },
  // Android Google identity uses an explicit web client ID and native autolinking.
  // The Google Expo plugin configures Firebase/iOS, neither needed for this Android beta.
  plugins: [
    'expo-secure-store',
    'expo-font',
    ['expo-build-properties', { android: { usesCleartextTraffic: development } }],
  ],
} satisfies ExpoConfig;
