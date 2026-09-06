import NextAuth from 'next-auth';
import { authConfig } from '@/lib/auth.config';

/**
 * Middleware uses the edge-compatible auth config (no MongoDB adapter).
 * The `authorized` callback in auth.config.ts handles all route protection logic.
 */
export default NextAuth(authConfig).auth;

export const config = {
  // Only this exact catalogue URL skips Auth.js. Its server page rejects
  // production requests; no other /dev page or API gains an auth exception.
  matcher: ['/((?!dev/design-system/?$|_next/static|_next/image|favicon.ico|.*\\..*).*)'],
};
