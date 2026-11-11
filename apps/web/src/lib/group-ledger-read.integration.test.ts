import { expect, it } from 'vitest';
import Expense from './models/Expense';
import { readFixture, readIds } from './test-utils/reads/fixture';
import { readGroupLedger } from './group-ledger-read';

const fixture = readFixture('module');

it('brings the admitted Household up to date before running its read', async () => {
  const access = await fixture.arrange('member');
  const result = await readGroupLedger({
    actor: { kind: 'member', id: access.actorId },
    groupId: access.groupId,
    read: async (group) => ({
      name: group.name,
      members: group.members.map((member) => member.user.name),
      amounts: (await Expense.find({ group: group._id }).sort({ amount: 1 })).map(
        (expense) => expense.amount,
      ),
    }),
  });
  expect(result).toEqual({
    name: 'Reads Household',
    members: ['Alex Rivera', 'Sam Chen'],
    amounts: [120, 600],
  });
  expect(await Expense.countDocuments({ recurringExpense: readIds.template, period: '2026-11' })).toBe(1);
});
