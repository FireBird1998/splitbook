import { describe, expect, it } from 'vitest';
import Expense from './models/Expense';
import Group from './models/Group';
import RecurringExpense from './models/RecurringExpense';
import Settlement from './models/Settlement';
import { DEMO_PERSONA_IDS } from './demo-personas';
import { groupService } from './services/group.service';
import { expenseService } from './services/expense.service';
import { balanceService } from './services/balance.service';
import { Refusal } from '@splitbook/shared/refusals';
import { readCases, readFixture, readIds } from './test-utils/reads/fixture';
import { readGroupLedger, readGroupLedgers } from './group-ledger-read';

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
            code:
              state === 'malformed'
                ? 'INVALID_ID'
                : kind === 'assistant'
                  ? 'NOT_FOUND'
                  : 'FORBIDDEN',
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

for (const scenario of [
  { kind: 'member', change: 'membership' },
  { kind: 'assistant', change: 'membership' },
  { kind: 'assistant', change: 'assistant-rule' },
  { kind: 'assistant', change: 'deletion' },
] as const)
  it(`withholds a ${scenario.kind} result when ${scenario.change} changes before the ledger query`, async () => {
    const access = await fixture.arrange('member');
    // Settle the historical Debt and stop future rent, so removal can use the real service.
    await RecurringExpense.deleteMany({ group: readIds.group });
    await Settlement.create({
      group: readIds.group,
      createdBy: access.actorId,
      paidBy: access.actorId,
      paidTo: DEMO_PERSONA_IDS.alex,
      amount: 40,
      amountMinor: 4000,
      moneyVersion: 1,
      currency: 'INR',
    });
    if (scenario.change === 'deletion')
      await Group.updateOne(
        { _id: readIds.group },
        { $set: { members: [{ user: access.actorId, role: 'admin', joinedAt: fixture.clock }] } },
      );
    const entered = Promise.withResolvers<void>();
    const continueRead = Promise.withResolvers<void>();
    const reading = readGroupLedger({
      actor: { kind: scenario.kind, id: access.actorId, excludedGroupIds: [] },
      groupId: access.groupId,
      read: async (group) => {
        entered.resolve();
        await continueRead.promise;
        return Expense.find({ group: group._id }).lean();
      },
    });
    const refused = expect(reading).rejects.toMatchObject({
      code: scenario.kind === 'assistant' ? 'NOT_FOUND' : 'FORBIDDEN',
    });
    await entered.promise;
    if (scenario.change === 'membership')
      await groupService.removeMember(access.groupId, access.actorId, DEMO_PERSONA_IDS.alex);
    if (scenario.change === 'assistant-rule')
      await groupService.setAssistantRule(access.groupId, 'not_allowed', DEMO_PERSONA_IDS.alex);
    if (scenario.change === 'deletion')
      await groupService.leave(access.groupId, access.actorId, true);
    continueRead.resolve();
    await refused;
  });

it('retains the named missing-Group answer', async () => {
  const access = await fixture.arrange('missing');
  await expect(
    readGroupLedger({
      actor: { kind: 'member', id: access.actorId },
      groupId: access.groupId,
      missingGroup: 'not-found',
      read: async (group) => group.name,
    }),
  ).rejects.toMatchObject({ code: 'NOT_FOUND', data: { resource: 'Group' } });
});
it('retains a member read of a deletion marker with membership intact', async () => {
  const access = await fixture.arrange('deletion-marker');
  await expect(
    readGroupLedger({
      actor: { kind: 'member', id: access.actorId },
      groupId: access.groupId,
      deletionMarker: 'allow-retained-members',
      read: async (group) => group,
    }),
  ).resolves.toMatchObject({ name: 'Reads Household' });
  expect(await Expense.countDocuments({ recurringExpense: readIds.template })).toBe(0);
});
it('keeps the marker compatibility setting from widening assistant access', async () => {
  const access = await fixture.arrange('deletion-marker');
  await expect(
    readGroupLedger({
      actor: { kind: 'assistant', id: access.actorId, excludedGroupIds: [] },
      groupId: access.groupId,
      deletionMarker: 'allow-retained-members',
      read: async (group) => group.name,
    }),
  ).rejects.toMatchObject({ code: 'NOT_FOUND' });
});
it('can read the recorded ledger without adding the due Month', async () => {
  const access = await fixture.arrange('member');
  await expect(
    readGroupLedger({
      actor: { kind: 'assistant', id: access.actorId, excludedGroupIds: [] },
      groupId: access.groupId,
      recurring: 'recorded-only',
      read: async (group) =>
        (await Expense.find({ group: group._id })).map((expense) => expense.amount),
    }),
  ).resolves.toEqual([120]);
});
it('validates an admitted request before materializing its due Month', async () => {
  const access = await fixture.arrange('member');
  await expect(
    readGroupLedger({
      actor: { kind: 'member', id: access.actorId },
      groupId: access.groupId,
      validate: () => {
        throw new Refusal('INVALID_ID');
      },
      read: async (group) => group.name,
    }),
  ).rejects.toMatchObject({ code: 'INVALID_ID' });
  expect(await Expense.countDocuments({ recurringExpense: readIds.template })).toBe(0);
});
it('refuses an outsider before validating the request', async () => {
  const access = await fixture.arrange('outsider');
  await expect(
    readGroupLedger({
      actor: { kind: 'member', id: access.actorId },
      groupId: access.groupId,
      validate: () => {
        throw new Refusal('INVALID_ID');
      },
      read: async (group) => group.name,
    }),
  ).rejects.toMatchObject({ code: 'FORBIDDEN' });
});
it('adds a due Month once for two concurrent readers', async () => {
  const access = await fixture.arrange('member');
  const description = {
    actor: { kind: 'member' as const, id: access.actorId },
    groupId: access.groupId,
    read: async () =>
      (await Expense.find({ recurringExpense: readIds.template })).map((expense) => expense.amount),
  };
  const results = await Promise.all([readGroupLedger(description), readGroupLedger(description)]);
  expect(results).toEqual([[600], [600]]);
  expect(
    await Expense.countDocuments({ recurringExpense: readIds.template, period: '2026-11' }),
  ).toBe(1);
});

it('describes the same admitted Group when its name changes during the read', async () => {
  const access = await fixture.arrange('member');
  const result = await readGroupLedger({
    actor: { kind: 'member', id: access.actorId },
    groupId: access.groupId,
    read: async (group) => {
      await groupService.update(
        access.groupId,
        { name: 'Renamed after admission' },
        DEMO_PERSONA_IDS.alex,
      );
      return groupService.readForMember(group, { id: access.actorId });
    },
  });
  expect(result.name).toBe('Reads Household');
  expect((await Group.findById(access.groupId))?.name).toBe('Renamed after admission');
});
for (const subject of ['Expenses', 'Balances'] as const)
  it(`${subject} uses the admitted member list when another member joins during the read`, async () => {
    const access = await fixture.arrange('member');
    const people = await readGroupLedger({
      actor: { kind: 'member', id: access.actorId },
      groupId: access.groupId,
      read: async (group) => {
        await groupService.addMember(access.groupId, DEMO_PERSONA_IDS.priya);
        if (subject === 'Expenses') {
          const result = await expenseService.getGroupExpenses(
            group,
            { includeMemberBreakdown: true },
            access.actorId,
          );
          return result.summary.byMember?.map((row) => row.user._id);
        }
        const result = await balanceService.getGroupBalances(group, { viewerId: access.actorId });
        return result?.balances.map((row) => row.user._id);
      },
    });
    expect(new Set(people)).toEqual(new Set([DEMO_PERSONA_IDS.alex, DEMO_PERSONA_IDS.sam]));
    expect((await Group.findById(access.groupId))?.members).toHaveLength(3);
  });

for (const state of ['missing', 'outsider'] as const)
  it(`keeps member missing-Group compatibility from distinguishing an assistant's ${state} Group`, async () => {
    const access = await fixture.arrange(state);
    await expect(
      readGroupLedger({
        actor: { kind: 'assistant', id: access.actorId, excludedGroupIds: [] },
        groupId: access.groupId,
        missingGroup: 'not-found',
        read: async (group) => group.name,
      }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

for (const state of ['member', 'admin', 'archived'] as const)
  it(`applies the admin requirement to ${state}`, async () => {
    const access = await fixture.arrange(state);
    const result = readGroupLedger({
      actor: { kind: 'member', id: access.actorId },
      groupId: access.groupId,
      requiredRole: 'admin',
      recurring: 'recorded-only',
      read: async (group) => group.name,
    });
    if (state === 'admin') await expect(result).resolves.toBe('Reads Household');
    else await expect(result).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });
it('allows an archived admin to read', async () => {
  await fixture.arrange('archived');
  await expect(
    readGroupLedger({
      actor: { kind: 'member', id: DEMO_PERSONA_IDS.alex },
      groupId: readIds.group,
      requiredRole: 'admin',
      recurring: 'recorded-only',
      read: async (group) => group.name,
    }),
  ).resolves.toBe('Reads Household');
});
it('withholds an admin result after demotion during the read', async () => {
  const access = await fixture.arrange('admin');
  const result = readGroupLedger({
    actor: { kind: 'member', id: access.actorId },
    groupId: access.groupId,
    requiredRole: 'admin',
    recurring: 'recorded-only',
    read: async (group) => {
      await Group.updateOne(
        { _id: group._id, 'members.user': access.actorId },
        { $set: { 'members.$.role': 'member' } },
      );
      return group.name;
    },
  });
  await expect(result).rejects.toMatchObject({ code: 'FORBIDDEN' });
});

it('reads only the member’s admitted Groups across the ledger', async () => {
  const access = await fixture.arrange('member');
  await expect(
    readGroupLedgers({
      actor: { kind: 'member', id: access.actorId },
      archived: 'exclude',
      recurring: 'recorded-only',
      read: async (groups) => groups.map((group) => group.name),
    }),
  ).resolves.toEqual(['Reads Household', 'Control Trip']);
});
it('recomputes a list’s aggregate after one Group revokes access during the read', async () => {
  const access = await fixture.arrange('member');
  const result = await readGroupLedgers({
    actor: { kind: 'member', id: access.actorId },
    archived: 'include',
    recurring: 'recorded-only',
    read: async (groups) => {
      await Group.updateOne(
        { _id: readIds.group },
        { $pull: { members: { user: access.actorId } } },
      );
      return { total: groups.length, names: groups.map((group) => group.name) };
    },
  });
  expect(result).toEqual({ total: 1, names: ['Control Trip'] });
});
it('materializes due Months before reading across Groups', async () => {
  const access = await fixture.arrange('member');
  const amounts = await readGroupLedgers({
    actor: { kind: 'member', id: access.actorId },
    archived: 'exclude',
    now: fixture.clock,
    read: async (groups) =>
      (
        await Expense.find({ group: { $in: groups.map((group) => group._id) } }).sort({ amount: 1 })
      ).map((expense) => expense.amount),
  });
  expect(amounts).toEqual([45, 120, 600]);
});
it('refuses a selected list before generation when any Group cannot be admitted', async () => {
  const access = await fixture.arrange('member');
  await expect(
    readGroupLedgers({
      actor: { kind: 'member', id: access.actorId },
      archived: 'include',
      groupIds: [readIds.group, 'b10000000000000000000099'],
      read: async (groups) => groups.map((group) => group.name),
    }),
  ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  expect(await Expense.countDocuments({ recurringExpense: readIds.template })).toBe(0);
});
it('refuses the whole selected export when a Group revokes access during its read', async () => {
  const access = await fixture.arrange('member');
  await expect(
    readGroupLedgers({
      actor: { kind: 'member', id: access.actorId },
      archived: 'include',
      recurring: 'recorded-only',
      groupIds: [readIds.control, readIds.group],
      read: async (groups) => {
        await Group.updateOne(
          { _id: readIds.group },
          { $pull: { members: { user: access.actorId } } },
        );
        return groups.map((group) => group.name);
      },
    }),
  ).rejects.toMatchObject({ code: 'FORBIDDEN' });
});
it('keeps the read’s Group order when listing by name', async () => {
  const access = await fixture.arrange('member');
  await expect(
    readGroupLedgers({
      actor: { kind: 'member', id: access.actorId },
      archived: 'include',
      recurring: 'recorded-only',
      sort: { name: 1, _id: 1 },
      read: async (groups) => groups.map((group) => group.name),
    }),
  ).resolves.toEqual(['Control Trip', 'Reads Household']);
});
for (const archived of ['include', 'exclude'] as const)
  it(`lists archived Groups with the ${archived} setting`, async () => {
    const access = await fixture.arrange('archived');
    const names = await readGroupLedgers({
      actor: { kind: 'member', id: access.actorId },
      archived,
      recurring: 'recorded-only',
      read: async (groups) => groups.map((group) => group.name),
    });
    expect(names).toEqual(
      archived === 'include' ? ['Reads Household', 'Control Trip'] : ['Control Trip'],
    );
  });
for (const deletionMarker of ['refuse', 'allow-retained-members'] as const)
  it(`lists a retained-member deletion marker with ${deletionMarker}`, async () => {
    const access = await fixture.arrange('deletion-marker');
    const names = await readGroupLedgers({
      actor: { kind: 'member', id: access.actorId },
      archived: 'include',
      deletionMarker,
      recurring: 'recorded-only',
      read: async (groups) => groups.map((group) => group.name),
    });
    expect(names).toEqual(
      deletionMarker === 'refuse' ? ['Control Trip'] : ['Reads Household', 'Control Trip'],
    );
  });
it('applies exclusions and the Assistant rule when listing an assistant’s Groups', async () => {
  const access = await fixture.arrange('member');
  await Group.updateOne({ _id: readIds.group }, { $set: { assistantRule: 'not_allowed' } });
  const names = await readGroupLedgers({
    actor: { kind: 'assistant', id: access.actorId, excludedGroupIds: [readIds.control] },
    archived: 'include',
    deletionMarker: 'allow-retained-members',
    recurring: 'recorded-only',
    read: async (groups) => groups.map((group) => group.name),
  });
  expect(names).toEqual([]);
});
it('answers across Groups with the recorded ledger when a due insertion fails', async () => {
  const access = await fixture.arrange('member');
  await Expense.db.db!.command({
    collMod: 'expenses',
    validator: { description: { $ne: 'Due rent' } },
  });
  try {
    const amounts = await readGroupLedgers({
      actor: { kind: 'member', id: access.actorId },
      archived: 'exclude',
      read: async (groups) =>
        (
          await Expense.find({ group: { $in: groups.map((group) => group._id) } }).sort({
            amount: 1,
          })
        ).map((expense) => expense.amount),
    });
    expect(amounts).toEqual([45, 120]);
  } finally {
    await Expense.db.db!.command({ collMod: 'expenses', validator: {} });
  }
});

it('materializes the one-Group ledger at the same instant the reader uses', async () => {
  const access = await fixture.arrange('member');
  const amounts = await readGroupLedger({
    actor: { kind: 'member', id: access.actorId },
    groupId: access.groupId,
    now: new Date('2026-10-31T12:00:00Z'),
    read: async (group) => (await Expense.find({ group: group._id })).map((row) => row.amount),
  });
  expect(amounts).toEqual([120]);
});
