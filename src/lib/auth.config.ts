import type { NextAuthConfig } from 'next-auth';
import Google from 'next-auth/providers/google';
import Credentials from 'next-auth/providers/credentials';
import { authorizeDemoPersona } from '@/lib/demo-credentials';

/**
 * Edge-compatible Auth.js configuration.
 * This file must NOT import any Node.js-only modules (mongodb, mongoose, etc.)
 * because it's used by middleware which runs in the Edge runtime.
 *
 * Both providers are registered so AUTH_MODE can switch without a rebuild.
 * Demo Credentials authorize() fails closed unless demo mode is allowed.
 * UI entry points choose the active provider via resolveAuthMode().
 */
function buildProviders(): NextAuthConfig['providers'] {
  return [
    Credentials({
      id: 'demo',
      name: 'Demo',
      credentials: {
        personaId: { label: 'Persona', type: 'text' },
      },
      authorize(credentials) {
        // Env is read at authorize-time so the production guard stays effective.
        return authorizeDemoPersona({
          personaId: typeof credentials?.personaId === 'string' ? credentials.personaId : undefined,
        });
      },
    }),
    Google({
      clientId: process.env.AUTH_GOOGLE_ID!,
      clientSecret: process.env.AUTH_GOOGLE_SECRET!,
    }),
  ];
}

export const authConfig: NextAuthConfig = {
  providers: buildProviders(),
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
    authorized({ auth, request }) {
      const isLoggedIn = !!auth?.user;
      const { nextUrl, method } = request;
      const { pathname } = nextUrl;

      const isAuthPage = pathname.startsWith('/login');
      const isPublicPage = pathname === '/' || pathname.startsWith('/join');
      const isApiAuth = pathname.startsWith('/api/auth');
      // GET /api/join/[code] is intentionally auth-free (invite preview); POST joins and stays protected
      const isJoinPreview = pathname.startsWith('/api/join/') && method === 'GET';
      const isApi = pathname.startsWith('/api');

      // Always allow auth API routes
      if (isApiAuth) return true;

      // Allow the public invite-preview read so the join page can render its sign-in CTA
      if (isJoinPreview) return true;

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
