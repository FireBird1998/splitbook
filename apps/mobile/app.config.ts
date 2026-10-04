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
  // Brand kit exports (tools/brand); colors are assets/brand/brand.json's ink and paper.
  icon: './assets/brand/app-icon.png',
  userInterfaceStyle: 'automatic',
  scheme: development ? 'splitbook-dev' : staging ? 'splitbook-staging' : 'splitbook',
  ios: { bundleIdentifier: appIdentifier },
  android: {
    package: appIdentifier,
    predictiveBackGestureEnabled: true,
    intentFilters: androidInvitationFilters({
      mode: process.env.EXPO_PUBLIC_APP_ENV,
      inviteOrigin: process.env.EXPO_PUBLIC_INVITE_ORIGIN,
      authOrigin: process.env.EXPO_PUBLIC_AUTH_ORIGIN,
    }),
    adaptiveIcon: {
      foregroundImage: './assets/brand/android-foreground.png',
      monochromeImage: './assets/brand/android-monochrome.png',
      backgroundColor: '#172033',
    },
  },
  // Android Google identity uses an explicit web client ID and native autolinking.
  // The Google Expo plugin configures Firebase/iOS, neither needed for this Android beta.
  plugins: [
    'expo-secure-store',
    'expo-font',
    ['expo-build-properties', { android: { usesCleartextTraffic: development } }],
    // Each image is the whole 288 dp splash icon canvas, padded for Android's circular mask.
    [
      'expo-splash-screen',
      {
        image: './assets/brand/splash-light.png',
        imageWidth: 288,
        backgroundColor: '#F8F9FC',
        dark: { image: './assets/brand/splash-dark.png', backgroundColor: '#172033' },
      },
    ],
  ],
} satisfies ExpoConfig;
