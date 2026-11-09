import { registerRootComponent } from 'expo';

import App from './App';
import { reconcileWidgetSetups } from './src/widget-lifecycle';

// Disabling receivers can prevent Android's deletion callback. Retry cleanup on every startup,
// including flag-off builds and before sign-in. Failure retains the records for the next start.
void reconcileWidgetSetups().catch(() => undefined);
import { androidWidgetsEnabled } from './src/widgets-flag';
import { androidNotificationsEnabled } from './src/notifications-flag';

// Data-only Expense-added messages reach this task in every app state, including with no app
// running, so it is defined synchronously at startup (#968). Required only in a build with
// Android notifications on: Expo inlines the flag, so other builds never load expo-task-manager.
if (androidNotificationsEnabled()) {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { defineNotificationTask } = require('./src/notification-task-native') as {
    defineNotificationTask: () => void;
  };
  defineNotificationTask();
}

if (androidWidgetsEnabled()) {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { registerAndroidWidgets } = require('./src/widgets') as {
    registerAndroidWidgets: () => void;
  };
  registerAndroidWidgets();
  // The configure screen reads device storage only; it never starts the app controller.
  /* eslint-disable @typescript-eslint/no-require-imports */
  const {
    registerWidgetConfigurationScreen,
  } = require('react-native-android-widget/src/api/register-widget-configuration-screen');
  const { WidgetSetup } = require('./src/widget-setup');
  /* eslint-enable @typescript-eslint/no-require-imports */
  registerWidgetConfigurationScreen(WidgetSetup);
}

// registerRootComponent calls AppRegistry.registerComponent('main', () => App);
// It also ensures that whether you load the app in Expo Go or in a native build,
// the environment is set up appropriately
registerRootComponent(App);
