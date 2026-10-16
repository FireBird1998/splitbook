import 'server-only';
import mongoose from 'mongoose';
import { isDeepStrictEqual } from 'node:util';
import {
  tagCommandSchema,
  type TagActionResult,
  type TagCommand,
  type TagSnapshot,
} from '@splitbook/shared/tag-management';
import connectDB from '@/lib/db';
import Group, { type IGroupDocument } from '@/lib/models/Group';
import Expense from '@/lib/models/Expense';
import RecurringExpense from '@/lib/models/RecurringExpense';
import { supportsGroupTransactions, withGroupMutation } from '@/lib/group-mutation';

export class TagManagementError extends Error {
  constructor(
    readonly code: string,
    readonly status: number,
    readonly snapshot?: TagSnapshot,
    readonly existingTagId?: string,
    message?: string,
  ) {
    super(message ?? code);
  }
}
interface Receipt {
  group: mongoose.Types.ObjectId;
  actor: mongoose.Types.ObjectId;
  requestId: string;
  intent: TagCommand['intent'];
  tagId: mongoose.Types.ObjectId;
  appliedAt: Date;
}
const indexReady = new WeakMap<object, Promise<unknown>>();
function receipts() {
  return mongoose.connection.db!.collection<Receipt>('tagactions');
}
async function ensureIndexes() {
  const db = mongoose.connection.db!;
  let pending = indexReady.get(db);
  if (!pending) {
    pending = Promise.all([
      receipts().createIndex({ group: 1, actor: 1, requestId: 1 }, { unique: true }),
      receipts().createIndex({ actor: 1 }),
    ]);
    indexReady.set(db, pending);
    pending.catch(() => indexReady.delete(db));
  }
  await pending;
}
function snapshot(group: IGroupDocument, actorId: string): TagSnapshot {
  return {
    canManage: group.members.some(
      (member) => String(member.user) === actorId && member.role === 'admin',
    ),
    tags: (group.tags ?? []).map((tag) => ({
      id: String(tag._id),
      name: tag.name,
      revision: tag.revision ?? 0,
      isArchived: tag.isArchived === true,
      isDeleted: tag.isDeleted === true,
    })),
  };
}
async function accessibleGroup(groupId: string, actorId: string) {
  await connectDB();
  const group = await Group.findOne({
    _id: groupId,
    deletionRequestedAt: null,
    'members.user': actorId,
  }).lean();
  if (!group) throw new Error('FORBIDDEN');
  // Some historical Groups predate Tags; reads must not backfill their history.
  group.tags ??= [];
  return group;
}
function applied(receipt: Receipt, current: TagSnapshot): TagActionResult {
  return {
    state: 'applied',
    requestId: receipt.requestId,
    receipt: {
      intent: receipt.intent,
      tagId: String(receipt.tagId),
      appliedAt: receipt.appliedAt.toISOString(),
    },
    snapshot: current,
  };
}
export const tagManagementService = {
  async snapshot(groupId: string, actorId: string): Promise<TagSnapshot> {
    return snapshot(await accessibleGroup(groupId, actorId), actorId);
  },
  async check(groupId: string, actorId: string, requestId: string): Promise<TagActionResult> {
    await connectDB();
    const receipt = await receipts().findOne({
      group: new mongoose.Types.ObjectId(groupId),
      actor: new mongoose.Types.ObjectId(actorId),
      requestId,
    });
    const group = await accessibleGroup(groupId, actorId);
    const current = snapshot(group, actorId);
    return receipt
      ? applied(receipt, current)
      : { state: 'not-applied', requestId, snapshot: current };
  },
  async submit(groupId: string, actorId: string, command: TagCommand): Promise<TagActionResult> {
    const parsed = tagCommandSchema.safeParse(command);
    if (!parsed.success) throw new TagManagementError('INVALID_TAG_COMMAND', 400);
    command = parsed.data;
    const initial = snapshot(await accessibleGroup(groupId, actorId), actorId);
    if (!initial.canManage) throw new TagManagementError('TAG_ADMIN_REQUIRED', 403, initial);
    if (!(await supportsGroupTransactions()))
      throw new TagManagementError('TAG_TRANSACTIONS_REQUIRED', 503);
    await ensureIndexes();
    return withGroupMutation(groupId, async (session) => {
      if (!session) throw new TagManagementError('TAG_TRANSACTIONS_REQUIRED', 503);
      const group = await accessibleGroup(groupId, actorId);
      const current = snapshot(group, actorId);
      if (!current.canManage) throw new TagManagementError('TAG_ADMIN_REQUIRED', 403, current);
      const actor = new mongoose.Types.ObjectId(actorId);
      // Share account deletion's user fence, so a late receipt cannot survive account cleanup.
      const owner = await mongoose.connection
        .db!.collection('users')
        .updateOne(
          { _id: actor, draftDeletionPending: { $ne: true } },
          { $inc: { tagMutationSequence: 1 } },
          { session },
        );
      if (!owner.matchedCount) throw new Error('FORBIDDEN');
      const scope = { group: group._id, actor, requestId: command.requestId };
      const previous = await receipts().findOne(scope, { session });
      if (previous) {
        if (!isDeepStrictEqual(previous.intent, command.intent))
          throw new TagManagementError('REQUEST_KEY_REUSED', 409, current);
        return applied(previous, current);
      }
      const intent = command.intent;
      const tag =
        intent.action === 'create'
          ? null
          : group.tags.find((candidate) => String(candidate._id) === intent.tagId);
      if (
        intent.action !== 'create' &&
        (!tag || tag.isDeleted || (tag.revision ?? 0) !== intent.expectedRevision)
      ) {
        throw new TagManagementError('TAG_CHANGED', 409, current);
      }
      if (intent.action === 'create' || intent.action === 'rename') {
        const duplicate = group.tags.find(
          (candidate) =>
            !candidate.isDeleted &&
            String(candidate._id) !== String(tag?._id) &&
            candidate.name.toLowerCase() === intent.name.toLowerCase(),
        );
        if (duplicate)
          throw new TagManagementError('TAG_EXISTS', 409, current, String(duplicate._id));
      }
      if (
        tag &&
        (intent.action === 'archive' || intent.action === 'delete') &&
        !tag.isArchived &&
        group.tags.filter((candidate) => !candidate.isArchived && !candidate.isDeleted).length <= 1
      ) {
        throw new TagManagementError('LAST_ACTIVE_TAG', 409, current);
      }
      if (tag && intent.action === 'delete') {
        const reference = {
          group: group._id,
          $or: [{ tagId: tag._id }, { tagId: null, tag: tag.name }],
        };
        const expenseCount = await Expense.countDocuments(reference);
        const templateCount = await RecurringExpense.countDocuments(reference);
        if (expenseCount + templateCount > 0)
          throw new TagManagementError(
            'TAG_IN_USE',
            409,
            current,
            undefined,
            'TAG_IN_USE:' + expenseCount + ':' + templateCount,
          );
      }
      const tagId = tag?._id ?? new mongoose.Types.ObjectId();
      if (tag && intent.action === 'rename' && tag.name !== intent.name) {
        const legacy = { group: group._id, tagId: null, tag: tag.name };
        if (group.tags.filter((candidate) => candidate.name === tag.name).length !== 1) {
          if ((await Expense.exists(legacy)) || (await RecurringExpense.exists(legacy)))
            throw new TagManagementError('AMBIGUOUS_TAG', 409, current);
        } else {
          await Expense.collection.updateMany(legacy, { $set: { tagId } }, { session });
          await RecurringExpense.collection.updateMany(legacy, { $set: { tagId } }, { session });
        }
      }
      const fields: Record<string, unknown> = {};
      if (tag) {
        fields['tags.$[tag].revision'] = (tag.revision ?? 0) + 1;
        if (intent.action === 'rename') fields['tags.$[tag].name'] = intent.name;
        if (intent.action === 'archive' || intent.action === 'delete')
          fields['tags.$[tag].isArchived'] = true;
        if (intent.action === 'restore') fields['tags.$[tag].isArchived'] = false;
        if (intent.action === 'delete') fields['tags.$[tag].isDeleted'] = true;
      }
      const updated = await Group.findByIdAndUpdate(
        groupId,
        intent.action === 'create'
          ? {
              $push: {
                tags: {
                  _id: tagId,
                  name: intent.name,
                  revision: 0,
                  isArchived: false,
                  isDeleted: false,
                },
              },
            }
          : { $set: fields },
        { returnDocument: 'after', ...(tag ? { arrayFilters: [{ 'tag._id': tagId }] } : {}) },
      ).lean();
      const receipt: Receipt = { ...scope, intent: command.intent, tagId, appliedAt: new Date() };
      await receipts().insertOne(receipt, { session });
      return applied(receipt, snapshot(updated!, actorId));
    });
  },
};
