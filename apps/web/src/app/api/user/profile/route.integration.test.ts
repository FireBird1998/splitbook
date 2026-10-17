/**
 * HTTP tests for the signed-in member's profile (#473) against a real, isolated MongoDB database
 * (`splitbook-test-profile-route`). Members sign in for real: a demo persona sign-in through
 * Better Auth's own handler returns the session cookie, and every route call sends it back.
 * `next/headers` is the only stand-in, because a handler called outside Next has no request
 * scope; it hands the route the headers of the request it is answering.
 *
 * The session decides whose profile is read and changed; nothing in the body can name another
 * account.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import mongoose from 'mongoose';
import User from '@/lib/models/User';
import { DEMO_PERSONAS, DEMO_PERSONA_IDS, type DemoPersonaKey } from '@/lib/demo-personas';
import { integrationTestDb } from '@/lib/test-utils/integration-db';

const APP_URL = 'http://localhost:3000';

const request = vi.hoisted(() => ({ headers: new Headers() }));
vi.mock('next/headers', () => ({ headers: async () => request.headers }));

type Handler = (request: Request) => Promise<Response>;

const db = integrationTestDb('profile-route');
const { alex, sam } = DEMO_PERSONA_IDS;

let auth: typeof import('@/lib/auth').auth;
let profile: typeof import('./route');

beforeAll(async () => {
  vi.stubEnv('AUTH_MODE', 'demo');
  vi.stubEnv('AUTH_SECRET', 'splitbook-test-secret-for-profile-routes');
  vi.stubEnv('NEXT_PUBLIC_APP_URL', APP_URL);
  await db.connect();
  // Better Auth opens its client on the database MONGODB_URI names when it loads, so the
  // routes load only once connect has pointed MONGODB_URI at this file's database.
  ({ auth } = await import('@/lib/auth'));
  profile = await import('./route');
});
beforeEach(async () => {
  await db.reset();
  await User.insertMany(
    DEMO_PERSONAS.map((persona) => ({
      _id: new mongoose.Types.ObjectId(persona.id),
      name: persona.name,
      email: persona.email,
      preferredCurrency: 'INR',
    })),
  );
});
afterAll(async () => {
  await db.teardown();
  vi.unstubAllEnvs();
});

/** Sign in as a demo persona and return the cookies a browser would send back. */
async function signIn(persona: DemoPersonaKey): Promise<string> {
  const response = await auth.handler(
    new Request(`${APP_URL}/api/auth/demo-persona/sign-in`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: APP_URL },
      body: JSON.stringify({ personaId: persona }),
    }),
  );
  expect(response.status, await response.clone().text()).toBe(200);
  return response.headers
    .getSetCookie()
    .map((cookie) => cookie.split(';')[0])
    .join('; ');
}

async function call(handler: Handler, init: { cookie: string; body?: unknown }) {
  const httpRequest = new Request(`${APP_URL}/api/user/profile`, {
    method: init.body === undefined ? 'GET' : 'PATCH',
    headers: { cookie: init.cookie, 'content-type': 'application/json' },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
  request.headers = httpRequest.headers;
  const response = await handler(httpRequest);
  return { status: response.status, body: await response.json() };
}

function account(data: { _id: string; name: string; email: string; preferredCurrency: string }) {
  const { _id, name, email, preferredCurrency } = data;
  return { _id, name, email, preferredCurrency };
}

describe('GET /api/user/profile', () => {
  it('reads the signed-in member’s own profile', async () => {
    const read = await call(profile.GET, { cookie: await signIn('sam') });

    expect(read.status).toBe(200);
    expect(account(read.body.data)).toEqual({
      _id: sam,
      name: 'Sam Chen',
      email: 'sam.demo@splitbook.local',
      preferredCurrency: 'INR',
    });
  });
});

describe('PATCH /api/user/profile', () => {
  it('changes only the signed-in member’s name and currency', async () => {
    const samCookie = await signIn('sam');

    const updated = await call(profile.PATCH, {
      cookie: samCookie,
      body: { name: 'Sam C.', preferredCurrency: 'EUR', email: 'alex.demo@splitbook.local' },
    });

    expect(updated.status).toBe(200);
    expect(account(updated.body.data)).toEqual({
      _id: sam,
      name: 'Sam C.',
      email: 'sam.demo@splitbook.local',
      preferredCurrency: 'EUR',
    });
    const samsProfile = await call(profile.GET, { cookie: samCookie });
    expect(account(samsProfile.body.data)).toEqual(account(updated.body.data));
    const alexsProfile = await call(profile.GET, { cookie: await signIn('alex') });
    expect(account(alexsProfile.body.data)).toEqual({
      _id: alex,
      name: 'Alex Rivera',
      email: 'alex.demo@splitbook.local',
      preferredCurrency: 'INR',
    });
  });

  it('refuses a change without a session and changes nothing', async () => {
    const refused = await call(profile.PATCH, { cookie: '', body: { name: 'Nobody' } });

    expect(refused).toEqual({ status: 401, body: { error: 'Unauthorized', status: 401 } });
    const samsProfile = await call(profile.GET, { cookie: await signIn('sam') });
    expect(samsProfile.body.data.name).toBe('Sam Chen');
  });
});
