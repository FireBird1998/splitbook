import { headers } from 'next/headers';
import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';

export interface AuthUser {
  /** 24-hex user id, byte-for-byte the stored ObjectId string. */
  id: string;
  name: string;
  email: string;
  image: string | null;
}

/**
 * Get the authenticated user from the Better Auth session (validated against
 * the database, or the five-minute cookie cache). Returns null if not
 * authenticated. Works in API routes and server components.
 */
export async function getAuthUser(): Promise<AuthUser | null> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session?.user?.id) return null;
  const { id, name, email, image } = session.user;
  return { id, name, email, image: image ?? null };
}

/**
 * Standard success response
 */
export function success<T>(data: T, status: number = 200) {
  return NextResponse.json({ data, status }, { status });
}

/**
 * Standard error response
 */
export function error(message: string, status: number = 400) {
  return NextResponse.json({ error: message, status }, { status });
}

/**
 * 401 Unauthorized response
 */
export function unauthorized() {
  return NextResponse.json({ error: 'Unauthorized', status: 401 }, { status: 401 });
}

/**
 * 403 Forbidden response
 */
export function forbidden() {
  return NextResponse.json({ error: 'Forbidden', status: 403 }, { status: 403 });
}

/**
 * 404 Not Found response
 */
export function notFound(resource: string = 'Resource') {
  return NextResponse.json({ error: `${resource} not found`, status: 404 }, { status: 404 });
}

/**
 * 500 Server Error response
 */
export function serverError(err?: unknown) {
  console.error('Server error:', err);
  return NextResponse.json({ error: 'Internal server error', status: 500 }, { status: 500 });
}

/**
 * Validation error response (from Zod)
 */
export function validationError(errors: unknown) {
  return NextResponse.json(
    { error: 'Validation error', details: errors, status: 422 },
    { status: 422 },
  );
}
