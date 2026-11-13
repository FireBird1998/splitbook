import { afterEach, describe, expect, it, vi } from 'vitest';
import type { DraftReview } from '@splitbook/shared/validators/expense-draft';
import { fakeSplitbook } from '../test-utils/fake-splitbook';
import { testPhone, until } from '../test-utils/test-phone';

const iso = '2026-11-13T12:00:00.000Z';
afterEach(() => vi.unstubAllEnvs());

function fixture() {
  vi.stubEnv('TZ', 'UTC');
  vi.stubEnv('EXPO_PUBLIC_PERSISTENT_DRAFTS_ENABLED', 'true');
  const server = fakeSplitbook();
  const group = server.world.groups[0];
  const user = server.world.people.alex;
  let items: DraftReview[] = [1, 2, 3].map((index) => ({
    draft: {
      id: `d${String(index).padStart(23, '0')}`,
      groupId: group._id,
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
      groups: [
        {
          groupId: group._id,
          groupName: group.name,
          currency: 'INR',
          count: items.length,
          items,
        },
      ],
    };
  };
  updateRead();
  server.reply('POST', `/api/groups/${group._id}/drafts/review`, ({ body }) =>
    Response.json({
      data: items.filter(({ draft }) => (body!.ids as string[]).includes(draft.id)),
    }),
  );
  const app = testPhone(server, { now: Date.parse(iso) }).open();
  return {
    app,
    server,
    ids,
    remove: (id: string) => {
      items = items.filter(({ draft }) => draft.id !== id);
      updateRead();
    },
  };
}

describe('an upcoming Android review item finished elsewhere', () => {
  it('records today: reaching the missing item shows its original copy and a generic error', async () => {
    const f = fixture();
    await f.app.signIn('alex');
    await until(f.app, (s) => s.toReview.status === 'ready');
    await f.app.startReviewRun();
    f.remove(f.ids[1]);
    await f.app.refreshToReview();
    const before = f.server.requests.length;
    await f.app.reviewRun()!.skip();

    const run = f.app.getSnapshot().toReview.run!;
    expect(run.index).toBe(1);
    expect(run.items[run.index].item.draft.id).toBe(f.ids[1]);
    expect(run.message).toBe('Could not confirm this action. Check again.');
    expect(run.outcomes).toEqual([{ id: f.ids[0], status: 'skipped' }]);
    expect(run.busy).toBe(false);
    expect(
      f.server.requests
        .slice(before)
        .filter((r) => r.path.endsWith('/drafts/review'))
        .map((r) => r.body!.ids),
    ).toEqual([[f.ids[1]]]);
  });
});
