import { describe, expect, expectTypeOf, it, vi } from 'vitest';
import { Types } from 'mongoose';
import type { CommandStartedEvent, CommandSucceededEvent } from 'mongodb';
import Expense from './models/Expense';
import Group from './models/Group';
import RecurringExpense from './models/RecurringExpense';
import ProductSwitch from './models/ProductSwitch';
import Settlement from './models/Settlement';
import { DEMO_PERSONA_IDS } from './demo-personas';
import { groupService } from './services/group.service';
import { expenseService } from './services/expense.service';
import { balanceService } from './services/balance.service';
import { Refusal } from '@splitbook/shared/refusals';
import { readCases, readFixture, readIds } from './test-utils/reads/fixture';
import {
  readGroupMetadata,
  readGroupLedger,
  readGroupLedgers,
  type LedgerReadGroup,
} from './group-ledger-read';

// Observe the real database replies for the bounded-query regression below.
if (process.env.TEST_MONGODB_URI) {
  const uri = new URL(process.env.TEST_MONGODB_URI);
  uri.searchParams.set('monitorCommands', 'true');
  vi.stubEnv('TEST_MONGODB_URI', uri.href);
}
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

it('refuses a missing Group like an inaccessible Group', async () => {
  const access = await fixture.arrange('missing');
  await expect(
    readGroupLedger({
      actor: { kind: 'member', id: access.actorId },
      groupId: access.groupId,
      read: async (group) => group.name,
    }),
  ).rejects.toMatchObject({ code: 'FORBIDDEN' });
});
it('refuses a deletion marker even with membership intact', async () => {
  const access = await fixture.arrange('deletion-marker');
  await expect(
    readGroupLedger({
      actor: { kind: 'member', id: access.actorId },
      groupId: access.groupId,
      read: async (group) => group,
    }),
  ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  expect(await Expense.countDocuments({ recurringExpense: readIds.template })).toBe(0);
});
it('refuses a retained-member deletion marker for an assistant', async () => {
  const access = await fixture.arrange('deletion-marker');
  await expect(
    readGroupLedger({
      actor: { kind: 'assistant', id: access.actorId, excludedGroupIds: [] },
      groupId: access.groupId,
      read: async (group) => group.name,
    }),
  ).rejects.toMatchObject({ code: 'NOT_FOUND' });
});
it('reads member metadata without adding a due Month', async () => {
  const access = await fixture.arrange('member');
  await expect(
    readGroupMetadata({
      actor: { kind: 'member', id: access.actorId },
      groupId: access.groupId,
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
  it(`does not distinguish an assistant's ${state} Group`, async () => {
    const access = await fixture.arrange(state);
    await expect(
      readGroupLedger({
        actor: { kind: 'assistant', id: access.actorId, excludedGroupIds: [] },
        groupId: access.groupId,
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
      read: async (groups) => groups.map((group) => group.name),
    }),
  ).resolves.toEqual(['Reads Household', 'Control Trip']);
});
it('recomputes a list’s aggregate after one Group revokes access during the read', async () => {
  const access = await fixture.arrange('member');
  const result = await readGroupLedgers({
    actor: { kind: 'member', id: access.actorId },
    archived: 'include',
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
      read: async (groups) => groups.map((group) => group.name),
    });
    expect(names).toEqual(
      archived === 'include' ? ['Reads Household', 'Control Trip'] : ['Control Trip'],
    );
  });
it('omits a retained-member deletion marker from lists', async () => {
  const access = await fixture.arrange('deletion-marker');
  const names = await readGroupLedgers({
    actor: { kind: 'member', id: access.actorId },
    archived: 'include',
    read: async (groups) => groups.map((group) => group.name),
  });
  expect(names).toEqual(['Control Trip']);
});
it('applies exclusions and the Assistant rule when listing an assistant’s Groups', async () => {
  const access = await fixture.arrange('member');
  await Group.updateOne({ _id: readIds.group }, { $set: { assistantRule: 'not_allowed' } });
  const names = await readGroupLedgers({
    actor: { kind: 'assistant', id: access.actorId, excludedGroupIds: [readIds.control] },
    archived: 'include',
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

it('reads 51 projected Group documents for a page among 120 admitted Groups', async () => {
  const access = await fixture.arrange('member');
  await Group.deleteMany({});
  await Group.insertMany(
    Array.from({ length: 120 }, (_, index) => ({
      _id: new Types.ObjectId((index + 1).toString(16).padStart(24, '0')),
      name: `Group ${index + 1}`,
      defaultCurrency: 'INR',
      createdBy: access.actorId,
      members: [{ user: access.actorId, role: 'admin' }],
    })),
  );
  const client = Group.db.getClient();
  const groupBatches: number[] = [];
  let userReads = 0;
  const observe = (event: CommandSucceededEvent) => {
    const { cursor } = event.reply as {
      cursor?: { ns: string; firstBatch?: unknown[]; nextBatch?: unknown[] };
    };
    if (!cursor) return;
    if (cursor.ns === `${Group.db.name}.groups`)
      groupBatches.push((cursor.firstBatch ?? cursor.nextBatch ?? []).length);
    if (cursor.ns === `${Group.db.name}.users`) userReads++;
  };
  client.on('commandSucceeded', observe);
  try {
    const page = await readGroupLedgers({
      actor: { kind: 'member', id: access.actorId },
      archived: 'include',
      sort: { _id: 1 },
      page: { limit: 51 },
      fields: ['name'],
      read: async (groups) => groups,
    });
    expectTypeOf(page).toEqualTypeOf<Pick<LedgerReadGroup, '_id' | 'name'>[]>();
    expect(groupBatches).toEqual([51, 51]); // Admission, then the delivery-time id probe.
    expect(userReads).toBe(0);
    expect(page).toHaveLength(51);
    expect(page[0]).toEqual({
      _id: new Types.ObjectId('000000000000000000000001'),
      name: 'Group 1',
    });
    expect(page[50].name).toBe('Group 51');
  } finally {
    client.off('commandSucceeded', observe);
  }
});

it('refills an exclusive id page after access is revoked and keeps next consistent', async () => {
  const access = await fixture.arrange('member');
  await Group.deleteMany({});
  const ids = Array.from(
    { length: 7 },
    (_, index) => new Types.ObjectId((index + 1).toString(16).padStart(24, '0')),
  );
  await Group.insertMany(
    ids.map((_id, index) => ({
      _id,
      name: `Group ${index + 1}`,
      defaultCurrency: 'INR',
      createdBy: access.actorId,
      members: [{ user: access.actorId, role: 'admin' }],
    })),
  );
  // An exclusive cursor is an id boundary even after membership in that Group is gone.
  await Group.updateOne({ _id: ids[0] }, { $set: { members: [] } });
  const attempts: string[][] = [];
  const result = await readGroupLedgers({
    actor: { kind: 'member', id: access.actorId },
    archived: 'include',
    sort: { _id: 1 },
    page: { after: String(ids[0]), limit: 4 },
    fields: ['name'],
    read: async (groups) => {
      attempts.push(groups.map((group) => group.name));
      if (attempts.length === 1) await Group.updateOne({ _id: ids[1] }, { $set: { members: [] } });
      return {
        groups: groups.slice(0, 3).map((group) => group.name),
        next: groups.length > 3 ? String(groups[2]._id) : null,
      };
    },
  });
  expect(attempts).toEqual([
    ['Group 2', 'Group 3', 'Group 4', 'Group 5'],
    ['Group 3', 'Group 4', 'Group 5', 'Group 6'],
  ]);
  expect(result).toEqual({ groups: ['Group 3', 'Group 4', 'Group 5'], next: String(ids[4]) });
});

it('requires the field type when an explicit result type selects fields', () => {
  expectTypeOf(readGroupLedgers<number>)
    .parameter(0)
    .toHaveProperty('fields')
    .toBeUndefined();
});

it('uses one schedule query and no separate switch query when no Month is due', async () => {
  const access = await fixture.arrange('member');
  await RecurringExpense.updateOne(
    { _id: readIds.template },
    { $set: { lastGeneratedFor: '2026-11' } },
  );
  const commands: CommandStartedEvent[] = [];
  const client = Group.db.getClient();
  const observe = (event: CommandStartedEvent) => commands.push(event);
  client.on('commandStarted', observe);
  try {
    await readGroupLedger({
      actor: { kind: 'member', id: access.actorId },
      groupId: access.groupId,
      read: async (group) => expect(await Expense.countDocuments({ group: group._id })).toBe(1),
    });
  } finally {
    client.off('commandStarted', observe);
  }
  const dueChecks = commands.filter(({ command }) =>
    ['recurringexpenses', 'productswitches'].includes(command.find ?? command.aggregate),
  );
  expect(dueChecks).toHaveLength(1);
});
it('records due rent before calculating the Debt cleared by a payment', async () => {
  const access = await fixture.arrange('member');
  const { createSettlementBatch } = await import('./services/settlement-batch.service');
  const result = await createSettlementBatch(
    access.groupId,
    {
      paidTo: DEMO_PERSONA_IDS.alex,
      paidCurrency: 'INR',
      settlements: [{ currency: 'INR', amount: 1 }],
    },
    access.actorId,
    'due-rent-payment-1126',
  );
  expect(result.settlements[0].pairDebtBeforeMinor).toBe(-34000);
});

it('a payment receipt retry does not recalculate Debt or generate another Month', async () => {
  const access = await fixture.arrange('member');
  const { createSettlementBatch } = await import('./services/settlement-batch.service');
  const payment = {
    paidTo: DEMO_PERSONA_IDS.alex,
    paidCurrency: 'INR',
    settlements: [{ currency: 'INR', amount: 1 }],
  };
  const first = await createSettlementBatch(
    access.groupId,
    payment,
    access.actorId,
    'rent-payment-retry-1126',
  );
  vi.setSystemTime(new Date(2026, 11, 11, 12));
  const retry = await createSettlementBatch(
    access.groupId,
    payment,
    access.actorId,
    'rent-payment-retry-1126',
  );
  expect(String(retry.settlements[0]._id)).toBe(String(first.settlements[0]._id));
  expect(await Expense.countDocuments({ recurringExpense: readIds.template })).toBe(1);
});

for (const state of ['archived', 'problem', 'before-switch'] as const)
  it(`uses only the due aggregate for ${state} rent, then records a repaired schedule once`, async () => {
    const access = await fixture.arrange('member');
    if (state === 'archived')
      await Group.updateOne({ _id: access.groupId }, { $set: { isArchived: true } });
    if (state === 'problem')
      await Group.updateOne(
        { _id: access.groupId, 'tags._id': readIds.tag },
        { $set: { 'tags.$.isArchived': true } },
      );
    if (state === 'before-switch') {
      await RecurringExpense.collection.updateOne(
        { _id: new Types.ObjectId(readIds.template) },
        {
          $set: {
            startsOn: new Date('2026-10-01T00:00:00Z'),
            endsOn: new Date('2026-10-31T00:00:00Z'),
            createdAt: new Date('2026-09-01T00:00:00Z'),
          },
        },
      );
      await ProductSwitch.create({
        _id: 'recurringExpenses',
        enabled: true,
        since: new Date('2026-11-01T00:00:00Z'),
      });
    }
    const read = () =>
      readGroupLedger({
        actor: { kind: 'member', id: access.actorId },
        groupId: access.groupId,
        read: async () => Expense.countDocuments({ recurringExpense: readIds.template }),
      });
    const commands: CommandStartedEvent[] = [];
    const client = Group.db.getClient();
    const observe = (event: CommandStartedEvent) => commands.push(event);
    client.on('commandStarted', observe);
    try {
      expect(await read()).toBe(0);
      expect(await read()).toBe(0);
    } finally {
      client.off('commandStarted', observe);
    }
    expect(
      commands.filter(({ command }) => command.aggregate === 'recurringexpenses'),
    ).toHaveLength(2);
    expect(
      commands.filter(({ command }) =>
        ['recurringexpenses', 'productswitches'].includes(command.find),
      ),
    ).toHaveLength(0);
    // Each read loads the admitted Group and verifies delivery. A full run adds another lookup.
    expect(commands.filter(({ command }) => command.find === 'groups')).toHaveLength(4);
    if (state === 'archived')
      await Group.updateOne({ _id: access.groupId }, { $set: { isArchived: false } });
    if (state === 'problem')
      await Group.updateOne(
        { _id: access.groupId, 'tags._id': readIds.tag },
        { $set: { 'tags.$.isArchived': false } },
      );
    if (state === 'before-switch')
      await RecurringExpense.updateOne(
        { _id: readIds.template },
        { $set: { endsOn: new Date('2026-11-30T00:00:00Z') } },
      );
    expect(await read()).toBe(1);
    expect(await read()).toBe(1);
    expect(await RecurringExpense.findById(readIds.template).lean()).toMatchObject({
      lastGeneratedFor: '2026-11',
    });
  });

it('confirms an existing Month after its template enters a problem state', async () => {
  const access = await fixture.arrange('member');
  const read = () =>
    readGroupLedger({
      actor: { kind: 'member', id: access.actorId },
      groupId: access.groupId,
      read: async () => Expense.countDocuments({ recurringExpense: readIds.template }),
    });
  expect(await read()).toBe(1);
  await RecurringExpense.updateOne({ _id: readIds.template }, { $set: { lastGeneratedFor: null } });
  await Group.updateOne(
    { _id: access.groupId, 'tags._id': readIds.tag },
    { $set: { 'tags.$.isArchived': true } },
  );
  expect(await read()).toBe(1);
  expect(await RecurringExpense.findById(readIds.template).lean()).toMatchObject({
    lastGeneratedFor: '2026-11',
  });
});

it('skips a problem template whose recorded Month is already confirmed', async () => {
  const access = await fixture.arrange('member');
  const read = () =>
    readGroupLedger({
      actor: { kind: 'member', id: access.actorId },
      groupId: access.groupId,
      read: async () => Expense.countDocuments({ recurringExpense: readIds.template }),
    });
  expect(await read()).toBe(1);
  await Group.updateOne(
    { _id: access.groupId, 'tags._id': readIds.tag },
    { $set: { 'tags.$.isArchived': true } },
  );
  vi.setSystemTime(new Date(2026, 11, 11, 12));
  const commands: CommandStartedEvent[] = [];
  const client = Group.db.getClient();
  const observe = (event: CommandStartedEvent) => commands.push(event);
  client.on('commandStarted', observe);
  try {
    expect(await read()).toBe(1);
  } finally {
    client.off('commandStarted', observe);
  }
  expect(commands.filter(({ command }) => command.aggregate === 'recurringexpenses')).toHaveLength(
    1,
  );
  expect(
    commands.filter(({ command }) =>
      ['recurringexpenses', 'productswitches'].includes(command.find),
    ),
  ).toHaveLength(0);
  expect(await RecurringExpense.findById(readIds.template).lean()).toMatchObject({
    lastGeneratedFor: '2026-11',
  });
});
