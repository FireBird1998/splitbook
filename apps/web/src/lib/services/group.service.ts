import connectDB from '@/lib/db';
import { assertCreateReplay, createRequestMetadata } from '@/lib/financial-write';
import { ensureLedgerWriteIndexes } from '@/lib/ledger-indexes';
import Group from '@/lib/models/Group';
import '@/lib/models/User'; // Ensure User model is registered for populate()
import { activityService } from './activity.service';
import { balanceService } from './balance.service';
import { buildDefaultGroupTags } from '@splitbook/shared/default-tags';
import type { CreateGroupInput, UpdateGroupInput } from '@splitbook/shared/validators/group';
import crypto from 'crypto';
import { escapeRegex } from '@splitbook/shared/escape-regex';
import Expense from '@/lib/models/Expense';
import RecurringExpense from '@/lib/models/RecurringExpense';
import Settlement from '@/lib/models/Settlement';

/** Why a member can't leave yet: an open balance, or they are the last admin. */
export class LeaveBlockedError extends Error {
  constructor(
    readonly code: 'OPEN_BALANCE' | 'LAST_ADMIN',
    /** For OPEN_BALANCE: the member's non-zero balance in each currency, in minor units. */
    readonly balances: { currency: string; amountMinor: number }[] = [],
  ) {
    super(code);
    this.name = 'LeaveBlockedError';
  }
}

export class GroupService {
  /**
   * Create a new group. The creator becomes the admin.
   * Seeds active default tags so the first expense is never blocked.
   */
  async create(data: CreateGroupInput, userId: string, requestKey?: string) {
    await connectDB();

    if (requestKey) {
      await ensureLedgerWriteIndexes();
      const replay = await this.findCreated(userId, requestKey, data);
      if (replay) return replay;
    }

    let group;
    try {
      group = await Group.create({
        ...data,
        createdBy: userId,
        members: [
          {
            user: userId,
            role: 'admin',
            joinedAt: new Date(),
          },
        ],
        tags: buildDefaultGroupTags(data.category),
        ...(requestKey ? { creationRequest: createRequestMetadata(requestKey, data) } : {}),
      });
    } catch (err) {
      // A concurrent request with the same key committed first.
      if (requestKey && (err as { code?: number }).code === 11000) {
        const existing = await this.findCreated(userId, requestKey, data);
        if (existing) return existing;
      }
      throw err;
    }

    // Log activity
    await activityService.log(group._id.toString(), 'group_created', userId, {
      groupName: group.name,
    });

    return group.populate('members.user', 'name email image');
  }

  /** The Group an earlier request with this key created, if the same creator sent the same data. */
  private async findCreated(userId: string, requestKey: string, data: CreateGroupInput) {
    const existing = await Group.findOne({
      createdBy: userId,
      'creationRequest.key': requestKey,
    }).select('+creationRequest');
    if (!existing) return null;
    assertCreateReplay(existing.creationRequest!, data);
    // A replay must not reveal a Group the creator no longer belongs to.
    if (!existing.members.some((member) => member.user.toString() === userId))
      throw new Error('FORBIDDEN');
    return existing.populate('members.user', 'name email image');
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

    if (data.defaultCurrency && data.defaultCurrency !== group.defaultCurrency) {
      const hasRecords =
        group.currencyLocked ||
        (
          await Promise.all([
            Expense.exists({ group: groupId }),
            Settlement.exists({ group: groupId }),
            RecurringExpense.exists({ group: groupId }),
          ])
        ).some(Boolean);
      if (hasRecords) throw new Error('CURRENCY_LOCKED');
      // First financial writes set the monotonic lock using the old currency predicate.
      const changed = await Group.findOneAndUpdate(
        {
          _id: groupId,
          defaultCurrency: group.defaultCurrency,
          currencyLocked: { $ne: true },
          members: { $elemMatch: { user: userId, role: 'admin' } },
        },
        { $set: data },
        { returnDocument: 'after', runValidators: true },
      );
      if (!changed) throw new Error('CURRENCY_LOCKED');
      await activityService.log(groupId, 'group_updated', userId, { changes });
      return changed.populate('members.user', 'name email image');
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

    const previousRole = target.role;
    target.role = newRole;
    await group.save();

    await activityService.log(groupId, 'group_updated', actorId, {
      changes: {
        memberRole: {
          old: { userId: targetUserId, role: previousRole },
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

  /**
   * The member leaves the Group. They must be settled up in every currency,
   * and the last admin must hand over first. The last member's leaving also
   * archives the Group, since nobody would be left to reach it.
   * Returns null when the Group doesn't exist.
   */
  async leave(groupId: string, actorId: string): Promise<{ archived: boolean } | null> {
    await connectDB();

    // A concurrent join or leave can change who remains between the read and
    // the conditional update; the update then matches nothing and we decide again.
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const group = await Group.findById(groupId).select('members isArchived').lean();
      if (!group) return null;

      const self = group.members.find((m) => m.user.toString() === actorId);
      if (!self) throw new Error('FORBIDDEN');
      const others = group.members.filter((m) => m.user.toString() !== actorId);

      if (others.length === 0) {
        // Nobody is left to settle with or to hand over to, so the Group is archived.
        const left = await Group.findOneAndUpdate(
          { _id: groupId, 'members.user': actorId, members: { $size: 1 } },
          { $pull: { members: { user: actorId } }, $set: { isArchived: true } },
        );
        if (!left) continue;
        await activityService.log(groupId, 'member_left', actorId, {
          userId: actorId,
          method: 'left',
        });
        if (!group.isArchived) {
          await activityService.log(groupId, 'group_updated', actorId, {
            changes: { isArchived: { old: false, new: true } },
          });
        }
        return { archived: true };
      }

      if (self.role === 'admin' && !others.some((m) => m.role === 'admin')) {
        throw new LeaveBlockedError('LAST_ADMIN');
      }

      const open = await balanceService.getMemberOpenBalances(groupId, actorId);
      if (open.length > 0) throw new LeaveBlockedError('OPEN_BALANCE', open);

      // An admin may leave only while another admin remains at the moment of the update.
      const stillHandedOver =
        self.role === 'admin'
          ? { members: { $elemMatch: { role: 'admin', user: { $ne: actorId } } } }
          : { 'members.1': { $exists: true } };
      const left = await Group.findOneAndUpdate(
        { $and: [{ _id: groupId }, { 'members.user': actorId }, stillHandedOver] },
        { $pull: { members: { user: actorId } } },
      );
      if (!left) continue;

      await activityService.log(groupId, 'member_left', actorId, {
        userId: actorId,
        method: 'left',
      });
      return { archived: false };
    }
    throw new Error('LEAVE_CONFLICT');
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
    if (!normalised || name.trim().length > 50) throw new Error('INVALID_TAG');
    const exists = (group.tags || []).some(
      (t) => !t.isDeleted && t.name.toLowerCase() === normalised,
    );
    if (exists) {
      throw new Error('TAG_EXISTS');
    }

    // Atomic $push directly to MongoDB
    const updated = await Group.findOneAndUpdate(
      {
        _id: groupId,
        members: { $elemMatch: { user: userId, role: 'admin' } },
        tags: {
          $not: {
            $elemMatch: {
              name: new RegExp(`^${escapeRegex(name.trim())}$`, 'i'),
              isDeleted: { $ne: true },
            },
          },
        },
      },
      {
        $push: {
          tags: {
            name: name.trim(),
            isArchived: false,
            createdAt: new Date(),
          },
        },
      },
      { returnDocument: 'after' },
    ).populate('members.user', 'name email image');

    if (!updated) throw new Error('TAG_EXISTS');
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

    const tag = (group.tags || []).find((t) => t._id.toString() === tagId && !t.isDeleted);
    if (!tag) return null;

    // If renaming, check uniqueness
    if (data.name !== undefined) {
      const normalised = data.name.trim().toLowerCase();
      if (!normalised || data.name.trim().length > 50) throw new Error('INVALID_TAG');
      const duplicate = (group.tags || []).some(
        (t) => !t.isDeleted && t._id.toString() !== tagId && t.name.toLowerCase() === normalised,
      );
      if (duplicate) {
        throw new Error('TAG_EXISTS');
      }
      // Preserve unambiguous pre-migration references before changing display text.
      // No monetary values, timestamps or audit history are rewritten.
      if (data.name.trim() !== tag.name) {
        const legacy = { group: group._id, tagId: null, tag: tag.name };
        if (group.tags.filter((candidate) => candidate.name === tag.name).length !== 1) {
          const [legacyExpense, legacyTemplate] = await Promise.all([
            Expense.exists(legacy),
            RecurringExpense.exists(legacy),
          ]);
          if (legacyExpense || legacyTemplate) throw new Error('AMBIGUOUS_TAG');
        } else {
          await Promise.all([
            Expense.collection.updateMany(legacy, { $set: { tagId: tag._id } }),
            RecurringExpense.collection.updateMany(legacy, { $set: { tagId: tag._id } }),
          ]);
        }
      }
    }

    // Build $set for the matched array element
    const setFields: Record<string, unknown> = {};
    if (data.name !== undefined) setFields['tags.$[tag].name'] = data.name.trim();
    if (data.isArchived !== undefined) setFields['tags.$[tag].isArchived'] = data.isArchived;

    const noDuplicate =
      data.name === undefined
        ? {}
        : {
            tags: {
              $not: {
                $elemMatch: {
                  _id: { $ne: tag._id },
                  name: new RegExp(`^${escapeRegex(data.name.trim())}$`, 'i'),
                  isDeleted: { $ne: true },
                },
              },
            },
          };

    const updated = await Group.findOneAndUpdate(
      {
        _id: groupId,
        members: { $elemMatch: { user: userId, role: 'admin' } },
        $and: [
          { tags: { $elemMatch: { _id: tag._id, name: tag.name, isDeleted: { $ne: true } } } },
          noDuplicate,
        ],
      },
      { $set: setFields },
      { returnDocument: 'after', arrayFilters: [{ 'tag._id': tag._id }] },
    ).populate('members.user', 'name email image');

    if (!updated) throw new Error('TAG_CHANGED');
    return updated;
  }

  /**
   * Retire an unused Tag, retaining its identity for in-flight historical writes.
   * Expenses (including deleted ones) and recurring templates block deletion.
   * Only admins can do this.
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

    const tag = (group.tags || []).find((t) => t._id.toString() === tagId && !t.isDeleted);
    if (!tag) return null;

    // Check if any expenses use this tag
    const reference = {
      group: groupId,
      $or: [{ tagId: tag._id }, { tagId: null, tag: tag.name }],
    };
    const [expenseCount, templateCount] = await Promise.all([
      Expense.countDocuments(reference),
      RecurringExpense.countDocuments(reference),
    ]);
    const usageCount = expenseCount + templateCount;

    if (usageCount > 0) {
      throw new Error(`TAG_IN_USE:${expenseCount}:${templateCount}`);
    }

    // Retain identity even if a write admitted before deletion finishes later.
    // Such a write keeps a readable historical Tag; subsequent selection fails.
    const updated = await Group.findOneAndUpdate(
      { _id: groupId, members: { $elemMatch: { user: userId, role: 'admin' } }, 'tags._id': tagId },
      { $set: { 'tags.$.isDeleted': true, 'tags.$.isArchived': true } },
      { returnDocument: 'after' },
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
