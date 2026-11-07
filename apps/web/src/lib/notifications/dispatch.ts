import 'server-only';
import { randomUUID } from 'node:crypto';
import mongoose from 'mongoose';
import { ObjectId } from 'mongodb';
import connectDB from '@/lib/db';
import { connectMongo, getAuthDb } from '@/lib/mongodb-client';
import { expenseChangeAlertsEnabled, type ExpenseNotificationContext } from '@/lib/financial-write';
import { sendFcm } from './provider';

interface Registration {
  environment: string;
  installationId: string;
  accountId: string;
  sessionId: string;
  binding: string;
  activation: string;
  expenseActivation?: string;
  expiresAt: Date;
  enabled: boolean;
  expenseUpdates: boolean;
  expenseCutoff: Date;
  token: string;
  tokenHash: string;
  revision: number;
}
interface Delivery {
  identity: string;
  eventId: string;
  environment: string;
  installationId: string;
  binding: string;
  activation: string;
  accountId: string;
  expiresAt: Date;
  deleteAt: Date;
  state:
    | 'pending'
    | 'claimed'
    | 'sending'
    | 'accepted'
    | 'temporary'
    | 'invalid-token'
    | 'operational'
    | 'uncertain'
    | 'ineligible';
  leaseUntil?: Date;
  claim?: string;
}
export const notificationEnvironment = () =>
  process.env.MOBILE_APP_ENV ||
  (process.env.NODE_ENV === 'production' ? 'production' : 'development');

/**
 * Which captured Expense events may send. Manual and reviewed-Draft Expense-added alerts (#840)
 * always may. Edits, deletion, restoration and recurring generation (#841) send only while
 * `ANDROID_NOTIFICATION_EXPENSE_CHANGES_ENABLED=true`, so turning it off also stops any it
 * captured while it was on.
 */
const changeAlertScope = () =>
  expenseChangeAlertsEnabled()
    ? {
        'notificationContext.kind': {
          $in: ['expense_added', 'expense_updated', 'expense_deleted'],
        },
      }
    : { 'notificationContext.kind': 'expense_added', 'metadata.recurring': { $ne: true } };
const changeAlertAllowed = (event: {
  notificationContext: ExpenseNotificationContext;
  metadata?: { recurring?: unknown };
}) =>
  expenseChangeAlertsEnabled() ||
  (event.notificationContext.kind === 'expense_added' && event.metadata?.recurring !== true);

type DispatchCounts = { considered: number; accepted: number; skipped: number; failed: number };

/** Explicit bounded first dispatch. Autonomous recovery and scheduling belong to T5. */
export async function dispatchExpenseAlerts(eventIds?: readonly string[]) {
  const deadline = Date.now() + 20_000;
  const counts: DispatchCounts = { considered: 0, accepted: 0, skipped: 0, failed: 0 };
  // Uncertain provider outcomes, a part of `failed`: the log line reports them on their own.
  const uncertain = { count: 0 };
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      runDispatch(deadline, counts, uncertain, eventIds),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('Notification dispatch budget expired')), 20_000);
      }),
    ]);
  } finally {
    clearTimeout(timer);
    // One line per run, counts only: production checks need no database read, and the line
    // carries no ids, tokens or names.
    console.info(
      `Notification dispatch: considered=${counts.considered} accepted=${counts.accepted}` +
        ` skipped=${counts.skipped} uncertain=${uncertain.count} failed=${counts.failed}`,
    );
  }
}
async function runDispatch(
  deadline: number,
  counts: DispatchCounts,
  uncertain: { count: number },
  eventIds?: readonly string[],
) {
  if (
    process.env.ANDROID_NOTIFICATIONS_ENABLED !== 'true' ||
    process.env.ANDROID_NOTIFICATION_SENDS_ENABLED !== 'true'
  )
    return counts;
  await connectDB();
  await connectMongo();
  const db = mongoose.connection.db!;
  const authDb = getAuthDb();
  const deliveries = authDb.collection<Delivery>('notificationDeliveries');
  await deliveries.createIndex({ identity: 1 }, { unique: true, maxTimeMS: 500 });
  await deliveries.createIndex({ deleteAt: 1 }, { expireAfterSeconds: 0, maxTimeMS: 500 });
  await deliveries.createIndex({ state: 1, leaseUntil: 1, expiresAt: 1 }, { maxTimeMS: 500 });
  await authDb.collection<Registration>('notificationRegistrations').createIndex(
    {
      environment: 1,
      accountId: 1,
      enabled: 1,
      expenseUpdates: 1,
      expenseCutoff: 1,
      expiresAt: 1,
    },
    { maxTimeMS: 500 },
  );
  const environment = notificationEnvironment();
  const now = new Date();
  const cursors = authDb.collection<{ _id: string; after: ObjectId }>(
    'notificationDispatchCursors',
  );
  const cursor = eventIds ? null : await cursors.findOne({ _id: environment }, { maxTimeMS: 500 });
  const eventCollection = db.collection<{
    _id: ObjectId;
    notificationContext: ExpenseNotificationContext;
    metadata?: { recurring?: unknown };
  }>('activities');
  const eligibility = {
    'notificationContext.version': 2,
    ...changeAlertScope(),
    createdAt: { $gt: new Date(now.getTime() - 86_400_000), $lte: now },
  };
  const page = (after?: ObjectId) =>
    eventCollection
      .find({
        ...eligibility,
        ...(eventIds
          ? { _id: { $in: eventIds.slice(0, 100).map((id) => new ObjectId(id)) } }
          : after
            ? { _id: { $gt: after } }
            : {}),
      })
      .sort({ _id: 1 })
      .limit(100)
      .maxTimeMS(500)
      .toArray();
  let events = await page(cursor?.after);
  if (!eventIds && !events.length && cursor) events = await page();
  let advanced: ObjectId | null = null;

  eventLoop: for (const event of events) {
    if (deadline - Date.now() < 10_000 || counts.considered >= 100) break;
    const previouslyAdvanced = advanced;
    advanced = event._id;
    const context = event.notificationContext;
    if (context.eventId !== String(event._id) || !ObjectId.isValid(context.groupId)) continue;
    const occurredAt = new Date(context.occurredAt);
    const expiresAt = new Date(occurredAt.getTime() + 86_400_000);
    // Exclude terminal/in-flight delivery identities before limiting devices, so an
    // accepted prefix cannot starve a later installation. Pending and expired claims remain eligible.
    const registrations = await authDb
      .collection<Registration>('notificationRegistrations')
      .aggregate<Registration>(
        [
          {
            $match: {
              environment,
              accountId: { $in: context.recipientIds },
              enabled: true,
              expenseUpdates: true,
              binding: { $type: 'string' },
              activation: { $type: 'string' },
              expenseCutoff: { $lte: occurredAt },
              expiresAt: { $gt: new Date() },
            },
          },
          {
            $set: {
              dispatchIdentity: {
                $concat: [
                  context.eventId + ':' + environment + ':',
                  '$installationId',
                  ':',
                  '$binding',
                  ':',
                  { $ifNull: ['$expenseActivation', '$activation'] },
                ],
              },
            },
          },
          {
            $lookup: {
              from: 'notificationDeliveries',
              localField: 'dispatchIdentity',
              foreignField: 'identity',
              as: 'priorDelivery',
            },
          },
          {
            $match: {
              $or: [
                { 'priorDelivery.0': { $exists: false } },
                { 'priorDelivery.state': 'pending' },
                {
                  priorDelivery: {
                    $elemMatch: {
                      state: { $in: ['claimed', 'sending'] },
                      leaseUntil: { $lte: new Date() },
                    },
                  },
                },
              ],
            },
          },
          { $limit: 100 - counts.considered },
          { $project: { dispatchIdentity: 0, priorDelivery: 0 } },
        ],
        { maxTimeMS: 500 },
      )
      .toArray();

    for (const registration of registrations) {
      if (deadline - Date.now() < 10_000 || counts.considered >= 100) break;
      counts.considered++;
      const activation = registration.expenseActivation ?? registration.activation;
      const identity = [
        context.eventId,
        environment,
        registration.installationId,
        registration.binding,
        activation,
      ].join(':');
      await deliveries.updateOne(
        { identity },
        {
          $setOnInsert: {
            identity,
            eventId: context.eventId,
            environment,
            installationId: registration.installationId,
            binding: registration.binding,
            activation,
            accountId: registration.accountId,
            expiresAt,
            deleteAt: new Date(expiresAt.getTime() + 7 * 86_400_000),
            state: 'pending',
          },
        },
        { upsert: true, maxTimeMS: 500 },
      );
      // A process lost after marking provider I/O is uncertain, never automatically resent.
      await deliveries.updateOne(
        { identity, state: 'sending', leaseUntil: { $lte: new Date() } },
        { $set: { state: 'uncertain' } },
        { maxTimeMS: 500 },
      );
      const claim = randomUUID();
      const row = await deliveries.findOneAndUpdate(
        {
          identity,
          expiresAt: { $gt: new Date() },
          $or: [{ state: 'pending' }, { state: 'claimed', leaseUntil: { $lte: new Date() } }],
        },
        { $set: { state: 'claimed', claim, leaseUntil: new Date(Date.now() + 20_000) } },
        { returnDocument: 'after', maxTimeMS: 500 },
      );
      if (!row) {
        counts.skipped++;
        continue;
      }
      const live = await authDb.collection<Registration>('notificationRegistrations').findOne(
        {
          environment,
          installationId: registration.installationId,
          binding: row.binding,
          ...(registration.expenseActivation
            ? { expenseActivation: row.activation }
            : { activation: row.activation }),
          accountId: row.accountId,
          sessionId: registration.sessionId,
          enabled: true,
          expenseUpdates: true,
          expenseCutoff: { $lte: occurredAt },
          expiresAt: { $gt: new Date() },
          token: registration.token,
        },
        { maxTimeMS: 500 },
      );
      const session =
        live &&
        ObjectId.isValid(live.sessionId) &&
        (await authDb.collection('sessions').findOne(
          {
            _id: new ObjectId(live.sessionId),
            userId: new ObjectId(row.accountId),
            expiresAt: { $gt: new Date() },
          },
          { projection: { _id: 1 }, maxTimeMS: 500 },
        ));
      const member =
        session &&
        (await db.collection('groups').findOne(
          {
            _id: new ObjectId(context.groupId),
            'members.user': new ObjectId(row.accountId),
            deletionRequestedAt: null,
          },
          { projection: { _id: 1 }, maxTimeMS: 500 },
        ));
      if (deadline - Date.now() < 10_000) {
        await deliveries.updateOne(
          { identity, claim, state: 'claimed' },
          { $set: { state: 'pending' }, $unset: { claim: '', leaseUntil: '' } },
          { maxTimeMS: 500 },
        );
        advanced = previouslyAdvanced;
        break eventLoop;
      }
      if (
        !live ||
        !session ||
        !member ||
        expiresAt.getTime() <= Date.now() ||
        process.env.ANDROID_NOTIFICATION_SENDS_ENABLED !== 'true'
      ) {
        await deliveries.updateOne(
          { identity, claim, state: 'claimed' },
          { $set: { state: 'ineligible' } },
          { maxTimeMS: 500 },
        );
        counts.skipped++;
        continue;
      }
      const remaining = expiresAt.getTime() - Date.now();
      let deferredForBudget = false;
      const outcome = await sendFcm(
        {
          token: live.token,
          data: {
            body: JSON.stringify({
              version: 2,
              eventId: context.eventId,
              kind: context.kind,
              environment,
              accountId: row.accountId,
              groupId: context.groupId,
              recordId: context.recordId,
              binding: row.binding,
              activation: row.activation,
              occurredAt: occurredAt.toISOString(),
              expiresAt: expiresAt.toISOString(),
            }),
          },
          android: {
            priority: 'high',
            ttl: Math.max(0, Math.floor(remaining / 1000)) + 's',
            collapse_key: context.eventId,
          },
        },
        AbortSignal.timeout(Math.min(15_000, deadline - Date.now())),
        async () => {
          if (deadline - Date.now() < 10_000) {
            deferredForBudget = true;
            return false;
          }
          if (
            Date.now() >= expiresAt.getTime() ||
            process.env.ANDROID_NOTIFICATIONS_ENABLED !== 'true' ||
            process.env.ANDROID_NOTIFICATION_SENDS_ENABLED !== 'true' ||
            !changeAlertAllowed(event)
          )
            return false;
          const binding = await authDb
            .collection<Registration>('notificationRegistrations')
            .findOne(
              {
                environment,
                installationId: live.installationId,
                binding: row.binding,
                ...(registration.expenseActivation
                  ? { expenseActivation: row.activation }
                  : { activation: row.activation }),
                accountId: row.accountId,
                sessionId: live.sessionId,
                enabled: true,
                expenseUpdates: true,
                expenseCutoff: { $lte: occurredAt },
                expiresAt: { $gt: new Date() },
                token: live.token,
              },
              { projection: { _id: 1 }, maxTimeMS: 500 },
            );
          if (!binding) return false;
          const session = await authDb.collection('sessions').findOne(
            {
              _id: new ObjectId(live.sessionId),
              userId: new ObjectId(row.accountId),
              expiresAt: { $gt: new Date() },
            },
            { projection: { _id: 1 }, maxTimeMS: 500 },
          );
          if (!session) return false;
          const member = await db.collection('groups').findOne(
            {
              _id: new ObjectId(context.groupId),
              'members.user': new ObjectId(row.accountId),
              deletionRequestedAt: null,
            },
            { projection: { _id: 1 }, maxTimeMS: 500 },
          );
          if (!member) return false;
          if (deadline - Date.now() < 10_000) {
            deferredForBudget = true;
            return false;
          }
          // Credentials are ready; mark actual provider I/O only now. Lost pre-I/O claims remain reclaimable.
          const marked = await deliveries.updateOne(
            {
              identity,
              claim,
              state: 'claimed',
              expiresAt: { $gt: new Date() },
              leaseUntil: { $gt: new Date() },
            },
            { $set: { state: 'sending' } },
            { maxTimeMS: 500 },
          );
          return marked.modifiedCount === 1;
        },
      );
      if (deferredForBudget && outcome === 'ineligible') {
        await deliveries.updateOne(
          { identity, claim, state: 'claimed' },
          { $set: { state: 'pending' }, $unset: { claim: '', leaseUntil: '' } },
          { maxTimeMS: 500 },
        );
        advanced = previouslyAdvanced;
        break eventLoop;
      }
      await deliveries.updateOne(
        { identity, claim, state: { $in: ['claimed', 'sending'] } },
        { $set: { state: outcome } },
        { maxTimeMS: 500 },
      );
      if (outcome === 'invalid-token')
        await authDb.collection('notificationRegistrations').updateOne(
          {
            environment,
            installationId: live.installationId,
            binding: live.binding,
            token: live.token,
          },
          {
            $set: { enabled: false, expenseUpdates: false, payments: false },
            $inc: { revision: 1 },
          },
          { maxTimeMS: 500 },
        );
      if (outcome === 'accepted') counts.accepted++;
      else counts.failed++;
      if (outcome === 'uncertain') uncertain.count++;
    }
  }
  if (!eventIds && advanced)
    await cursors.updateOne(
      { _id: environment },
      { $set: { after: advanced } },
      { upsert: true, maxTimeMS: 500 },
    );
  return counts;
}
