import { afterEach, describe, expect, it, vi } from 'vitest';
import { summarizeReviewRun } from '@splitbook/shared/to-review';
import type { DraftReview } from '@splitbook/shared/validators/expense-draft';
import { fakeSplitbook } from '../test-utils/fake-splitbook';
import { testPhone, until } from '../test-utils/test-phone';

const iso = '2026-11-13T12:00:00.000Z';
afterEach(() => {
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

function fixture(crossGroups = false) {
  vi.stubEnv('TZ', 'UTC');
  vi.useFakeTimers({ now: Date.parse(iso), toFake: ['Date'] });
  vi.stubEnv('EXPO_PUBLIC_PERSISTENT_DRAFTS_ENABLED', 'true');
  const server = fakeSplitbook();
  const group = server.world.groups[0];
  const user = server.world.people.alex;
  const other = { ...group, _id: 'b00000000000000000000002', name: 'Goa Friends Trip' };
  const groups = crossGroups ? [group, other] : [group];
  server.world.groups = groups;
  let items: DraftReview[] = [1, 2, 3].map((index) => ({
    draft: {
      id: `d${String(index).padStart(23, '0')}`,
      groupId: crossGroups && index > 1 ? other._id : group._id,
      revision: 0,
      state: 'active',
      preparedBy: { kind: 'member' },
      changedBy: { kind: 'member' },
      createdAt: iso,
      updatedAt: iso,
      missingFields: [],
      values: {
        description: `Meal ${index}`,
        amount: 10,
        currency: 'INR',
        date: '2026-11-13',
        category: 'food',
        tagId: 'c00000000000000000000001',
        paidBy: [{ user: user.id, amount: 10 }],
        splitMethod: 'equal',
        splitBetween: [{ user: user.id }],
      },
    },
    review: 'a'.repeat(64),
    problems: [],
    duplicates: [],
  }));
  const ids = items.map(({ draft }) => draft.id);
  const updateRead = () => {
    server.world.toReview = {
      total: items.length,
      groups: groups.flatMap((group) => {
        const own = items.filter(({ draft }) => draft.groupId === group._id);
        return own.length
          ? [
              {
                groupId: group._id,
                groupName: group.name,
                currency: 'INR',
                count: own.length,
                items: own,
              },
            ]
          : [];
      }),
    };
  };
  updateRead();
  for (const group of groups) {
    server.reply('POST', `/api/groups/${group._id}/drafts/review`, ({ body }) =>
      Response.json({
        data: items.filter(({ draft }) => (body!.ids as string[]).includes(draft.id)),
      }),
    );
    server.reply('POST', `/api/groups/${group._id}/drafts/save`, ({ body }) =>
      Response.json({
        data: (body!.drafts as { id: string }[]).map(({ id }) => ({
          id,
          status: 'saved',
          expenseId: `e${id.slice(1)}`,
        })),
      }),
    );
  }
  const app = testPhone(server, { now: Date.parse(iso) }).open();
  return {
    app,
    server,
    ids,
    groupId: group._id,
    otherGroupId: other._id,
    remove: (...ids: string[]) => {
      items = items.filter(({ draft }) => !ids.includes(draft.id));
      updateRead();
    },
  };
}

describe('an upcoming Android review item finished elsewhere', () => {
  it('passes over the absent upcoming item without an outcome or request', async () => {
    const f = fixture();
    await f.app.signIn('alex');
    await until(f.app, (s) => s.toReview.status === 'ready');
    await f.app.startReviewRun();
    f.remove(f.ids[1]);
    await f.app.refreshToReview();
    const before = f.server.requests.length;
    await f.app.reviewRun()!.skip();

    const run = f.app.getSnapshot().toReview.run!;
    expect(run.index).toBe(2);
    expect(run.items[run.index].item.draft.id).toBe(f.ids[2]);
    expect(run.message).toBeNull();
    expect(run.outcomes).toEqual([{ id: f.ids[0], status: 'skipped' }]);
    expect(run.busy).toBe(false);
    expect(
      f.server.requests
        .slice(before)
        .filter((r) => r.path.endsWith('/drafts/review'))
        .map((r) => r.body!.ids),
    ).toEqual([[f.ids[2]]]);
  });

  it('passes over an absent item across Groups, preserving the original order and counts', async () => {
    const f = fixture(true);
    await f.app.signIn('alex');
    await until(f.app, (s) => s.toReview.status === 'ready');
    await f.app.startReviewRun();
    f.remove(f.ids[1]);
    await f.app.refreshToReview();
    const before = f.server.requests.length;
    await f.app.reviewRun()!.skip();

    const run = f.app.getSnapshot().toReview.run!;
    expect(run.index).toBe(2);
    expect(run.items[run.index].groupId).toBe(f.otherGroupId);
    expect(run.items[run.index].item.draft.id).toBe(f.ids[2]);
    expect(run.outcomes).toEqual([{ id: f.ids[0], status: 'skipped' }]);
    expect(summarizeReviewRun(run.outcomes)).toEqual({
      saved: 0,
      deleted: 0,
      left: 1,
      label: '1 left for later',
    });
    expect(
      f.server.requests
        .slice(before)
        .filter((r) => r.path.startsWith('/api/groups/'))
        .map((r) => `${r.method} ${r.path}`),
    ).toEqual([
      `GET /api/groups/${f.otherGroupId}`,
      `POST /api/groups/${f.otherGroupId}/drafts/review`,
    ]);
    expect(
      f.server.requests.slice(before).find((r) => r.path.endsWith('/drafts/review'))!.body!.ids,
    ).toEqual([f.ids[2]]);
  });

  it('reaches its summary without any request when every remaining item is gone', async () => {
    const f = fixture(true);
    await f.app.signIn('alex');
    await until(f.app, (s) => s.toReview.status === 'ready');
    await f.app.startReviewRun();
    f.remove(f.ids[1], f.ids[2]);
    await f.app.refreshToReview();
    const before = f.server.requests.length;
    await f.app.reviewRun()!.skip();

    const run = f.app.getSnapshot().toReview.run!;
    expect(run.index).toBe(run.items.length);
    expect(run.message).toBeNull();
    expect(run.outcomes).toEqual([{ id: f.ids[0], status: 'skipped' }]);
    expect(summarizeReviewRun(run.outcomes)).toEqual({
      saved: 0,
      deleted: 0,
      left: 1,
      label: '1 left for later',
    });
    expect(f.server.requests.slice(before)).toEqual([]);
  });

  it('retains presence delivered during a save and omits the absent item after confirmation', async () => {
    const f = fixture(true);
    await f.app.signIn('alex');
    await until(f.app, (s) => s.toReview.status === 'ready');
    await f.app.startReviewRun();
    const hold = f.server.hold('POST', `/api/groups/${f.groupId}/drafts/save`, { at: 'request' });
    const saving = f.app.reviewRun()!.save();
    await hold.arrived;
    f.remove(f.ids[1]);
    await f.app.refreshToReview();
    hold.release();
    await saving;

    const run = f.app.getSnapshot().toReview.run!;
    expect(run.index).toBe(2);
    expect(run.items[run.index].item.draft.id).toBe(f.ids[2]);
    expect(run.outcomes).toEqual([{ id: f.ids[0], status: 'saved' }]);
    expect(summarizeReviewRun(run.outcomes)).toEqual({
      saved: 1,
      deleted: 0,
      left: 0,
      label: 'Saved 1',
    });
    expect(
      f.server.requests
        .filter((r) => r.path.endsWith('/drafts/review'))
        .flatMap((r) => r.body!.ids as string[]),
    ).not.toContain(f.ids[1]);
  });

  it('records the out-of-scope current disappearance: Save shows the error but sends no save', async () => {
    const f = fixture();
    await f.app.signIn('alex');
    await until(f.app, (s) => s.toReview.status === 'ready');
    await f.app.startReviewRun();
    f.remove(f.ids[0]);
    await f.app.refreshToReview();
    await f.app.reviewRun()!.save();

    const run = f.app.getSnapshot().toReview.run!;
    expect(run.index).toBe(0);
    expect(run.items[run.index].item.draft.id).toBe(f.ids[0]);
    expect(run.message).toBe('Could not confirm this action. Check again.');
    expect(run.outcomes).toEqual([]);
    expect(f.server.requests.filter((r) => r.path.endsWith('/drafts/save'))).toEqual([]);
  });

  it('keeps upcoming items when the account read fails instead of confirming absence', async () => {
    const f = fixture();
    await f.app.signIn('alex');
    await until(f.app, (s) => s.toReview.status === 'ready');
    await f.app.startReviewRun();
    f.server.reply(
      'GET',
      '/api/user/to-review',
      () => Response.json({ error: 'Unavailable', status: 500 }, { status: 500 }),
      { once: true },
    );
    await f.app.refreshToReview();
    expect(f.app.getSnapshot().toReview.status).toBe('error');
    await f.app.reviewRun()!.skip();
    const run = f.app.getSnapshot().toReview.run!;
    expect(run.index).toBe(1);
    expect(run.items[run.index].item.draft.id).toBe(f.ids[1]);
    expect(run.outcomes).toEqual([{ id: f.ids[0], status: 'skipped' }]);
  });
});
