import mongoose from 'mongoose';
import connectDB from '@/lib/db';
import {
  supportsGroupTransactions,
  withGroupMutation,
  groupTransactionOptions,
} from '@/lib/group-mutation';
import { groupOwnedCollections } from '@/lib/group-cleanup';

interface DeletionRequest {
  _id: mongoose.Types.ObjectId;
  actorId: string | null;
  state: 'pending' | 'complete';
  collectionIndex: number;
  requestedAt: Date;
  completedAt?: Date;
  expiresAt?: Date;
}
export interface GroupDeletionResult {
  archived: true;
  deleted: boolean;
  deletionPending: boolean;
}
const result = (complete: boolean): GroupDeletionResult => ({
  archived: true,
  deleted: complete,
  deletionPending: !complete,
});

/** Minimal durable receipt contains no ledger content, names, amounts or authentication. */
export async function findGroupDeletion(groupId: string, actorId: string) {
  await connectDB();
  return mongoose.connection
    .db!.collection<DeletionRequest>('groupdeletions')
    .findOne({ _id: new mongoose.Types.ObjectId(groupId), actorId });
}

/** Claim and consent are one transaction; ordinary archive/empty Groups are never scanned. */
export async function requestGroupDeletion(
  groupId: string,
  actorId: string,
): Promise<GroupDeletionResult> {
  if (!(await supportsGroupTransactions())) throw new Error('GROUP_DELETION_UNAVAILABLE');
  const db = mongoose.connection.db!;
  const id = new mongoose.Types.ObjectId(groupId);
  await db
    .collection('groupdeletions')
    .createIndex(
      { expiresAt: 1 },
      { name: 'completed_group_deletion_expiry', expireAfterSeconds: 0 },
    );
  await db
    .collection('groupdeletions')
    .createIndex({ state: 1, requestedAt: 1 }, { name: 'pending_group_deletion_requests' });
  await withGroupMutation(groupId, async (session) => {
    const claimed = await db.collection('groups').updateOne(
      {
        _id: id,
        members: { $size: 1 },
        'members.user': new mongoose.Types.ObjectId(actorId),
        deletionRequestedAt: null,
      },
      {
        $set: {
          members: [],
          isArchived: true,
          deletionRequestedAt: new Date(),
          inviteCode: null,
          inviteCodeExpiresAt: null,
        },
        $inc: { __v: 1 },
      },
      { session },
    );
    if (!claimed.matchedCount) throw new Error('LEAVE_CONFLICT');
    await db
      .collection<DeletionRequest>('groupdeletions')
      .insertOne(
        { _id: id, actorId, state: 'pending', collectionIndex: 0, requestedAt: new Date() },
        { session },
      );
  });
  return resumeGroupDeletion(groupId);
}

/** Bounded batches, each fenced and committed atomically with durable progress. */
export async function resumeGroupDeletion(
  groupId: string,
  maxBatches = 12,
): Promise<GroupDeletionResult> {
  await connectDB();
  if (!(await supportsGroupTransactions())) throw new Error('GROUP_DELETION_UNAVAILABLE');
  const db = mongoose.connection.db!;
  const id = new mongoose.Types.ObjectId(groupId);
  const requests = db.collection<DeletionRequest>('groupdeletions');
  const deadline = Date.now() + 2_000;
  for (
    let batch = 0;
    batch < Math.min(20, Math.max(1, maxBatches)) && Date.now() < deadline;
    batch++
  ) {
    const transactionOptions = {
      ...groupTransactionOptions,
      timeoutMS: Math.max(1, deadline - Date.now()),
    };
    try {
      const complete = await mongoose.connection.transaction(async (session) => {
        const request = await requests.findOne({ _id: id }, { session });
        if (!request) throw new Error('GROUP_DELETION_NOT_REQUESTED');
        if (request.state === 'complete') return true;
        const group = await db.collection('groups').updateOne(
          {
            _id: id,
            members: { $type: 'array', $size: 0 },
            deletionRequestedAt: { $type: 'date' },
          },
          { $inc: { mutationSequence: 1 } },
          { session },
        );
        if (!group.matchedCount) throw new Error('GROUP_DELETION_CHANGED');
        const collection = groupOwnedCollections[request.collectionIndex];
        if (collection) {
          const records = await db
            .collection(collection)
            .find({ group: id }, { session, projection: { _id: 1 } })
            .sort({ _id: 1 })
            .limit(100)
            .toArray();
          if (records.length)
            await db
              .collection(collection)
              .deleteMany(
                { group: id, _id: { $in: records.map((record) => record._id) } },
                { session },
              );
          if (records.length < 100)
            await requests.updateOne({ _id: id }, { $inc: { collectionIndex: 1 } }, { session });
          return false;
        }
        // Every writer shares the fence, so completed collections cannot gain late records.
        for (const name of groupOwnedCollections) {
          if (await db.collection(name).findOne({ group: id }, { session, projection: { _id: 1 } }))
            throw new Error('GROUP_DELETION_CHANGED');
        }
        await db.collection('groups').deleteOne({ _id: id, members: { $size: 0 } }, { session });
        await requests.updateOne(
          { _id: id },
          {
            $set: {
              state: 'complete',
              completedAt: new Date(),
              expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1_000),
            },
          },
          { session },
        );
        return true;
      }, transactionOptions);
      if (complete) return result(true);
    } catch (error) {
      if (
        error instanceof Error &&
        ['GROUP_DELETION_NOT_REQUESTED', 'GROUP_DELETION_CHANGED'].includes(error.message)
      )
        throw error;
      // A committed claim remains durable after process death, lost responses or an interrupted batch.
      return result(false);
    }
  }
  return result(false);
}

/** Only requests carrying explicit consent/maintenance selection enter this queue. */
export async function resumeRequestedGroupDeletions() {
  await connectDB();
  if (!(await supportsGroupTransactions())) return;
  const pending = await mongoose.connection
    .db!.collection<DeletionRequest>('groupdeletions')
    .find({ state: 'pending' })
    .sort({ requestedAt: 1 })
    .limit(20)
    .toArray();
  const outcomes = [];
  for (const request of pending) {
    try {
      outcomes.push({
        groupId: String(request._id),
        ...(await resumeGroupDeletion(String(request._id), 2)),
      });
    } catch {
      outcomes.push({ groupId: String(request._id), blocked: true });
    }
  }
  return outcomes;
}
