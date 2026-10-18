import { headers } from 'next/headers';
import { NextResponse } from 'next/server';
import type { ZodError } from 'zod';
import { auth } from '@/lib/auth';
import { MoneyValidationError, StoredMoneyError } from '@splitbook/shared/exact-money';
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
 * The request's JSON body. A body that isn't JSON is the client's mistake, so `serverError`
 * answers it as 400 INVALID_JSON (#539). Any other failure to read it stays a server fault.
 */
export async function readJson(req: Request): Promise<unknown> {
  try {
    return await req.json();
  } catch (cause) {
    if (cause instanceof SyntaxError) throw new Error('INVALID_JSON');
    throw cause;
  }
}

const OBJECT_ID = /^[a-f\d]{24}$/i;

/**
 * The ids in a route's address, each checked to be one. One that isn't is the client's mistake,
 * which `serverError` answers as 400 INVALID_ID (#539). Only the address is checked: an id that
 * fails later, such as a stored reference, stays a server fault.
 */
export async function routeIds<Params extends Record<string, string>>(
  params: Promise<Params>,
): Promise<Params> {
  const ids = await params;
  if (!Object.values(ids).every((id) => OBJECT_ID.test(id))) throw new Error('INVALID_ID');
  return ids;
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
  if (err instanceof MoneyValidationError) {
    // A refusal about one input field names it, such as a split row's amount (#497).
    const field = err.field ? { field: err.field } : {};
    return NextResponse.json(
      { error: err.message, status: 422, code: err.code, ...field },
      { status: 422 },
    );
  }
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
      INVALID_JSON: ['Invalid JSON body', 400],
      INVALID_ID: ['Invalid id', 400],
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
  return internalServerError();
}

function internalServerError() {
  return NextResponse.json({ error: 'Internal server error', status: 500 }, { status: 500 });
}

/**
 * The answer to a read that failed. Stored data it can't use, such as an Expense whose money
 * doesn't add up, is a fault on our side, never the request's (#547): it answers 500 and is logged
 * once with the route, the code and the ids that find the record, never member data. Anything
 * else answers as `serverError` does, so a read's own bad input is still refused.
 */
export function failedRead(err: unknown, req: Request) {
  if (err instanceof StoredMoneyError) {
    console.error('Stored data fault:', {
      route: `${req.method} ${new URL(req.url).pathname}`,
      code: err.code,
      ...err.ids,
    });
    return internalServerError();
  }
  return serverError(err);
}

/**
 * Validation error response. A Zod error's problems travel as `[{ path, message }]`, the same
 * shape on every API (#538).
 */
export function validationError(refusal: ZodError) {
  const details = refusal.issues.map((issue) => ({ path: issue.path, message: issue.message }));
  return NextResponse.json(
    { error: 'Validation error', code: 'VALIDATION_ERROR', details, status: 422 },
    { status: 422 },
  );
}
