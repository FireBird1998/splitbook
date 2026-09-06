import { test, expect, dataOf, expensePath } from './fixtures';
import { accessMatrix } from './access-matrix';
import { DEMO_PERSONA_IDS } from '../src/lib/demo-personas';

accessMatrix({ name: 'read', request: (actor, path) => actor.get(path, { maxRedirects: 0 }) });

test('non-admin non-creator member reads the existing populated expense shape', async ({
  ledger,
}) => {
  const expense = await dataOf(await ledger.sam.get(expensePath(ledger.groupB, ledger.expenseB)));
  expect(expense).toMatchObject({
    group: ledger.groupB,
    description: 'Private rent',
    amount: 1200,
    isDeleted: false,
    createdBy: { _id: DEMO_PERSONA_IDS.priya, name: 'Priya Shah' },
    paidBy: [{ user: { _id: DEMO_PERSONA_IDS.priya, name: 'Priya Shah' }, amount: 1200 }],
    splitBetween: [{ user: { _id: DEMO_PERSONA_IDS.priya, name: 'Priya Shah' }, amount: 1200 }],
    editHistory: [],
  });
});
