import { test, expect, dataOf, expensePath, observeLedger, generatedExpense } from './fixtures';
import { accessMatrix } from './access-matrix';
import { DEMO_PERSONA_IDS } from '../src/lib/demo-personas';

for (const membership of ['outsider', 'removed'] as const) {
  for (const body of ['invalid shape', 'malformed JSON'] as const) {
    test(`PATCH preserves forbidden precedence for ${membership} with ${body}`, async ({
      ledger,
    }) => {
      const actor = membership === 'outsider' ? ledger.alex : ledger.sam;
      if (membership === 'removed') {
        await dataOf(
          await ledger.priya.delete(`/api/groups/${ledger.groupB}/members/${DEMO_PERSONA_IDS.sam}`),
        );
        expect((await (await actor.get('/api/auth/session')).json()).user.id).toBe(
          DEMO_PERSONA_IDS.sam,
        );
      }
      const before = await observeLedger(ledger, ledger.expenseB);
      const response = await actor.patch(expensePath(ledger.groupB, ledger.expenseB), {
        data: body === 'invalid shape' ? { amount: -1 } : Buffer.from('{'),
        headers: { 'Content-Type': 'application/json' },
      });
      expect.soft(response.status()).toBe(403);
      expect.soft(await response.json()).toEqual({ error: 'Forbidden', status: 403 });
      expect(await observeLedger(ledger, ledger.expenseB)).toEqual(before);
    });
  }
}

accessMatrix({
  name: 'edit',
  request: (actor, path) =>
    actor.patch(path, {
      data: { description: 'Corrected rent', category: 'housing' },
      maxRedirects: 0,
    }),
});
accessMatrix({
  name: 'restore',
  restore: true,
  request: (actor, path) => actor.patch(path, { data: { isDeleted: false }, maxRedirects: 0 }),
});

for (const origin of ['manual', 'recurring'] as const) {
  test(`ordinary member edits and restores ${origin} expense with attribution intact`, async ({
    ledger,
  }) => {
    const id = origin === 'recurring' ? await generatedExpense(ledger) : ledger.expenseB;
    const path = expensePath(ledger.groupB, id);
    const edited = await dataOf(
      await ledger.sam.patch(path, {
        data: { description: 'Corrected rent', category: 'housing' },
      }),
    );
    expect(edited).toMatchObject({
      description: 'Corrected rent',
      amount: 1200,
      category: 'housing',
      createdBy: { _id: DEMO_PERSONA_IDS.priya },
      paidBy: [{ user: { name: 'Priya Shah' }, amount: 1200 }],
    });
    const afterEdit = await dataOf(await ledger.sam.get(path));
    expect(afterEdit.editHistory).toEqual([
      expect.objectContaining({
        editedBy: expect.objectContaining({ _id: DEMO_PERSONA_IDS.sam }),
        changes: {
          description: {
            old: origin === 'recurring' ? 'Generated rent' : 'Private rent',
            new: 'Corrected rent',
          },
        },
      }),
    ]);
    const activities = await dataOf(
      await ledger.priya.get(`/api/groups/${ledger.groupB}/activity`),
    );
    expect(activities.activities).toContainEqual(
      expect.objectContaining({
        type: 'expense_updated',
        actor: expect.objectContaining({ _id: DEMO_PERSONA_IDS.sam }),
        metadata: expect.objectContaining({ expenseId: id }),
      }),
    );

    await dataOf(await ledger.priya.delete(path));
    const restored = await dataOf(await ledger.sam.patch(path, { data: { isDeleted: false } }));
    expect(restored).toMatchObject({
      description: 'Corrected rent',
      isDeleted: false,
      deletedAt: null,
      deletedBy: null,
      createdBy: { _id: DEMO_PERSONA_IDS.priya },
    });
    const afterRestore = await observeLedger(ledger, id);
    expect(afterRestore.expense.editHistory).toEqual(afterEdit.editHistory);
    expect(afterRestore.activityB.activities).toContainEqual(
      expect.objectContaining({
        type: 'expense_updated',
        actor: expect.objectContaining({ _id: DEMO_PERSONA_IDS.sam }),
        metadata: expect.objectContaining({ expenseId: id, action: 'restored' }),
      }),
    );
  });
}

for (const [rule, body] of [
  ['participants', { paidBy: [{ user: DEMO_PERSONA_IDS.alex, amount: 1200 }] }],
  ['currency', { currency: 'USD' }],
  ['Category', { category: 'not-a-category' }],
  ['Tag', { tag: 'Not a group tag' }],
] as const) {
  test(`authorized edit preserves ${rule} validation`, async ({ ledger }) => {
    const before = await observeLedger(ledger, ledger.expenseB);
    const response = await ledger.sam.patch(expensePath(ledger.groupB, ledger.expenseB), {
      data: body,
    });
    expect(response.status()).toBe(422);
    expect(await observeLedger(ledger, ledger.expenseB)).toEqual(before);
  });
}

test('an unchanged archived Tag remains editable', async ({ ledger }) => {
  const group = await dataOf(await ledger.priya.get(`/api/groups/${ledger.groupB}`));
  const tag = group.tags.find((item: { name: string }) => item.name === 'Rent');
  await dataOf(
    await ledger.priya.patch(`/api/groups/${ledger.groupB}/tags/${tag._id}`, {
      data: { isArchived: true },
    }),
  );
  const updated = await dataOf(
    await ledger.sam.patch(expensePath(ledger.groupB, ledger.expenseB), {
      data: { description: 'Corrected rent', tag: 'Rent', category: 'housing' },
    }),
  );
  expect(updated).toMatchObject({ description: 'Corrected rent', tag: 'Rent' });
});
