import NextAuth from 'next-auth';
import { MongoDBAdapter } from '@auth/mongodb-adapter';
import clientPromise from './mongodb-client';
import { authConfig } from './auth.config';

/**
 * Full Auth.js configuration with MongoDB adapter.
 * This file is used by API routes and server components (Node.js runtime only).
 * The middleware uses auth.config.ts instead (Edge-compatible).
 */
export const { handlers, auth, signIn, signOut } = NextAuth({
  ...authConfig,
  adapter: MongoDBAdapter(clientPromise),
});
