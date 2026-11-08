import { parseNotificationEnvelope, type NotificationEnvelope } from './data/notification-alerts';

/**
 * Expense messages (added, updated, deleted) are data-only (#968, #841): Android shows nothing
 * by itself, and Expo SDK 58 passes them to no foreground handler. The one notification task
 * (expo-task-manager, through expo-notifications `registerTaskAsync`) receives each in every app
 * state: foreground, background, and with no app running. It shows the generic alert only after
 * the checks pass. Its name stays as first registered (#968): every Expense kind uses it.
 */
export const notificationTaskName = 'splitbook-expense-added';
/** Shown alerts are this app's own local notifications; one per event, so a repeat replaces it. */
export const expenseAlertPrefix = 'expense-added:';
/** Each Expense alert kind's fixed generic text and identifier prefix (#840, #841). */
const expenseAlertKinds = {
  expense_added: { prefix: expenseAlertPrefix, text: 'An Expense was added.' },
  expense_updated: { prefix: 'expense-updated:', text: 'An Expense was updated.' },
  expense_deleted: { prefix: 'expense-deleted:', text: 'An Expense was deleted.' },
} as const satisfies Record<NotificationEnvelope['kind'], { prefix: string; text: string }>;
/** Whether a local notification is one of this app's own Expense alerts. */
export const isExpenseAlert = (identifier: string) =>
  Object.values(expenseAlertKinds).some(({ prefix }) => identifier.startsWith(prefix));
export const expenseAlertChannel = 'ledger-updates';
/** A check that hasn't answered by then shows nothing. */
export const receiptBudget = 10_000;

/** The running app's checks: whether to show the alert, and a quiet refresh when it doesn't. */
export interface LiveReceiver {
  /** Whether the app's sign-in is confirmed (`authenticated`); only then does it check. */
  signedIn(): boolean;
  receive(data: unknown, visible: boolean): Promise<boolean>;
}
let live: LiveReceiver | null = null;
/**
 * The mounted app attaches its controller; until then, and after, the task checks alone. So does
 * an attached app that isn't signed in yet, such as one still restoring in the background.
 */
export function attachLiveReceiver(receiver: LiveReceiver) {
  live = receiver;
  return () => {
    if (live === receiver) live = null;
  };
}

export interface ExpenseAlert {
  identifier: string;
  content: {
    title: string;
    body: string;
    data: { body: string };
    sound: 'default';
  };
  trigger: { channelId: string };
}
/** The fixed generic alert: no name, amount, description or Group. A tap carries the envelope. */
export const expenseAlert = (event: NotificationEnvelope): ExpenseAlert => ({
  identifier: expenseAlertKinds[event.kind].prefix + event.eventId,
  content: {
    title: 'Splitbook',
    body: expenseAlertKinds[event.kind].text,
    data: { body: JSON.stringify(event) },
    sound: 'default',
  },
  trigger: { channelId: expenseAlertChannel },
});

export interface NotificationTaskDependencies {
  now(): number;
  /** Whether the app is on screen (`AppState` active). */
  visible(): boolean;
  /** The checks with no app running (`checkNotificationWithoutApp`). */
  withoutApp(data: unknown): Promise<NotificationEnvelope | null>;
  present(alert: ExpenseAlert): Promise<void>;
}

/** Runs once per received message. Resolves whether it showed the alert; never rejects. */
export async function receiveNotificationTask(
  payload: unknown,
  d: NotificationTaskDependencies,
): Promise<boolean> {
  // A response to an action button also reaches the task; taps go to the response listener.
  if (!payload || typeof payload !== 'object' || 'actionIdentifier' in payload) return false;
  if (!('data' in payload)) return false;
  const data = payload.data;
  const event = parseNotificationEnvelope(data, d.now());
  if (!event) return false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    // One path per message: the signed-in app's checks, or else the checks without the app.
    const receiver = live?.signedIn() ? live : null;
    const show = await Promise.race([
      receiver
        ? receiver.receive(data, d.visible())
        : d.withoutApp(data).then((found) => found !== null),
      new Promise<boolean>((resolve) => {
        timer = setTimeout(() => resolve(false), receiptBudget);
      }),
    ]);
    if (!show) return false;
    await d.present(expenseAlert(event));
    return true;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}
