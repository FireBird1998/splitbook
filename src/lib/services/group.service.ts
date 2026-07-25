import connectDB from '@/lib/db';
import Group from '@/lib/models/Group';
import '@/lib/models/User'; // Ensure User model is registered for populate()
import { activityService } from './activity.service';
import { buildDefaultGroupTags } from '@/lib/constants/default-tags';
import type { CreateGroupInput, UpdateGroupInput } from '@/lib/validators/group.validator';
import crypto from 'crypto';

export class GroupService {
  /**
   * Create a new group. The creator becomes the admin.
   * Seeds active default tags so the first expense is never blocked.
   */
  async create(data: CreateGroupInput, userId: string) {
    await connectDB();

    const group = await Group.create({
      ...data,
      createdBy: userId,
      members: [
        {
          user: userId,
          role: 'admin',
          joinedAt: new Date(),
        },
      ],
      tags: buildDefaultGroupTags(),
    });

    // Log activity
    await activityService.log(group._id.toString(), 'group_created', userId, {
      groupName: group.name,
    });

    return group.populate('members.user', 'name email image');
  }

  /**
   * Get all groups the user is a member of.
   */
  async getUserGroups(userId: string, includeArchived: boolean = false) {
    await connectDB();

    const filter: Record<string, unknown> = {
      'members.user': userId,
    };
    if (!includeArchived) {
      filter.isArchived = false;
    }

    return Group.find(filter)
      .populate('members.user', 'name email image')
      .sort({ updatedAt: -1 })
      .lean();
  }

  /**
   * Get a single group by ID.
   */
  async getById(groupId: string) {
    await connectDB();
    return Group.findById(groupId).populate('members.user', 'name email image').lean();
  }

  /**
   * Update group details. Only admins can update.
   */
  async update(groupId: string, data: UpdateGroupInput, userId: string) {
    await connectDB();

    const group = await Group.findById(groupId);
    if (!group) return null;

    // Check admin permission
    const member = group.members.find((m) => m.user.toString() === userId);
    if (!member || member.role !== 'admin') {
      throw new Error('FORBIDDEN');
    }

    // Track changes for activity log
    const changes: Record<string, { old: unknown; new: unknown }> = {};
    for (const [key, value] of Object.entries(data)) {
      const oldValue = (group as unknown as Record<string, unknown>)[key];
      if (JSON.stringify(oldValue) !== JSON.stringify(value)) {
        changes[key] = { old: oldValue, new: value };
      }
    }

    Object.assign(group, data);
    await group.save();

    if (Object.keys(changes).length > 0) {
      await activityService.log(groupId, 'group_updated', userId, { changes });
    }

    return group.populate('members.user', 'name email image');
  }

  /**
   * Archive a group (soft delete).
   */
  async archive(groupId: string, userId: string) {
    await connectDB();

    const group = await Group.findById(groupId);
    if (!group) return null;

    const member = group.members.find((m) => m.user.toString() === userId);
    if (!member || member.role !== 'admin') {
      throw new Error('FORBIDDEN');
    }

    group.isArchived = true;
    await group.save();

    await activityService.log(groupId, 'group_updated', userId, {
      changes: { isArchived: { old: false, new: true } },
    });

    return group;
  }

  /**
   * Check if a user is a member of a group.
   */
  async isMember(groupId: string, userId: string): Promise<boolean> {
    await connectDB();
    const group = await Group.findOne({
      _id: groupId,
      'members.user': userId,
    }).lean();
    return !!group;
  }

  /**
   * Add a member to a group.
   */
  async addMember(
    groupId: string,
    userId: string,
    role: 'admin' | 'member' = 'member',
    addedBy?: string,
    method?: string,
  ) {
    await connectDB();

    const group = await Group.findById(groupId);
    if (!group) return null;

    // Check if already a member
    const existing = group.members.find((m) => m.user.toString() === userId);
    if (existing) return group;

    group.members.push({
      user: userId as unknown as import('mongoose').Types.ObjectId,
      role,
      joinedAt: new Date(),
    });
    await group.save();

    await activityService.log(groupId, 'member_joined', userId, {
      userId,
      method: method || 'invite',
    });

    return group.populate('members.user', 'name email image');
  }

  /**
   * Update a member's role. Only admins can do this.
   * Cannot demote the last admin.
   */
  async updateMemberRole(
    groupId: string,
    targetUserId: string,
    newRole: 'admin' | 'member',
    actorId: string,
  ) {
    await connectDB();

    const group = await Group.findById(groupId);
    if (!group) return null;

    // Check admin permission
    const actor = group.members.find((m) => m.user.toString() === actorId);
    if (!actor || actor.role !== 'admin') {
      throw new Error('FORBIDDEN');
    }

    const target = group.members.find((m) => m.user.toString() === targetUserId);
    if (!target) return null;

    // Prevent demoting the last admin
    if (newRole === 'member' && target.role === 'admin') {
      const adminCount = group.members.filter((m) => m.role === 'admin').length;
      if (adminCount <= 1) {
        throw new Error('LAST_ADMIN');
      }
    }

    target.role = newRole;
    await group.save();

    await activityService.log(groupId, 'group_updated', actorId, {
      changes: {
        memberRole: {
          old: { userId: targetUserId, role: target.role },
          new: { userId: targetUserId, role: newRole },
        },
      },
    });

    return group.populate('members.user', 'name email image');
  }

  /**
   * Remove a member from the group. Only admins can do this.
   * Cannot remove the last admin, cannot remove self (use leave instead).
   */
  async removeMember(groupId: string, targetUserId: string, actorId: string) {
    await connectDB();

    const group = await Group.findById(groupId);
    if (!group) return null;

    // Check admin permission
    const actor = group.members.find((m) => m.user.toString() === actorId);
    if (!actor || actor.role !== 'admin') {
      throw new Error('FORBIDDEN');
    }

    // Prevent self-removal
    if (targetUserId === actorId) {
      throw new Error('SELF_REMOVE');
    }

    const target = group.members.find((m) => m.user.toString() === targetUserId);
    if (!target) return null;

    // Prevent removing the last admin
    if (target.role === 'admin') {
      const adminCount = group.members.filter((m) => m.role === 'admin').length;
      if (adminCount <= 1) {
        throw new Error('LAST_ADMIN');
      }
    }

    group.members = group.members.filter(
      (m) => m.user.toString() !== targetUserId,
    ) as typeof group.members;
    await group.save();

    await activityService.log(groupId, 'member_left', actorId, {
      userId: targetUserId,
      method: 'removed',
    });

    return group.populate('members.user', 'name email image');
  }

  // ─── Tag Management ─────────────────────────────────

  /**
   * Add a new tag to the group. Only admins can do this.
   * Tag names must be unique (case-insensitive) within a group.
   * Uses atomic $push to avoid Mongoose change-tracking issues.
   */
  async addTag(groupId: string, name: string, userId: string) {
    await connectDB();

    const group = await Group.findById(groupId).lean();
    if (!group) return null;

    // Check admin permission
    const member = group.members.find((m) => m.user.toString() === userId);
    if (!member || member.role !== 'admin') {
      throw new Error('FORBIDDEN');
    }

    // Check for duplicate tag name (case-insensitive)
    const normalised = name.trim().toLowerCase();
    const exists = (group.tags || []).some((t) => t.name.toLowerCase() === normalised);
    if (exists) {
      throw new Error('TAG_EXISTS');
    }

    // Atomic $push directly to MongoDB
    const updated = await Group.findByIdAndUpdate(
      groupId,
      {
        $push: {
          tags: {
            name: name.trim(),
            isArchived: false,
            createdAt: new Date(),
          },
        },
      },
      { new: true },
    ).populate('members.user', 'name email image');

    return updated;
  }

  /**
   * Update a tag (archive/unarchive or rename). Only admins can do this.
   * Uses positional $ operator for atomic subdocument update.
   */
  async updateTag(
    groupId: string,
    tagId: string,
    data: { name?: string; isArchived?: boolean },
    userId: string,
  ) {
    await connectDB();

    const group = await Group.findById(groupId).lean();
    if (!group) return null;

    // Check admin permission
    const member = group.members.find((m) => m.user.toString() === userId);
    if (!member || member.role !== 'admin') {
      throw new Error('FORBIDDEN');
    }

    const tag = (group.tags || []).find((t) => t._id.toString() === tagId);
    if (!tag) return null;

    // If renaming, check uniqueness
    if (data.name !== undefined) {
      const normalised = data.name.trim().toLowerCase();
      const duplicate = (group.tags || []).some(
        (t) => t._id.toString() !== tagId && t.name.toLowerCase() === normalised,
      );
      if (duplicate) {
        throw new Error('TAG_EXISTS');
      }
    }

    // Build $set for the matched array element
    const setFields: Record<string, unknown> = {};
    if (data.name !== undefined) setFields['tags.$.name'] = data.name.trim();
    if (data.isArchived !== undefined) setFields['tags.$.isArchived'] = data.isArchived;

    const updated = await Group.findOneAndUpdate(
      { _id: groupId, 'tags._id': tagId },
      { $set: setFields },
      { new: true },
    ).populate('members.user', 'name email image');

    return updated;
  }

  /**
   * Delete a tag. Only allowed if no expenses reference it.
   * Only admins can do this. Uses atomic $pull.
   */
  async deleteTag(groupId: string, tagId: string, userId: string) {
    await connectDB();

    const group = await Group.findById(groupId).lean();
    if (!group) return null;

    // Check admin permission
    const member = group.members.find((m) => m.user.toString() === userId);
    if (!member || member.role !== 'admin') {
      throw new Error('FORBIDDEN');
    }

    const tag = (group.tags || []).find((t) => t._id.toString() === tagId);
    if (!tag) return null;

    // Check if any expenses use this tag
    const { default: Expense } = await import('@/lib/models/Expense');
    const usageCount = await Expense.countDocuments({
      group: groupId,
      tag: tag.name,
    });

    if (usageCount > 0) {
      throw new Error(`TAG_IN_USE:${usageCount}`);
    }

    // Atomic $pull directly from MongoDB
    const updated = await Group.findByIdAndUpdate(
      groupId,
      { $pull: { tags: { _id: tagId } } },
      { new: true },
    ).populate('members.user', 'name email image');

    return updated;
  }

  /**
   * Generate an invite code for the group.
   */
  async generateInviteCode(groupId: string, userId: string, expiresInDays: number = 7) {
    await connectDB();

    const group = await Group.findById(groupId);
    if (!group) return null;

    const member = group.members.find((m) => m.user.toString() === userId);
    if (!member) throw new Error('FORBIDDEN');

    const inviteCode = crypto.randomBytes(4).toString('hex'); // 8-char hex
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + expiresInDays);

    group.inviteCode = inviteCode;
    group.inviteCodeExpiresAt = expiresAt;
    await group.save();

    return {
      inviteCode,
      inviteUrl: `${process.env.NEXT_PUBLIC_APP_URL}/join/${inviteCode}`,
      expiresAt,
    };
  }

  /**
   * Find a group by invite code.
   */
  async findByInviteCode(code: string) {
    await connectDB();
    return Group.findOne({
      inviteCode: code,
      inviteCodeExpiresAt: { $gt: new Date() },
      isArchived: false,
    })
      .populate('members.user', 'name email image')
      .lean();
  }
}

export const groupService = new GroupService();
