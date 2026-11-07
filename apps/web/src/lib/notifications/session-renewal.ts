import 'server-only';
import { connectMongo, getAuthDb } from '@/lib/mongodb-client';

/**
 * A notification registration lives exactly as long as its session. Better
 * Auth renews a session (30 days, refreshed after a day of use), so each
 * renewal moves the session's registrations to the new expiry. The TTL index,
 * the controls read and dispatch then keep following the live session; a
 * revoked or expired session's registration still sends nothing.
 */
export async function followSessionRenewal(session: { id: string; expiresAt: Date | string }) {
  const expiresAt = new Date(session.expiresAt);
  await connectMongo();
  await getAuthDb()
    .collection('notificationRegistrations')
    .updateMany({ sessionId: session.id, expiresAt: { $lt: expiresAt } }, { $set: { expiresAt } });
}
