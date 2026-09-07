import connectDB from '@/lib/db';
import Activity from '@/lib/models/Activity';
import type { ActivityType } from '@splitbook/shared/types';

export class ActivityService {
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
    const skip = (page - 1) * limit;

    const [activities, total] = await Promise.all([
      Activity.find({ group: groupId })
        .sort({ createdAt: -1 })
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
