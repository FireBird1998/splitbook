import { describe, expect, it } from 'vitest';
import Expense from './models/Expense';
import Group from './models/Group';
import { Refusal } from '@splitbook/shared/refusals';
import { readCases, readFixture, readIds } from './test-utils/reads/fixture';
import { readGroupLedger } from './group-ledger-read';

const fixture = readFixture('module');

it('brings the admitted Household up to date before running its read', async () => {
  const access = await fixture.arrange('member');
  const result = await readGroupLedger({
    actor: { kind: 'member', id: access.actorId },
    groupId: access.groupId,
    read: async (group) => ({
      name: group.name,
      members: group.members.map((member) => member.user?.name),
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
  expect(
    await Expense.countDocuments({ recurringExpense: readIds.template, period: '2026-11' }),
  ).toBe(1);
});

for (const kind of ['member', 'assistant'] as const)
  describe(`${kind} access`, () => {
    for (const state of readCases)
      it(state, async () => {
        const access = await fixture.arrange(state);
        let reached = false;
        const result = readGroupLedger({
          actor: { kind, id: access.actorId, excludedGroupIds: [] },
          groupId: access.groupId,
          read: async (group) => {
            reached = true;
            return group.name;
          },
        });
        if (['member', 'admin', 'archived'].includes(state)) {
          await expect(result).resolves.toBe('Reads Household');
          expect(reached).toBe(true);
        } else {
          await expect(result).rejects.toMatchObject({
            code: state === 'malformed' ? 'INVALID_ID' : 'FORBIDDEN',
          });
          expect(reached).toBe(false);
        }
      });
  });
for (const restriction of ['excluded', 'not-allowed'] as const)
  it(`refuses an assistant's ${restriction} Group before reading its ledger`, async () => {
    const access = await fixture.arrange('member');
    if (restriction === 'not-allowed')
      await Group.updateOne({ _id: readIds.group }, { $set: { assistantRule: 'not_allowed' } });
    await expect(
      readGroupLedger({
        actor: {
          kind: 'assistant',
          id: access.actorId,
          excludedGroupIds: restriction === 'excluded' ? [readIds.group] : [],
        },
        groupId: access.groupId,
        read: async () => {
          throw new Error('An inaccessible read ran');
        },
      }),
    ).rejects.toBeInstanceOf(Refusal);
    expect(await Expense.countDocuments({ recurringExpense: readIds.template })).toBe(0);
  });

for (const change of ['membership', 'assistant-rule', 'deletion'] as const)
  it(`withholds the result when ${change} changes between admission and the ledger query`, async () => {
    const access = await fixture.arrange('member');
    const entered = Promise.withResolvers<void>();
    const continueRead = Promise.withResolvers<void>();
    const reading = readGroupLedger({
      actor: { kind: 'assistant', id: access.actorId, excludedGroupIds: [] },
      groupId: access.groupId,
      read: async (group) => {
        entered.resolve();
        await continueRead.promise;
        return Expense.find({ group: group._id }).lean();
      },
    });
    const refused = expect(reading).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await entered.promise;
    if (change === 'membership')
      await Group.updateOne(
        { _id: access.groupId },
        { $pull: { members: { user: access.actorId } } },
      );
    if (change === 'assistant-rule')
      await Group.updateOne({ _id: access.groupId }, { $set: { assistantRule: 'not_allowed' } });
    if (change === 'deletion')
      await Group.updateOne(
        { _id: access.groupId },
        { $set: { deletionRequestedAt: fixture.clock } },
      );
    continueRead.resolve();
    await refused;
  });
