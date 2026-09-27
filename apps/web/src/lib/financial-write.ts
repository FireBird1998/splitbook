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

export interface IPendingActivity {
  _id: Types.ObjectId;
  group: Types.ObjectId;
  type: ActivityType;
  actor: Types.ObjectId;
  occurredAt: Date;
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

/** Refuse another mutation before committing if a sustained outage has filled this outbox. */
export function assertPendingActivityCapacity(events: readonly IPendingActivity[] = []): void {
  if (events.length >= PENDING_ACTIVITY_LIMIT) throw new Error('ACTIVITY_BACKLOG_FULL');
}
