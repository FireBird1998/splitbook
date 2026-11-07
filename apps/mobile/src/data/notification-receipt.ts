import type { StoredSession } from './cookies';
import {
  notificationAuthorized,
  parseNotificationEnvelope,
  type NotificationEnvelope,
} from './notification-alerts';
import { parseNotificationPreferences } from './notification-controls';

/** What a notification task can read when no app is running: this phone's saved records. */
export interface NotificationAccess {
  /** This build's environment, as the controller compares it. */
  environment: string;
  /** A sign-out not yet confirmed: its saved cookie is kept only to send the revoke. */
  leaving(): Promise<boolean>;
  /** The saved session, or null. */
  session(): Promise<StoredSession | null>;
  installation(): Promise<{ id: string; key: string }>;
  /** `GET /api/notifications/device` with the saved cookie and the installation proof. */
  controls(installation: { id: string; key: string }, cookie: string): Promise<unknown>;
}

/**
 * The checks for a data-only message with no app running (#968). It asks the server for this
 * phone's confirmed controls with the saved session, so a revoked or ended session, another
 * account's binding or an Expense activation since replaced all drop it, as in the running app.
 * Reads nothing else, changes nothing, and resolves null on any failure.
 */
export async function checkNotificationWithoutApp(
  value: unknown,
  access: NotificationAccess,
  now: () => number,
): Promise<NotificationEnvelope | null> {
  try {
    const event = parseNotificationEnvelope(value, now());
    if (!event || event.environment !== access.environment) return null;
    if (await access.leaving()) return null;
    const session = await access.session();
    // An unverified cookie has no confirmed account yet: nothing shows until the app checks it.
    if (!session?.accountId || session.accountId !== event.accountId) return null;
    const confirmed = parseNotificationPreferences(
      await access.controls(await access.installation(), session.cookie),
    );
    return notificationAuthorized(event, {
      accountId: session.accountId,
      environment: access.environment,
      confirmed,
      now: now(),
    })
      ? event
      : null;
  } catch {
    return null;
  }
}
