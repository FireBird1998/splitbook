import type { MobileSnapshot } from './types';
import type { NotificationPreferences } from './notification-controls';
import { z } from 'zod';
const id = z.string().regex(/^[a-f0-9]{24}$/i);
export const notificationEnvelope = z
  .object({
    version: z.literal(2),
    // Expense-added (#840); updated, covering restoration, and deleted (#841); a recorded
    // Settlement, single, batch or Cross-currency (#842).
    kind: z.enum(['expense_added', 'expense_updated', 'expense_deleted', 'settlement_recorded']),
    eventId: id,
    groupId: id,
    recordId: id,
    accountId: id,
    environment: z.enum(['development', 'staging', 'production']),
    binding: z.string().uuid(),
    activation: z.string().uuid(),
    occurredAt: z.string().datetime(),
    expiresAt: z.string().datetime(),
  })
  .strict();
export type NotificationEnvelope = z.infer<typeof notificationEnvelope>;
export interface NotificationOpening {
  status: 'idle' | 'held' | 'opening' | 'error';
  message: string;
}
export const emptyNotificationOpening = (): NotificationOpening => ({
  status: 'idle',
  message: '',
});
export function parseNotificationEnvelope(value: unknown, time: number) {
  // Expo direct FCM data presentation places the JSON envelope in body.
  let raw = value;
  try {
    if (raw && typeof raw === 'object' && 'body' in raw && typeof raw.body === 'string')
      raw = JSON.parse(raw.body);
  } catch {
    return null;
  }
  const parsed = notificationEnvelope.safeParse(raw);
  if (!parsed.success) return null;
  const event = parsed.data;
  const occurred = Date.parse(event.occurredAt),
    expires = Date.parse(event.expiresAt);
  // A freshly delivered server event can precede a device clock by a few seconds.
  // This tolerance never changes the server's expiry or the exact 24-hour lifetime.
  return occurred <= time + 30_000 && expires > time && expires - occurred === 86_400_000
    ? event
    : null;
}

/**
 * Whether an envelope is for this phone as it is now: the signed-in account, this build's
 * environment, the confirmed binding, the category's own switch and activation (Payments for a
 * recorded Settlement, #842; Expense updates for every Expense kind), and not expired.
 * The running app and the notification task with no app running (#968) both decide with this.
 */
export function notificationAuthorized(
  event: NotificationEnvelope,
  phone: {
    accountId: string | null | undefined;
    environment: string;
    confirmed: NotificationPreferences;
    now: number;
  },
): boolean {
  const { confirmed } = phone;
  const payment = event.kind === 'settlement_recorded';
  return (
    !!phone.accountId &&
    phone.accountId === event.accountId &&
    event.environment === phone.environment &&
    Date.parse(event.expiresAt) > phone.now &&
    confirmed.enabled &&
    (payment ? confirmed.payments : confirmed.expenseUpdates) &&
    confirmed.binding === event.binding &&
    ((payment ? confirmed.paymentActivation : confirmed.expenseActivation) ??
      confirmed.activation) === event.activation
  );
}

/** Read-only routes may contain protected sheets; both commands and the action banner use this guard. */
export function notificationTaskProtected(snapshot: MobileSnapshot): boolean {
  return (
    !['group', 'groups', 'members', 'settings'].includes(snapshot.screen) ||
    ['uncertain', 'saving'].includes(snapshot.expense.status) ||
    ['uncertain', 'saving'].includes(snapshot.settlement.status) ||
    ['uncertain', 'saving'].includes(snapshot.creation.status) ||
    snapshot.toReview.groupId !== null ||
    snapshot.toReview.run !== null ||
    // The collection keeps its Group and results after its sheet closes. The open sheet/run
    // above owns task protection; a retained display collection is not an active task.
    snapshot.sharedDraftCollection.busy ||
    snapshot.tagsOpenFor !== null ||
    snapshot.currenciesOpenFor !== null ||
    snapshot.tagManager.edit !== null ||
    snapshot.tagManager.recovery !== null ||
    snapshot.tagManager.busy ||
    snapshot.leave.status !== 'closed'
  );
}
