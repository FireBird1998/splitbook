/**
 * Integration tests for the recurring Expenses switch (#289) against a real, isolated MongoDB
 * database (`splitbook-test-recurring-switch`). Only the session is a stand-in.
 *
 * Off, the default: the recurring API refuses every change and lists no templates, no Group,
 * Expense-list or Balances read and no leave generates an Expense, and nothing stored changes.
 * Expenses generated before it was turned off stay ordinary Expenses. Turning it back on adds
 * nothing for the months it was off: templates resume from the month it was turned on.
 */

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import Expense from '@/lib/models/Expense';
import ProductSwitch from '@/lib/models/ProductSwitch';
import RecurringExpense from '@/lib/models/RecurringExpense';
import { groupService } from '@/lib/services/group.service';
import { expenseService } from '@/lib/services/expense.service';
import { settlementService } from '@/lib/services/settlement.service';
import { recurringExpenseService } from '@/lib/services/recurring-expense.service';
import { integrationTestDb } from '@/lib/test-utils/integration-db';
import { createTestUsers, TEST_USER_IDS } from '@/lib/test-utils/fixtures';
import {
  expenseDateForPeriod,
  previousPeriod,
  toPeriod,
} from '@splitbook/shared/recurring-due-periods';
import type { CreateRecurringExpenseInput } from '@splitbook/shared/validators/recurring-expense';
import { GET as readGroup } from '@/app/api/groups/[id]/route';
import { GET as readExpenses } from '@/app/api/groups/[id]/expenses/route';
import { GET as readBalances } from '@/app/api/groups/[id]/balances/route';
import {
  GET as listTemplates,
  POST as createTemplate,
} from '@/app/api/groups/[id]/recurring/route';
import {
  DELETE as deleteTemplate,
  PATCH as changeTemplate,
} from '@/app/api/groups/[id]/recurring/[recurringId]/route';

const session = vi.hoisted(() => ({ userId: null as string | null }));
vi.mock('next/headers', () => ({ headers: vi.fn(async () => new Headers()) }));
vi.mock('@/lib/auth', () => ({
  auth: {
    api: {
      getSession: vi.fn(async () =>
        session.userId
          ? { user: { id: session.userId, name: 'Tester', email: 'tester@splitbook-test.local' } }
          : null,
      ),
    },
  },
}));

const db = integrationTestDb('recurring-switch');
const { alice, bob, carol, dave } = TEST_USER_IDS;

/** Recurring Expenses are off unless the variable is exactly `true`; unset is the default. */
function switchRecurringExpenses(on: boolean) {
  vi.stubEnv('RECURRING_EXPENSES_ENABLED', on ? 'true' : undefined);
}

beforeAll(async () => {
  await db.connect();
  await Expense.createIndexes();
});
beforeEach(async () => {
  await db.reset();
  await createTestUsers('alice', 'bob', 'carol', 'dave');
  session.userId = null;
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});
afterAll(db.teardown);

const NOW = new Date();
const CURRENT_PERIOD = toPeriod(NOW);
const PREVIOUS_PERIOD = previousPeriod(CURRENT_PERIOD);

/** The 5th of the month `delta` months from now, as a generation run's clock. */
function monthOffset(delta: number): Date {
  return new Date(Date.UTC(NOW.getUTCFullYear(), NOW.getUTCMonth() + delta, 5));
}

function periodOffset(delta: number): string {
  return toPeriod(monthOffset(delta));
}

const OFF = {
  status: 409,
  body: {
    error: 'Recurring Expenses are turned off.',
    code: 'RECURRING_EXPENSES_OFF',
    status: 409,
  },
};

async function createHousehold(name = 'Lakeview Flat'): Promise<string> {
  const group = await groupService.create(
    { name, category: 'home', defaultCurrency: 'INR', alternateCurrencies: [] },
    alice,
  );
  const groupId = String(group._id);
  await groupService.addMember(groupId, bob);
  await groupService.addMember(groupId, carol);
  return groupId;
}

function rent(overrides: Partial<CreateRecurringExpenseInput> = {}): CreateRecurringExpenseInput {
  return {
    description: 'Rent',
    amount: 30000,
    currency: 'INR',
    category: 'housing',
    tag: 'Rent',
    paidBy: [{ user: alice, amount: 30000 }],
    splitMethod: 'equal',
    splitBetween: [{ user: alice }, { user: bob }, { user: carol }],
    dayOfMonth: 1,
    startsOn: expenseDateForPeriod(CURRENT_PERIOD, 1),
    ...overrides,
  };
}

/** The month before last. */
const TWO_MONTHS_AGO = previousPeriod(PREVIOUS_PERIOD);

/** A WiFi template that started the month before last, so it has three months to add. */
function wifiSinceTwoMonthsAgo(): CreateRecurringExpenseInput {
  return rent({
    description: 'WiFi',
    amount: 1200,
    tag: 'Utilities',
    paidBy: [{ user: bob, amount: 1200 }],
    startsOn: expenseDateForPeriod(TWO_MONTHS_AGO, 1),
  });
}

/** A Household with its Rent template, created while recurring Expenses were on. */
async function householdWithRent() {
  switchRecurringExpenses(true);
  const groupId = await createHousehold();
  const template = await recurringExpenseService.create(groupId, rent(), alice);
  return { groupId, templateId: String(template!._id) };
}

/**
 * The same Household with its Rent materialized through last month only: this month's Rent,
 * due on the 1st, has not been added because nobody has read the Group since.
 */
async function householdWithRentDue() {
  const household = await householdWithRent();
  const lastMonth = expenseDateForPeriod(PREVIOUS_PERIOD, 1);
  const rewound = await Expense.updateOne(
    { recurringExpense: household.templateId, period: CURRENT_PERIOD },
    { $set: { period: PREVIOUS_PERIOD, date: lastMonth } },
  );
  expect(rewound.modifiedCount).toBe(1);
  await RecurringExpense.updateOne(
    { _id: household.templateId },
    { $set: { startsOn: lastMonth, lastGeneratedFor: PREVIOUS_PERIOD } },
  );
  return household;
}

function storedTemplate(templateId: string) {
  return RecurringExpense.findById(templateId).lean();
}

async function periodsOf(templateId: string): Promise<string[]> {
  const rows = await Expense.find({ recurringExpense: templateId, isDeleted: false })
    .sort({ period: 1 })
    .lean();
  return rows.map((row) => row.period!);
}

/** A route handler called as Next calls it, answering with its status and JSON body. */
async function call<Params>(
  handler: (request: Request, context: { params: Promise<Params> }) => Promise<Response>,
  path: string,
  params: Params,
  init: RequestInit = {},
) {
  const response = await handler(new Request(`http://localhost/api/groups/${path}`, init), {
    params: Promise.resolve(params),
  });
  return { status: response.status, body: await response.json() };
}

const json = (method: string, body: unknown, revision?: number): RequestInit => ({
  method,
  headers: {
    'Content-Type': 'application/json',
    ...(revision === undefined ? {} : { 'X-Splitbook-Revision': String(revision) }),
  },
  body: JSON.stringify(body),
});

function balanceOf(body: { data: { balances: { user: { _id: string }; balance: number }[] } }) {
  return Object.fromEntries(body.data.balances.map((entry) => [entry.user._id, entry.balance]));
}

describe('with recurring Expenses off, the default', () => {
  it('reads the Group, its Expenses and its Balances without adding the Rent that is due', async () => {
    const { groupId, templateId } = await householdWithRentDue();
    const before = await storedTemplate(templateId);
    switchRecurringExpenses(false);
    session.userId = bob;

    const [group, expenses, balances] = await Promise.all([
      call(readGroup, groupId, { id: groupId }),
      call(readExpenses, `${groupId}/expenses`, { id: groupId }),
      call(readBalances, `${groupId}/balances`, { id: groupId }),
    ]);

    expect(group).toMatchObject({ status: 200, body: { data: { _id: groupId } } });
    expect(expenses.status).toBe(200);
    expect(expenses.body.data.expenses.map((row: { period: string }) => row.period)).toEqual([
      PREVIOUS_PERIOD,
    ]);
    expect(balances.status).toBe(200);
    expect(balanceOf(balances.body)).toEqual({ [alice]: 20000, [bob]: -10000, [carol]: -10000 });
    expect(await periodsOf(templateId)).toEqual([PREVIOUS_PERIOD]);
    expect(await storedTemplate(templateId)).toEqual(before);
  });

  it('lets a settled member leave without adding the Rent that is due first', async () => {
    const { groupId, templateId } = await householdWithRentDue();
    switchRecurringExpenses(false);
    await settlementService.create(groupId, { paidTo: alice, amount: 10000, currency: 'INR' }, bob);
    const before = await storedTemplate(templateId);

    expect(await recurringExpenseService.materializeDueExpenses(groupId)).toEqual({
      generated: 0,
      complete: true,
    });
    await expect(groupService.leave(groupId, bob)).resolves.toEqual({ archived: false });

    expect(await periodsOf(templateId)).toEqual([PREVIOUS_PERIOD]);
    expect(await storedTemplate(templateId)).toEqual(before);
  });

  it('refuses every change to a template with RECURRING_EXPENSES_OFF and lists none', async () => {
    const { groupId, templateId } = await householdWithRentDue();
    const before = await storedTemplate(templateId);
    switchRecurringExpenses(false);
    session.userId = alice;
    const list = `${groupId}/recurring`;
    const item = `${groupId}/recurring/${templateId}`;
    const ids = { id: groupId, recurringId: templateId };

    expect(await call(createTemplate, list, ids, json('POST', rent({ tag: 'Utilities' })))).toEqual(
      OFF,
    );
    // Refused before the body is read, so an invalid one gets the same answer.
    expect(await call(createTemplate, list, ids, json('POST', { amount: -1 }))).toEqual(OFF);
    expect(
      await call(changeTemplate, item, ids, json('PATCH', { description: 'Flat rent' }, 0)),
    ).toEqual(OFF);
    expect(await call(changeTemplate, item, ids, json('PATCH', { isPaused: true }, 0))).toEqual(
      OFF,
    );
    expect(await call(changeTemplate, item, ids, json('PATCH', { isPaused: false }, 0))).toEqual(
      OFF,
    );
    expect(
      await call(deleteTemplate, item, ids, {
        method: 'DELETE',
        headers: { 'X-Splitbook-Revision': '0' },
      }),
    ).toEqual(OFF);

    // A member reads an empty list; a stranger is still refused, as before.
    expect(await call(listTemplates, list, ids)).toEqual({
      status: 200,
      body: { data: [], status: 200 },
    });
    session.userId = dave;
    expect(await call(listTemplates, list, ids)).toMatchObject({ status: 403 });

    // The service refuses the same changes to any other caller.
    await expect(recurringExpenseService.create(groupId, rent(), alice)).rejects.toThrow(
      'RECURRING_EXPENSES_OFF',
    );
    await expect(
      recurringExpenseService.update(groupId, templateId, { isPaused: true }, alice, 0),
    ).rejects.toThrow('RECURRING_EXPENSES_OFF');
    await expect(recurringExpenseService.remove(groupId, templateId, alice, 0)).rejects.toThrow(
      'RECURRING_EXPENSES_OFF',
    );
    expect(await recurringExpenseService.list(groupId)).toEqual([]);

    expect(await RecurringExpense.countDocuments()).toBe(1);
    expect(await storedTemplate(templateId)).toEqual(before);
    expect(await periodsOf(templateId)).toEqual([PREVIOUS_PERIOD]);
  });

  it('keeps the Expenses generated before as ordinary Expenses: listed, in Balances, edited and settled', async () => {
    const { groupId, templateId } = await householdWithRent();
    switchRecurringExpenses(false);
    session.userId = bob;

    const listed = await call(readExpenses, `${groupId}/expenses`, { id: groupId });
    expect(listed.body.data.expenses).toEqual([
      expect.objectContaining({
        description: 'Rent',
        recurringExpense: templateId,
        period: CURRENT_PERIOD,
      }),
    ]);
    const generated = listed.body.data.expenses[0] as { _id: string; revision?: number };

    const edited = await expenseService.update(
      { actorId: alice, groupId, expenseId: generated._id },
      { description: 'Rent, October' },
      generated.revision ?? 0,
    );
    expect(edited?.toObject()).toMatchObject({
      description: 'Rent, October',
      period: CURRENT_PERIOD,
    });

    await settlementService.create(groupId, { paidTo: alice, amount: 10000, currency: 'INR' }, bob);
    const balances = await call(readBalances, `${groupId}/balances`, { id: groupId });
    expect(balanceOf(balances.body)).toEqual({ [alice]: 10000, [bob]: 0, [carol]: -10000 });
    expect(await periodsOf(templateId)).toEqual([CURRENT_PERIOD]);
  });
});

describe('turning recurring Expenses back on', () => {
  it('adds nothing for the months it was off, and resumes from the month it was turned on', async () => {
    const { groupId, templateId } = await householdWithRent();
    expect(await periodsOf(templateId)).toEqual([CURRENT_PERIOD]);

    switchRecurringExpenses(false);
    for (const month of [1, 2]) {
      expect(
        await recurringExpenseService.materializeDueExpenses(groupId, monthOffset(month)),
      ).toEqual({ generated: 0, complete: true });
    }

    switchRecurringExpenses(true);
    expect(await recurringExpenseService.generateDueExpenses(groupId, monthOffset(3))).toEqual({
      generated: 1,
    });
    expect(await periodsOf(templateId)).toEqual([CURRENT_PERIOD, periodOffset(3)]);
    expect((await storedTemplate(templateId))?.lastGeneratedFor).toBe(periodOffset(3));

    // From then on, each month is added as before.
    expect(await recurringExpenseService.generateDueExpenses(groupId, monthOffset(4))).toEqual({
      generated: 1,
    });

    // Off and on again: only the month it was last turned on is added.
    switchRecurringExpenses(false);
    await recurringExpenseService.generateDueExpenses(groupId, monthOffset(5));
    await recurringExpenseService.generateDueExpenses(groupId, monthOffset(6));
    switchRecurringExpenses(true);
    expect(await recurringExpenseService.generateDueExpenses(groupId, monthOffset(7))).toEqual({
      generated: 1,
    });
    expect(await periodsOf(templateId)).toEqual([
      CURRENT_PERIOD,
      periodOffset(3),
      periodOffset(4),
      periodOffset(7),
    ]);
  });

  it('counts a read of any Group while it was off, even one with no templates', async () => {
    const { groupId, templateId } = await householdWithRent();
    const trip = await groupService.create(
      { name: 'Hill trip', category: 'trip', defaultCurrency: 'INR', alternateCurrencies: [] },
      alice,
    );

    switchRecurringExpenses(false);
    await recurringExpenseService.generateDueExpenses(String(trip._id), monthOffset(1));

    switchRecurringExpenses(true);
    expect(await recurringExpenseService.generateDueExpenses(groupId, monthOffset(2))).toEqual({
      generated: 1,
    });
    expect(await periodsOf(templateId)).toEqual([CURRENT_PERIOD, periodOffset(2)]);
  });

  it('still adds the earlier months of a template created after it was turned back on', async () => {
    const { groupId } = await householdWithRent();
    switchRecurringExpenses(false);
    await recurringExpenseService.generateDueExpenses(groupId);
    switchRecurringExpenses(true);
    await recurringExpenseService.generateDueExpenses(groupId);

    const wifi = await recurringExpenseService.create(groupId, wifiSinceTwoMonthsAgo(), alice);

    expect(await periodsOf(String(wifi!._id))).toEqual([
      TWO_MONTHS_AGO,
      PREVIOUS_PERIOD,
      CURRENT_PERIOD,
    ]);
  });

  it('still adds every month of a template created before anything is read once it is back on', async () => {
    const { groupId } = await householdWithRent();
    switchRecurringExpenses(false);
    await recurringExpenseService.generateDueExpenses(groupId);
    switchRecurringExpenses(true);

    // Nothing reads a Group after it is turned back on. The new template's own generation run
    // follows its insert a moment later, as on a busy server.
    const insert = RecurringExpense.create.bind(RecurringExpense) as (
      ...args: unknown[]
    ) => Promise<unknown>;
    vi.spyOn(RecurringExpense, 'create').mockImplementation((async (...args: unknown[]) => {
      const created = await insert(...args);
      await new Promise((resolve) => setTimeout(resolve, 25));
      return created;
    }) as never);

    const wifi = await recurringExpenseService.create(groupId, wifiSinceTwoMonthsAgo(), alice);

    expect(await periodsOf(String(wifi!._id))).toEqual([
      TWO_MONTHS_AGO,
      PREVIOUS_PERIOD,
      CURRENT_PERIOD,
    ]);
  });

  it('with the switch on from the start, catches up every missed month as before', async () => {
    const { groupId, templateId } = await householdWithRent();

    expect(await recurringExpenseService.generateDueExpenses(groupId, monthOffset(3))).toEqual({
      generated: 3,
    });
    expect(await periodsOf(templateId)).toEqual([
      CURRENT_PERIOD,
      periodOffset(1),
      periodOffset(2),
      periodOffset(3),
    ]);
  });
});

describe('with recurring Expenses on and the switch’s record unreadable', () => {
  /** Reads of `productswitches` fail, as for a database user with no access to it. */
  function recordUnreadable() {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(ProductSwitch, 'findById').mockImplementation((() => ({
      lean: () => Promise.reject(new Error('not authorized to execute find on productswitches')),
    })) as never);
  }

  /** The three reads the Group page starts, as Bob. */
  async function openGroupPage(groupId: string) {
    session.userId = bob;
    const reads = await Promise.all([
      call(readGroup, groupId, { id: groupId }),
      call(readExpenses, `${groupId}/expenses`, { id: groupId }),
      call(readBalances, `${groupId}/balances`, { id: groupId }),
    ]);
    return reads.map((read) => read.status);
  }

  it('reads a Group with no templates as before, and lets a member leave it', async () => {
    switchRecurringExpenses(true);
    const trip = await groupService.create(
      { name: 'Hill trip', category: 'trip', defaultCurrency: 'INR', alternateCurrencies: [] },
      alice,
    );
    const tripId = String(trip._id);
    await groupService.addMember(tripId, bob);
    recordUnreadable();

    expect(await openGroupPage(tripId)).toEqual([200, 200, 200]);
    expect(await recurringExpenseService.materializeDueExpenses(tripId)).toEqual({
      generated: 0,
      complete: true,
    });
    await expect(groupService.leave(tripId, bob)).resolves.toEqual({ archived: false });
  });

  it('reports a Group with templates as incomplete: its reads answer, nothing is added, a leave waits', async () => {
    const { groupId, templateId } = await householdWithRentDue();
    recordUnreadable();

    expect(await recurringExpenseService.materializeDueExpenses(groupId)).toEqual({
      generated: 0,
      complete: false,
    });
    expect(await openGroupPage(groupId)).toEqual([200, 200, 200]);
    await expect(groupService.leave(groupId, bob)).rejects.toThrow('LEAVE_CONFLICT');
    expect(await periodsOf(templateId)).toEqual([PREVIOUS_PERIOD]);

    // A new template is still saved; its months wait for the record, as missed periods do.
    const wifi = await recurringExpenseService.create(groupId, wifiSinceTwoMonthsAgo(), alice);
    expect(await periodsOf(String(wifi!._id))).toEqual([]);
  });
});
