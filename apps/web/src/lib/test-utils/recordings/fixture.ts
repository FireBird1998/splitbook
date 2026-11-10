import { writeFile } from 'node:fs/promises';
import { AsyncLocalStorage } from 'node:async_hooks';
import mongoose from 'mongoose';
import { afterAll, afterEach, beforeAll, beforeEach, expect, vi } from 'vitest';
import Group from '@/lib/models/Group';
import Expense from '@/lib/models/Expense';
import Activity from '@/lib/models/Activity';
import RecurringExpense from '@/lib/models/RecurringExpense';
import { groupService } from '@/lib/services/group.service';
import { DEMO_PERSONA_IDS, type DemoPersonaKey } from '@/lib/demo-personas';
import { integrationTestDb } from '../integration-db';
import {
  callRoute,
  connectSignedIn,
  disconnectSignedIn,
  insertDemoPersonas,
  requireReplicaSet,
  signIn,
} from '../signed-in-route';
import { recordingNames } from './normalise';

export type Writer =
  | 'manual-expense'
  | 'draft-save'
  | 'recurring-expense'
  | 'single-settlement'
  | 'settlement-batch'
  | 'edit'
  | 'delete'
  | 'restore'
  | 'tag-change';
const { alex, sam, priya } = DEMO_PERSONA_IDS;
const clock = new Date('2026-11-11T12:00:00.000Z');
const requestOwner = new AsyncLocalStorage<string>();
type Handler = (
  request: Request,
  context: { params: Promise<{ id: string; expenseId: string }> },
) => Promise<Response>;
export type Answer = Awaited<ReturnType<typeof callRoute>>;

async function handlers() {
  return {
    expenses: await import('@/app/api/groups/[id]/expenses/route'),
    expense: await import('@/app/api/groups/[id]/expenses/[expenseId]/route'),
    settlements: await import('@/app/api/groups/[id]/settlements/route'),
    batch: await import('@/app/api/groups/[id]/settlements/batch/route'),
    drafts: await import('@/app/api/groups/[id]/drafts/route'),
    review: await import('@/app/api/groups/[id]/drafts/review/route'),
    save: await import('@/app/api/groups/[id]/drafts/save/route'),
    tags: await import('@/app/api/groups/[id]/expenses/tag-change/route'),
    feed: await import('@/app/api/groups/[id]/activity/route'),
  };
}

/** A real database and signed-in exported HTTP handlers. Only Next's request scope is supplied. */
export function recordingFixture(writer: Writer) {
  const db = integrationTestDb(`recording-${writer}`);
  let routes: Awaited<ReturnType<typeof handlers>>;
  let cookie: string;
  let readerCookie: string;
  let groupId: string;
  let expenseId: string;
  let foodId: string;
  let targetTag: string;
  let templateId: string;
  let draftCommand: { drafts: Array<{ id: string; revision: number; review: string }> };
  let names: ReturnType<typeof recordingNames>;
  let recordingStarted = false;
  let requestNumber = 0;
  const isChange = ['edit', 'delete', 'restore', 'tag-change'].includes(writer);
  const fenceNumber = isChange || writer === 'recurring-expense' ? 2 : 1;

  const expenseBody = (changes: object = {}) => ({
    description: 'Recorded dinner',
    amount: 120,
    currency: 'INR',
    category: 'food',
    tag: 'Food',
    date: '2026-11-01',
    paidBy: [{ user: alex, amount: 120 }],
    splitMethod: 'equal' as const,
    splitBetween: [{ user: sam }, { user: priya }],
    ...changes,
  });
  const paymentBody = (changes: object = {}) => ({
    paidBy: alex,
    paidTo: sam,
    amount: 30,
    currency: 'INR',
    note: 'Recorded payment',
    ...changes,
  });
  const batchBody = (changes: object = {}) => ({
    paidBy: alex,
    paidTo: sam,
    paidCurrency: 'INR',
    settlements: [{ amount: 30, currency: 'INR', note: 'Recorded batch payment' }],
    ...changes,
  });
  const http = (
    handler: Handler,
    method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
    suffix: string,
    body?: unknown,
    headers: Record<string, string> = {},
    asReader = false,
  ) => {
    // A retry happens later. Freezing a whole case at one instant would hide timestamp rewrites.
    if (recordingStarted) vi.setSystemTime(new Date(clock.getTime() + requestNumber++ * 1_000));
    return callRoute(handler, {
      method,
      path: `/api/groups/${groupId}/${suffix}`,
      params: { id: groupId, expenseId },
      cookie: asReader ? readerCookie : cookie,
      ...(body === undefined ? {} : { body }),
      headers,
    });
  };
  const readAs = async (persona: DemoPersonaKey) => {
    readerCookie = await signIn(persona);
  };
  const revision = () => (writer === 'restore' ? '1' : '0');
  const send = (changes: object = {}, headers: Record<string, string> = {}): Promise<Answer> => {
    const keyed = { 'Idempotency-Key': 'recording-submission-0001', ...headers };
    if (keyed['Idempotency-Key'] === '') delete (keyed as Partial<typeof keyed>)['Idempotency-Key'];
    switch (writer) {
      case 'manual-expense':
        return http(routes.expenses.POST, 'POST', 'expenses', expenseBody(changes), keyed);
      case 'single-settlement':
        return http(routes.settlements.POST, 'POST', 'settlements', paymentBody(changes), keyed);
      case 'settlement-batch':
        return http(routes.batch.POST, 'POST', 'settlements/batch', batchBody(changes), keyed);
      case 'draft-save':
        return http(routes.save.POST, 'POST', 'drafts/save', { ...draftCommand, ...changes });
      case 'recurring-expense':
        return http(
          routes.expenses.GET,
          'GET',
          'expenses?sortBy=date&sortOrder=asc',
          undefined,
          {},
          true,
        );
      case 'delete':
        return http(routes.expense.DELETE, 'DELETE', `expenses/${expenseId}`, undefined, {
          'X-Splitbook-Revision': revision(),
          ...headers,
        });
      case 'tag-change':
        return http(routes.tags.POST, 'POST', 'expenses/tag-change', {
          tagId: targetTag,
          expenses: [{ id: expenseId, revision: 0 }],
          ...changes,
        });
      default:
        return http(
          routes.expense.PATCH,
          'PATCH',
          `expenses/${expenseId}`,
          {
            ...(writer === 'restore' ? { isDeleted: false } : { description: 'Edited dinner' }),
            ...changes,
          },
          { 'X-Splitbook-Revision': revision(), ...headers },
        );
    }
  };
  const collection = (name: string) => mongoose.connection.db!.collection(name);
  const remove = (member: string) =>
    Group.updateOne(
      { _id: new mongoose.Types.ObjectId(groupId) },
      { $pull: { members: { user: new mongoose.Types.ObjectId(member) } } },
    );
  const archive = () => Group.updateOne({ _id: groupId }, { $set: { isArchived: true } });
  const state = async () => {
    const group = await Group.findById(groupId).lean();
    const expenses = await collection('expenses')
      .find({ group: new mongoose.Types.ObjectId(groupId) })
      .sort({ _id: 1 })
      .toArray();
    const settlements = await collection('settlements')
      .find({ group: new mongoose.Types.ObjectId(groupId) })
      .sort({ _id: 1 })
      .toArray();
    const activities = await collection('activities')
      .find({ group: new mongoose.Types.ObjectId(groupId) })
      .sort({ _id: 1 })
      .toArray();
    const templates = await collection('recurringexpenses')
      .find({ group: new mongoose.Types.ObjectId(groupId) })
      .sort({ _id: 1 })
      .toArray();
    const drafts = await collection('expensedrafts')
      .find({ group: new mongoose.Types.ObjectId(groupId) })
      .sort({ _id: 1 })
      .toArray();
    for (const [subject, rows] of [
      ['expense', expenses],
      ['settlement', settlements],
      ['event', activities],
      ['template', templates],
      ['draft', drafts],
    ] as const)
      for (const row of rows) {
        names.name(row._id, subject);
        for (const event of row.pendingActivity ?? []) names.name(event._id, 'event');
      }
    return {
      expenses,
      settlements,
      activities,
      templates,
      drafts,
      group: group && {
        isArchived: group.isArchived,
        currencyLocked: group.currencyLocked,
        defaultCurrency: group.defaultCurrency,
        alternateCurrencies: group.alternateCurrencies,
        members: group.members.map((member) => String(member.user)),
      },
    };
  };
  const capture = async (
    action: () => Promise<Answer | Answer[]>,
    before?: Awaited<ReturnType<typeof state>>,
  ) => {
    const initial = before ?? (await state());
    const answers = await action();
    const after = await state();
    if (!Array.isArray(answers) && answers.status >= 400) {
      expect(after.expenses).toHaveLength(initial.expenses.length);
      expect(after.settlements).toHaveLength(initial.settlements.length);
      expect(after.activities).toEqual(initial.activities);
    }
    const record = names.normalise({ before: initial, answers, after });
    if (process.env.RECORDING_STANDALONE_RESULT)
      await writeFile(process.env.RECORDING_STANDALONE_RESULT, JSON.stringify(record));
    else expect(record).toMatchSnapshot();
    return { answers, after, before: initial };
  };

  /** Pause at the real transaction boundary, outside it, while another committed DB change wins. */
  const holdFence = (number: number) => {
    let arrived!: () => void;
    let missed!: (reason: Error) => void;
    let release!: () => void;
    const reached = new Promise<void>((resolve, reject) => {
      arrived = resolve;
      missed = reject;
    });
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const timeout = setTimeout(() => {
      release();
      missed(new Error('Recording did not reach its expected fence'));
    }, 2_000);
    const transaction = mongoose.connection.transaction.bind(mongoose.connection);
    let count = 0;
    const spy = vi
      .spyOn(mongoose.connection, 'transaction')
      .mockImplementation(async (callback, options) => {
        if (++count === number) {
          clearTimeout(timeout);
          arrived();
          await gate;
        }
        return transaction(callback, options);
      });
    return {
      reached,
      release,
      restore: () => {
        clearTimeout(timeout);
        spy.mockRestore();
      },
    };
  };
  const interleave = async (
    change: () => Promise<unknown>,
    changes: object = {},
    number = fenceNumber,
  ) => {
    const before = await state();
    const pause = holdFence(number);
    const pending = send(changes);
    try {
      await Promise.race([
        pause.reached,
        pending.then(() => {
          throw new Error('Writer ended before the requested fence');
        }),
      ]);
      await change();
    } finally {
      pause.release();
      pause.restore();
    }
    return capture(() => pending, before);
  };

  beforeAll(async () => {
    await connectSignedIn(db);
    if (process.env.RECORDING_STANDALONE_RESULT) {
      const hello = await mongoose.connection.db!.admin().command({ hello: 1 });
      expect(hello.setName).toBeUndefined();
      expect(hello.msg).not.toBe('isdbgrid');
    } else await requireReplicaSet();
    routes = await handlers();
  });
  const prepare = async () => {
    recordingStarted = false;
    requestNumber = 0;
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(clock.getTime() - 60_000));
    vi.stubEnv('ANDROID_NOTIFICATION_EXPENSE_CHANGES_ENABLED', 'true');
    vi.stubEnv('ANDROID_NOTIFICATION_PAYMENTS_ENABLED', 'true');
    vi.stubEnv('PERSISTENT_DRAFTS_ENABLED', 'true');
    vi.stubEnv('ANDROID_NOTIFICATIONS_ENABLED', 'false');
    vi.stubEnv('ANDROID_NOTIFICATION_SENDS_ENABLED', 'false');
    vi.stubEnv('RECURRING_EXPENSES_ENABLED', writer === 'recurring-expense' ? 'true' : 'false');
    await db.reset();
    await insertDemoPersonas();
    cookie = await signIn('alex');
    readerCookie = await signIn('sam');
    names = recordingNames();
    const group = await groupService.create(
      {
        name: 'Recording ledger',
        category: writer === 'recurring-expense' ? 'home' : 'trip',
        defaultCurrency: 'INR',
        alternateCurrencies: ['EUR', 'USD'],
      },
      alex,
    );
    groupId = String(group._id);
    names.name(groupId, 'group');
    await Group.updateOne(
      { _id: groupId },
      {
        $push: {
          members: {
            $each: [
              { user: sam, role: 'admin' },
              { user: priya, role: 'member' },
            ],
          },
        },
      },
    );
    foodId = String(
      group.tags.find(
        (tag) => tag.name === (writer === 'recurring-expense' ? 'Groceries' : 'Food'),
      )!._id,
    );
    targetTag = String(
      group.tags.find(
        (tag) => tag.name !== (writer === 'recurring-expense' ? 'Groceries' : 'Food'),
      )!._id,
    );
    for (const tag of group.tags)
      names.name(tag._id, `tag-${tag.name.toLowerCase().replaceAll(' ', '-')}`);
    expenseId = 'e00000000000000000000001';
    templateId = '';
    if (isChange) {
      const saved = await http(routes.expenses.POST, 'POST', 'expenses', expenseBody(), {
        'Idempotency-Key': 'fixture-expense-0001',
      });
      expect(saved.status).toBe(201);
      expenseId = saved.body.data._id;
      if (writer === 'restore')
        expect(
          (
            await http(routes.expense.DELETE, 'DELETE', `expenses/${expenseId}`, undefined, {
              'X-Splitbook-Revision': '0',
            })
          ).status,
        ).toBe(200);
    }
    if (writer === 'settlement-batch') {
      for (const currency of ['INR', 'EUR']) {
        const saved = await http(
          routes.expenses.POST,
          'POST',
          'expenses',
          expenseBody({
            description: `Debt in ${currency}`,
            amount: 120,
            currency,
            paidBy: [{ user: sam, amount: 120 }],
            splitBetween: [{ user: alex }],
          }),
        );
        expect(saved.status).toBe(201);
      }
    }
    if (writer === 'recurring-expense') {
      const template = await RecurringExpense.create({
        ...expenseBody({
          tag: 'Groceries',
          paidBy: [{ user: sam, amount: 120 }],
          splitBetween: [
            { user: sam, amount: 60 },
            { user: priya, amount: 60 },
          ],
        }),
        tagId: foodId,
        group: groupId,
        createdBy: alex,
        startsOn: new Date('2026-11-01T00:00:00Z'),
        dayOfMonth: 1,
        lastGeneratedFor: null,
      });
      templateId = String(template._id);
      names.name(templateId, 'template');
    }
    if (writer === 'draft-save') {
      const kept = await http(
        routes.drafts.POST,
        'POST',
        'drafts',
        { drafts: [expenseBody({ tagId: foodId })] },
        { 'Idempotency-Key': 'fixture-draft-0001' },
      );
      expect(kept.status).toBe(201);
      const draftId = kept.body.data[0].id;
      names.name(draftId, 'draft');
      const reviewed = await http(routes.review.POST, 'POST', 'drafts/review', { ids: [draftId] });
      expect(reviewed.body.data[0]).toMatchObject({ problems: [], duplicates: [] });
      draftCommand = {
        drafts: [{ id: draftId, revision: 0, review: reviewed.body.data[0].review }],
      };
    }
    await Activity.deleteMany({});
    vi.setSystemTime(clock);
    recordingStarted = true;
  };
  beforeEach(prepare);
  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });
  afterAll(() => disconnectSignedIn(db));

  return {
    writer,
    readAs,
    isChange,
    fenceNumber,
    expenseBody,
    http,
    send,
    state,
    capture,
    holdFence,
    interleave,
    remove,
    archive,
    clock,
    requestOwner,
    prepare,
    get groupId() {
      return groupId;
    },
    get expenseId() {
      return expenseId;
    },
    get foodId() {
      return foodId;
    },
    get targetTag() {
      return targetTag;
    },
    get templateId() {
      return templateId;
    },
    get draftCommand() {
      return draftCommand;
    },
    get names() {
      return names;
    },
    get routes() {
      return routes;
    },
  };
}
export type Recording = ReturnType<typeof recordingFixture>;
