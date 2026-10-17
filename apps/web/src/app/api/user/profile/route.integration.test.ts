/**
 * HTTP tests for the signed-in member's profile (#473) against a real, isolated MongoDB database
 * (`splitbook-test-profile-route`), with a real session (`signed-in-route.ts`).
 *
 * The session decides whose profile is read and changed; nothing in the body can name another
 * account.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEMO_PERSONA_IDS } from '@/lib/demo-personas';
import { integrationTestDb } from '@/lib/test-utils/integration-db';
import {
  callRoute,
  connectSignedIn,
  disconnectSignedIn,
  insertDemoPersonas,
  signIn,
} from '@/lib/test-utils/signed-in-route';

vi.mock('next/headers', async () => (await import('@/lib/test-utils/signed-in-route')).nextHeaders);

const db = integrationTestDb('profile-route');
const { alex, sam } = DEMO_PERSONA_IDS;

let profile: typeof import('./route');

beforeAll(async () => {
  await connectSignedIn(db);
  profile = await import('./route');
});
beforeEach(async () => {
  await db.reset();
  await insertDemoPersonas();
});
afterAll(() => disconnectSignedIn(db));

function readProfile(cookie: string) {
  return callRoute(profile.GET, { method: 'GET', path: '/api/user/profile', cookie });
}

function changeProfile(cookie: string, body: object) {
  return callRoute(profile.PATCH, { method: 'PATCH', path: '/api/user/profile', cookie, body });
}

function profileFields(data: {
  _id: string;
  name: string;
  email: string;
  preferredCurrency: string;
}) {
  const { _id, name, email, preferredCurrency } = data;
  return { _id, name, email, preferredCurrency };
}

describe('GET /api/user/profile', () => {
  it('reads the signed-in member’s own profile', async () => {
    const read = await readProfile(await signIn('sam'));

    expect(read.status).toBe(200);
    expect(profileFields(read.body.data)).toEqual({
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

    const updated = await changeProfile(samCookie, {
      name: 'Sam C.',
      preferredCurrency: 'EUR',
      email: 'alex.demo@splitbook.local',
    });

    expect(updated.status).toBe(200);
    expect(profileFields(updated.body.data)).toEqual({
      _id: sam,
      name: 'Sam C.',
      email: 'sam.demo@splitbook.local',
      preferredCurrency: 'EUR',
    });
    expect(profileFields((await readProfile(samCookie)).body.data)).toEqual(
      profileFields(updated.body.data),
    );
    expect(profileFields((await readProfile(await signIn('alex'))).body.data)).toEqual({
      _id: alex,
      name: 'Alex Rivera',
      email: 'alex.demo@splitbook.local',
      preferredCurrency: 'INR',
    });
  });

  it('refuses a change without a session and changes nothing', async () => {
    const refused = await changeProfile('', { name: 'Nobody' });

    expect(refused).toEqual({ status: 401, body: { error: 'Unauthorized', status: 401 } });
    expect((await readProfile(await signIn('sam'))).body.data.name).toBe('Sam Chen');
  });
});
