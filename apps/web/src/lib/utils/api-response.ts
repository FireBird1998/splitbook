import {
  Refusal,
  refusalAnswer,
  directRefusalAnswer,
  type RefusalCaller,
} from '@splitbook/shared/refusals';
import { headers } from 'next/headers';
import {
  DATABASE_UNAVAILABLE,
  DATABASE_UNAVAILABLE_MESSAGE,
} from '@splitbook/shared/database-unavailable';
import { NextResponse } from 'next/server';
import type { ZodError } from 'zod';
import { auth } from '@/lib/auth';
import { MoneyValidationError, StoredMoneyError } from '@splitbook/shared/exact-money';
import { ACCOUNT_CHANGED, EXPECTED_ACCOUNT_HEADER } from '@/lib/expected-account';
import {
  AuthDatabaseWatch,
  DatabaseUnavailableError,
  isDatabaseNoAnswer,
} from '@/lib/mongodb-client';

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
  const watch = new AuthDatabaseWatch();
  const session = await watch
    .run(() => auth.api.getSession({ headers: requestHeaders }))
    .catch((cause: unknown) => {
      // A page's layout calls this first: its error boundary knows this one (`app/error.tsx`).
      throw watch.failure(cause);
    });
  if (!session?.user?.id) return null;
  const expectedAccount = requestHeaders.get(EXPECTED_ACCOUNT_HEADER);
  if (expectedAccount !== null && expectedAccount !== session.user.id) {
    throw new Refusal(ACCOUNT_CHANGED);
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
    if (cause instanceof SyntaxError) throw new Refusal('INVALID_JSON');
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
  if (!Object.values(ids).every((id) => OBJECT_ID.test(id))) throw new Refusal('INVALID_ID');
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
  const answer = directRefusalAnswer('unauthorized');
  return NextResponse.json(answer, { status: answer.status });
}

/**
 * 403 Forbidden response
 */
export function forbidden() {
  const answer = directRefusalAnswer('forbidden');
  return NextResponse.json(answer, { status: answer.status });
}

/**
 * 404 Not Found response
 */
export function notFound(resource: string = 'Resource') {
  const answer = directRefusalAnswer('notFound', resource);
  return NextResponse.json(answer, { status: answer.status });
}

/**
 * Answer a thrown value, preserving the legacy answers during the service migration.
 */
export function serverError(err?: unknown, caller?: RefusalCaller): NextResponse {
  if (err instanceof Refusal) {
    const answer = refusalAnswer(err, caller);
    return NextResponse.json(answer, { status: answer.status });
  }
  if (err instanceof MoneyValidationError) {
    // A refusal about one input field names it, such as a split row's amount (#497).
    const field = err.field ? { field: err.field } : {};
    return NextResponse.json(
      { error: err.message, status: 422, code: err.code, ...field },
      { status: 422 },
    );
  }
  if (err instanceof Error) {
    // Only these plain messages had a central answer before migration. Other old errors keep
    // their fallthrough until their area moves to Refusal.
    const legacyCodes = [
      'FORBIDDEN',
      'INVALID_IDEMPOTENCY_KEY',
      'IDEMPOTENCY_CONFLICT',
      'STALE_REVISION',
      'REVISION_REQUIRED',
      'CURRENCY_LOCKED',
      'GROUP_ARCHIVED',
      'RECURRING_EXPENSES_OFF',
      'ACTIVITY_BACKLOG_FULL',
      'INVALID_MONEY',
      'INVALID_JSON',
      'INVALID_ID',
      'ACCOUNT_CHANGED',
    ] as const;
    if (err.name === 'VersionError') return serverError(new Refusal('STALE_REVISION'), caller);
    if (legacyCodes.some((code) => code === err.message)) {
      return serverError(new Refusal(err.message as (typeof legacyCodes)[number]), caller);
    }
  }

  // An operation that ran out of its time got no answer either: a save's transaction whose
  // connection kept dropping can end that way rather than on the dropped connection. Its retry
  // with the same Idempotency-Key or revision records it once (ADR 0004).
  if (isDatabaseNoAnswer(err)) return databaseUnavailable(err);
  console.error('Server error:', err);
  return internalServerError();
}

/** Each error in the chain, as the driver named and described it, never as the request held it. */
function databaseFailure(err: unknown): string {
  const parts: string[] = [];
  for (let cause = err; cause instanceof Error && parts.length < 8; cause = cause.cause)
    if (!(cause instanceof DatabaseUnavailableError)) parts.push(`${cause.name}: ${cause.message}`);
  return parts.join(' <- ');
}

/**
 * 503 DATABASE_UNAVAILABLE: the database couldn't be reached, even after the one retry (#826,
 * #858, #862), in the words every client shows as they are. Only the driver's own description is
 * logged: an unreachable database's errors carry no request data.
 */
export function databaseUnavailable(err: unknown) {
  console.error('Database unreachable:', databaseFailure(err));
  return NextResponse.json(
    { error: DATABASE_UNAVAILABLE_MESSAGE, status: 503, code: DATABASE_UNAVAILABLE },
    { status: 503 },
  );
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
export function failedRead(err: unknown, req: Request, caller?: RefusalCaller) {
  if (err instanceof StoredMoneyError) {
    console.error('Stored data fault:', {
      route: `${req.method} ${new URL(req.url).pathname}`,
      code: err.code,
      ...err.ids,
    });
    return internalServerError();
  }
  return serverError(err, caller);
}

/**
 * Validation error response. A Zod error's problems travel as `[{ path, message }]`, the same
 * shape on every API (#538).
 */
export function validationError(
  refusal: ZodError,
  response: { code?: string; message?: string } = {},
) {
  const details = refusal.issues.map((issue) => ({ path: issue.path, message: issue.message }));
  return NextResponse.json(
    {
      error: response.message ?? 'Validation error',
      code: response.code ?? 'VALIDATION_ERROR',
      details,
      status: 422,
    },
    { status: 422 },
  );
}
