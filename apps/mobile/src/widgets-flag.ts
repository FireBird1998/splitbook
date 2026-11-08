/** Keep this literal read so Expo can inline the build switch. */
export const androidWidgetsEnabled = () =>
  process.env.EXPO_PUBLIC_ANDROID_WIDGETS_ENABLED === 'true';
