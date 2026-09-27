import type { ExpoConfig } from 'expo/config';

const development = process.env.EXPO_PUBLIC_APP_ENV === 'development';

export default {
  name: development ? 'SplitBook Dev' : 'SplitBook',
  slug: 'splitbook',
  version: '0.1.0',
  orientation: 'portrait',
  userInterfaceStyle: 'automatic',
  scheme: development ? 'splitbook-dev' : 'splitbook',
  ios: { bundleIdentifier: development ? 'com.splitbook.app.dev' : 'com.splitbook.app' },
  android: {
    package: development ? 'com.splitbook.app.dev' : 'com.splitbook.app',
    predictiveBackGestureEnabled: true,
  },
  plugins: [
    'expo-secure-store',
    'expo-font',
    ['expo-build-properties', { android: { usesCleartextTraffic: development } }],
  ],
} satisfies ExpoConfig;
