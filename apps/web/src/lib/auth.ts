import 'server-only';
import { mongodbAdapter } from 'better-auth/adapters/mongodb';
import { connectedAuthAdapter, getAuthDb } from '@/lib/mongodb-client';
import { createSplitbookAuth } from '@/lib/auth/create-auth';

/**
 * The Better Auth instance (Node runtime only: route handler, server
 * components, `getAuthUser`). `src/proxy.ts` must not import this file; it
 * only checks for the session cookie.
 *
 * Plural collection names keep the application's `users` collection as the
 * user model; sessions, accounts, verifications and rate-limit counters get
 * their own collections. Ids stay ObjectIds through the adapter default.
 * `transaction: false` because local and CI run a standalone `mongod`. It runs
 * on the app's one client, connected before each of its calls (#826).
 */
export const auth = createSplitbookAuth({
  database: connectedAuthAdapter(
    mongodbAdapter(getAuthDb(), { usePlural: true, transaction: false }),
  ),
});
