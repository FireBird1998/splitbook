import { describe, expect, it } from 'vitest';
import { testPhone } from '../test-utils/test-phone';
import { fakeSplitbook } from '../test-utils/fake-splitbook';
import type { TagCommand, TagSnapshot } from '@splitbook/shared/tag-management';
import type { AccountGroupRecordStore } from './account-record-storage';

const user = {
  id: 'a00000000000000000000001',
  name: 'Alex',
  email: 'alex@example.test',
  image: null,
};
const groupId = 'b00000000000000000000001';
const tagId = 'c00000000000000000000001';
const requestId = '00000000-0000-4000-8000-000000000001';
const iso = '2026-10-13T10:00:00.000Z';
const json = (data: unknown, status = 200, cookie?: string) =>
  new Response(JSON.stringify({ status, ...Object(data) }), {
    status,
    headers: cookie ? { 'Set-Cookie': cookie } : {},
  });

function phone() {
  const networkListeners = new Set<
    (state: { isConnected: boolean; isInternetReachable?: boolean }) => void
  >();
  const server = {
    snapshot: {
      canManage: true,
      tags: [{ id: tagId, name: 'Shared', revision: 0, isArchived: false, isDeleted: false }],
    } as TagSnapshot,
    submitted: [] as TagCommand[],
    lostReply: false,
    tagReads: 0,
    apply: true,
    groupDenied: false,
    failStorage: false,
    denial: null as string | null,
    failure: null as { status: number; code: string } | null,
    result: null as unknown,
    holdPost: null as null | Promise<void>,
  };
  const group = () => ({
    _id: groupId,
    name: 'Harbour Flat',
    createdBy: user.id,
    category: 'home',
    defaultCurrency: 'INR',
    members: [{ user: { ...user, _id: user.id }, role: 'admin', joinedAt: iso }],
    createdAt: iso,
    updatedAt: iso,
  });
  const backend = fakeSplitbook();
  backend.world.people.alex = user;
  Object.defineProperty(backend.world, 'groups', { get: () => [group()] });
  Object.defineProperty(backend.world.groupsByAccount, user.id, {
    get: () => (server.groupDenied ? [] : [group()]),
  });
  Object.defineProperty(backend.world.tags, groupId, { get: () => server.snapshot });
  backend.reply('*', '*', async ({ url, init }) => {
    const path = url.pathname;
    if (
      ['/api/auth/demo-persona/sign-in', '/api/auth/get-session', '/api/auth/sign-out'].includes(
        path,
      )
    )
      return undefined;
    if (path.includes('/tag-actions')) {
      if (server.denial)
        return server.denial === 'unreadable'
          ? {
              ok: false,
              status: 403,
              headers: new Headers(),
              json: async () => {
                throw new SyntaxError('body unavailable');
              },
            }
          : json({ code: server.denial, error: 'Permission changed' }, 403);
      if (init.method === 'POST') {
        const command = JSON.parse(String(init.body)) as TagCommand;
        server.submitted.push(command);
        if (server.holdPost) await server.holdPost;
        if (server.failure)
          return json(
            {
              code: server.failure.code,
              error: 'Tag action unavailable',
              snapshot: server.snapshot,
            },
            server.failure.status,
          );
        if (server.apply)
          server.result ??= {
            state: 'applied',
            requestId: command.requestId,
            receipt: { intent: command.intent, tagId, appliedAt: iso },
            snapshot: server.snapshot,
          };
        if (server.lostReply) throw new TypeError('reply lost');
        return json({ data: { ...Object(server.result), snapshot: server.snapshot } });
      }
      if (path.endsWith('/tag-actions')) {
        server.tagReads++;
        return undefined;
      }
      return json({
        data: server.result
          ? { ...Object(server.result), snapshot: server.snapshot }
          : { state: 'not-applied', requestId, snapshot: server.snapshot },
      });
    }
    if (path === `/api/groups/${groupId}` && server.groupDenied)
      return json({ error: 'Not a member' }, 403);
    if (
      path === '/api/groups' ||
      path === '/api/user/balances' ||
      path === `/api/groups/${groupId}`
    )
      return undefined;
    // The original fixture’s unsupported reads returned malformed empty data, not real pages.
    return json({ data: {} });
  });
  const native = testPhone(backend, {
    origin: 'http://tags.example.test',
    purge: ['tagRequests'],
    newSubmissionKey: () => requestId,
    parts: {
      savedQueries: undefined,
      offlineIdentity: undefined,
      pendingInvitation: undefined,
      expenseDrafts: undefined,
      settlementAttempts: undefined,
      draftRequests: undefined,
      groupCreations: undefined,
      netInfo: {
        addEventListener(listener) {
          networkListeners.add(listener);
          return () => {
            networkListeners.delete(listener);
          };
        },
      },
      accountLocal: {
        financialCleanup: undefined,
        untrustedCopies: undefined,
        signOutRecord: undefined,
        cleanupMarker: { load: async () => false, mark: async () => {}, clear: async () => {} },
      },
    },
  });
  const tagRequests = native.stores.tagRequests;
  delete (tagRequests as AccountGroupRecordStore).list;
  tagRequests.failPersistently('save', new Error('disk full'), () => server.failStorage);
  const boot = () => native.open();

  return {
    boot,
    server,
    tagRequests,
    connect: (isConnected: boolean, isInternetReachable?: boolean) => {
      for (const listener of networkListeners) listener({ isConnected, isInternetReachable });
    },
  };
}

describe('Group Tag actions through the public controller', () => {
  it('allows an explicit Tag write on connected Wi-Fi even when internet reachability is false', async () => {
    const device = phone();
    const controller = device.boot();
    await controller.signIn('alex');
    device.connect(true, false);
    try {
      const manager = controller.groupTags(groupId);
      await manager.read();
      await expect(manager.submit({ action: 'create', name: 'Villa' })).resolves.toMatchObject({
        state: 'applied',
      });
      expect(device.server.submitted).toHaveLength(1);
    } finally {
      device.connect(true, true);
    }
  });

  it('allows explicit correction after an authoritative ambiguous-name rejection', async () => {
    const device = phone();
    const controller = device.boot();
    await controller.signIn('alex');
    device.server.failure = { status: 409, code: 'AMBIGUOUS_TAG' };
    const manager = controller.groupTags(groupId);
    await expect(manager.submit({ action: 'create', name: 'Villa' })).rejects.toMatchObject({
      code: 'AMBIGUOUS_TAG',
    });
    expect((await manager.recovery())?.rejected?.code).toBe('AMBIGUOUS_TAG');
    await manager.acknowledge();
    expect(await manager.pending()).toBeNull();
  });

  it.each([false, true])(
    'retains exact recovery after unavailable transactions; earlier unknown action %s',
    async (earlierUnknown) => {
      const device = phone();
      const controller = device.boot();
      await controller.signIn('alex');
      const manager = controller.groupTags(groupId);
      if (earlierUnknown) {
        device.server.lostReply = true;
        await expect(manager.submit({ action: 'create', name: 'Villa' })).rejects.toThrow();
        device.server.lostReply = false;
      }
      device.server.failure = { status: 503, code: 'TAG_TRANSACTIONS_REQUIRED' };
      await expect(
        earlierUnknown ? manager.retry() : manager.submit({ action: 'create', name: 'Villa' }),
      ).rejects.toMatchObject({ code: 'TAG_TRANSACTIONS_REQUIRED' });
      expect((await manager.recovery())?.rejected).toBeUndefined();
      await expect(manager.acknowledge()).rejects.toThrow('not confirmed');
      const checked = await manager.check();
      expect(checked.state).toBe(earlierUnknown ? 'applied' : 'not-applied');
      if (!earlierUnknown) await expect(manager.acknowledge()).rejects.toThrow('not confirmed');
      device.server.failure = null;
      const result = await manager.retry();
      expect(result.state).toBe('applied');
      expect(
        device.server.submitted.every(
          (command) => JSON.stringify(command) === JSON.stringify(device.server.submitted[0]),
        ),
      ).toBe(true);
      await manager.acknowledge();
    },
  );

  it('clears recovery on sign-out and ignores the late reply from the previous account', async () => {
    const device = phone();
    const controller = device.boot();
    await controller.signIn('alex');
    let release!: () => void;
    device.server.holdPost = new Promise<void>((resolve) => {
      release = resolve;
    });
    const manager = controller.groupTags(groupId);
    const sending = manager
      .submit({ action: 'create', name: 'Villa' })
      .catch((error: unknown) => error);
    await expect.poll(() => device.server.submitted.length).toBe(1);
    await controller.signOut();
    release();
    await sending;
    expect(await device.tagRequests.load(user.id, groupId)).toBeNull();
    expect(controller.getSnapshot().auth.user).toBeNull();
    expect(controller.getSnapshot().tagManager.snapshot).toBeNull();
    await expect(manager.retry()).rejects.toThrow();
  });

  it('drops a closed manager’s late reply and keeps its submitted recovery record', async () => {
    const device = phone();
    const controller = device.boot();
    await controller.signIn('alex');
    const manager = controller.manageTags(groupId);
    const close = manager.open();
    await expect.poll(() => controller.getSnapshot().tagManager.busy).toBe(false);
    manager.newTag();
    manager.enter('Villa');
    let release!: () => void;
    device.server.holdPost = new Promise<void>((resolve) => {
      release = resolve;
    });
    const sending = manager.submit();
    await expect.poll(() => device.server.submitted.length).toBe(1);
    close();
    const reopened = controller.manageTags(groupId);
    const closeAgain = reopened.open();
    await expect.poll(() => controller.getSnapshot().tagManager.busy).toBe(false);
    release();
    await sending;
    expect(controller.getSnapshot().tagManager.result).toBeNull();
    await reopened.check();
    expect(controller.getSnapshot().tagManager.result?.state).toBe('applied');
    closeAgain();
  });

  it('reconnects the open manager with a read and never automatically submits an action', async () => {
    const device = phone();
    const controller = device.boot();
    await controller.signIn('alex');
    const manager = controller.manageTags(groupId);
    const close = manager.open();
    await expect
      .poll(() => controller.getSnapshot().tagManager.snapshot?.tags[0].name)
      .toBe('Shared');
    device.connect(false);
    await expect(
      controller.groupTags(groupId).submit({ action: 'create', name: 'Villa' }),
    ).rejects.toThrow('connection');
    device.server.snapshot.tags[0].name = 'Changed elsewhere';
    device.connect(true);
    await expect
      .poll(() => controller.getSnapshot().tagManager.snapshot?.tags[0].name)
      .toBe('Changed elsewhere');
    expect(device.server.submitted).toEqual([]);
    close();
  });

  it.each([false, true])(
    'confirms Group membership after an unreadable Tag denial: access lost %s',
    async (accessLost) => {
      const device = phone();
      const controller = device.boot();
      await controller.signIn('alex');
      const manager = controller.groupTags(groupId);
      device.server.denial = 'unreadable';
      device.server.groupDenied = accessLost;
      await expect(manager.submit({ action: 'create', name: 'Villa' })).rejects.toThrow();
      expect(controller.getSnapshot().groups.data.some((group) => group.id === groupId)).toBe(
        !accessLost,
      );
      if (accessLost) expect(await device.tagRequests.load(user.id, groupId)).toBeNull();
      else expect(await manager.pending()).not.toBeNull();
    },
  );

  it.each([false, true])(
    'checks Group membership when a read of the Tags meets an unreadable denial: access lost %s (#638)',
    async (accessLost) => {
      const device = phone();
      const controller = device.boot();
      await controller.signIn('alex');
      const manager = controller.groupTags(groupId);
      device.server.denial = 'unreadable';
      device.server.groupDenied = accessLost;
      // Reads go as display reads now, through the same Tag refusal check as changes.
      if (accessLost) await expect(manager.read()).rejects.toThrow();
      else
        await expect(manager.read()).rejects.toMatchObject({
          code: 'TAG_PERMISSION_UNCONFIRMED',
        });
      expect(controller.getSnapshot().groups.data.some((group) => group.id === groupId)).toBe(
        !accessLost,
      );
      expect(device.server.submitted).toEqual([]);
    },
  );

  it('does not submit when the exact intent cannot be stored', async () => {
    const device = phone();
    const controller = device.boot();
    await controller.signIn('alex');
    device.server.failStorage = true;
    await expect(
      controller.groupTags(groupId).submit({ action: 'create', name: 'Villa' }),
    ).rejects.toThrow('nothing was sent');
    expect(device.server.submitted).toEqual([]);
  });

  it('keeps an unconfirmed command after a read-only not-applied check', async () => {
    const device = phone();
    const controller = device.boot();
    await controller.signIn('alex');
    const manager = controller.groupTags(groupId);
    device.server.apply = false;
    device.server.lostReply = true;
    await expect(
      manager.submit({ action: 'rename', tagId, expectedRevision: 0, name: 'Villa' }),
    ).rejects.toThrow();
    expect(await manager.check()).toMatchObject({ state: 'not-applied' });
    await expect(manager.acknowledge()).rejects.toThrow('not confirmed');
    expect(device.server.submitted).toHaveLength(1);
    expect(await manager.pending()).toEqual({
      requestId,
      intent: { action: 'rename', tagId, expectedRevision: 0, name: 'Villa' },
    });
  });

  it('keeps an accessible Group and recovery when only admin permission is lost', async () => {
    const device = phone();
    const controller = device.boot();
    await controller.signIn('alex');
    expect(controller.getSnapshot().groups.data.map((group) => group.id)).toContain(groupId);
    const manager = controller.groupTags(groupId);
    device.server.denial = 'TAG_ADMIN_REQUIRED';
    await expect(manager.submit({ action: 'create', name: 'Villa' })).rejects.toMatchObject({
      code: 'TAG_ADMIN_REQUIRED',
    });
    expect(controller.getSnapshot().groups.data.map((group) => group.id)).toContain(groupId);
    expect(await manager.pending()).toEqual({
      requestId,
      intent: { action: 'create', name: 'Villa' },
    });
    await expect(manager.acknowledge()).rejects.toThrow('not confirmed');
  });

  it('retains the exact submitted action across restart; Check only reads and Retry reuses it', async () => {
    const device = phone();
    const first = device.boot();
    await first.signIn('alex');
    const manager = first.groupTags(groupId);
    expect((await manager.read()).snapshot.canManage).toBe(true);
    device.server.lostReply = true;
    await expect(manager.submit({ action: 'create', name: ' Villa ' })).rejects.toThrow();
    first.dispose();
    device.server.snapshot.tags[0] = {
      id: tagId,
      name: 'Renamed later',
      revision: 2,
      isArchived: true,
      isDeleted: false,
    };
    const second = device.boot();
    await second.restore();
    const recovered = second.groupTags(groupId);
    expect(await recovered.pending()).toEqual({
      requestId,
      intent: { action: 'create', name: 'Villa' },
    });
    const checked = await recovered.check();
    expect(checked).toMatchObject({
      state: 'applied',
      receipt: { intent: { action: 'create', name: 'Villa' }, tagId },
      snapshot: { tags: [{ name: 'Renamed later', isArchived: true }] },
    });
    expect(device.server.submitted).toHaveLength(1);
    device.server.lostReply = false;
    await recovered.retry();
    expect(device.server.submitted).toEqual([
      { requestId, intent: { action: 'create', name: 'Villa' } },
      { requestId, intent: { action: 'create', name: 'Villa' } },
    ]);
    await recovered.acknowledge();
    expect(await recovered.pending()).toBeNull();
  });
});
