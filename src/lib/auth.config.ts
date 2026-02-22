import type { NextAuthConfig } from 'next-auth';
import Google from 'next-auth/providers/google';

/**
 * Edge-compatible Auth.js configuration.
 * This file must NOT import any Node.js-only modules (mongodb, mongoose, etc.)
 * because it's used by middleware which runs in the Edge runtime.
 */
export const authConfig: NextAuthConfig = {
  providers: [
    Google({
      clientId: process.env.AUTH_GOOGLE_ID!,
      clientSecret: process.env.AUTH_GOOGLE_SECRET!,
    }),
  ],
  session: {
    strategy: 'jwt',
  },
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.id = user.id;
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user) {
        session.user.id = token.id as string;
      }
      return session;
    },
    authorized({ auth, request: { nextUrl } }) {
      const isLoggedIn = !!auth?.user;
      const { pathname } = nextUrl;

      const isAuthPage = pathname.startsWith('/login');
      const isPublicPage = pathname === '/' || pathname.startsWith('/join');
      const isApiAuth = pathname.startsWith('/api/auth');
      const isApi = pathname.startsWith('/api');

      // Always allow auth API routes
      if (isApiAuth) return true;

      // Redirect logged-in users away from login page
      if (isLoggedIn && isAuthPage) {
        return Response.redirect(new URL('/dashboard', nextUrl));
      }

      // Allow public pages and login page
      if (isPublicPage || isAuthPage) return true;

      // Protect API routes — return false (will return 401)
      if (isApi && !isLoggedIn) return false;

      // Protect all other pages — redirect to login
      if (!isLoggedIn) {
        const loginUrl = new URL('/login', nextUrl);
        loginUrl.searchParams.set('callbackUrl', pathname);
        return Response.redirect(loginUrl);
      }

      return true;
    },
  },
  pages: {
    signIn: '/login',
  },
};
