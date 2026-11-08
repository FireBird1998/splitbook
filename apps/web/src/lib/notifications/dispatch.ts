import 'server-only';
import { randomUUID } from 'node:crypto';
import mongoose from 'mongoose';
import { ObjectId } from 'mongodb';
import connectDB from '@/lib/db';
import { connectMongo, getAuthDb } from '@/lib/mongodb-client';
import {
  expenseChangeAlertsEnabled,
  paymentAlertsEnabled,
  type NotificationContext,
  type NotificationKind,
} from '@/lib/financial-write';
import { sendFcm, type SendResult } from './provider';

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
  payments?: boolean;
  paymentCutoff?: Date | null;
  paymentActivation?: string;
  token: string;
  tokenHash: string;
  /** FCM answered that the token is unregistered (#844): consent stays, sends wait for a new token. */
  tokenInvalid?: true;
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
  /** Provider attempts so far (#843). */
  attempts?: number;
  /** When a definite temporary failure may be tried again; null once retries are spent. */
  nextAttemptAt?: Date | null;
}
export const notificationEnvironment = () =>
  process.env.MOBILE_APP_ENV ||
  (process.env.NODE_ENV === 'production' ? 'production' : 'development');

/**
 * Which captured events may send. Manual and reviewed-Draft Expense-added alerts (#840) always
 * may. Edits, deletion, restoration and recurring generation (#841) send only while
 * `ANDROID_NOTIFICATION_EXPENSE_CHANGES_ENABLED=true`, and recorded Settlements (#842) only while
 * `ANDROID_NOTIFICATION_PAYMENTS_ENABLED=true`, so turning either off also stops any it captured
 * while it was on.
 */
const sendableKinds = (): NotificationKind[] => [
  'expense_added',
  ...(expenseChangeAlertsEnabled() ? (['expense_updated', 'expense_deleted'] as const) : []),
  ...(paymentAlertsEnabled() ? (['settlement_recorded'] as const) : []),
];
const changeAlertScope = () => ({
  'notificationContext.kind': { $in: sendableKinds() },
  ...(expenseChangeAlertsEnabled() ? {} : { 'metadata.recurring': { $ne: true } }),
});
const changeAlertAllowed = (event: {
  notificationContext: NotificationContext;
  metadata?: { recurring?: unknown };
}) =>
  sendableKinds().includes(event.notificationContext.kind) &&
  (expenseChangeAlertsEnabled() || event.metadata?.recurring !== true);
/**
 * The device switch an event kind obeys (#839): Payments for a recorded Settlement, Expense
 * updates for every Expense kind, each with its own cutoff and activation generation.
 */
const preferenceFor = (kind: NotificationKind) =>
  kind === 'settlement_recorded'
    ? ({ flag: 'payments', cutoff: 'paymentCutoff', activation: 'paymentActivation' } as const)
    : ({
        flag: 'expenseUpdates',
        cutoff: 'expenseCutoff',
        activation: 'expenseActivation',
      } as const);

type DispatchCounts = {
  considered: number;
  accepted: number;
  skipped: number;
  failed: number;
  /** Unpublished Activity intents this recovery pass published (#843). */
  recovered: number;
  /** Definite temporary failures this recovery pass scheduled for another attempt (#843). */
  retrying: number;
};

/**
 * The recovery kill switch (#843). Only while `ANDROID_NOTIFICATION_RECOVERY_ENABLED=true` does
 * the protected trigger publish unpublished Activity of every Group, retry definite temporary
 * failures and revisit lost claims. Unset, the trigger runs exactly the #840 pass, so nothing in
 * production sends anything new until the owner turns it on.
 */
export const notificationRecoveryEnabled = () =>
  process.env.ANDROID_NOTIFICATION_RECOVERY_ENABLED === 'true';

/** At most this many provider attempts per delivery, all inside the event's 24 hours. */
export const RETRY_ATTEMPTS = 5;
/**
 * The wait before attempt `attempts + 1`: exponential from one minute, capped at 30 minutes,
 * with jitter over its upper half; never shorter than the provider's Retry-After.
 */
export function retryDelay(
  attempts: number,
  retryAfterMs: number | null,
  random: () => number = Math.random,
) {
  const ceiling = Math.min(30 * 60_000, 60_000 * 2 ** Math.max(0, attempts - 1));
  return Math.max(ceiling * (0.5 + random() * 0.5), retryAfterMs ?? 0);
}

/**
 * One bounded dispatch pass. With `eventIds` (after a new event) it covers only those events.
 * Without (the protected trigger) it is a global pass over the last 24 hours and, while the
 * recovery switch is on, also recovers unpublished Activity and due retries first.
 */
export async function dispatchExpenseAlerts(eventIds?: readonly string[]) {
  const deadline = Date.now() + 20_000;
  const counts: DispatchCounts = {
    considered: 0,
    accepted: 0,
    skipped: 0,
    failed: 0,
    recovered: 0,
    retrying: 0,
  };
  const recovering = !eventIds && notificationRecoveryEnabled();
  // Uncertain provider outcomes, a part of `failed`: the log line reports them on their own.
  const uncertain = { count: 0 };
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      runDispatch(deadline, counts, uncertain, recovering, eventIds),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('Notification dispatch budget expired')), 20_000);
      }),
    ]);
  } finally {
    clearTimeout(timer);
    // One line per run, counts only: production checks need no database read, and the line
    // carries no ids, tokens or names. With recovery off it is exactly the #840 line.
    console.info(
      `Notification dispatch: considered=${counts.considered} accepted=${counts.accepted}` +
        ` skipped=${counts.skipped} uncertain=${uncertain.count} failed=${counts.failed}` +
        (recovering ? ` recovered=${counts.recovered} retrying=${counts.retrying}` : ''),
    );
  }
}
type AlertEvent = {
  _id: ObjectId;
  notificationContext: NotificationContext;
  metadata?: { recurring?: unknown };
};
const RETRYABLE = ['claimed', 'sending'] as const;

async function runDispatch(
  deadline: number,
  counts: DispatchCounts,
  uncertain: { count: number },
  recovering: boolean,
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
  const registrationCollection = authDb.collection<Registration>('notificationRegistrations');
  await deliveries.createIndex({ identity: 1 }, { unique: true, maxTimeMS: 500 });
  await deliveries.createIndex({ deleteAt: 1 }, { expireAfterSeconds: 0, maxTimeMS: 500 });
  await deliveries.createIndex({ state: 1, leaseUntil: 1, expiresAt: 1 }, { maxTimeMS: 500 });
  await registrationCollection.createIndex(
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
  await registrationCollection.createIndex(
    { environment: 1, accountId: 1, enabled: 1, payments: 1, paymentCutoff: 1, expiresAt: 1 },
    { maxTimeMS: 500 },
  );
  const environment = notificationEnvironment();
  const now = new Date();
  const cursors = authDb.collection<{ _id: string; after: ObjectId }>(
    'notificationDispatchCursors',
  );
  const eventCollection = db.collection<AlertEvent>('activities');
  const eligibility = {
    'notificationContext.version': 2,
    ...changeAlertScope(),
    createdAt: { $gt: new Date(now.getTime() - 86_400_000), $lte: now },
  };
  /** A definite temporary failure whose wait is over, reclaimable only by a recovery pass. */
  const dueRetry = () => ({ state: 'temporary' as const, nextAttemptAt: { $lte: new Date() } });

  /**
   * One attempt at one event/installation/binding/activation delivery: an atomic claim with a
   * lease, every live recheck, then at most one provider request. 'stop' means the invocation
   * budget ran out before provider I/O, with the work left pending.
   */
  const attempt = async (
    event: AlertEvent,
    registration: Registration,
  ): Promise<'next' | 'stop'> => {
    const context = event.notificationContext;
    const preference = preferenceFor(context.kind);
    const occurredAt = new Date(context.occurredAt);
    const expiresAt = new Date(occurredAt.getTime() + 86_400_000);
    counts.considered++;
    const generation = registration[preference.activation];
    const activation = generation ?? registration.activation;
    const sameGeneration = generation
      ? { [preference.activation]: activation }
      : { activation: activation };
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
        $or: [
          { state: 'pending' },
          { state: 'claimed', leaseUntil: { $lte: new Date() } },
          ...(recovering ? [dueRetry()] : []),
        ],
      },
      { $set: { state: 'claimed', claim, leaseUntil: new Date(Date.now() + 20_000) } },
      { returnDocument: 'after', maxTimeMS: 500 },
    );
    if (!row) {
      counts.skipped++;
      return 'next';
    }
    const live = await registrationCollection.findOne(
      {
        environment,
        installationId: registration.installationId,
        binding: row.binding,
        ...sameGeneration,
        accountId: row.accountId,
        sessionId: registration.sessionId,
        enabled: true,
        [preference.flag]: true,
        [preference.cutoff]: { $lte: occurredAt },
        expiresAt: { $gt: new Date() },
        // The installation's current token, which may have rotated since this pass listed it (#844).
        token: { $type: 'string' },
        tokenInvalid: { $ne: true },
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
    const release = () =>
      deliveries.updateOne(
        { identity, claim, state: 'claimed' },
        // A retry keeps its schedule: put back as due, so only recovery picks it up again.
        row.attempts
          ? { $set: { state: 'temporary', nextAttemptAt: new Date() } }
          : { $set: { state: 'pending' }, $unset: { claim: '', leaseUntil: '' } },
        { maxTimeMS: 500 },
      );
    if (deadline - Date.now() < 10_000) {
      await release();
      return 'stop';
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
      return 'next';
    }
    const remaining = expiresAt.getTime() - Date.now();
    let deferredForBudget = false;
    const sent: SendResult = await sendFcm(
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
        const binding = await registrationCollection.findOne(
          {
            environment,
            installationId: live.installationId,
            binding: row.binding,
            ...sameGeneration,
            accountId: row.accountId,
            sessionId: live.sessionId,
            enabled: true,
            [preference.flag]: true,
            [preference.cutoff]: { $lte: occurredAt },
            expiresAt: { $gt: new Date() },
            token: live.token,
            tokenInvalid: { $ne: true },
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
    const outcome = typeof sent === 'string' ? sent : sent.outcome;
    if (deferredForBudget && outcome === 'ineligible') {
      await release();
      return 'stop';
    }
    // Retry only a definite temporary failure, with bounded backoff and jitter (never sooner
    // than Retry-After), and only while another attempt still fits in the event's 24 hours.
    const attempts = (row.attempts ?? 0) + (outcome === 'ineligible' ? 0 : 1);
    let nextAttemptAt: Date | null = null;
    if (outcome === 'temporary') {
      const at =
        Date.now() + retryDelay(attempts, typeof sent === 'string' ? null : sent.retryAfterMs);
      if (attempts < RETRY_ATTEMPTS && at < expiresAt.getTime()) nextAttemptAt = new Date(at);
    }
    await deliveries.updateOne(
      { identity, claim, state: { $in: [...RETRYABLE] } },
      {
        $set: {
          state: outcome,
          attempts,
          ...(outcome === 'temporary' ? { nextAttemptAt } : {}),
        },
      },
      { maxTimeMS: 500 },
    );
    // An app that maintains its registration keeps the member's consent: only the token is
    // disabled, and the phone's next token, under the same binding and activation, receives
    // later alerts. An app that never maintains (2a0b065b) would never send that token, so its
    // registration is switched off as before and its Settings shows off (#844). One atomic
    // update decides on the capability as stored; a rotated token is untouched.
    if (outcome === 'invalid-token') {
      const maintained = { $eq: ['$maintains', true] };
      const unlessMaintained = (field: string, off: unknown) => ({
        $cond: [maintained, '$' + field, off],
      });
      await authDb.collection('notificationRegistrations').updateOne(
        {
          environment,
          installationId: live.installationId,
          binding: live.binding,
          token: live.token,
        },
        [
          {
            $set: {
              tokenInvalid: { $cond: [maintained, true, '$$REMOVE'] },
              enabled: unlessMaintained('enabled', false),
              expenseUpdates: unlessMaintained('expenseUpdates', false),
              payments: unlessMaintained('payments', false),
              revision: unlessMaintained('revision', { $add: ['$revision', 1] }),
            },
          },
        ],
        { maxTimeMS: 500 },
      );
    }
    if (outcome === 'accepted') counts.accepted++;
    else counts.failed++;
    if (outcome === 'uncertain') uncertain.count++;
    if (recovering && nextAttemptAt) counts.retrying++;
    return 'next';
  };

  const budgetLeft = () => deadline - Date.now() >= 10_000 && counts.considered < 100;
  let eventsSeen = 0;

  /** Every eligible device for one event, excluding terminal and in-flight deliveries. */
  const processEvent = async (event: AlertEvent): Promise<'next' | 'stop'> => {
    const context = event.notificationContext;
    const preference = preferenceFor(context.kind);
    if (context.eventId !== String(event._id) || !ObjectId.isValid(context.groupId)) return 'next';
    const occurredAt = new Date(context.occurredAt);
    // Exclude terminal/in-flight delivery identities before limiting devices, so an
    // accepted prefix cannot starve a later installation. Pending and expired claims remain eligible.
    const registrations = await registrationCollection
      .aggregate<Registration>(
        [
          {
            $match: {
              environment,
              accountId: { $in: context.recipientIds },
              enabled: true,
              [preference.flag]: true,
              binding: { $type: 'string' },
              activation: { $type: 'string' },
              [preference.cutoff]: { $lte: occurredAt },
              expiresAt: { $gt: new Date() },
              token: { $type: 'string' },
              tokenInvalid: { $ne: true },
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
                  { $ifNull: ['$' + preference.activation, '$activation'] },
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
                      state: { $in: [...RETRYABLE] },
                      leaseUntil: { $lte: new Date() },
                    },
                  },
                },
                ...(recovering ? [{ priorDelivery: { $elemMatch: dueRetry() } }] : []),
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
      if (!budgetLeft()) break;
      if ((await attempt(event, registration)) === 'stop') return 'stop';
    }
    return 'next';
  };

  if (recovering) {
    await deliveries.createIndex(
      { environment: 1, state: 1, nextAttemptAt: 1 },
      { maxTimeMS: 500 },
    );
    // 1. Unpublished Activity of every Group, with no Group read (#843). Publication
    // acknowledges each intent on its own; no delivery outcome can hold one open.
    let recoveredIds: string[] = [];
    const publicationBudget = Math.min(5_000, deadline - Date.now() - 10_000);
    if (publicationBudget > 0) {
      const { activityService } = await import('@/lib/services/activity.service');
      const published = await activityService.recoverAllActivity({
        maxDocuments: 100,
        maxEvents: 100,
        maxDurationMs: publicationBudget,
      });
      counts.recovered = published.published;
      recoveredIds = published.eventIds;
    }
    // 2. A send whose process was lost mid-request may have reached Google: uncertain, never resent.
    await deliveries.updateMany(
      { environment, state: 'sending', leaseUntil: { $lte: new Date() } },
      { $set: { state: 'uncertain' } },
      { maxTimeMS: 500 },
    );
    // 3. Due retries, expired pre-I/O claims and deferred work, wherever the cursor is.
    const due = await deliveries
      .find({
        environment,
        expiresAt: { $gt: new Date() },
        $or: [
          dueRetry(),
          { state: 'claimed', leaseUntil: { $lte: new Date() } },
          { state: 'pending' },
        ],
      })
      .sort({ _id: 1 })
      .limit(100)
      .maxTimeMS(500)
      .toArray();
    for (const row of due) {
      if (!budgetLeft()) return counts;
      const event = ObjectId.isValid(row.eventId)
        ? await eventCollection.findOne(
            { ...eligibility, _id: new ObjectId(row.eventId) },
            { maxTimeMS: 500 },
          )
        : null;
      const generation = event && preferenceFor(event.notificationContext.kind).activation;
      const registration =
        event &&
        generation &&
        (await registrationCollection.findOne(
          {
            environment,
            installationId: row.installationId,
            binding: row.binding,
            accountId: row.accountId,
            $or: [
              { [generation]: row.activation },
              { [generation]: { $exists: false }, activation: row.activation },
            ],
          },
          { maxTimeMS: 500 },
        ));
      if (!event || !registration) {
        // Its event has expired or its kind is switched off, or its binding or activation
        // has since been replaced: this delivery can never be sent.
        counts.considered++;
        counts.skipped++;
        await deliveries.updateOne(
          {
            identity: row.identity,
            state: row.state,
            ...(row.claim ? { claim: row.claim } : { claim: { $exists: false } }),
          },
          { $set: { state: 'ineligible' } },
          { maxTimeMS: 500 },
        );
        continue;
      }
      if ((await attempt(event, registration)) === 'stop') return counts;
    }
    // 4. Events this pass just published, which may sit behind the cursor.
    if (recoveredIds.length) {
      const recovered = await eventCollection
        .find({ ...eligibility, _id: { $in: recoveredIds.map((id) => new ObjectId(id)) } })
        .sort({ _id: 1 })
        .limit(100)
        .maxTimeMS(500)
        .toArray();
      for (const event of recovered) {
        if (!budgetLeft() || eventsSeen >= 100) return counts;
        eventsSeen++;
        if ((await processEvent(event)) === 'stop') return counts;
      }
    }
  }

  // 5. The bounded pass over the last 24 hours (or the named new events), from the cursor.
  const cursor = eventIds ? null : await cursors.findOne({ _id: environment }, { maxTimeMS: 500 });
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
  for (const event of events) {
    if (!budgetLeft() || eventsSeen >= 100) break;
    eventsSeen++;
    const previouslyAdvanced = advanced;
    advanced = event._id;
    if ((await processEvent(event)) === 'stop') {
      advanced = previouslyAdvanced;
      break;
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
