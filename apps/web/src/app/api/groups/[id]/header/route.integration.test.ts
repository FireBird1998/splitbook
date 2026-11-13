/** Real sessions and replica-set Group writes, observed through HTTP and Activity. */
import { afterAll, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import Group from '@/lib/models/Group';
import { Types } from 'mongoose';
import { DEMO_PERSONA_IDS } from '@/lib/demo-personas';
import { groupService } from '@/lib/services/group.service';
import { integrationTestDb } from '@/lib/test-utils/integration-db';
import {
  callRoute,
  connectSignedIn,
  disconnectSignedIn,
  insertDemoPersonas,
  signIn,
} from '@/lib/test-utils/signed-in-route';
import { formatActivityHeadline, formatActivityDetail } from '@splitbook/shared/activity-timeline';
import { parseActivityPageResponse } from '@splitbook/shared/activity-page-read';

vi.mock('next/headers', async () => (await import('@/lib/test-utils/signed-in-route')).nextHeaders);
vi.mock('next/server', async (original) =>
  (await import('@/lib/test-utils/signed-in-route')).nextServer(original),
);
const db = integrationTestDb('group-header');
let header: typeof import('./route');
let group: typeof import('../route');
let activity: typeof import('../activity/route');
let groups: typeof import('../../route');
let member: typeof import('../members/[userId]/route');
let id: string;
const scene = { style: 'scene', scene: 'sakura', time: 'sunset' } as const;
beforeAll(async () => {
  await connectSignedIn(db);
  header = await import('./route');
  group = await import('../route');
  activity = await import('../activity/route');
  groups = await import('../../route');
  member = await import('../members/[userId]/route');
});
beforeEach(async () => {
  vi.stubEnv('NEXT_PUBLIC_HEADER_SCENES_ENABLED', 'true');
  await db.reset();
  await insertDemoPersonas();
  const made = await groupService.create(
    { name: 'Goa Friends Trip', category: 'trip', defaultCurrency: 'INR', alternateCurrencies: [] },
    DEMO_PERSONA_IDS.alex,
  );
  id = String(made._id);
  await groupService.addMember(id, DEMO_PERSONA_IDS.sam);
});
afterAll(async () => {
  vi.unstubAllEnvs();
  await disconnectSignedIn(db);
});
const save = async (body: unknown = scene, persona: 'sam' | 'alex' | 'priya' = 'sam') =>
  callRoute(header.PATCH, {
    method: 'PATCH',
    path: `/api/groups/${id}/header`,
    params: { id },
    cookie: await signIn(persona),
    body,
  });
const read = async () =>
  callRoute(group.GET, {
    method: 'GET',
    path: `/api/groups/${id}`,
    params: { id },
    cookie: await signIn('sam'),
  });
const events = async () => {
  const answer = await callRoute(activity.GET, {
    method: 'GET',
    path: `/api/groups/${id}/activity`,
    params: { id },
    cookie: await signIn('sam'),
  });
  expect(answer.status).toBe(200);
  return parseActivityPageResponse(answer.body)
    .activities.filter((event) => event.type === 'group_updated')
    .map((event) => ({
      ...event,
      actor: typeof event.actor === 'string' ? { _id: event.actor } : event.actor,
    }));
};

it('lets a current member save the shared header and explains who changed it in Activity', async () => {
  expect((await read()).body.data.header).toEqual({
    style: 'classic',
    scene: 'beach',
    time: 'auto',
  });
  expect((await save()).status).toBe(200);
  expect((await read()).body.data.header).toEqual(scene);
  const [event] = await events();
  expect(event.actor?._id).toBe(DEMO_PERSONA_IDS.sam);
  expect(formatActivityHeadline(event)).toBe('Sam Chen changed the header to Sakura, at Sunset');
  expect(formatActivityDetail(event)).toBe('Previously: Classic header');
  expect(event.metadata?.changes).toEqual({
    header: { old: { style: 'classic', scene: 'beach', time: 'auto' }, new: scene },
  });
});

it('keeps the chosen scene and time when returning to Classic and records no no-op', async () => {
  await save();
  await save();
  expect(await events()).toHaveLength(1);
  expect((await save({ ...scene, style: 'classic' })).status).toBe(200);
  expect((await read()).body.data.header).toEqual({ ...scene, style: 'classic' });
  expect(formatActivityHeadline((await events())[0])).toBe(
    'Sam Chen changed the header to Classic header',
  );
  expect((await read()).body.data.currencyLocked).toBe(false);
});

it('masks only the style while the switch is off, without erasing the stored choice', async () => {
  await save();
  vi.stubEnv('NEXT_PUBLIC_HEADER_SCENES_ENABLED', '');
  expect((await read()).body.data.header).toEqual({ ...scene, style: 'classic' });
  vi.stubEnv('NEXT_PUBLIC_HEADER_SCENES_ENABLED', 'true');
  expect((await read()).body.data.header).toEqual(scene);
});

it('refuses non-members, while the ordinary Group update stays admin-only', async () => {
  expect((await save(scene, 'priya')).status).toBe(403);
  const answer = await callRoute(group.PATCH, {
    method: 'PATCH',
    path: `/api/groups/${id}`,
    params: { id },
    cookie: await signIn('sam'),
    body: { name: 'Changed' },
  });
  expect(answer.status).toBe(403);
  expect((await read()).body.data.name).toBe('Goa Friends Trip');
  expect(await events()).toHaveLength(0);
});
it.each([
  { ...scene, scene: 'unknown' },
  { ...scene, time: 'midnight' },
  { ...scene, style: 'picture' },
  {},
])('refuses invalid header %j without a change', async (body) => {
  expect((await save(body)).status).toBe(422);
  expect((await read()).body.data.header.style).toBe('classic');
  expect(await events()).toHaveLength(0);
});
it('requires authentication and refuses malformed ids and JSON', async () => {
  expect(
    (
      await callRoute(header.PATCH, {
        method: 'PATCH',
        path: `/api/groups/${id}/header`,
        params: { id },
        cookie: '',
        body: scene,
      })
    ).status,
  ).toBe(401);
  const cookie = await signIn('sam');
  expect(
    (
      await callRoute(header.PATCH, {
        method: 'PATCH',
        path: '/api/groups/bad/header',
        params: { id: 'bad' },
        cookie,
        body: scene,
      })
    ).status,
  ).toBe(400);
  expect(
    (
      await callRoute(header.PATCH, {
        method: 'PATCH',
        path: `/api/groups/${id}/header`,
        params: { id },
        cookie,
        rawBody: '{',
      })
    ).status,
  ).toBe(400);
});

it('refuses a removed member even when their session still works', async () => {
  await groupService.removeMember(id, DEMO_PERSONA_IDS.sam, DEMO_PERSONA_IDS.alex);
  expect((await save()).status).toBe(403);
});

const list = async () =>
  callRoute(groups.GET, { method: 'GET', path: '/api/groups', cookie: await signIn('sam') });
const stored = () => Group.collection.findOne({ _id: new Types.ObjectId(id) });
it('refuses a header write while the switch is off, without storing a setting or Activity', async () => {
  vi.stubEnv('NEXT_PUBLIC_HEADER_SCENES_ENABLED', 'false');
  const answer = await save();
  expect(answer).toEqual({
    status: 404,
    body: { error: 'Header scenes are not enabled', status: 404, code: 'HEADER_SCENES_DISABLED' },
  });
  expect((await stored())?.header).toBeUndefined();
  expect(await events()).toHaveLength(0);
  vi.stubEnv('NEXT_PUBLIC_HEADER_SCENES_ENABLED', 'true');
  expect((await read()).body.data.header).toEqual({
    style: 'classic',
    scene: 'beach',
    time: 'auto',
  });
});
it('keeps an earlier setting while off, masks detail/list reads and refuses a replacement', async () => {
  expect((await save()).body.data.header).toEqual(scene);
  vi.stubEnv('NEXT_PUBLIC_HEADER_SCENES_ENABLED', 'false');
  expect((await save({ ...scene, scene: 'beach' })).body.code).toBe('HEADER_SCENES_DISABLED');
  expect((await read()).body.data.header).toEqual({ ...scene, style: 'classic' });
  expect((await list()).body.data.find((row: { _id: string }) => row._id === id).header).toEqual({
    ...scene,
    style: 'classic',
  });
  expect((await stored())?.header).toEqual(scene);
  expect(await events()).toHaveLength(1);
  vi.stubEnv('NEXT_PUBLIC_HEADER_SCENES_ENABLED', 'true');
  expect((await read()).body.data.header).toEqual(scene);
});

it.each([
  { style: 'scene', scene: 'forest', time: 'dawn', version: 2 },
  { style: 'scene' },
  'future-header-format',
])(
  'lets an admin edit a Group without validating or rewriting an untouched legacy header: %j',
  async (legacyHeader) => {
    // Seed a row written by a newer server or an older malformed import.
    await Group.collection.updateOne(
      { _id: new Types.ObjectId(id) },
      { $set: { header: legacyHeader } },
    );
    const answer = await callRoute(group.PATCH, {
      method: 'PATCH',
      path: `/api/groups/${id}`,
      params: { id },
      cookie: await signIn('alex'),
      body: { name: 'Renamed Group' },
    });
    expect(answer.status).toBe(200);
    expect(answer.body.data).toMatchObject({
      name: 'Renamed Group',
      header: { style: 'classic', scene: 'beach', time: 'auto' },
    });
    expect((await read()).body.data.name).toBe('Renamed Group');
    expect((await stored())?.header).toEqual(legacyHeader);
  },
);
it('projects the role-change response while Header scenes are off', async () => {
  await save();
  vi.stubEnv('NEXT_PUBLIC_HEADER_SCENES_ENABLED', 'false');
  const answer = await callRoute(member.PATCH, {
    method: 'PATCH',
    path: `/api/groups/${id}/members/${DEMO_PERSONA_IDS.sam}`,
    params: { id, userId: DEMO_PERSONA_IDS.sam },
    cookie: await signIn('alex'),
    body: { role: 'admin' },
  });
  expect(answer.status).toBe(200);
  expect(answer.body.data.header).toEqual({ ...scene, style: 'classic' });
  expect(
    answer.body.data.members.find(
      (row: { user: { _id: string } }) => row.user._id === DEMO_PERSONA_IDS.sam,
    ).role,
  ).toBe('admin');
  expect((await stored())?.header).toEqual(scene);
});
it('allows a member to change an archived Group’s header', async () => {
  const archived = await callRoute(group.DELETE, {
    method: 'DELETE',
    path: `/api/groups/${id}`,
    params: { id },
    cookie: await signIn('alex'),
  });
  expect(archived.status).toBe(200);
  expect((await save()).body.data.header).toEqual(scene);
  expect((await read()).body.data).toMatchObject({
    isArchived: true,
    header: scene,
    currencyLocked: false,
  });
  expect(
    (await events()).filter(
      (event) => event.metadata?.changes && 'header' in event.metadata.changes,
    ),
  ).toHaveLength(1);
});
it('treats saving the default on a Group with no setting as a no-op', async () => {
  const header = { style: 'classic', scene: 'beach', time: 'auto' };
  expect(await save(header)).toMatchObject({ status: 200, body: { data: { header } } });
  expect((await stored())?.header).toBeUndefined();
  expect(await events()).toHaveLength(0);
});
