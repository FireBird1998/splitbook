import { attachLiveReceiver, isLedgerAlert, notificationTaskName } from './notification-task';

/**
 * Receipt/tap callbacks are the only native navigation seam; no permissions are requested here.
 * Expense messages are data-only and reach the notification task, not this handler
 * (#968): with this app mounted and signed in, the task checks with its controller. The handler presents
 * only the generic alert the task posted, quietly while the app is in use.
 */
export async function attachNotificationCallbacks(
  controller: {
    receiveNotification(value: unknown, options?: { visible?: boolean }): Promise<boolean>;
    tapNotification(value: unknown): Promise<void>;
    getSnapshot(): { auth: { status: string } };
  },
  restored: Promise<void>,
) {
  const n = await import('expo-notifications');
  let active = true;
  const responses = new Set<string>();
  n.setNotificationHandler({
    handleNotification: async (notification) => {
      const { trigger, identifier } = notification.request;
      const pushed = !!trigger && 'type' in trigger && trigger.type === 'push';
      const show = active && !pushed && isLedgerAlert(identifier);
      return {
        shouldShowBanner: show,
        shouldShowList: show,
        shouldPlaySound: false,
        shouldSetBadge: false,
      };
    },
  });
  const detach = attachLiveReceiver({
    signedIn: () => controller.getSnapshot().auth.status === 'authenticated',
    receive: (data, visible) => controller.receiveNotification(data, { visible }),
  });
  // Defined at startup (`index.ts`); registering again is harmless and survives restarts.
  void n.registerTaskAsync(notificationTaskName).catch(() => undefined);
  const respond = async (response: import('expo-notifications').NotificationResponse | null) => {
    if (!response || !active || response.actionIdentifier !== n.DEFAULT_ACTION_IDENTIFIER) return;
    const identity = response.notification.request.identifier;
    if (responses.has(identity)) return;
    responses.add(identity);
    while (responses.size > 1024) responses.delete(responses.values().next().value!);
    try {
      await restored;
      if (!active) return;
      await controller.tapNotification(response.notification.request.content.data);
      await n.clearLastNotificationResponseAsync();
    } catch {
      responses.delete(identity);
    }
  };
  const subscription = n.addNotificationResponseReceivedListener((response) => {
    void respond(response);
  });
  void n
    .getLastNotificationResponseAsync()
    .then(respond)
    .catch(() => undefined);
  return () => {
    active = false;
    detach();
    subscription.remove();
    n.setNotificationHandler(null);
  };
}
