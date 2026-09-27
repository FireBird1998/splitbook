import { describe, expect, it } from 'vitest';
import { Types } from 'mongoose';
import {
  assertCreateReplay,
  assertPendingActivityCapacity,
  createRequestMetadata,
  fingerprintCreateCommand,
  makePendingActivity,
  parseIdempotencyKey,
  PENDING_ACTIVITY_LIMIT,
  requestTagForReplay,
} from './financial-write';

const tagId = 'b00000000000000000000010';
const actorId = 'b00000000000000000000001';
const groupId = 'b00000000000000000000002';
const key = 'create-expense-request-001';

describe('financial request identity', () => {
  it('recognises equivalent object ordering, dates and optional omitted values', () => {
    const initial = createRequestMetadata(key, {
      amountMinor: 101,
      date: new Date('2026-09-16T12:00:00Z'),
      paidBy: [{ user: actorId, amountMinor: 101 }],
      notes: undefined,
    });

    expect(() =>
      assertCreateReplay(initial, {
        paidBy: [{ amountMinor: 101, user: new Types.ObjectId(actorId) }],
        date: '2026-09-16T12:00:00.000Z',
        amountMinor: 101,
      }),
    ).not.toThrow();
  });

  it('does not let a renamed display label change stable Tag identity', () => {
    const initial = createRequestMetadata(key, { tagId, tag: 'Food', amountMinor: 100 });
    expect(() =>
      assertCreateReplay(initial, { amountMinor: 100, tagId, tag: 'Restaurants' }),
    ).not.toThrow();
  });

  it('recovers a legacy name replay from its original immutable Tag alias', () => {
    const creationRequest = createRequestMetadata(
      key,
      { tagId, tag: 'Food', amountMinor: 100 },
      'Food',
    );
    const replay = requestTagForReplay(
      { tag: 'Food', amountMinor: 100 },
      // The expense itself has since been assigned a different Tag.
      { tagId: new Types.ObjectId('b00000000000000000000011'), creationRequest },
    );
    expect(replay).toMatchObject({ tagId });
    expect(() => assertCreateReplay(creationRequest, replay)).not.toThrow();
  });

  it('does not reinterpret a new explicit Tag ID or a different legacy name', () => {
    const creationRequest = createRequestMetadata(key, { tagId, amountMinor: 100 }, 'Food');
    const changedId = requestTagForReplay(
      { tagId: 'b00000000000000000000011', tag: 'Food', amountMinor: 100 },
      { tagId, creationRequest },
    );
    expect(() => assertCreateReplay(creationRequest, changedId)).toThrow('IDEMPOTENCY_CONFLICT');
    expect(requestTagForReplay({ tag: 'Transport' }, { tagId, creationRequest })).toEqual({
      tag: 'Transport',
    });
  });

  it('rejects changed money, participant order and unsupported fingerprint versions', () => {
    const initial = createRequestMetadata(key, {
      amountMinor: 100,
      splitBetween: [{ user: actorId }, { user: groupId }],
    });
    expect(() =>
      assertCreateReplay(initial, {
        amountMinor: 101,
        splitBetween: [{ user: actorId }, { user: groupId }],
      }),
    ).toThrow('IDEMPOTENCY_CONFLICT');
    // Array order may break allocation ties and therefore remains part of the command.
    expect(() =>
      assertCreateReplay(initial, {
        amountMinor: 100,
        splitBetween: [{ user: groupId }, { user: actorId }],
      }),
    ).toThrow('IDEMPOTENCY_CONFLICT');
    expect(() => assertCreateReplay({ ...initial, fingerprintVersion: 2 as 1 }, {})).toThrow(
      'IDEMPOTENCY_CONFLICT',
    );
  });

  it('validates bounded request keys without inventing one for a legacy request', () => {
    expect(parseIdempotencyKey(null)).toBeUndefined();
    expect(parseIdempotencyKey(key)).toBe(key);
    for (const value of ['', 'tiny', 'a'.repeat(129), 'request key with spaces', 'key\nheader']) {
      expect(() => parseIdempotencyKey(value)).toThrow('INVALID_IDEMPOTENCY_KEY');
    }
  });

  it('refuses non-finite numbers instead of fingerprinting them as null', () => {
    for (const amount of [NaN, Infinity, -Infinity]) {
      expect(() => fingerprintCreateCommand({ amount })).toThrow('INVALID_REQUEST_FINGERPRINT');
    }
  });
});

describe('durable Activity intent', () => {
  it('snapshots the original payload and timestamp', () => {
    const when = new Date('2026-09-16T12:00:00Z');
    const metadata = { description: 'Original', changes: { amount: { old: 10, new: 20 } } };
    const event = makePendingActivity(groupId, 'expense_updated', actorId, metadata, when);
    metadata.description = 'Changed later';
    metadata.changes.amount.new = 99;
    when.setUTCFullYear(2030);

    expect(event.metadata).toEqual({
      description: 'Original',
      changes: { amount: { old: 10, new: 20 } },
    });
    expect(event.occurredAt.toISOString()).toBe('2026-09-16T12:00:00.000Z');
  });

  it('limits pending work without silently dropping old events', () => {
    const event = makePendingActivity(groupId, 'expense_added', actorId);
    expect(() =>
      assertPendingActivityCapacity(Array(PENDING_ACTIVITY_LIMIT - 1).fill(event)),
    ).not.toThrow();
    expect(() => assertPendingActivityCapacity(Array(PENDING_ACTIVITY_LIMIT).fill(event))).toThrow(
      'ACTIVITY_BACKLOG_FULL',
    );
  });
});
