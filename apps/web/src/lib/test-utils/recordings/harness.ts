import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { AsyncLocalStorage } from 'node:async_hooks';
import mongoose from 'mongoose';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import Group from '@/lib/models/Group';
import Expense from '@/lib/models/Expense';
import Activity from '@/lib/models/Activity';
import RecurringExpense from '@/lib/models/RecurringExpense';
import { groupService } from '@/lib/services/group.service';
import { DEMO_PERSONA_IDS } from '@/lib/demo-personas';
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
type Answer = Awaited<ReturnType<typeof callRoute>>;

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
export function recordWriter(writer: Writer) {
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
  ) =>
    callRoute(handler, {
      method,
      path: `/api/groups/${groupId}/${suffix}`,
      params: { id: groupId, expenseId },
      cookie: asReader ? readerCookie : cookie,
      ...(body === undefined ? {} : { body }),
      headers,
    });
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
    let release!: () => void;
    const reached = new Promise<void>((resolve) => {
      arrived = resolve;
    });
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const transaction = mongoose.connection.transaction.bind(mongoose.connection);
    let count = 0;
    const spy = vi
      .spyOn(mongoose.connection, 'transaction')
      .mockImplementation(async (callback, options) => {
        if (++count === number) {
          arrived();
          await gate;
        }
        return transaction(callback, options);
      });
    return { reached, release, restore: () => spy.mockRestore() };
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
  };
  beforeEach(prepare);
  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });
  afterAll(() => disconnectSignedIn(db));

  describe(`${writer} record of recordings`, () => {
    for (const expenseAlerts of [false, true])
      for (const paymentAlerts of [false, true])
        it(`first save, Expense alerts ${expenseAlerts ? 'on' : 'off'}, Payment alerts ${paymentAlerts ? 'on' : 'off'}`, async () => {
          vi.stubEnv('ANDROID_NOTIFICATION_EXPENSE_CHANGES_ENABLED', String(expenseAlerts));
          vi.stubEnv('ANDROID_NOTIFICATION_PAYMENTS_ENABLED', String(paymentAlerts));
          const recorded = await capture(() => send());
          expect((recorded.answers as Answer).status).toBe(
            ['manual-expense', 'single-settlement', 'settlement-batch'].includes(writer)
              ? 201
              : 200,
          );
          expect(recorded.after.activities).toHaveLength(1);
          const captures =
            ['manual-expense', 'draft-save'].includes(writer) ||
            (['single-settlement', 'settlement-batch'].includes(writer)
              ? paymentAlerts
              : expenseAlerts);
          expect(recorded.after.activities[0].notificationContext?.recipientIds).toEqual(
            captures
              ? ['single-settlement', 'settlement-batch'].includes(writer)
                ? [sam]
                : [sam, priya]
              : undefined,
          );
        });
    it('same command and retry identity twice', async () => {
      await capture(async () => [await send(), await send()]);
    });
    if (writer !== 'delete')
      it(
        writer === 'recurring-expense'
          ? 'a changed template keeps the recorded Month'
          : 'changed command under the original retry identity',
        async () => {
          await capture(async () => {
            const first = await send();
            if (writer === 'recurring-expense')
              await RecurringExpense.updateOne(
                { _id: templateId },
                { $set: { description: 'Changed template' } },
              );
            const changes =
              writer === 'draft-save'
                ? {
                    drafts: draftCommand.drafts.map((draft) => ({
                      ...draft,
                      review: '0'.repeat(64),
                    })),
                  }
                : writer === 'settlement-batch'
                  ? { settlements: [{ amount: 31, currency: 'INR' }] }
                  : writer === 'tag-change'
                    ? { tagId: foodId }
                    : { description: 'Changed retry', note: 'Changed retry' };
            return [first, await send(changes)];
          });
        },
      );
    it('retry after the Group is archived', async () => {
      await capture(async () => {
        const first = await send();
        await archive();
        return [first, await send()];
      });
    });
    it('first save in an archived Group', async () => {
      await archive();
      await capture(() => send());
    });
    it('actor is no longer a member before the request', async () => {
      await remove(alex);
      await capture(() => send());
    });
    it('named person is no longer a member before the request', async () => {
      await remove(sam);
      await capture(() =>
        send(
          writer === 'edit' || writer === 'restore'
            ? {
                amount: 240,
                paidBy: [{ user: alex, amount: 240 }],
                splitBetween: [{ user: sam }, { user: priya }],
              }
            : {},
        ),
      );
    });
    it('archive commits after the checks and before the recording fence', async () => {
      await interleave(archive);
    });
    it('actor leaves between the checks and the commit', async () => {
      await interleave(() => remove(alex));
    });
    it('named person leaves between the checks and the commit', async () => {
      const changes =
        writer === 'edit' || writer === 'restore'
          ? {
              amount: 240,
              paidBy: [{ user: alex, amount: 240 }],
              splitBetween: [{ user: sam }, { user: priya }],
            }
          : {};
      await interleave(
        () => remove(sam),
        changes,
        writer === 'edit' || writer === 'restore' ? 1 : fenceNumber,
      );
    });
    it('two requests race with the same retry identity', async () => {
      const transaction = mongoose.connection.transaction.bind(mongoose.connection);
      const calls = new Map<string, number>();
      let arrivals = 0;
      let release!: () => void;
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      const spy = vi
        .spyOn(mongoose.connection, 'transaction')
        .mockImplementation(async (callback, options) => {
          const owner = requestOwner.getStore();
          if (owner) {
            const count = (calls.get(owner) ?? 0) + 1;
            calls.set(owner, count);
            if (count === fenceNumber) {
              if (++arrivals === 2) release();
              await gate;
            }
          }
          return transaction(callback, options);
        });
      const timeout = setTimeout(release, 2000);
      try {
        await capture(async () => {
          const answers = await Promise.all(
            ['a', 'b'].map((owner) => requestOwner.run(owner, () => send())),
          );
          expect(arrivals).toBe(2);
          return answers.sort((left, right) =>
            JSON.stringify(left).localeCompare(JSON.stringify(right)),
          );
        });
      } finally {
        clearTimeout(timeout);
        release();
        spy.mockRestore();
      }
    });
    if (['edit', 'delete', 'restore'].includes(writer)) {
      for (const revisionHeader of ['stale', 'missing', 'malformed'] as const)
        for (const exists of [true, false])
          it(`${revisionHeader} revision with ${exists ? 'an existing' : 'a missing'} Expense`, async () => {
            if (!exists) await Expense.deleteOne({ _id: expenseId });
            const header =
              revisionHeader === 'stale'
                ? '91'
                : revisionHeader === 'missing'
                  ? ''
                  : 'not-a-revision';
            await capture(() => send({}, { 'X-Splitbook-Revision': header }));
          });
      it('an old Expense gets its first revision before a missing revision is refused', async () => {
        await Expense.collection.updateOne(
          { _id: new mongoose.Types.ObjectId(expenseId) },
          { $unset: { revision: '' } },
        );
        await capture(() => send({}, { 'X-Splitbook-Revision': '' }));
      });
    }
    if (writer === 'edit') {
      it('an edit that changes nothing', async () => {
        await capture(() => send({ description: 'Recorded dinner' }));
      });
      it('an edit moves the currency', async () => {
        await capture(() =>
          send({
            currency: 'EUR',
            amount: 120,
            paidBy: [{ user: alex, amount: 120 }],
            splitBetween: [{ user: sam }, { user: priya }],
          }),
        );
      });
    }
    if (writer === 'delete')
      it('an already deleted Expense with its current revision', async () => {
        await send();
        await Activity.deleteMany({});
        await capture(() => send({}, { 'X-Splitbook-Revision': '1' }));
      });
    if (writer === 'restore')
      it('a restore also changes fields, history records them and Activity says restored', async () => {
        const recorded = await capture(() =>
          send({ description: 'Restored and edited dinner', notes: 'Corrected while restoring' }),
        );
        expect(recorded.after.activities[0].metadata).toMatchObject({ action: 'restored' });
        expect(recorded.after.activities[0].metadata).not.toHaveProperty('changes');
        expect(recorded.after.expenses[0].editHistory).toHaveLength(1);
      });
    if (writer === 'single-settlement' || writer === 'settlement-batch')
      it('the Group vanishes after route admission and before the service reads it', async () => {
        const before = await state();
        const find = Group.collection.findOne;
        let removed = false;
        const spy = vi.spyOn(Group.collection, 'findOne').mockImplementation(async (...args) => {
          const filter = args[0];
          if (!removed && Object.keys(filter).length === 1 && String(filter._id) === groupId) {
            removed = true;
            await Group.collection.deleteOne({ _id: new mongoose.Types.ObjectId(groupId) });
          }
          return find.apply(Group.collection, args);
        });
        vi.spyOn(console, 'error').mockImplementation(() => {});
        try {
          const recorded = await capture(() => send(), before);
          expect(removed).toBe(true);
          expect((recorded.answers as Answer).status).toBe(
            writer === 'single-settlement' ? 500 : 403,
          );
        } finally {
          spy.mockRestore();
        }
      });
    if (writer === 'settlement-batch') {
      it('one batch records same-currency and cross-currency rows', async () => {
        await capture(() =>
          send({
            settlements: [
              { currency: 'INR', amount: 30, note: 'Same currency' },
              {
                currency: 'EUR',
                amount: 20,
                amountPaidMinor: 185000,
                appliedRate: '92.5',
                rateKind: 'custom',
                suggestedRate: '92.1',
                rateSource: 'frankfurter',
                rateAsOf: '2026-10-20',
                rateFetchedAt: '2026-10-21T00:15:00.000Z',
                note: 'Cross currency',
              },
            ],
          }),
        );
      });
      it('no Debt in one row refuses the whole batch', async () => {
        await capture(() =>
          send({
            settlements: [
              { currency: 'INR', amount: 30 },
              {
                currency: 'USD',
                amount: 20,
                amountPaidMinor: 2000,
                appliedRate: '1',
                rateKind: 'entered',
              },
            ],
          }),
        );
      });
    }
    if (writer === 'manual-expense') {
      it('the ordinary old-Tag-name retry returns the current display name', async () => {
        await capture(async () => {
          const first = await send();
          await Group.updateOne(
            { _id: groupId, 'tags._id': foodId },
            { $set: { 'tags.$.name': 'Meals' } },
          );
          return [first, await send()];
        });
      });
      it('the duplicate-race response keeps the stored Tag name, then an ordinary retry rewrites it', async () => {
        const before = await state();
        const pause = holdFence(1);
        const racing = send();
        let first: Answer;
        try {
          await pause.reached;
          first = await send();
          await Group.updateOne(
            { _id: groupId, 'tags._id': foodId },
            { $set: { 'tags.$.name': 'Meals' } },
          );
        } finally {
          pause.release();
          pause.restore();
        }
        const duplicate = await racing;
        const ordinary = await send();
        const after = await state();
        expect([duplicate.body.data.tag, ordinary.body.data.tag]).toEqual(['Food', 'Meals']);
        expect(names.normalise({ before, first, duplicate, ordinary, after })).toMatchSnapshot();
      });
      it('a reused old Tag name conflicts in the duplicate race but replays ordinarily', async () => {
        const before = await state();
        const transaction = mongoose.connection.transaction.bind(mongoose.connection);
        const releases = new Map<string, () => void>();
        const arrivals = new Map<string, () => void>();
        const reached = (owner: string) =>
          new Promise<void>((resolve) => {
            arrivals.set(owner, resolve);
          });
        const winnerReached = reached('winner');
        const loserReached = reached('loser');
        const held = new Set<string>();
        const spy = vi
          .spyOn(mongoose.connection, 'transaction')
          .mockImplementation(async (callback, options) => {
            const owner = requestOwner.getStore();
            if (owner && !held.has(owner)) {
              held.add(owner);
              const wait = new Promise<void>((resolve) => {
                releases.set(owner, resolve);
              });
              arrivals.get(owner)!();
              await wait;
            }
            return transaction(callback, options);
          });
        const winner = requestOwner.run('winner', () => send());
        let loser: Promise<Answer> | undefined;
        try {
          await winnerReached;
          await Group.updateOne(
            { _id: groupId, 'tags._id': foodId },
            { $set: { 'tags.$.name': 'Meals' } },
          );
          const replacement = new mongoose.Types.ObjectId();
          names.name(replacement, 'replacement-tag');
          await Group.updateOne(
            { _id: groupId },
            { $push: { tags: { _id: replacement, name: 'Food', isArchived: false } } },
          );
          loser = requestOwner.run('loser', () => send());
          await loserReached;
          releases.get('winner')!();
          const committed = await winner;
          releases.get('loser')!();
          const duplicate = await loser;
          spy.mockRestore();
          const ordinary = await send();
          const after = await state();
          expect([committed.status, duplicate.status, ordinary.status]).toEqual([201, 409, 201]);
          expect(
            names.normalise({ before, committed, duplicate, ordinary, after }),
          ).toMatchSnapshot();
        } finally {
          for (const release of releases.values()) release();
          await Promise.allSettled([winner, ...(loser ? [loser] : [])]);
          spy.mockRestore();
        }
      });
    }
    if (writer === 'recurring-expense') {
      it('one read catches up three Months and a second read repeats none', async () => {
        await RecurringExpense.collection.updateOne(
          { _id: new mongoose.Types.ObjectId(templateId) },
          { $set: { startsOn: new Date('2026-09-01T00:00:00Z'), createdAt: clock } },
        );
        await capture(async () => [await send(), await send()]);
      });
      it('an unrelated duplicate stops the marker at the recorded prefix, then a read catches up', async () => {
        await RecurringExpense.collection.updateOne(
          { _id: new mongoose.Types.ObjectId(templateId) },
          { $set: { startsOn: new Date('2026-09-01T00:00:00Z'), createdAt: clock } },
        );
        const index = await Expense.collection.createIndex(
          { description: 1 },
          { unique: true, name: 'recording_unrelated_collision' },
        );
        vi.spyOn(console, 'error').mockImplementation(() => {});
        const before = await state();
        try {
          const first = await send();
          const stopped = await state();
          expect(stopped.templates[0].lastGeneratedFor).toBe('2026-09');
          await Expense.collection.dropIndex(index);
          const retried = await send();
          const after = await state();
          expect(after.templates[0].lastGeneratedFor).toBe('2026-11');
          expect(names.normalise({ before, first, stopped, retried, after })).toMatchSnapshot();
        } finally {
          if ((await Expense.collection.indexes()).some((entry) => entry.name === index))
            await Expense.collection.dropIndex(index);
        }
      });
    }
    if (isChange)
      it('a full Activity backlog refuses another event without saving the change', async () => {
        const pending = Array.from({ length: 100 }, (_, ordinal) => ({
          _id: new mongoose.Types.ObjectId(),
          group: new mongoose.Types.ObjectId(groupId),
          actor: new mongoose.Types.ObjectId(alex),
          occurredAt: clock,
          type: 'expense_updated',
          metadata: { expenseId, ordinal },
        }));
        await Expense.collection.updateOne(
          { _id: new mongoose.Types.ObjectId(expenseId) },
          { $set: { pendingActivity: pending } },
        );
        vi.spyOn(console, 'error').mockImplementation(() => {});
        const recorded = await capture(() => send());
        expect(recorded.after.activities).toHaveLength(0);
        expect(recorded.after.expenses[0].pendingActivity).toHaveLength(100);
      });
    if (writer === 'manual-expense' || writer === 'edit' || writer === 'restore')
      it('a currency removed before the financial commit refuses the recording', async () => {
        await interleave(
          () => Group.updateOne({ _id: groupId }, { $pull: { alternateCurrencies: 'EUR' } }),
          { currency: 'EUR' },
        );
      });
    if (writer === 'single-settlement' || writer === 'settlement-batch') {
      it('a paying currency removed before the financial commit refuses the recording', async () => {
        const cross = {
          currency: 'INR',
          amount: 30,
          amountPaidMinor: 3000,
          appliedRate: '1',
          rateKind: 'entered',
        };
        await interleave(
          () => Group.updateOne({ _id: groupId }, { $pull: { alternateCurrencies: 'EUR' } }),
          writer === 'single-settlement'
            ? { ...cross, paidCurrency: 'EUR' }
            : { paidCurrency: 'EUR', settlements: [cross] },
        );
      });
      it('a real standalone database keeps its own transaction requirement', async () => {
        if (process.env.RECORDING_STANDALONE_RESULT) {
          const recorded = await capture(() => send());
          expect((recorded.answers as Answer).status).toBe(
            writer === 'single-settlement' ? 201 : 503,
          );
          return;
        }
        const standaloneUri = process.env.STANDALONE_TEST_MONGODB_URI;
        if (!standaloneUri)
          throw new Error('Recordings require STANDALONE_TEST_MONGODB_URI for topology coverage');
        // Auth and models share one client. A separate process exercises a fresh server instance
        // against the real standalone database, then returns its record to this writer's snapshot.
        const directory = await mkdtemp(join(tmpdir(), 'splitbook-recording-'));
        const result = join(directory, 'record.json');
        try {
          await promisify(execFile)(
            process.execPath,
            [
              resolve('node_modules/vitest/vitest.mjs'),
              'run',
              `src/lib/recording-${writer}.integration.test.ts`,
              '-t',
              'a real standalone database keeps its own transaction requirement',
              '--maxWorkers',
              '1',
            ],
            {
              cwd: process.cwd(),
              timeout: 15_000,
              env: {
                ...process.env,
                TEST_MONGODB_URI: standaloneUri,
                RECORDING_STANDALONE_RESULT: result,
              },
            },
          );
          expect(JSON.parse(await readFile(result, 'utf8'))).toMatchSnapshot();
        } finally {
          await rm(directory, { recursive: true, force: true });
        }
      });
    }
    if (writer === 'manual-expense' || writer === 'single-settlement')
      it('two saves without a submission key are two recordings', async () => {
        await capture(async () => [
          await send({}, { 'Idempotency-Key': '' }),
          await send({}, { 'Idempotency-Key': '' }),
        ]);
      });
    if (writer === 'tag-change')
      it('a stale Expense does not stop the next Expense from changing', async () => {
        const second = await http(
          routes.expenses.POST,
          'POST',
          'expenses',
          expenseBody({ description: 'Another dinner' }),
        );
        expect(second.status).toBe(201);
        await Activity.deleteMany({});
        const recorded = await capture(() =>
          send({
            expenses: [
              { id: expenseId, revision: 91 },
              { id: second.body.data._id, revision: 0 },
            ],
          }),
        );
        expect(
          (recorded.answers as Answer).body.data.results.map(
            (row: { outcome: string }) => row.outcome,
          ),
        ).toEqual(['changed-elsewhere', 'changed']);
      });
    if (writer === 'manual-expense' || writer === 'recurring-expense')
      it('a failed first insertion leaves the currency lock the writer committed', async () => {
        await Expense.createCollection();
        await mongoose.connection.db!.command({
          collMod: 'expenses',
          validator: { description: { $ne: 'Recorded dinner' } },
        });
        vi.spyOn(console, 'error').mockImplementation(() => {});
        try {
          const recorded = await capture(() => send());
          expect(recorded.after.expenses).toHaveLength(0);
          expect(recorded.after.activities).toHaveLength(0);
          expect(recorded.after.group?.currencyLocked).toBe(writer === 'recurring-expense');
        } finally {
          await mongoose.connection.db!.command({ collMod: 'expenses', validator: {} });
        }
      });
    for (const recovery of ['retry', 'feed'] as const)
      it(`Activity fails after the commit, then ${recovery}`, async () => {
        vi.spyOn(console, 'error').mockImplementation(() => {});
        const fault = vi.spyOn(Activity, 'updateOne').mockImplementation(() => {
          throw new Error('Fictional Activity storage outage');
        });
        const before = await state();
        const first = await send();
        const pending = await state();
        expect(pending.activities).toHaveLength(0);
        expect(
          [...pending.expenses, ...pending.settlements].flatMap((row) => row.pendingActivity ?? []),
        ).toHaveLength(1);
        fault.mockRestore();
        const recovered =
          recovery === 'retry' ? await send() : await http(routes.feed.GET, 'GET', 'activity');
        const after = await state();
        const publishesOnRetry = [
          'manual-expense',
          'single-settlement',
          'settlement-batch',
        ].includes(writer);
        expect(after.activities).toHaveLength(recovery === 'feed' || publishesOnRetry ? 1 : 0);
        expect(names.normalise({ before, first, pending, recovered, after })).toMatchSnapshot();
      });
  });
}
