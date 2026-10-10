import mongoose from 'mongoose';
import { createHash } from 'node:crypto';
import connectDB from '@/lib/db';
import {
  supportsGroupTransactions,
  withGroupMutation,
  groupTransactionOptions,
} from '@/lib/group-mutation';
import {
  groupOwnedCollections,
  orphanGroupManifestSchema,
  projectOrphanGroup,
  type GroupRecordCounts,
} from '@/lib/group-cleanup';

interface DeletionRequest {
  _id: mongoose.Types.ObjectId;
  actorId: string | null;
  state: 'pending' | 'complete';
  collectionIndex: number;
  requestedAt: Date;
  completedAt?: Date;
  expiresAt?: Date;
  manifestFingerprint?: string;
  lastAttemptAt?: Date;
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

async function ensureGroupDeletionIndexes() {
  const db = mongoose.connection.db!;
  await db
    .collection('groupdeletions')
    .createIndex(
      { expiresAt: 1 },
      { name: 'completed_group_deletion_expiry', expireAfterSeconds: 0 },
    );
  await db
    .collection('groupdeletions')
    .createIndex(
      { state: 1, lastAttemptAt: 1, requestedAt: 1 },
      { name: 'pending_group_deletion_attempts' },
    );
}

/** Claim and consent are one transaction; ordinary archive/empty Groups are never scanned. */
export async function requestGroupDeletion(
  groupId: string,
  actorId: string,
): Promise<GroupDeletionResult> {
  if (!(await supportsGroupTransactions())) throw new Error('GROUP_DELETION_UNAVAILABLE');
  const db = mongoose.connection.db!;
  const id = new mongoose.Types.ObjectId(groupId);
  await ensureGroupDeletionIndexes();
  try {
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
  } catch (error) {
    // A simultaneous retry may observe the claim after its original membership read.
    if (!(await findGroupDeletion(groupId, actorId))) throw error;
  }
  return resumeGroupDeletion(groupId);
}

/** Bounded batches, each fenced and committed atomically with durable progress. */
export async function resumeGroupDeletion(
  groupId: string,
  maxBatches = 12,
  maxDurationMs = 2_000,
): Promise<GroupDeletionResult> {
  const deadline = Date.now() + Math.min(2_000, Math.max(1, maxDurationMs));
  if (!(await supportsGroupTransactions(deadline))) throw new Error('GROUP_DELETION_UNAVAILABLE');
  const db = mongoose.connection.db!;
  const id = new mongoose.Types.ObjectId(groupId);
  const requests = db.collection<DeletionRequest>('groupdeletions');
  for (
    let batch = 0;
    batch < Math.min(20, Math.max(1, maxBatches)) && Date.now() < deadline;
    batch++
  ) {
    const transactionOptions = {
      ...groupTransactionOptions,
      timeoutMS: Math.max(1, deadline - Date.now()),
      maxCommitTimeMS: Math.max(1, Math.min(1_000, deadline - Date.now())),
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
        const completedAt = new Date();
        await requests.updateOne(
          { _id: id },
          {
            $set: {
              state: 'complete',
              completedAt,
              expiresAt: new Date(completedAt.getTime() + 7 * 24 * 60 * 60 * 1_000),
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
  const deadline = Date.now() + 500;
  if (!(await supportsGroupTransactions(deadline))) return;
  const pending = await mongoose.connection
    .db!.collection<DeletionRequest>('groupdeletions')
    .find({ state: 'pending' }, { timeoutMS: Math.max(1, deadline - Date.now()) })
    .sort({ lastAttemptAt: 1, requestedAt: 1 })
    .limit(3)
    .maxTimeMS(Math.max(1, Math.min(100, deadline - Date.now())))
    .toArray();
  const outcomes = [];
  for (const request of pending) {
    if (Date.now() >= deadline) break;
    await mongoose.connection.db!.collection('groupdeletions').updateOne(
      { _id: request._id, state: 'pending' },
      { $set: { lastAttemptAt: new Date() } },
      {
        maxTimeMS: Math.max(1, Math.min(100, deadline - Date.now())),
        timeoutMS: Math.max(1, deadline - Date.now()),
      },
    );
    try {
      outcomes.push({
        groupId: String(request._id),
        ...(await resumeGroupDeletion(String(request._id), 2, Math.max(1, deadline - Date.now()))),
      });
    } catch {
      outcomes.push({ groupId: String(request._id), blocked: true });
    }
  }
  return outcomes;
}

/** Exact reviewed maintenance selection; default remains read-only. No missing-parent sweep. */
export async function applyOrphanGroupManifest(
  value: unknown,
  options: { environment: string; database: string; apply?: boolean },
) {
  const manifest = orphanGroupManifestSchema.parse(value);
  await connectDB();
  const db = mongoose.connection.db!;
  if (
    manifest.environment !== options.environment ||
    manifest.database !== options.database ||
    db.databaseName !== options.database
  )
    throw new Error('Manifest target does not match the explicit environment/database');
  if (options.apply && !(await supportsGroupTransactions()))
    throw new Error('GROUP_DELETION_UNAVAILABLE');
  const fingerprint = createHash('sha256').update(JSON.stringify(manifest)).digest('hex');
  const outcomes: Array<{
    groupId: string;
    status: 'eligible' | 'changed' | 'complete' | 'pending';
  }> = [];
  for (const reviewed of manifest.groups) {
    const id = new mongoose.Types.ObjectId(reviewed.id);
    const requests = db.collection<DeletionRequest>('groupdeletions');
    const previous = await requests.findOne({ _id: id });
    if (previous) {
      if (previous.manifestFingerprint !== fingerprint)
        throw new Error('Deletion request belongs to a different reviewed selection');
      if (options.apply) {
        const outcome = await resumeGroupDeletion(reviewed.id);
        outcomes.push({ groupId: reviewed.id, status: outcome.deleted ? 'complete' : 'pending' });
      } else
        outcomes.push({
          groupId: reviewed.id,
          status: previous.state === 'complete' ? 'complete' : 'pending',
        });
      continue;
    }
    const check = async (session?: mongoose.ClientSession) => {
      const group = await db
        .collection('groups')
        .findOne(
          { _id: id, members: { $type: 'array', $size: 0 }, deletionRequestedAt: null },
          { session },
        );
      if (!group) return false;
      const counts: GroupRecordCounts = {
        expenses: 0,
        settlements: 0,
        activities: 0,
        recurringexpenses: 0,
        invitations: 0,
      };
      for (const name of groupOwnedCollections)
        counts[name] = await db.collection(name).countDocuments({ group: id }, { session });
      const fresh = projectOrphanGroup(group, counts);
      return JSON.stringify(fresh) === JSON.stringify(reviewed);
    };
    if (!options.apply) {
      outcomes.push({ groupId: reviewed.id, status: (await check()) ? 'eligible' : 'changed' });
      continue;
    }
    await ensureGroupDeletionIndexes();
    let claimed = false;
    try {
      claimed = await withGroupMutation(reviewed.id, async (session) => {
        if (!(await check(session))) return false;
        const claim = await db.collection('groups').updateOne(
          { _id: id, members: { $type: 'array', $size: 0 }, deletionRequestedAt: null },
          {
            $set: {
              isArchived: true,
              deletionRequestedAt: new Date(),
              inviteCode: null,
              inviteCodeExpiresAt: null,
            },
            $inc: { __v: 1 },
          },
          { session },
        );
        if (!claim.matchedCount) return false;
        await requests.insertOne(
          {
            _id: id,
            actorId: null,
            state: 'pending',
            collectionIndex: 0,
            requestedAt: new Date(),
            manifestFingerprint: fingerprint,
          },
          { session },
        );
        return true;
      });
    } catch (error) {
      if (!(error instanceof Error) || error.message !== 'FORBIDDEN') throw error;
    }
    if (!claimed) {
      const concurrent = await requests.findOne({ _id: id });
      if (concurrent?.manifestFingerprint === fingerprint) {
        const outcome = await resumeGroupDeletion(reviewed.id);
        outcomes.push({ groupId: reviewed.id, status: outcome.deleted ? 'complete' : 'pending' });
      } else outcomes.push({ groupId: reviewed.id, status: 'changed' });
    } else {
      const outcome = await resumeGroupDeletion(reviewed.id);
      outcomes.push({ groupId: reviewed.id, status: outcome.deleted ? 'complete' : 'pending' });
    }
  }
  return {
    dryRun: options.apply !== true,
    environment: options.environment,
    database: options.database,
    results: outcomes,
  };
}
