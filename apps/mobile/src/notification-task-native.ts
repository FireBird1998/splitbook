import * as TaskManager from 'expo-task-manager';
import * as Notifications from 'expo-notifications';
import { AppState } from 'react-native';
import { checkNotificationWithoutApp } from './data/notification-receipt';
import { notificationTaskName, receiveNotificationTask } from './notification-task';
import { notificationAccess } from './runtime';

/**
 * Defines the notification task. Expo runs it from the module scope of the bundle, including
 * with no app running, so `index.ts` calls this at startup, only when this build turns Android
 * notifications on. Registration is the mounted app's (`notification-callbacks.ts`).
 */
export function defineNotificationTask() {
  TaskManager.defineTask(notificationTaskName, async ({ data }) => {
    await receiveNotificationTask(data, {
      now: Date.now,
      visible: () => AppState.currentState === 'active',
      withoutApp: async (value) =>
        notificationAccess
          ? checkNotificationWithoutApp(value, notificationAccess, Date.now)
          : null,
      present: async (alert) => {
        await Notifications.scheduleNotificationAsync(alert);
      },
    });
  });
}
