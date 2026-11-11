import { expect, it, vi } from 'vitest';
import mongoose from 'mongoose';
import Group from './models/Group';
import RecurringExpense from './models/RecurringExpense';
import { readFixture, readIds } from './test-utils/reads/fixture';
import { groupReads, acrossReads, exportReads } from './test-utils/reads/catalog';
import { httpRead } from './test-utils/reads/http';
import { readGrant, mcpRead } from './test-utils/reads/mcp';
vi.mock('next/headers', async () => (await import('./test-utils/signed-in-route')).nextHeaders);
vi.mock('next/server', async (original) =>
  (await import('./test-utils/signed-in-route')).nextServer(original),
);
const fixture = readFixture('differences');
const read = (name: string) => groupReads.find((entry) => entry.name === name)!;
for (const [name, id] of [
  ['another Group', readIds.controlExpense],
  ['missing Expense', 'e10000000000000000000099'],
  ['malformed Expense', 'not-an-id'],
] as const)
  it(`One Expense / ${name}`, async () => {
    const record = await fixture.capture(() =>
      httpRead(fixture, read('One Expense'), 'member', {
        expenseId: id,
        path: `/api/groups/${readIds.group}/expenses/${id}`,
      }),
    );
    expect(record.answer.status).toBe(name === 'malformed Expense' ? 400 : 404);
    expect(record.addedDueExpense).toBe(name !== 'malformed Expense');
  });
for (const state of ['member', 'outsider', 'malformed'] as const)
  it(`Drafts off / ${state}`, async () => {
    vi.stubEnv('PERSISTENT_DRAFTS_ENABLED', 'false');
    const record = await fixture.capture(() => httpRead(fixture, read('Drafts'), state));
    expect(record.answer.body.code).toBe(
      state === 'malformed' ? 'VALIDATION_ERROR' : 'DRAFTS_DISABLED',
    );
  });
for (const state of ['member', 'archived', 'deleting', 'deletion-marker'] as const)
  it(`Trip summary / ${state} Trip`, async () => {
    await Group.updateOne(
      { _id: readIds.group },
      {
        $set: {
          category: 'trip',
          startDate: new Date('2026-11-01T00:00:00Z'),
          endDate: new Date('2026-11-15T00:00:00Z'),
        },
      },
    );
    await RecurringExpense.deleteMany({ group: readIds.group });
    const record = await fixture.capture(() => httpRead(fixture, read('Trip summary'), state));
    expect(record.answer.status).toBe(state === 'deleting' ? 403 : 200);
    expect(record.addedDueExpense).toBe(false);
  });
it('Balances / an insert fails to materialize the due Month', async () => {
  await mongoose.connection.db!.command({
    collMod: 'expenses',
    validator: { description: { $ne: 'Due rent' } },
  });
  try {
    const record = await fixture.capture(() => httpRead(fixture, read('Balances'), 'member'));
    expect(record.answer.status).toBe(200);
    expect(record.addedDueExpense).toBe(false);
  } finally {
    await mongoose.connection.db!.command({ collMod: 'expenses', validator: {} });
  }
});
it('Tag receipt / not applied', async () => {
  const requestId = '00000000-0000-4000-8000-000000001121';
  const record = await fixture.capture(() =>
    httpRead(fixture, read('Tag receipt'), 'member', {
      requestId,
      path: `/api/groups/${readIds.group}/tag-actions/${requestId}`,
    }),
  );
  expect(record.answer).toMatchObject({ status: 200, body: { data: { state: 'not-applied' } } });
});
it('Assistant reach / a live grant', async () => {
  await readGrant(fixture.cookies.sam);
  const record = await fixture.capture(() => httpRead(fixture, read('Assistant reach'), 'admin'));
  expect(record.answer.status).toBe(200);
  expect(record.answer.body.data.reach).toHaveLength(1);
});
for (const state of ['archived', 'deleting'] as const)
  it(`Assistant reach / ${state} admin`, async () => {
    await fixture.capture(() =>
      httpRead(fixture, read('Assistant reach'), state, { cookie: fixture.cookies.alex }),
    );
  });

for (const state of ['member', 'outsider'] as const)
  it(`CSV multiple Groups / ${state}`, async () => {
    const path = `/api/export?groups=${readIds.control},${readIds.group}&format=csv&include=payments,shares&tz=UTC`;
    const record = await fixture.capture(() =>
      httpRead(fixture, exportReads.find((entry) => entry.name === 'Export csv download')!, state, {
        path,
      }),
    );
    expect(record.answer.status).toBe(state === 'outsider' ? 403 : 200);
    expect(record.addedDueExpense).toBe(state === 'member');
  });
it('Activity, search and both duplicate warnings after an Expense read', async () => {
  const generated = await fixture.capture(() => httpRead(fixture, read('Expenses'), 'member'));
  expect(generated.addedDueExpense).toBe(true);
  for (const name of ['Activity', 'Search', 'Duplicate warning', 'Draft review']) {
    const selected = [...groupReads, ...acrossReads].find((entry) => entry.name === name)!;
    const record = await fixture.capture(() => httpRead(fixture, selected, 'member'));
    expect(record.addedDueExpense).toBe(false);
    expect(record.answer.status).toBe(200);
    expect(JSON.stringify(record.answer.body)).toContain('Due rent');
  }
});

it('Group / a member reads a Not allowed Group', async () => {
  await Group.updateOne({ _id: readIds.group }, { $set: { assistantRule: 'not_allowed' } });
  const record = await fixture.capture(() => httpRead(fixture, read('Group'), 'member'));
  expect(record.answer.status).toBe(200);
  expect(record.addedDueExpense).toBe(true);
});

for (const name of [
  'Activity',
  'Home Activity',
  'Search',
  'Duplicate warning',
  'Draft review',
  'To review',
  'Payments',
])
  it(`${name} agrees before and after opening Expenses`, async () => {
    const selected = [...groupReads, ...acrossReads].find((entry) => entry.name === name)!;
    const first = await httpRead(fixture, selected, 'member');
    expect(first.status).toBe(200);
    await httpRead(fixture, read('Expenses'), 'member');
    expect(await httpRead(fixture, selected, 'member')).toEqual(first);
  });
for (const tool of ['group_balances', 'group_spending'] as const)
  it(`${tool} agrees before and after a member opens Expenses`, async () => {
    const grant = await readGrant(fixture.cookies.sam);
    const args =
      tool === 'group_balances'
        ? { groupId: readIds.group }
        : { groupId: readIds.group, from: '2026-11-01', to: '2026-11-30' };
    const first = await mcpRead(grant.token, tool, args);
    expect(JSON.stringify(first)).toContain(tool === 'group_balances' ? '340' : 'Due rent');
    await httpRead(fixture, read('Expenses'), 'member');
    expect(await mcpRead(grant.token, tool, args)).toEqual(first);
  });
