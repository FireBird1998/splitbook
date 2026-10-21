import 'server-only';
import { GROUP_ARCHIVED_MESSAGE } from '@splitbook/shared/group-archive';
import { isPossibleExpenseDuplicate } from '@splitbook/shared/expense-duplicate';
import mongoose from 'mongoose';
import {
  cleanAssistantName,
  draftAttributionSchema,
  type DraftAttribution,
} from '@splitbook/shared/draft-attribution';
import Group, { type IGroupDocument } from '@/lib/models/Group';
import type { ToReviewRead } from '@splitbook/shared/to-review-read';
import Expense from '@/lib/models/Expense';
import {
  saveExpenseDraftsSchema,
  completeExpenseDraftSchema,
  withGroupCurrency,
  type DraftReview,
  type DraftSaveOutcome,
} from '@splitbook/shared/validators/expense-draft';
import { expenseService } from './expense.service';
import { ensureLedgerWriteIndexes } from '@/lib/ledger-indexes';
import { normalizeExpenseMoney } from '@splitbook/shared/exact-money';
import {
  assertExpenseParticipants,
  assertGroupCurrency,
} from '@splitbook/shared/expense-validation';
import { resolveTagReference } from '@splitbook/shared/tag-identity';
import {
  ACTIVE_DRAFTS_PER_MEMBER,
  createExpenseDraftsSchema,
  draftObjectId,
  draftRequestKey,
  expenseDraftValuesSchema,
  type ExpenseDraftValues,
  type PersistedExpenseDraft,
} from '@splitbook/shared/validators/expense-draft';
import connectDB from '@/lib/db';
import { supportsGroupTransactions, withGroupMutation } from '@/lib/group-mutation';
import { fingerprintCreateCommand } from '@/lib/financial-write';
import { assertExpectedRevision } from '@/lib/ledger-revision';

interface DraftRecord {
  _id: mongoose.Types.ObjectId;
  group: mongoose.Types.ObjectId;
  owner: mongoose.Types.ObjectId;
  requestKey: string;
  requestFingerprint: string;
  itemIndex: number;
  revision: number;
  state: 'active' | 'discarded' | 'saved';
  expenseId?: string;
  savedReview?: string;
  preparedBy?: DraftAttribution;
  changedBy?: DraftAttribution;
  values?: ExpenseDraftValues;
  createdAt: Date;
  updatedAt: Date;
}

export interface DraftActor {
  /** Trusted session/token subject, never taken from submitted tool or HTTP arguments. */
  id: string;
  /** Set only by the MCP boundary from authenticated client metadata. */
  assistant?: { name: string };
  /** Recheck a connected assistant at each write authorization. */
  authorize?: () => Promise<void>;
  /** Set only by the MCP boundary: the Groups this connection leaves out (#617). */
  excludedGroupIds?: readonly string[];
}

function attribution(actor: DraftActor): DraftAttribution {
  return actor.assistant
    ? { kind: 'assistant', name: cleanAssistantName(actor.assistant.name) }
    : { kind: 'member' };
}

const indexes = new WeakMap<object, Promise<unknown>>();
async function collection() {
  if (process.env.PERSISTENT_DRAFTS_ENABLED !== 'true') throw new Error('DRAFTS_DISABLED');
  await connectDB();
  const db = mongoose.connection.db!;
  const drafts = db.collection<DraftRecord>('expensedrafts');
  let ready = indexes.get(db);
  if (!ready) {
    ready = Promise.all([
      drafts.createIndex(
        { group: 1, owner: 1, requestKey: 1, itemIndex: 1 },
        {
          unique: true,
          name: 'draft_creation_identity',
        },
      ),
      drafts.createIndex({ group: 1, state: 1, owner: 1 }, { name: 'active_group_drafts' }),
    ]).catch((error) => {
      indexes.delete(db);
      throw error;
    });
    indexes.set(db, ready);
  }
  await ready;
  return drafts;
}

function access(actor: DraftActor, groupId: string) {
  return {
    group: new mongoose.Types.ObjectId(draftObjectId.parse(groupId)),
    owner: new mongoose.Types.ObjectId(draftObjectId.parse(actor.id)),
  };
}

/**
 * What a connected assistant reaches (#617): never a Group its connection leaves out, and to it
 * a Group out of reach answers exactly as one that doesn't exist. Null for a member.
 */
function assistantReach(actor: DraftActor) {
  return actor.assistant
    ? { excluded: (actor.excludedGroupIds ?? []).map((id) => new mongoose.Types.ObjectId(id)) }
    : null;
}

async function requireMembership(
  scope: ReturnType<typeof access>,
  session?: mongoose.ClientSession,
  /** A save or an assistant's preparation, which an archived Group refuses (#578). */
  refuseArchived = false,
  reach: ReturnType<typeof assistantReach> = null,
) {
  const account = await mongoose.connection
    .db!.collection('users')
    .findOne(
      { _id: scope.owner, draftDeletionPending: { $ne: true } },
      { session, projection: { _id: 1 } },
    );
  if (!account) throw new Error('FORBIDDEN');
  const group = await mongoose.connection.db!.collection('groups').findOne(
    {
      _id: reach ? { $eq: scope.group, $nin: reach.excluded } : scope.group,
      'members.user': scope.owner,
      deletionRequestedAt: null,
    },
    { session, projection: { _id: 1, defaultCurrency: 1, isArchived: 1 } },
  );
  if (!group) throw new Error(reach ? 'GROUP_NOT_FOUND' : 'FORBIDDEN');
  if (refuseArchived && group.isArchived) throw new Error('GROUP_ARCHIVED');
  return group.defaultCurrency as string | undefined;
}

/**
 * Schema refinements may wait for valid fields; identify every absent fact independently. A
 * Draft without a currency takes its Group's, so the currency is never asked for (#512).
 */
function draftValidation(stored: ExpenseDraftValues = {}, groupCurrency?: string) {
  const values = withGroupCurrency(stored, groupCurrency);
  const parsed = completeExpenseDraftSchema.safeParse(values);
  const required = [
    ['description', values.description, 'Enter a description.'],
    ['amount', values.amount, 'Enter the Expense amount.'],
    ['currency', values.currency, 'Choose a currency.'],
    ['date', values.date, 'Choose the Expense date.'],
    ['paidBy', values.paidBy?.length, 'Choose who paid.'],
    ['splitMethod', values.splitMethod, 'Choose a split method.'],
    ['splitBetween', values.splitBetween?.length, 'Choose who shared this Expense.'],
    ['tagId', values.tagId || values.tag, 'Choose a Tag.'],
  ] as const;
  const missing = required.filter(([, value]) => value === undefined || value === 0);
  const missingKeys = new Set<string>(missing.map(([key]) => key));
  const issues = parsed.success ? [] : parsed.error.issues;
  const problems = missing.map(([key, , message]) => `${key}: ${message}`);
  for (const issue of issues) {
    if (missingKeys.has(String(issue.path[0]))) continue;
    const isMissingPayerAmount =
      issue.path[0] === 'paidBy' &&
      issue.path[2] === 'amount' &&
      values.paidBy?.[Number(issue.path[1])]?.amount === undefined;
    problems.push(
      `${issue.path.join('.')}: ${
        isMissingPayerAmount ? 'Enter the amount paid by this member.' : issue.message
      }`,
    );
  }
  return {
    parsed,
    problems,
    missingFields: [
      ...new Set([...missingKeys, ...issues.map((issue) => String(issue.path[0] ?? 'expense'))]),
    ],
  };
}

function present(record: DraftRecord, groupCurrency?: string): PersistedExpenseDraft {
  return {
    id: String(record._id),
    groupId: String(record.group),
    revision: record.revision,
    state: record.state,
    preparedBy: draftAttributionSchema.parse(record.preparedBy),
    changedBy: draftAttributionSchema.parse(record.changedBy),
    ...(record.expenseId ? { expenseId: record.expenseId } : {}),
    ...(record.state === 'active'
      ? {
          values: record.values,
          missingFields: draftValidation(record.values, groupCurrency).missingFields,
        }
      : {}),
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
  };
}

/** The Group transaction fence serializes quota checks, membership changes and deletion. */
async function mutate<T>(
  actor: DraftActor,
  groupId: string,
  write: (
    drafts: Awaited<ReturnType<typeof collection>>,
    scope: ReturnType<typeof access>,
    session: mongoose.ClientSession,
    groupCurrency: string | undefined,
  ) => Promise<T>,
  refuseArchived = false,
) {
  const scope = access(actor, groupId);
  const drafts = await collection();
  await actor.authorize?.();
  await requireMembership(scope, undefined, refuseArchived, assistantReach(actor));
  // No count-then-insert fallback: it would violate the per-member cap under concurrency.
  if (!(await supportsGroupTransactions())) throw new Error('DRAFT_TRANSACTIONS_REQUIRED');
  return withGroupMutation(String(scope.group), async (session) => {
    if (!session) throw new Error('DRAFT_TRANSACTIONS_REQUIRED');
    await actor.authorize?.();
    const account = await mongoose.connection
      .db!.collection('users')
      .updateOne(
        { _id: scope.owner, draftDeletionPending: { $ne: true } },
        { $inc: { draftMutationSequence: 1 } },
        { session },
      );
    if (!account.matchedCount) throw new Error('FORBIDDEN');
    // Checked again inside the transaction, so an archive that commits first stops the write.
    const groupCurrency = await requireMembership(
      scope,
      session,
      refuseArchived,
      assistantReach(actor),
    );
    return write(drafts, scope, session, groupCurrency);
  });
}

/** An assistant prepares nothing in an archived Group (#578); a member's own items stay theirs. */
function prepare<T>(actor: DraftActor, groupId: string, write: Parameters<typeof mutate<T>>[2]) {
  return mutate(actor, groupId, write, Boolean(actor.assistant));
}

function reviewValues(record: DraftRecord, group: IGroupDocument) {
  const { parsed, problems } = draftValidation(record.values, group.defaultCurrency);
  let allocation: DraftReview['allocation'];
  if (parsed.success) {
    try {
      const money = normalizeExpenseMoney(parsed.data);
      allocation = {
        currency: parsed.data.currency,
        paidBy: money.paidBy.map((row) => ({ user: String(row.user), amount: row.amount })),
        splitBetween: money.splitBetween.map((row) => ({
          user: String(row.user),
          amount: row.amount,
        })),
      };
      assertExpenseParticipants(
        new Set(group.members.map((member) => String(member.user))),
        parsed.data.paidBy,
        parsed.data.splitBetween,
      );
      assertGroupCurrency(group, parsed.data.currency);
      resolveTagReference(group.tags, parsed.data);
    } catch (error) {
      problems.push(error instanceof Error ? error.message : 'Invalid Expense');
    }
  }
  return { problems, allocation };
}

/** Read only the owner's Drafts plus saved Expenses visible to every current Group member. */
async function reviewDraft(
  actor: DraftActor,
  groupId: string,
  draftId: string,
  session?: mongoose.ClientSession,
): Promise<DraftReview> {
  const scope = access(actor, groupId);
  const drafts = await collection();
  await requireMembership(scope, session);
  const record = await drafts.findOne(
    { ...scope, _id: new mongoose.Types.ObjectId(draftObjectId.parse(draftId)), state: 'active' },
    { session },
  );
  if (!record) throw new Error('DRAFT_NOT_FOUND');
  const group = await Group.findById(groupId)
    .session(session ?? null)
    .lean();
  if (!group) throw new Error('FORBIDDEN');
  const values = withGroupCurrency(record.values, group.defaultCurrency);
  const { problems, allocation } = reviewValues(record, group);
  const duplicates: DraftReview['duplicates'] = [];
  const warningVersions: unknown[] = [];
  if (values.description && values.amount && values.date && values.currency) {
    const day = values.date.slice(0, 10);
    const otherDrafts = await drafts
      .find({ ...scope, state: 'active', _id: { $ne: record._id } }, { session })
      .toArray();
    for (const other of otherDrafts)
      if (
        other.values &&
        isPossibleExpenseDuplicate(values, withGroupCurrency(other.values, group.defaultCurrency))
      ) {
        duplicates.push({
          kind: 'draft',
          id: String(other._id),
          description: other.values.description!,
        });
        warningVersions.push(['draft', String(other._id), other.revision]);
      }
    const expenses = await Expense.find({
      group: groupId,
      isDeleted: false,
      currency: values.currency,
      amount: values.amount,
      date: {
        $gte: new Date(`${day}T00:00:00.000Z`),
        $lt: new Date(new Date(`${day}T00:00:00.000Z`).getTime() + 86400000),
      },
    })
      .session(session ?? null)
      .select('description revision amount currency date')
      .lean();
    for (const expense of expenses)
      if (isPossibleExpenseDuplicate(values, { ...expense, date: expense.date.toISOString() })) {
        duplicates.push({
          kind: 'expense',
          id: String(expense._id),
          description: expense.description,
        });
        warningVersions.push(['expense', String(expense._id), expense.revision ?? 0]);
      }
  }
  warningVersions.sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
  // joinedAt makes leave/rejoin invalidate every earlier review, even with the same members.
  const review = fingerprintCreateCommand({
    id: String(record._id),
    revision: record.revision,
    members: group.members,
    tags: group.tags,
    currency: group.defaultCurrency,
    warnings: warningVersions,
  });
  return {
    draft: present(record, group.defaultCurrency),
    review,
    problems,
    duplicates,
    ...(allocation ? { allocation } : {}),
  };
}

export const expenseDraftService = {
  review: reviewDraft,
  /** One read across current Groups. No mutation fence, writes or per-item Expense queries. */
  async toReview(actor: DraftActor): Promise<ToReviewRead> {
    const drafts = await collection();
    const owner = new mongoose.Types.ObjectId(draftObjectId.parse(actor.id));
    const account = await mongoose.connection.db!.collection('users').findOne(
      {
        _id: owner,
        draftDeletionPending: { $ne: true },
      },
      { projection: { _id: 1 } },
    );
    if (!account) throw new Error('FORBIDDEN');
    const groups = await Group.find({ 'members.user': owner, deletionRequestedAt: null })
      .sort({ name: 1, _id: 1 })
      .lean();
    const records = await drafts
      .find({ owner, state: 'active', group: { $in: groups.map((group) => group._id) } })
      .sort({ createdAt: 1, _id: 1 })
      .toArray();
    const result: ToReviewRead = { groups: [], total: records.length };
    for (const group of groups) {
      const own = records.filter((record) => String(record.group) === String(group._id));
      if (!own.length) continue;
      // Bound the one Expense query to the dates/amounts/currencies represented in this Group.
      const comparable = own.flatMap((record) => {
        const v = withGroupCurrency(record.values, group.defaultCurrency);
        if (!v.description || !v.amount || !v.currency || !v.date) return [];
        const start = new Date(`${v.date.slice(0, 10)}T00:00:00.000Z`);
        return [
          {
            currency: v.currency,
            amount: v.amount,
            date: { $gte: start, $lt: new Date(start.getTime() + 86400000) },
          },
        ];
      });
      const expenses = comparable.length
        ? await Expense.find({ group: group._id, isDeleted: false, $or: comparable })
            .select('description amount currency date')
            .lean()
        : [];
      const items = own.map((record) => {
        const values = withGroupCurrency(record.values, group.defaultCurrency);
        const duplicates: DraftReview['duplicates'] = [];
        for (const other of own) {
          if (
            String(other._id) !== String(record._id) &&
            other.values &&
            isPossibleExpenseDuplicate(
              values,
              withGroupCurrency(other.values, group.defaultCurrency),
            )
          )
            duplicates.push({
              kind: 'draft',
              id: String(other._id),
              description: other.values.description!,
            });
        }
        for (const expense of expenses) {
          if (isPossibleExpenseDuplicate(values, { ...expense, date: expense.date.toISOString() }))
            duplicates.push({
              kind: 'expense',
              id: String(expense._id),
              description: expense.description,
            });
        }
        return {
          draft: present(record, group.defaultCurrency),
          problems: reviewValues(record, group).problems,
          duplicates,
        };
      });
      result.groups.push({
        groupId: String(group._id),
        groupName: group.name,
        currency: group.defaultCurrency,
        category: group.category ?? 'other',
        count: items.length,
        items,
      });
    }
    return result;
  },
  async save(actor: DraftActor, groupId: string, input: unknown): Promise<DraftSaveOutcome[]> {
    // An MCP actor is never permitted to convert a Draft, even if accidentally wired here.
    if (actor.authorize) throw new Error('FORBIDDEN');
    const command = saveExpenseDraftsSchema.parse(input);
    const drafts = await collection();
    await ensureLedgerWriteIndexes();
    // An archived Group takes no new Expense (#578), but a retry of items saved before the
    // archive is still confirmed below.
    const scope = access(actor, groupId);
    const group = await mongoose.connection
      .db!.collection('groups')
      .findOne(
        { _id: scope.group, 'members.user': scope.owner, deletionRequestedAt: null },
        { projection: { isArchived: 1 } },
      );
    if (group?.isArchived) {
      const ids = command.drafts.map((item) => new mongoose.Types.ObjectId(item.id));
      const saved = await drafts.countDocuments({ ...scope, _id: { $in: ids }, state: 'saved' });
      if (saved < ids.length) throw new Error('GROUP_ARCHIVED');
    }
    const outcomes: DraftSaveOutcome[] = [];
    for (const item of command.drafts) {
      try {
        const expenseId = await mutate(actor, groupId, async (drafts, scope, session, currency) => {
          const record = await drafts.findOne(
            { ...scope, _id: new mongoose.Types.ObjectId(item.id) },
            { session },
          );
          if (!record) throw new Error('DRAFT_NOT_FOUND');
          if (record.state === 'saved') {
            if (record.revision !== item.revision + 1 || record.savedReview !== item.review)
              throw new Error('STALE_REVISION');
            return record.expenseId!;
          }
          if (record.state !== 'active') throw new Error('DRAFT_NOT_FOUND');
          assertExpectedRevision(record.revision, item.revision);
          const current = await reviewDraft(actor, groupId, item.id, session);
          if (current.review !== item.review)
            throw new Error('Review changed. Reload this Draft and review it again.');
          if (current.problems.length)
            throw new Error('Invalid Draft: ' + current.problems.join('; '));
          if (current.duplicates.length && !item.acknowledgeDuplicates)
            throw new Error('Review and acknowledge the possible duplicates before saving.');
          const preparedBy = draftAttributionSchema.parse(record.preparedBy);
          const expense = await expenseService.create(
            groupId,
            completeExpenseDraftSchema.parse(withGroupCurrency(record.values, currency)),
            actor.id,
            `draft:${item.id}`,
            preparedBy.kind === 'assistant' ? { preparedBy } : undefined,
          );
          const expenseId = String(expense._id);
          await drafts.updateOne(
            { ...scope, _id: record._id },
            {
              $unset: { values: '' },
              $set: {
                state: 'saved',
                expenseId,
                savedReview: item.review,
                updatedAt: new Date(),
                changedBy: attribution(actor),
              },
              $inc: { revision: 1 },
            },
            { session },
          );
          return expenseId;
        });
        outcomes.push({ id: item.id, status: 'saved', expenseId });
      } catch (error) {
        // Infrastructure errors can include an unknown commit result. Never call them a confirmed failure.
        const known =
          error instanceof Error &&
          (['ZodError', 'MoneyValidationError'].includes(error.name) ||
            [
              'FORBIDDEN',
              'GROUP_ARCHIVED',
              'DRAFT_NOT_FOUND',
              'STALE_REVISION',
              'REVISION_REQUIRED',
              'Review changed. Reload this Draft and review it again.',
              'Review and acknowledge the possible duplicates before saving.',
            ].includes(error.message) ||
            error.message.startsWith('Invalid Draft: '));
        outcomes.push({
          id: item.id,
          status: known ? 'failed' : 'unresolved',
          message: !known
            ? 'Save not confirmed. Retry this same reviewed save.'
            : error.message === 'GROUP_ARCHIVED'
              ? GROUP_ARCHIVED_MESSAGE
              : error.message,
        });
      }
    }
    return outcomes;
  },
  async list(actor: DraftActor, groupId: string) {
    const scope = access(actor, groupId);
    const drafts = await collection();
    const currency = await requireMembership(scope, undefined, false, assistantReach(actor));
    // Each owner's active Drafts in this Group are bounded by the per-member limit.
    return (
      await drafts
        .find({ ...scope, state: 'active' })
        .sort({ createdAt: 1, _id: 1 })
        .limit(ACTIVE_DRAFTS_PER_MEMBER)
        .toArray()
    ).map((record) => present(record, currency));
  },

  async create(actor: DraftActor, groupId: string, input: unknown, key: string) {
    const command = createExpenseDraftsSchema.parse(input);
    const requestKey = draftRequestKey.parse(key);
    const requestFingerprint = fingerprintCreateCommand(command);
    return prepare(actor, groupId, async (drafts, scope, session, currency) => {
      const replay = await drafts
        .find({ ...scope, requestKey }, { session })
        .sort({ itemIndex: 1 })
        .toArray();
      if (replay.length) {
        if (
          replay.length !== command.drafts.length ||
          replay.some((row) => row.requestFingerprint !== requestFingerprint)
        )
          throw new Error('IDEMPOTENCY_CONFLICT');
        // A discarded item's content is gone; its minimal receipt prevents resurrection.
        return replay.map((record) => present(record, currency));
      }
      const count = await drafts.countDocuments({ ...scope, state: 'active' }, { session });
      if (count + command.drafts.length > ACTIVE_DRAFTS_PER_MEMBER)
        throw new Error('DRAFT_GROUP_LIMIT');
      const now = new Date();
      const records: DraftRecord[] = command.drafts.map((values, itemIndex) => ({
        _id: new mongoose.Types.ObjectId(),
        ...scope,
        requestKey,
        requestFingerprint,
        itemIndex,
        revision: 0,
        state: 'active',
        preparedBy: attribution(actor),
        changedBy: attribution(actor),
        values,
        createdAt: now,
        updatedAt: now,
      }));
      await drafts.insertMany(records, { session });
      return records.map((record) => present(record, currency));
    });
  },

  async replace(
    actor: DraftActor,
    groupId: string,
    draftId: string,
    input: unknown,
    revision: number,
  ) {
    const values = expenseDraftValuesSchema.parse(input);
    const _id = new mongoose.Types.ObjectId(draftObjectId.parse(draftId));
    return prepare(actor, groupId, async (drafts, scope, session, currency) => {
      const record = await drafts.findOne({ ...scope, _id, state: 'active' }, { session });
      if (!record) throw new Error('DRAFT_NOT_FOUND');
      assertExpectedRevision(record.revision, revision);
      // Unlike older trusted service calls, Draft mutations always require a revision.
      if (revision === undefined) throw new Error('REVISION_REQUIRED');
      const updatedAt = new Date();
      const changedBy = attribution(actor);
      await drafts.updateOne(
        { ...scope, _id, revision },
        {
          $set: { values, updatedAt, changedBy },
          $inc: { revision: 1 },
        },
        { session },
      );
      return present({ ...record, values, updatedAt, changedBy, revision: revision + 1 }, currency);
    });
  },

  async discard(actor: DraftActor, groupId: string, draftId: string, revision: number) {
    const _id = new mongoose.Types.ObjectId(draftObjectId.parse(draftId));
    return mutate(actor, groupId, async (drafts, scope, session) => {
      const record = await drafts.findOne({ ...scope, _id }, { session });
      if (!record) throw new Error('DRAFT_NOT_FOUND');
      if (revision === undefined) throw new Error('REVISION_REQUIRED');
      if (record.state === 'discarded') {
        assertExpectedRevision(record.revision - 1, revision);
        return present(record);
      }
      if (record.state !== 'active') throw new Error('STALE_REVISION');
      assertExpectedRevision(record.revision, revision);
      const updatedAt = new Date();
      const changedBy = attribution(actor);
      await drafts.updateOne(
        { ...scope, _id, revision },
        {
          $unset: { values: '' },
          $set: { state: 'discarded', updatedAt, changedBy },
          $inc: { revision: 1 },
        },
        { session },
      );
      return present({
        ...record,
        values: undefined,
        state: 'discarded',
        updatedAt,
        changedBy,
        revision: revision + 1,
      });
    });
  },
};
