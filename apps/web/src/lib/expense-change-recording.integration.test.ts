import { pendingActivityFixture as makePendingActivity } from '@/lib/test-utils/pending-activity';
import { describe, expect, it, vi } from 'vitest';
import { Types } from 'mongoose';
import Expense from './models/Expense';
import { DEMO_PERSONA_IDS } from './demo-personas';
import { recordingFixture } from './test-utils/recordings/fixture';

vi.mock('next/headers', async () => (await import('./test-utils/signed-in-route')).nextHeaders);
vi.mock('next/server', async (original) =>
  (await import('./test-utils/signed-in-route')).nextServer(original),
);

const fixture = recordingFixture('edit', 'expense-change-order');
it.each(['edit', 'delete', 'restore'] as const)(
  '%s captures Activity and history or deletion time before waiting for the save fence',
  async (writer) => {
    if (writer === 'restore')
      await Expense.collection.updateOne(
        { _id: new Types.ObjectId(fixture.expenseId) },
        {
          $set: {
            isDeleted: true,
            deletedAt: fixture.clock,
            deletedBy: new Types.ObjectId(DEMO_PERSONA_IDS.alex),
          },
        },
      );
    const pause = fixture.holdFence(2);
    const pending =
      writer === 'delete'
        ? fixture.http(
            fixture.routes.expense.DELETE,
            'DELETE',
            `expenses/${fixture.expenseId}`,
            undefined,
            { 'X-Splitbook-Revision': '0' },
          )
        : fixture.send({
            notes: 'Changed alongside recording',
            ...(writer === 'restore' ? { isDeleted: false } : {}),
          });
    try {
      await Promise.race([
        pause.reached,
        pending.then(() => {
          throw new Error('Change ended before save fence');
        }),
      ]);
      vi.setSystemTime(new Date(fixture.clock.getTime() + 500));
    } finally {
      pause.restore();
      pause.release();
      await pending;
    }
    expect((await pending).status).toBe(200);
    const state = await fixture.state();
    expect(state.expenses[0].updatedAt.toISOString()).toBe(
      new Date(fixture.clock.getTime() + 500).toISOString(),
    );
    expect(state.activities[0].createdAt.toISOString()).toBe(fixture.clock.toISOString());
    if (writer === 'delete')
      expect(state.expenses[0].deletedAt.toISOString()).toBe(fixture.clock.toISOString());
    else
      expect(state.expenses[0].editHistory[0].editedAt.toISOString()).toBe(
        fixture.clock.toISOString(),
      );
  },
);

describe('change refusal precedence', () => {
  it('requires the displayed revision before judging unsupported stored money', async () => {
    await Expense.collection.updateOne(
      { _id: new Types.ObjectId(fixture.expenseId) },
      { $set: { currency: 'ZZZ' } },
    );
    const answer = await fixture.send({}, { 'X-Splitbook-Revision': '' });
    expect(answer.status).toBe(428);
    expect(answer.body.code).toBe('REVISION_REQUIRED');
  });
  it('validates the requested Tag before judging a full Activity backlog', async () => {
    const pendingActivity = Array.from({ length: 100 }, () =>
      makePendingActivity(fixture.groupId, 'expense_updated', DEMO_PERSONA_IDS.alex, {
        expenseId: fixture.expenseId,
      }),
    );
    await Expense.collection.updateOne(
      { _id: new Types.ObjectId(fixture.expenseId) },
      { $set: { pendingActivity } },
    );
    const answer = await fixture.send({ tagId: String(new Types.ObjectId()) });
    expect(answer.status).toBe(422);
    expect(answer.body.code).toBe('INVALID_TAG');
  });
});

it.each(['edit', 'delete', 'restore'] as const)(
  '%s refuses an actor who left before legacy revision initialization',
  async (operation) => {
    await Expense.collection.updateOne(
      { _id: new Types.ObjectId(fixture.expenseId) },
      {
        $unset: { revision: '' },
        ...(operation === 'restore' ? { $set: { isDeleted: true } } : {}),
      },
    );
    const pause = fixture.holdFence(1);
    const pending =
      operation === 'delete'
        ? fixture.http(
            fixture.routes.expense.DELETE,
            'DELETE',
            `expenses/${fixture.expenseId}`,
            undefined,
            { 'X-Splitbook-Revision': '0' },
          )
        : fixture.send(operation === 'restore' ? { isDeleted: false } : {}, {
            'X-Splitbook-Revision': '0',
          });
    try {
      await Promise.race([
        pause.reached,
        pending.then(() => {
          throw new Error('Change ended before initialization');
        }),
      ]);
      await fixture.remove(DEMO_PERSONA_IDS.alex);
    } finally {
      pause.restore();
      pause.release();
      await pending;
    }
    expect((await pending).status).toBe(403);
    expect((await fixture.state()).expenses[0]).not.toHaveProperty('revision');
  },
);
