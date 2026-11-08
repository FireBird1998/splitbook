import { registerRootComponent } from 'expo';

import App from './App';
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
}

// registerRootComponent calls AppRegistry.registerComponent('main', () => App);
// It also ensures that whether you load the app in Expo Go or in a native build,
// the environment is set up appropriately
registerRootComponent(App);
