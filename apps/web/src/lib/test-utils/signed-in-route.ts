/**
 * Route integration tests with a real session (#473). The Group-route tests of #472 use it too.
 *
 * A member signs in for real: a demo persona sign-in through Better Auth's own handler returns
 * the session cookie, and every route call sends it back, so the route's `getAuthUser()` checks
 * a session stored in the test file's own database. The stand-ins are only for Next's request
 * scope, which a handler called outside Next does not have: `next/headers` hands the route the
 * request being answered, and for a route that calls `after()`, `nextServer` below runs that
 * work once the response is ready. Each test file installs the first with this line at the top
 * (Vitest hoists `vi.mock` per file):
 *
 *   vi.mock('next/headers', async () => (await import('@/lib/test-utils/signed-in-route')).nextHeaders);
 *
 * Better Auth opens its database client on the database MONGODB_URI names when `@/lib/auth`
 * loads, so a test file imports its routes only after `connectSignedIn`, with `await import()`
 * in `beforeAll`. A static import of a route would point Better Auth at the wrong database.
 */

import mongoose from 'mongoose';
import { vi } from 'vitest';
import User from '@/lib/models/User';
import { DEMO_PERSONAS, type DemoPersonaKey } from '@/lib/demo-personas';
import type { IntegrationTestDb } from '@/lib/test-utils/integration-db';

export const APP_URL = 'http://localhost:3000';

/** The headers of the request a route is answering, which `next/headers` hands back. */
const requestScope = { headers: new Headers() };

/** The `next/headers` stand-in each test file installs with `vi.mock`. */
export const nextHeaders = { headers: async () => requestScope.headers };

/** Work a route scheduled with `after()`, which `callRoute` runs once the response is ready. */
const afterResponse: (() => unknown)[] = [];

/**
 * The `next/server` stand-in for a route that schedules work with `after()`, which also needs a
 * request scope. It keeps the rest of the module, `NextResponse` included:
 *
 *   vi.mock('next/server', async (original) => (await import('@/lib/test-utils/signed-in-route')).nextServer(original));
 */
export async function nextServer(original: () => Promise<typeof import('next/server')>) {
  return {
    ...(await original()),
    after: (task: Promise<unknown> | (() => unknown)) => {
      afterResponse.push(typeof task === 'function' ? task : () => task);
    },
  };
}

let auth: typeof import('@/lib/auth').auth | null = null;

/** Turn demo sign-in on, connect the file's database, then load Better Auth on it. */
export async function connectSignedIn(db: IntegrationTestDb): Promise<void> {
  vi.stubEnv('AUTH_MODE', 'demo');
  vi.stubEnv('AUTH_SECRET', 'splitbook-test-secret-for-signed-in-routes');
  vi.stubEnv('NEXT_PUBLIC_APP_URL', APP_URL);
  await db.connect();
  ({ auth } = await import('@/lib/auth'));
}

/** Drop the file's database and undo every environment stub, the file's own included. */
export async function disconnectSignedIn(db: IntegrationTestDb): Promise<void> {
  await db.teardown();
  vi.unstubAllEnvs();
}

/** Draft and To review saves use transactions, so their tests need a replica set. */
export async function requireReplicaSet(): Promise<void> {
  const hello = await mongoose.connection.db!.admin().command({ hello: 1 });
  if (!hello.setName)
    throw new Error('These tests need TEST_MONGODB_URI to name a replica set (transactions).');
}

/** Alex, Sam and Priya, the accounts a demo persona sign-in looks up. Call after a reset. */
export async function insertDemoPersonas(): Promise<void> {
  await User.insertMany(
    DEMO_PERSONAS.map((persona) => ({
      _id: new mongoose.Types.ObjectId(persona.id),
      name: persona.name,
      email: persona.email,
      preferredCurrency: 'INR',
    })),
  );
}

/** Sign in as a demo persona and return the cookies a browser would send back. */
export async function signIn(persona: DemoPersonaKey): Promise<string> {
  if (!auth) throw new Error('Call connectSignedIn before signIn.');
  const response = await auth.handler(
    new Request(`${APP_URL}/api/auth/demo-persona/sign-in`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: APP_URL },
      body: JSON.stringify({ personaId: persona }),
    }),
  );
  if (!response.ok)
    throw new Error(`Sign-in as ${persona} answered ${response.status}: ${await response.text()}`);
  return response.headers
    .getSetCookie()
    .map((cookie) => cookie.split(';')[0])
    .join('; ');
}

export type RouteCall<Params> = {
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  /** The request path, such as `/api/groups/<id>/settlements`. */
  path: string;
  /** The route segments Next would pass, such as `{ id }`; none for a route without any. */
  params?: Params;
  /** The cookies from `signIn`, or `''` for a request without a session. */
  cookie: string;
  headers?: Record<string, string>;
} & (
  | { body?: unknown; rawBody?: never }
  /** A body sent as it is, such as text that isn't JSON (#539). */
  | { body?: never; rawBody: string }
);

/** The issues of a 422 VALIDATION_ERROR, which travel as the serialized Zod error's message. */
export function validationIssues(body: { details: { message: string } }): unknown[] {
  return JSON.parse(body.details.message);
}

/** Call a route handler with a request carrying the session cookie, as Next would. */
export async function callRoute<Params>(
  handler: (request: Request, context: { params: Promise<Params> }) => Promise<Response>,
  { method, path, params, cookie, body, rawBody, headers }: RouteCall<Params>,
) {
  const request = new Request(`${APP_URL}${path}`, {
    method,
    headers: { cookie, 'content-type': 'application/json', ...headers },
    body: body === undefined ? rawBody : JSON.stringify(body),
  });
  requestScope.headers = request.headers;
  const response = await handler(request, { params: Promise.resolve(params as Params) });
  const answer = { status: response.status, body: await response.json() };
  for (const task of afterResponse.splice(0)) await task();
  return answer;
}
