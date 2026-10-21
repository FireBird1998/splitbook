import type { GenericEndpointContext } from 'better-auth';
import { APIError } from 'better-auth/api';

export const SESSION_NOT_ENDED = {
  code: 'SESSION_NOT_ENDED',
  message: 'The session could not be ended. Try signing out again.',
} as const;

/**
 * Better Auth's sign-out logs a failed session delete and still answers 200,
 * clearing the cookie, so a session both clients believe ended stays valid
 * for up to 30 days. This runs first: it ends the session the signed cookie
 * names and checks it is gone, or answers 500 and leaves the cookie, which
 * the client keeps to try again. Without a readable session cookie there is
 * nothing to end, and sign-out goes on as before.
 */
export async function endCurrentSession(ctx: GenericEndpointContext) {
  const { authCookies, internalAdapter, logger, secret } = ctx.context;
  const token = await ctx.getSignedCookie(authCookies.sessionToken.name, secret);
  if (!token) return;
  let ended: boolean;
  try {
    await internalAdapter.deleteSession(token);
    // A failed lookup before the delete is swallowed and deletes nothing, so check.
    ended = (await internalAdapter.findSession(token)) === null;
  } catch (error) {
    logger.error('Failed to end the session at sign-out', error);
    ended = false;
  }
  if (!ended) throw APIError.from('INTERNAL_SERVER_ERROR', SESSION_NOT_ENDED);
}
