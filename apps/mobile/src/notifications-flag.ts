/**
 * Whether this build turns on Android notifications. Expo inlines the literal
 * `process.env.EXPO_PUBLIC_…` read at build time, so keep it written out here.
 */
export const androidNotificationsEnabled = () =>
  process.env.EXPO_PUBLIC_ANDROID_NOTIFICATIONS_ENABLED === 'true';
