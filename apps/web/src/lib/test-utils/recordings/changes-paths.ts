import { it, expect, vi } from 'vitest';
import type { Recording, Answer } from './fixture';
import mongoose from 'mongoose';
import Expense from '@/lib/models/Expense';
import Activity from '@/lib/models/Activity';
import { DEMO_PERSONA_IDS } from '@/lib/demo-personas';
const { alex, sam, priya } = DEMO_PERSONA_IDS;

export function recordChangesPaths(recording: Recording) {
  if (['edit', 'delete', 'restore'].includes(recording.writer)) {
    for (const revisionHeader of ['stale', 'missing', 'malformed'] as const)
      for (const exists of [true, false])
        it(`${revisionHeader} revision with ${exists ? 'an existing' : 'a missing'} Expense`, async () => {
          if (!exists) await Expense.deleteOne({ _id: recording.expenseId });
          const header =
            revisionHeader === 'stale'
              ? '91'
              : revisionHeader === 'missing'
                ? ''
                : 'not-a-revision';
          await recording.capture(() => recording.send({}, { 'X-Splitbook-Revision': header }));
        });
    it('an old Expense gets its first revision before a missing revision is refused', async () => {
      await Expense.collection.updateOne(
        { _id: new mongoose.Types.ObjectId(recording.expenseId) },
        { $unset: { revision: '' } },
      );
      await recording.capture(() => recording.send({}, { 'X-Splitbook-Revision': '' }));
    });
  }
  if (recording.writer === 'edit' || recording.writer === 'restore')
    it('changing the people alerts the before-and-after union', async () => {
      const recorded = await recording.capture(() =>
        recording.send({ splitBetween: [{ user: priya }] }),
      );
      expect(
        recorded.after.expenses[0].splitBetween.map((row: { user: unknown }) => String(row.user)),
      ).toEqual([priya]);
      expect(recorded.after.activities[0].notificationContext.recipientIds).toEqual([sam, priya]);
    });
  if (recording.writer === 'edit') {
    it('an edit that changes nothing', async () => {
      await recording.capture(() => recording.send({ description: 'Recorded dinner' }));
    });
    it('an edit moves the currency', async () => {
      await recording.capture(() =>
        recording.send({
          currency: 'EUR',
          amount: 120,
          paidBy: [{ user: alex, amount: 120 }],
          splitBetween: [{ user: sam }, { user: priya }],
        }),
      );
    });
  }
  if (recording.writer === 'delete')
    it('an already deleted Expense with its current revision', async () => {
      await recording.send();
      await Activity.deleteMany({});
      await recording.capture(() => recording.send({}, { 'X-Splitbook-Revision': '1' }));
    });
  if (recording.writer === 'restore')
    it('a restore also changes fields, history records them and Activity says restored', async () => {
      const recorded = await recording.capture(() =>
        recording.send({
          description: 'Restored and edited dinner',
          notes: 'Corrected while restoring',
        }),
      );
      expect(recorded.after.activities[0].metadata).toMatchObject({ action: 'restored' });
      expect(recorded.after.activities[0].metadata).not.toHaveProperty('changes');
      expect(recorded.after.expenses[0].editHistory).toHaveLength(1);
    });
  if (recording.isChange)
    it('a full Activity backlog refuses another event without saving the change', async () => {
      const pending = Array.from({ length: 100 }, (_, ordinal) => ({
        _id: new mongoose.Types.ObjectId(),
        group: new mongoose.Types.ObjectId(recording.groupId),
        actor: new mongoose.Types.ObjectId(alex),
        occurredAt: recording.clock,
        type: 'expense_updated',
        metadata: { expenseId: recording.expenseId, ordinal },
      }));
      await Expense.collection.updateOne(
        { _id: new mongoose.Types.ObjectId(recording.expenseId) },
        { $set: { pendingActivity: pending } },
      );
      vi.spyOn(console, 'error').mockImplementation(() => {});
      const recorded = await recording.capture(() => recording.send());
      expect(recorded.after.activities).toHaveLength(0);
      expect(recorded.after.expenses[0].pendingActivity).toHaveLength(100);
    });
  if (recording.writer === 'tag-change')
    it('a stale Expense does not stop the next Expense from changing', async () => {
      const second = await recording.http(
        recording.routes.expenses.POST,
        'POST',
        'expenses',
        recording.expenseBody({ description: 'Another dinner' }),
      );
      expect(second.status).toBe(201);
      await Activity.deleteMany({});
      const recorded = await recording.capture(() =>
        recording.send({
          expenses: [
            { id: recording.expenseId, revision: 91 },
            { id: second.body.data._id, revision: 0 },
          ],
        }),
      );
      expect(
        (recorded.answers as Answer).body.data.results.map(
          (row: { outcome: string }) => row.outcome,
        ),
      ).toEqual(['changed-elsewhere', 'changed']);
    });
}
