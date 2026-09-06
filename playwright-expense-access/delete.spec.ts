import { test, expect, dataOf, expensePath, observeLedger, generatedExpense } from './fixtures';
import { accessMatrix } from './access-matrix';
import { DEMO_PERSONA_IDS } from '../src/lib/demo-personas';

accessMatrix({ name: 'delete', request: (actor, path) => actor.delete(path, { maxRedirects: 0 }) });

for (const origin of ['manual', 'recurring'] as const) {
  test(`ordinary member soft-deletes ${origin} expense and preserves repeat-deletion behavior`, async ({
    ledger,
  }) => {
    const id = origin === 'recurring' ? await generatedExpense(ledger) : ledger.expenseB;
    const path = expensePath(ledger.groupB, id);
    const before = await dataOf(await ledger.sam.get(path));
    for (const actor of [ledger.sam, ledger.priya]) {
      expect(await dataOf(await actor.delete(path))).toEqual({ message: 'Expense deleted' });
      const stored = await dataOf(await ledger.sam.get(path));
      const actorId = actor === ledger.sam ? DEMO_PERSONA_IDS.sam : DEMO_PERSONA_IDS.priya;
      expect(stored).toMatchObject({
        isDeleted: true,
        deletedBy: actorId,
        description: before.description,
        amount: 1200,
        editHistory: before.editHistory,
      });
      expect(Number.isFinite(Date.parse(stored.deletedAt))).toBe(true);
      const activity = await dataOf(
        await ledger.priya.get(`/api/groups/${ledger.groupB}/activity`),
      );
      expect(activity.activities).toContainEqual(
        expect.objectContaining({
          type: 'expense_deleted',
          actor: expect.objectContaining({ _id: actorId }),
          metadata: expect.objectContaining({ expenseId: id }),
        }),
      );
    }
    const list = await dataOf(await ledger.sam.get(`/api/groups/${ledger.groupB}/expenses`));
    expect(list.expenses.map((expense: { _id: string }) => expense._id)).not.toContain(id);
  });
}

test('cross-group deletion cannot change the expense or its audit trail', async ({ ledger }) => {
  const before = await observeLedger(ledger, ledger.expenseB);
  const response = await ledger.alex.delete(expensePath(ledger.groupA, ledger.expenseB));
  expect.soft(response.status()).toBe(404);
  expect.soft(await response.json()).toEqual({ error: 'Expense not found', status: 404 });
  expect(await observeLedger(ledger, ledger.expenseB)).toEqual(before);
});
