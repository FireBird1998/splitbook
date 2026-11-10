import { it, expect, vi } from 'vitest';
import type { Recording, Answer } from './fixture';
import mongoose from 'mongoose';
import Activity from '@/lib/models/Activity';
import RecurringExpense from '@/lib/models/RecurringExpense';
import { DEMO_PERSONA_IDS } from '@/lib/demo-personas';
const { alex, sam, priya } = DEMO_PERSONA_IDS;

export function recordCommonPaths(recording: Recording) {
  for (const expenseAlerts of [false, true])
    for (const paymentAlerts of [false, true])
      it(`first save, Expense alerts ${expenseAlerts ? 'on' : 'off'}, Payment alerts ${paymentAlerts ? 'on' : 'off'}`, async () => {
        vi.stubEnv('ANDROID_NOTIFICATION_EXPENSE_CHANGES_ENABLED', String(expenseAlerts));
        vi.stubEnv('ANDROID_NOTIFICATION_PAYMENTS_ENABLED', String(paymentAlerts));
        const recorded = await recording.capture(() => recording.send());
        expect((recorded.answers as Answer).status).toBe(
          ['manual-expense', 'single-settlement', 'settlement-batch'].includes(recording.writer)
            ? 201
            : 200,
        );
        expect(recorded.after.activities).toHaveLength(1);
        const captures =
          ['manual-expense', 'draft-save'].includes(recording.writer) ||
          (['single-settlement', 'settlement-batch'].includes(recording.writer)
            ? paymentAlerts
            : expenseAlerts);
        expect(recorded.after.activities[0].notificationContext?.recipientIds).toEqual(
          captures
            ? ['single-settlement', 'settlement-batch'].includes(recording.writer)
              ? [sam]
              : [sam, priya]
            : undefined,
        );
      });
  it('same command and retry identity twice', async () => {
    await recording.capture(async () => [await recording.send(), await recording.send()]);
  });
  if (recording.writer !== 'delete')
    it(
      recording.writer === 'recurring-expense'
        ? 'a changed template keeps the recorded Month'
        : 'changed command under the original retry identity',
      async () => {
        await recording.capture(async () => {
          const first = await recording.send();
          if (recording.writer === 'recurring-expense')
            await RecurringExpense.updateOne(
              { _id: recording.templateId },
              { $set: { description: 'Changed template' } },
            );
          const changes =
            recording.writer === 'draft-save'
              ? {
                  drafts: recording.draftCommand.drafts.map((draft) => ({
                    ...draft,
                    review: '0'.repeat(64),
                  })),
                }
              : recording.writer === 'settlement-batch'
                ? { settlements: [{ amount: 31, currency: 'INR' }] }
                : recording.writer === 'tag-change'
                  ? { tagId: recording.foodId }
                  : { description: 'Changed retry', note: 'Changed retry' };
          return [first, await recording.send(changes)];
        });
      },
    );
  it('retry after the Group is archived', async () => {
    await recording.capture(async () => {
      const first = await recording.send();
      await recording.archive();
      return [first, await recording.send()];
    });
  });
  it('first save in an archived Group', async () => {
    await recording.archive();
    await recording.capture(() => recording.send());
  });
  it('actor is no longer a member before the request', async () => {
    await recording.remove(alex);
    await recording.capture(() => recording.send());
  });
  it('named person is no longer a member before the request', async () => {
    if (recording.writer === 'recurring-expense') await recording.readAs('priya');
    await recording.remove(sam);
    await recording.capture(() =>
      recording.send(
        recording.writer === 'edit' || recording.writer === 'restore'
          ? {
              amount: 240,
              paidBy: [{ user: alex, amount: 240 }],
              splitBetween: [{ user: sam }, { user: priya }],
            }
          : {},
      ),
    );
  });
  for (const person of ['actor', 'named person'] as const)
    it(`retry after the ${person} leaves following the first recording`, async () => {
      if (recording.writer === 'recurring-expense' && person === 'named person')
        await recording.readAs('priya');
      await recording.capture(async () => {
        const first = await recording.send();
        await recording.remove(person === 'actor' ? alex : sam);
        return [first, await recording.send()];
      });
    });
  it('archive commits after the checks and before the recording fence', async () => {
    await recording.interleave(recording.archive);
  });
  it('actor leaves between the checks and the commit', async () => {
    await recording.interleave(() => recording.remove(alex));
  });
  it('named person leaves between the checks and the commit', async () => {
    if (recording.writer === 'recurring-expense') await recording.readAs('priya');
    const changes =
      recording.writer === 'edit' || recording.writer === 'restore'
        ? {
            amount: 240,
            paidBy: [{ user: alex, amount: 240 }],
            splitBetween: [{ user: sam }, { user: priya }],
          }
        : {};
    await recording.interleave(
      () => recording.remove(sam),
      changes,
      recording.writer === 'edit' || recording.writer === 'restore' ? 1 : recording.fenceNumber,
    );
  });
  it('two requests race with the same retry identity', async () => {
    const transaction = mongoose.connection.transaction.bind(mongoose.connection);
    const calls = new Map<string, number>();
    let arrivals = 0;
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const spy = vi
      .spyOn(mongoose.connection, 'transaction')
      .mockImplementation(async (callback, options) => {
        const owner = recording.requestOwner.getStore();
        if (owner) {
          const count = (calls.get(owner) ?? 0) + 1;
          calls.set(owner, count);
          if (count === recording.fenceNumber) {
            if (++arrivals === 2) release();
            await gate;
          }
        }
        return transaction(callback, options);
      });
    const timeout = setTimeout(release, 2000);
    try {
      await recording.capture(async () => {
        const answers = await Promise.all(
          ['a', 'b'].map((owner) => recording.requestOwner.run(owner, () => recording.send())),
        );
        expect(arrivals).toBe(2);
        return answers.sort((left, right) =>
          JSON.stringify(left).localeCompare(JSON.stringify(right)),
        );
      });
    } finally {
      clearTimeout(timeout);
      release();
      spy.mockRestore();
    }
  });
  for (const recovery of ['retry', 'feed'] as const)
    it(`Activity fails after the commit, then ${recovery}`, async () => {
      vi.spyOn(console, 'error').mockImplementation(() => {});
      const fault = vi.spyOn(Activity, 'updateOne').mockImplementation(() => {
        throw new Error('Fictional Activity storage outage');
      });
      const before = await recording.state();
      const first = await recording.send();
      const pending = await recording.state();
      expect(pending.activities).toHaveLength(0);
      expect(
        [...pending.expenses, ...pending.settlements].flatMap((row) => row.pendingActivity ?? []),
      ).toHaveLength(1);
      fault.mockRestore();
      const recovered =
        recovery === 'retry'
          ? await recording.send()
          : await recording.http(recording.routes.feed.GET, 'GET', 'activity');
      const after = await recording.state();
      const publishesOnRetry = ['manual-expense', 'single-settlement', 'settlement-batch'].includes(
        recording.writer,
      );
      expect(after.activities).toHaveLength(recovery === 'feed' || publishesOnRetry ? 1 : 0);
      expect(
        recording.names.normalise({ before, first, pending, recovered, after }),
      ).toMatchSnapshot();
    });
}
