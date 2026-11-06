/** Receipt/tap callbacks are the only native navigation seam; no permissions are requested here. */
export async function attachNotificationCallbacks(
  controller: {
    receiveNotification(value: unknown): Promise<boolean>;
    tapNotification(value: unknown): Promise<void>;
  },
  restored: Promise<void>,
) {
  const n = await import('expo-notifications');
  let active = true;
  const responses = new Set<string>();
  n.setNotificationHandler({
    handleNotification: async (notification) => {
      let timer: ReturnType<typeof setTimeout> | undefined;
      let show = false;
      try {
        show = await Promise.race([
          controller.receiveNotification(notification.request.content.data),
          new Promise<boolean>((resolve) => {
            timer = setTimeout(() => resolve(false), 2_000);
          }),
        ]);
      } catch {
        /* Reject unknown payloads and unavailable authorization. */
      } finally {
        clearTimeout(timer);
      }
      return {
        shouldShowBanner: active && show,
        shouldShowList: active && show,
        shouldPlaySound: false,
        shouldSetBadge: false,
      };
    },
  });
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
    subscription.remove();
    n.setNotificationHandler(null);
  };
}
