import connectDB from '@/lib/db';
import Activity from '@/lib/models/Activity';
import mongoose, { Types } from 'mongoose';
import { fingerprintCreateCommand, type IPendingActivity } from '@/lib/financial-write';
import type { ActivityType } from '@splitbook/shared/types';

export type ActivitySource = 'expenses' | 'settlements';

export interface ActivityRecoveryBudget {
  maxDocuments?: number;
  maxEvents?: number;
  maxDurationMs?: number;
}

export interface ActivityPublicationResult {
  published: number;
  failed: number;
  remaining: number;
}

interface PendingActivitySource {
  _id: Types.ObjectId;
  group: Types.ObjectId;
  pendingActivity?: IPendingActivity[];
}

function bounded(value: number | undefined, fallback: number, maximum: number): number {
  return value !== undefined && Number.isFinite(value)
    ? Math.max(1, Math.min(maximum, Math.floor(value)))
    : fallback;
}

function recoveryBudget(budget: ActivityRecoveryBudget) {
  return {
    maxDocuments: bounded(budget.maxDocuments, 25, 100),
    maxEvents: bounded(budget.maxEvents, 50, 100),
    maxDurationMs: bounded(budget.maxDurationMs, 1_000, 5_000),
  };
}

function activityPayload(event: IPendingActivity) {
  return {
    group: event.group,
    type: event.type,
    actor: event.actor,
    metadata: event.metadata,
    createdAt: event.occurredAt,
  };
}

export class ActivityService {
  /**
   * Persist an immutable event once, then acknowledge its embedded intent. The two
   * writes deliberately remain separately retryable on standalone MongoDB.
   */
  private async publishOne(
    source: ActivitySource,
    recordId: string | Types.ObjectId,
    event: IPendingActivity,
    deadline: number,
  ) {
    const maxTimeMS = () => Math.max(1, Math.min(500, deadline - Date.now()));
    const payload = activityPayload(event);
    try {
      await Activity.updateOne(
        { _id: event._id },
        { $setOnInsert: payload },
        { upsert: true, runValidators: true, timestamps: false, maxTimeMS: maxTimeMS() },
      );
    } catch (err) {
      // Concurrent upserts may race on _id. Only acknowledge the same immutable event.
      if (typeof err !== 'object' || err === null || (err as { code?: unknown }).code !== 11000) {
        throw err;
      }
      const existing = await Activity.findById(event._id).maxTimeMS(maxTimeMS()).lean();
      if (
        !existing ||
        fingerprintCreateCommand({
          group: existing.group,
          type: existing.type,
          actor: existing.actor,
          metadata: existing.metadata,
          createdAt: existing.createdAt,
        }) !== fingerprintCreateCommand(payload)
      ) {
        throw err;
      }
    }

    const db = mongoose.connection.db;
    if (!db) throw new Error('Activity database is not connected');
    // Raw maintenance update avoids Mongoose timestamps and business-revision changes.
    // Pulling exactly one event is safe alongside an editor appending a different one.
    await db
      .collection<PendingActivitySource>(source)
      .updateOne(
        { _id: new Types.ObjectId(recordId), group: event.group },
        { $pull: { pendingActivity: { _id: event._id } } },
        { maxTimeMS: maxTimeMS() },
      );
  }

  /**
   * Call only after the ledger mutation and its pending events have committed.
   * Projection trouble must never turn that committed write into a failed request.
   */
  async publishPending(
    source: ActivitySource,
    recordId: string | Types.ObjectId,
    events: readonly IPendingActivity[],
    budget: ActivityRecoveryBudget = {},
  ): Promise<ActivityPublicationResult> {
    const limits = recoveryBudget(budget);
    const deadline = Date.now() + limits.maxDurationMs;
    const result = { published: 0, failed: 0, remaining: events.length };
    if (events.length === 0) return result;

    try {
      await connectDB();
      for (const event of events.slice(0, limits.maxEvents)) {
        if (Date.now() >= deadline) break;
        try {
          await this.publishOne(source, recordId, event, deadline);
          result.published += 1;
          result.remaining -= 1;
        } catch (err) {
          result.failed += 1;
          console.error(`Activity publication failed for ${source}/${recordId}/${event._id}`, err);
        }
      }
    } catch (err) {
      result.failed += 1;
      console.error(`Activity publication could not connect for ${source}/${recordId}`, err);
    }
    return result;
  }

  /** Repair a bounded amount of pending work before serving this Group's activity feed. */
  async recoverGroupActivity(
    groupId: string,
    budget: ActivityRecoveryBudget = {},
  ): Promise<ActivityPublicationResult> {
    const limits = recoveryBudget(budget);
    const deadline = Date.now() + limits.maxDurationMs;
    const result = { published: 0, failed: 0, remaining: 0 };
    let documents = 0;
    let attempted = 0;

    try {
      await connectDB();
      const db = mongoose.connection.db;
      if (!db) return result;

      // Reserve document capacity for both collections in an ordinary recovery pass.
      for (const source of ['expenses', 'settlements'] as const) {
        if (
          documents >= limits.maxDocuments ||
          attempted >= limits.maxEvents ||
          Date.now() >= deadline
        ) {
          break;
        }
        const sourceLimit =
          source === 'expenses'
            ? Math.ceil(limits.maxDocuments / 2)
            : limits.maxDocuments - documents;
        const pending = await db
          .collection<PendingActivitySource>(source)
          .find({ group: new Types.ObjectId(groupId), 'pendingActivity.0': { $exists: true } })
          .project<PendingActivitySource>({
            _id: 1,
            group: 1,
            pendingActivity: { $slice: limits.maxEvents },
          })
          .sort({ _id: 1 })
          .limit(sourceLimit)
          .maxTimeMS(Math.max(1, Math.min(500, deadline - Date.now())))
          .toArray();

        for (const record of pending) {
          documents += 1;
          const events = record.pendingActivity ?? [];
          result.remaining += events.length;
          for (const event of events) {
            if (attempted >= limits.maxEvents || Date.now() >= deadline) break;
            attempted += 1;
            try {
              await this.publishOne(source, record._id, event, deadline);
              result.published += 1;
              result.remaining -= 1;
            } catch (err) {
              result.failed += 1;
              console.error(
                `Activity recovery failed for ${source}/${record._id}/${event._id}`,
                err,
              );
            }
          }
          if (attempted >= limits.maxEvents || Date.now() >= deadline) break;
        }
      }
    } catch (err) {
      result.failed += 1;
      console.error(`Activity recovery could not complete for group ${groupId}`, err);
    }
    return result;
  }

  /**
   * Log an activity in a group.
   */
  async log(
    groupId: string,
    type: ActivityType,
    actorId: string,
    metadata: Record<string, unknown> = {},
  ) {
    await connectDB();
    return Activity.create({
      group: groupId,
      type,
      actor: actorId,
      metadata,
    });
  }

  /**
   * Get paginated activity feed for a group.
   */
  async getGroupActivity(groupId: string, page: number = 1, limit: number = 20) {
    await connectDB();
    await this.recoverGroupActivity(groupId);
    const skip = (page - 1) * limit;

    const [activities, total] = await Promise.all([
      Activity.find({ group: groupId })
        .sort({ createdAt: -1, _id: -1 })
        .skip(skip)
        .limit(limit)
        .populate('actor', 'name email image')
        .lean(),
      Activity.countDocuments({ group: groupId }),
    ]);

    return {
      activities,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  }
}

export const activityService = new ActivityService();
