import { afterEach, expect, it, vi } from 'vitest';
import { fakeSplitbook } from '../test-utils/fake-splitbook';
import { testPhone, until } from '../test-utils/test-phone';
import { createSceneMotion } from './scene-motion';
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
      { status: reason === 'disabled' ? 503 : 500 },
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
it('keeps Motion outside account storage and serializes phone writes', async () => {
  let kept: string | null = 'off';
  const device = createSceneMotion({
    load: async () => kept,
    save: async (value) => {
      kept = value;
    },
  });
  await device.restore();
  expect(device.getSnapshot().enabled).toBe(false);
  await device.select(true);
  expect(kept).toBe('on');
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

it('restores the saved header offline and keeps phone Motion through account sign-out', async () => {
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
  let kept: string | null = null;
  const motion = createSceneMotion({
    load: async () => kept,
    save: async (value) => {
      kept = value;
    },
  });
  await motion.select(false);
  await app.signOut();
  expect(kept).toBe('off');
  expect(app.getSnapshot().headerSettings).toBeNull();
});
