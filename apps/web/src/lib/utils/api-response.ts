import { headers } from 'next/headers';
import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { MoneyValidationError } from '@splitbook/shared/exact-money';

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
  if (err instanceof MoneyValidationError) return error(err.message, 422);
  if (err instanceof Error) {
    const messages: Record<string, [string, number]> = {
      INVALID_IDEMPOTENCY_KEY: ['Invalid submission key', 422],
      IDEMPOTENCY_CONFLICT: [
        'This submission key was already used for different data. Start a new submission.',
        409,
      ],
      STALE_REVISION: [
        'This record changed while you were editing. Reload the latest version before saving.',
        409,
      ],
      REVISION_REQUIRED: ['Reload this record before changing it.', 428],
      CURRENCY_LOCKED: ['Currency cannot change after this Group has financial records.', 409],
      ACTIVITY_BACKLOG_FULL: [
        'The audit feed is temporarily unavailable. Please retry later.',
        503,
      ],
      INVALID_MONEY: ['Enter a positive amount with the currency’s supported precision.', 422],
    };
    if (err.name === 'VersionError') return error(messages.STALE_REVISION[0], 409);
    if (messages[err.message]) return error(...messages[err.message]);
  }
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
