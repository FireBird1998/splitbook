import { createHash } from 'node:crypto';
import { Schema, Types } from 'mongoose';
import type { ActivityType } from '@splitbook/shared/types';

/** Retry metadata is immutable, private persistence data, not part of a ledger DTO. */
export interface ICreationRequest {
  key: string;
  fingerprintVersion: 1;
  fingerprint: string;
  /** Creation-time identity survives both Tag renames and later edits to the expense. */
  tagId?: string;
  /** The originally submitted name, for replaying clients that predate stable Tag IDs. */
  legacyTagAlias?: string;
}

/** The Expense events an Android alert can be about (#840, #841). */
export const EXPENSE_NOTIFICATION_KINDS = [
  'expense_added',
  'expense_updated',
  'expense_deleted',
] as const;
export type ExpenseNotificationKind = (typeof EXPENSE_NOTIFICATION_KINDS)[number];
/** Every event an Android alert can be about: the Expense ones and a recorded Settlement (#842). */
export const NOTIFICATION_KINDS = [...EXPENSE_NOTIFICATION_KINDS, 'settlement_recorded'] as const;
export type NotificationKind = (typeof NOTIFICATION_KINDS)[number];

/** The private immutable alert context an Expense or Settlement event captures at its commit. */
export interface NotificationContext {
  version: 2;
  eventId: string;
  kind: NotificationKind;
  groupId: string;
  recordId: string;
  occurredAt: Date;
  recipientIds: string[];
}
export const NotificationContextSchema = new Schema<NotificationContext>(
  {
    version: { type: Number, enum: [2], required: true },
    eventId: { type: String, required: true },
    kind: { type: String, enum: NOTIFICATION_KINDS, required: true },
    groupId: { type: String, required: true },
    recordId: { type: String, required: true },
    occurredAt: { type: Date, required: true },
    recipientIds: { type: [String], required: true },
  },
  { _id: false },
);

export interface IPendingActivity {
  _id: Types.ObjectId;
  group: Types.ObjectId;
  type: ActivityType;
  actor: Types.ObjectId;
  occurredAt: Date;
  notificationContext?: NotificationContext;
  metadata: Record<string, unknown>;
}

export const ACTIVITY_TYPES: ActivityType[] = [
  'expense_added',
  'expense_updated',
  'expense_deleted',
  'settlement_recorded',
  'member_joined',
  'member_left',
  'group_created',
  'group_updated',
  'assistant_rule_changed',
];

export const PENDING_ACTIVITY_LIMIT = 100;

/** Missing keys remain valid for older clients; a provided key must be bounded and printable. */
export function parseIdempotencyKey(value: string | null | undefined): string | undefined {
  if (value == null) return undefined;
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/.test(value)) {
    throw new Error('INVALID_IDEMPOTENCY_KEY');
  }
  return value;
}

export const CreationRequestSchema = new Schema<ICreationRequest>(
  {
    key: {
      type: String,
      required: true,
      immutable: true,
      match: /^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/,
    },
    fingerprintVersion: { type: Number, required: true, immutable: true, enum: [1] },
    fingerprint: { type: String, required: true, immutable: true, match: /^[a-f0-9]{64}$/ },
    tagId: { type: String, immutable: true, match: /^[a-fA-F0-9]{24}$/ },
    legacyTagAlias: { type: String, immutable: true, maxlength: 50 },
  },
  { _id: false },
);

export const PendingActivitySchema = new Schema<IPendingActivity>({
  _id: { type: Schema.Types.ObjectId, required: true },
  group: { type: Schema.Types.ObjectId, required: true },
  type: { type: String, required: true, enum: ACTIVITY_TYPES },
  actor: { type: Schema.Types.ObjectId, required: true },
  occurredAt: { type: Date, required: true },
  notificationContext: { type: NotificationContextSchema, default: undefined },
  metadata: { type: Schema.Types.Mixed, default: {} },
});

function canonicalize(value: unknown): unknown {
  if (value instanceof Date) return value.toISOString();
  if (value instanceof Types.ObjectId) return value.toHexString();
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, item]) => item !== undefined)
        .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
        .map(([key, item]) => [key, canonicalize(item)]),
    );
  }
  if (typeof value === 'number' && !Number.isFinite(value)) {
    throw new Error('INVALID_REQUEST_FINGERPRINT');
  }
  if (['function', 'symbol', 'bigint'].includes(typeof value)) {
    throw new Error('INVALID_REQUEST_FINGERPRINT');
  }
  return value;
}

/** Call with the validated public command, including its resolved stable Tag identity. */
export function fingerprintCreateCommand(command: Record<string, unknown>): string {
  // A Tag's display name can change while the original command is being retried.
  const { tag, ...withoutTagLabel } = command;
  const stableCommand = command.tagId != null ? withoutTagLabel : { ...withoutTagLabel, tag };
  return createHash('sha256')
    .update(JSON.stringify(canonicalize(stableCommand)))
    .digest('hex');
}

export function createRequestMetadata(
  key: string,
  normalizedCommand: Record<string, unknown>,
  legacyTagAlias?: string,
): ICreationRequest {
  return {
    key: parseIdempotencyKey(key)!,
    fingerprintVersion: 1,
    fingerprint: fingerprintCreateCommand(normalizedCommand),
    ...(normalizedCommand.tagId != null ? { tagId: String(normalizedCommand.tagId) } : {}),
    ...(legacyTagAlias !== undefined ? { legacyTagAlias: legacyTagAlias.trim() } : {}),
  };
}

export function assertCreateReplay(
  stored: ICreationRequest,
  normalizedCommand: Record<string, unknown>,
): void {
  if (
    stored.fingerprintVersion !== 1 ||
    stored.fingerprint !== fingerprintCreateCommand(normalizedCommand)
  ) {
    throw new Error('IDEMPOTENCY_CONFLICT');
  }
}

/**
 * Resolve an old-name replay through its saved identity, before active-Tag validation.
 * Other names still need ordinary Group resolution; an explicit incoming ID always wins.
 */
export function requestTagForReplay<T extends { tag?: string; tagId?: unknown }>(
  input: T,
  existing: { tagId?: unknown; creationRequest?: ICreationRequest | null },
): T {
  const originalTagId = existing.creationRequest?.tagId ?? existing.tagId;
  if (
    input.tagId == null &&
    input.tag !== undefined &&
    originalTagId != null &&
    input.tag.trim() === existing.creationRequest?.legacyTagAlias
  ) {
    return { ...input, tagId: String(originalTagId) };
  }
  return input;
}

export function makePendingActivity(
  groupId: string,
  type: ActivityType,
  actorId: string,
  metadata: Record<string, unknown> = {},
  occurredAt: Date = new Date(),
): IPendingActivity {
  return {
    _id: new Types.ObjectId(),
    group: new Types.ObjectId(groupId),
    type,
    actor: new Types.ObjectId(actorId),
    occurredAt: new Date(occurredAt),
    // Snapshot now: callers may subsequently mutate an expense or a changes object.
    metadata: JSON.parse(JSON.stringify(metadata)) as Record<string, unknown>,
  };
}

/**
 * Whether edits, deletion, restoration and recurring generation capture an alert audience
 * (#841). Off unless `ANDROID_NOTIFICATION_EXPENSE_CHANGES_ENABLED=true`: while it is off those
 * events record no notification context, exactly as before #841, so turning it on later sends
 * no backlog, and the dispatcher sends none it captured earlier. Manual and reviewed-Draft
 * Expense-added alerts (#840) never depend on it.
 */
export function expenseChangeAlertsEnabled(): boolean {
  return process.env.ANDROID_NOTIFICATION_EXPENSE_CHANGES_ENABLED === 'true';
}

/**
 * Whether a recorded Settlement (single, batch or Cross-currency) captures a Payment alert
 * audience (#842). Off unless `ANDROID_NOTIFICATION_PAYMENTS_ENABLED=true`, independently of
 * `ANDROID_NOTIFICATION_EXPENSE_CHANGES_ENABLED`: while it is off a recording captures no
 * notification context, exactly as before #842, so turning it on later sends no backlog, and the
 * dispatcher sends none it captured earlier. Expense alerts never depend on it.
 */
export function paymentAlertsEnabled(): boolean {
  return process.env.ANDROID_NOTIFICATION_PAYMENTS_ENABLED === 'true';
}

/**
 * The private immutable alert context for one Expense or Settlement event, captured inside the
 * financial commit: its involved members (an Expense's payers and split participants, before and
 * after for an edit; a Settlement's payer and recipient) who are Group members at that commit,
 * without the event's actor.
 */
export function ledgerNotificationContext(
  event: Pick<IPendingActivity, '_id' | 'actor' | 'occurredAt'>,
  kind: NotificationKind,
  record: { groupId: string; recordId: string },
  involved: Iterable<unknown>,
  membersAtCommit: ReadonlySet<string>,
): NotificationContext {
  const actor = String(event.actor);
  return {
    version: 2,
    eventId: String(event._id),
    kind,
    groupId: record.groupId,
    recordId: record.recordId,
    occurredAt: event.occurredAt,
    recipientIds: [...new Set(Array.from(involved, String))]
      .filter((candidate) => candidate !== actor && membersAtCommit.has(candidate))
      .sort(),
  };
}

/**
 * Inside a Settlement's financial commit: give its `settlement_recorded` intent the Payment alert
 * audience (#842), the payer and recipient who are Group members at this commit, without the
 * member who recorded it. Each Settlement of a batch gets its own, under its own event identity.
 * While the rollout switch is off nothing is read or captured. Never refuses: an alert can't
 * change what the save does.
 */
export async function paymentAlertAudience(
  event: IPendingActivity,
  settlement: {
    groupId: string;
    recordId: string;
    paidBy: string;
    paidTo: string;
    members: () => Promise<ReadonlyArray<{ user: unknown }>>;
  },
): Promise<void> {
  if (!paymentAlertsEnabled()) return;
  const membersAtCommit = new Set(
    (await settlement.members()).map((member) => String(member.user)),
  );
  event.notificationContext = ledgerNotificationContext(
    event,
    'settlement_recorded',
    { groupId: settlement.groupId, recordId: settlement.recordId },
    [settlement.paidBy, settlement.paidTo],
    membersAtCommit,
  );
}

/** The payer and split-participant ids an Expense (or its template) records. */
export function involvedMembers(record: {
  paidBy?: ReadonlyArray<{ user: unknown }>;
  splitBetween?: ReadonlyArray<{ user: unknown }>;
}): string[] {
  return [...(record.paidBy ?? []), ...(record.splitBetween ?? [])].map((row) => {
    const user = row.user as { _id?: unknown } | null;
    return String(user && typeof user === 'object' && '_id' in user ? user._id : user);
  });
}

/** Refuse another mutation before committing if a sustained outage has filled this outbox. */
export function assertPendingActivityCapacity(events: readonly IPendingActivity[] = []): void {
  if (events.length >= PENDING_ACTIVITY_LIMIT) throw new Error('ACTIVITY_BACKLOG_FULL');
}
