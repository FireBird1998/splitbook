import { headers } from 'next/headers';
import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { MoneyValidationError } from '@splitbook/shared/exact-money';
import {
  ACCOUNT_CHANGED,
  ACCOUNT_CHANGED_STATUS,
  EXPECTED_ACCOUNT_HEADER,
} from '@/lib/expected-account';
import { RECURRING_EXPENSES_OFF } from '@/lib/recurring-expenses-switch';

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
 *
 * A web page sends the account it was rendered for as `X-Expected-Account`.
 * When that header is present and names anyone but the session user, the
 * session moved to another account in a different tab: this throws
 * `ACCOUNT_CHANGED`, which `serverError` answers as 419 with no data, before
 * the route reads or writes anything. Without the header nothing changes.
 */
export async function getAuthUser(): Promise<AuthUser | null> {
  const requestHeaders = await headers();
  const session = await auth.api.getSession({ headers: requestHeaders });
  if (!session?.user?.id) return null;
  const expectedAccount = requestHeaders.get(EXPECTED_ACCOUNT_HEADER);
  if (expectedAccount !== null && expectedAccount !== session.user.id) {
    throw new Error(ACCOUNT_CHANGED);
  }
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
export function error(message: string, status: number = 400, code?: string) {
  return NextResponse.json({ error: message, status, ...(code ? { code } : {}) }, { status });
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
  if (err instanceof MoneyValidationError) return error(err.message, 422, err.code);
  if (err instanceof Error) {
    const messages: Record<string, [string, number]> = {
      FORBIDDEN: ['Forbidden', 403],
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
      [RECURRING_EXPENSES_OFF]: ['Recurring Expenses are turned off.', 409],
      ACTIVITY_BACKLOG_FULL: [
        'The audit feed is temporarily unavailable. Please retry later.',
        503,
      ],
      INVALID_MONEY: ['Enter a positive amount with the currency’s supported precision.', 422],
      [ACCOUNT_CHANGED]: [
        'The signed-in account changed in another tab. Reload this page to continue.',
        ACCOUNT_CHANGED_STATUS,
      ],
    };
    if (err.name === 'VersionError')
      return error(messages.STALE_REVISION[0], 409, 'STALE_REVISION');
    if (messages[err.message]) return error(...messages[err.message], err.message);
  }
  console.error('Server error:', err);
  return NextResponse.json({ error: 'Internal server error', status: 500 }, { status: 500 });
}

/**
 * Validation error response (from Zod)
 */
export function validationError(errors: unknown) {
  return NextResponse.json(
    { error: 'Validation error', code: 'VALIDATION_ERROR', details: errors, status: 422 },
    { status: 422 },
  );
}
