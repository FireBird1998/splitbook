import { afterEach, expect, it, vi } from 'vitest';
import { fakeSplitbook } from '../test-utils/fake-splitbook';
import { testPhone, until } from '../test-utils/test-phone';
afterEach(() => vi.unstubAllEnvs());
async function setup() {
  vi.stubEnv('EXPO_PUBLIC_HEADER_SCENES_ENABLED', 'true');
  const server = fakeSplitbook();
  const app = testPhone(server).open();
  await app.signIn('alex');
  await app.openGroup(server.world.groups[0]!._id);
  await until(app, (snapshot) => snapshot.detail.status === 'ready');
  app.openHeaderSettings();
  app.chooseHeader({ style: 'scene', scene: 'sakura', time: 'night' });
  return { server, app, path: `/api/groups/${server.world.groups[0]!._id}/header` };
}
it('any member saves their choices through one explicit PATCH', async () => {
  const { server, app, path } = await setup();
  server.reply('PATCH', path, () =>
    Response.json({ success: true, data: { style: 'scene', scene: 'sakura', time: 'night' } }),
  );
  expect(await app.saveHeader()).toBe(true);
  expect(app.getSnapshot().headerSettings?.saved).toEqual({
    style: 'scene',
    scene: 'sakura',
    time: 'night',
  });
  expect(server.requests.filter((r) => r.method === 'PATCH' && r.path === path)).toHaveLength(1);
});
it.each(['failed', 'disabled'] as const)('keeps unsaved choices when %s', async (reason) => {
  const { server, app, path } = await setup();
  server.reply('PATCH', path, () =>
    Response.json(
      {
        success: false,
        code: reason === 'disabled' ? 'HEADER_SCENES_DISABLED' : 'SERVER_ERROR',
        error: 'Unavailable',
      },
      { status: reason === 'disabled' ? 404 : 500 },
    ),
  );
  expect(await app.saveHeader()).toBe(false);
  expect(app.getSnapshot().headerSettings?.draft.scene).toBe('sakura');
  expect(app.getSnapshot().headerSettings?.message).toMatch(/not.*saved/);
  if (reason === 'disabled')
    expect(app.getSnapshot().headerSettings?.message).toContain('unavailable here');
});
it('hides entry while disabled and clears account choices on sign-out', async () => {
  const { app } = await setup();
  await app.signOut();
  expect(app.getSnapshot().headerSettings).toBeNull();
  vi.stubEnv('EXPO_PUBLIC_HEADER_SCENES_ENABLED', 'false');
  app.openHeaderSettings();
  expect(app.getSnapshot().headerSettings).toBeNull();
});
it('refuses offline without queuing or replaying the header write', async () => {
  const { server, app, path } = await setup();
  server.online = false;
  await app.refresh();
  expect(app.getSnapshot().offline.active).toBe(true);
  expect(await app.saveHeader()).toBe(false);
  expect(app.getSnapshot().headerSettings?.draft.scene).toBe('sakura');
  expect(app.getSnapshot().headerSettings?.message).toContain('needs a connection');
  server.online = true;
  await app.refresh();
  expect(server.requests.filter((r) => r.method === 'PATCH' && r.path === path)).toHaveLength(0);
});

it('restores the saved header offline and clears account header choices on sign-out', async () => {
  vi.stubEnv('EXPO_PUBLIC_HEADER_SCENES_ENABLED', 'true');
  const server = fakeSplitbook();
  Object.assign(server.world.groups[0]!, {
    header: { style: 'scene', scene: 'eco-city', time: 'morning' },
  });
  const phone = testPhone(server);
  const app = phone.open();
  await app.signIn('alex');
  await app.openGroup(server.world.groups[0]!._id);
  await until(app, (s) => s.detail.status === 'ready');
  server.online = false;
  await app.refresh();
  expect(app.getSnapshot().detail.data?.header?.scene).toBe('eco-city');
  await app.signOut();
  expect(app.getSnapshot().headerSettings).toBeNull();
});

it('invalidates a successful write after navigation cleared its settings snapshot', async () => {
  const { server, app, path } = await setup();
  const id = server.world.groups[0]!._id;
  const chosen = { style: 'scene', scene: 'sakura', time: 'night' };
  server.reply('PATCH', path, () => {
    Object.assign(server.world.groups[0]!, { header: chosen });
    return Response.json({ success: true, data: chosen });
  });
  const held = server.hold('PATCH', path);
  const saving = app.saveHeader();
  await held.arrived;
  app.back();
  expect(app.getSnapshot().headerSettings).toBeNull();
  held.release();
  expect(await saving).toBe(true);
  const before = server.requests.filter(
    (request) => request.method === 'GET' && request.path === `/api/groups/${id}`,
  ).length;
  await app.openGroup(id);
  await until(app, (state) => state.detail.status === 'ready');
  expect(app.getSnapshot().detail.data?.header).toEqual(chosen);
  expect(
    server.requests.filter(
      (request) => request.method === 'GET' && request.path === `/api/groups/${id}`,
    ).length,
  ).toBeGreaterThan(before);
});
it('refreshes Group access after a FORBIDDEN save', async () => {
  const { server, app, path } = await setup();
  const id = server.world.groups[0]!._id;
  const before = server.requests.filter(
    (r) => r.method === 'GET' && r.path === `/api/groups/${id}`,
  ).length;
  server.reply('PATCH', path, () =>
    Response.json(
      { success: false, code: 'FORBIDDEN', error: 'Membership removed' },
      { status: 403 },
    ),
  );
  server.reply('GET', `/api/groups/${id}`, () =>
    Response.json(
      { success: false, code: 'FORBIDDEN', error: 'Membership removed' },
      { status: 403 },
    ),
  );
  expect(await app.saveHeader()).toBe(false);
  await until(app, (state) => state.detail.status === 'denied');
  expect(app.getSnapshot().headerSettings).toBeNull();
  expect(
    server.requests.filter((r) => r.method === 'GET' && r.path === `/api/groups/${id}`).length,
  ).toBeGreaterThan(before);
});
it('ignores a save reply after sign-out and another account sign-in', async () => {
  const { server, app, path } = await setup();
  server.reply('PATCH', path, () =>
    Response.json({ success: true, data: { style: 'scene', scene: 'sakura', time: 'night' } }),
  );
  const held = server.hold('PATCH', path);
  const saving = app.saveHeader();
  await held.arrived;
  await app.signOut();
  await app.signIn('sam');
  const before = server.requests.length;
  held.release();
  expect(await saving).toBe(false);
  expect(app.getSnapshot().headerSettings).toBeNull();
  expect(app.getSnapshot().auth.user?.id).toBe(server.world.people.sam.id);
  expect(server.requests).toHaveLength(before);
});
