/**
 * HTTP tests for editing and discarding one Draft (#473) against a real, isolated MongoDB
 * database (`splitbook-test-draft-item-route`). Members sign in for real: a demo persona sign-in
 * through Better Auth's own handler returns the session cookie, and every route call sends it
 * back. `next/headers` is the only stand-in, because a handler called outside Next has no
 * request scope; it hands the route the headers of the request it is answering.
 *
 * An edit names the revision it was based on, so an edit based on an old version fails rather
 * than overwrite a newer one, and discard is permanent (ADR 0008).
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import mongoose from 'mongoose';
import User from '@/lib/models/User';
import { DEMO_PERSONAS, DEMO_PERSONA_IDS, type DemoPersonaKey } from '@/lib/demo-personas';
import { groupService } from '@/lib/services/group.service';
import { integrationTestDb } from '@/lib/test-utils/integration-db';

const APP_URL = 'http://localhost:3000';

const request = vi.hoisted(() => ({ headers: new Headers() }));
vi.mock('next/headers', () => ({ headers: async () => request.headers }));

type Params = { id: string; draftId?: string };
type Handler = (request: Request, context: { params: Promise<never> }) => Promise<Response>;

const db = integrationTestDb('draft-item-route');
const { alex, sam } = DEMO_PERSONA_IDS;

let auth: typeof import('@/lib/auth').auth;
let draft: typeof import('./route');
let drafts: typeof import('../route');

beforeAll(async () => {
  vi.stubEnv('AUTH_MODE', 'demo');
  vi.stubEnv('AUTH_SECRET', 'splitbook-test-secret-for-draft-item-routes');
  vi.stubEnv('NEXT_PUBLIC_APP_URL', APP_URL);
  vi.stubEnv('PERSISTENT_DRAFTS_ENABLED', 'true');
  await db.connect();
  // Better Auth opens its client on the database MONGODB_URI names when it loads, so the
  // routes load only once connect has pointed MONGODB_URI at this file's database.
  ({ auth } = await import('@/lib/auth'));
  draft = await import('./route');
  drafts = await import('../route');
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

async function call(
  handler: Handler,
  params: Params,
  init: { method: string; cookie: string; body?: unknown; headers?: Record<string, string> },
) {
  const path = params.draftId ? `/drafts/${params.draftId}` : '/drafts';
  const httpRequest = new Request(`${APP_URL}/api/groups/${params.id}${path}`, {
    method: init.method,
    headers: { cookie: init.cookie, 'content-type': 'application/json', ...init.headers },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
  request.headers = httpRequest.headers;
  const response = await handler(httpRequest, { params: Promise.resolve(params as never) });
  return { status: response.status, body: await response.json() };
}

/** Alex's and Sam's trip, where Sam keeps an unfinished Draft of a ₹450.00 taxi. */
async function tripWithSamsTaxi(samCookie: string) {
  const group = await groupService.create(
    { name: 'Coorg Weekend', category: 'trip', defaultCurrency: 'INR', alternateCurrencies: [] },
    alex,
  );
  const groupId = String(group._id);
  await groupService.addMember(groupId, sam);
  const created = await call(
    drafts.POST,
    { id: groupId },
    {
      method: 'POST',
      cookie: samCookie,
      body: { drafts: [{ description: 'Taxi', amount: 450 }] },
      headers: { 'Idempotency-Key': 'draft-sam-taxi-0001' },
    },
  );
  expect(created.status).toBe(201);
  return { groupId, draftId: created.body.data[0].id as string };
}

async function samsDrafts(groupId: string, samCookie: string) {
  const listed = await call(drafts.GET, { id: groupId }, { method: 'GET', cookie: samCookie });
  return listed.body.data as { id: string; revision: number; values: object }[];
}

describe('PUT /api/groups/[id]/drafts/[draftId]', () => {
  it('replaces the Draft when the edit is based on the revision Sam last saw', async () => {
    const samCookie = await signIn('sam');
    const { groupId, draftId } = await tripWithSamsTaxi(samCookie);

    const edited = await call(
      draft.PUT,
      { id: groupId, draftId },
      {
        method: 'PUT',
        cookie: samCookie,
        body: { values: { description: 'Airport taxi', amount: 650 } },
        headers: { 'X-Splitbook-Revision': '0' },
      },
    );

    expect(edited.status).toBe(200);
    expect(edited.body.data).toMatchObject({
      id: draftId,
      revision: 1,
      values: { description: 'Airport taxi', amount: 650 },
    });
    expect(await samsDrafts(groupId, samCookie)).toMatchObject([
      { id: draftId, revision: 1, values: { description: 'Airport taxi', amount: 650 } },
    ]);
  });

  it('refuses an edit based on an older revision and keeps the newer one', async () => {
    const samCookie = await signIn('sam');
    const { groupId, draftId } = await tripWithSamsTaxi(samCookie);
    const edit = (description: string) =>
      call(
        draft.PUT,
        { id: groupId, draftId },
        {
          method: 'PUT',
          cookie: samCookie,
          body: { values: { description, amount: 450 } },
          headers: { 'X-Splitbook-Revision': '0' },
        },
      );
    expect((await edit('Taxi to the falls')).status).toBe(200);

    const stale = await edit('Taxi back');

    expect(stale).toEqual({
      status: 409,
      body: {
        error:
          'This record changed while you were editing. Reload the latest version before saving.',
        status: 409,
        code: 'STALE_REVISION',
      },
    });
    expect(await samsDrafts(groupId, samCookie)).toMatchObject([
      { revision: 1, values: { description: 'Taxi to the falls', amount: 450 } },
    ]);
  });

  it('does not let Alex edit the Draft Sam keeps', async () => {
    const samCookie = await signIn('sam');
    const { groupId, draftId } = await tripWithSamsTaxi(samCookie);

    const refused = await call(
      draft.PUT,
      { id: groupId, draftId },
      {
        method: 'PUT',
        cookie: await signIn('alex'),
        body: { values: { description: 'Not my taxi', amount: 1 } },
        headers: { 'X-Splitbook-Revision': '0' },
      },
    );

    expect(refused).toEqual({
      status: 404,
      body: { error: 'Draft not found', status: 404, code: 'DRAFT_NOT_FOUND' },
    });
    expect(await samsDrafts(groupId, samCookie)).toMatchObject([
      { revision: 0, values: { description: 'Taxi', amount: 450 } },
    ]);
  });
});

describe('DELETE /api/groups/[id]/drafts/[draftId]', () => {
  it('discards the Draft for good', async () => {
    const samCookie = await signIn('sam');
    const { groupId, draftId } = await tripWithSamsTaxi(samCookie);

    const discarded = await call(
      draft.DELETE,
      { id: groupId, draftId },
      { method: 'DELETE', cookie: samCookie, headers: { 'X-Splitbook-Revision': '0' } },
    );

    expect(discarded.status).toBe(200);
    expect(discarded.body.data).toMatchObject({ id: draftId, state: 'discarded', revision: 1 });
    expect(await samsDrafts(groupId, samCookie)).toEqual([]);
  });
});
