import { withGroupMutation } from '@/lib/group-mutation';
import {
  findGroupDeletion,
  requestGroupDeletion,
  resumeGroupDeletion,
  type GroupDeletionResult,
} from './group-cleanup.service';
import connectDB from '@/lib/db';
import { assertCreateReplay, createRequestMetadata } from '@/lib/financial-write';
import { ensureLedgerWriteIndexes } from '@/lib/ledger-indexes';
import Group from '@/lib/models/Group';
import '@/lib/models/User'; // Ensure User model is registered for populate()
import { activityService } from './activity.service';
import { balanceService } from './balance.service';
import { recurringExpenseService } from './recurring-expense.service';
import { buildDefaultGroupTags } from '@splitbook/shared/default-tags';
import type { AssistantRule } from '@splitbook/shared/assistant-rule';
import type { CreateGroupInput, UpdateGroupInput } from '@splitbook/shared/validators/group';
import crypto from 'crypto';
import { cache } from 'react';
import { tagManagementService } from './tag-management.service';
import Expense from '@/lib/models/Expense';
import RecurringExpense from '@/lib/models/RecurringExpense';
import Settlement from '@/lib/models/Settlement';
import { PERSON_FIELDS } from './person-fields';
import mongoose from 'mongoose';
import { MoneyValidationError } from '@splitbook/shared/exact-money';
import {
  extraCurrenciesProblem,
  normaliseExtraCurrencies,
} from '@splitbook/shared/group-currencies';

/**
 * A Group as its members read it: an older Group's extra currencies as the rule allows them
 * (#719), so reading or saving it never fails on old data.
 */
function withReadableCurrencies<
  T extends { defaultCurrency: string; alternateCurrencies?: unknown },
>(group: T): T & { alternateCurrencies: string[] } {
  return {
    ...group,
    alternateCurrencies: normaliseExtraCurrencies(
      group.defaultCurrency,
      Array.isArray(group.alternateCurrencies) ? group.alternateCurrencies : [],
    ),
  };
}

/** A Group as one member reads it, with where their next Expense starts (#719). */
function readableFor<T extends { defaultCurrency: string; alternateCurrencies?: unknown }>(
  group: T,
  latestExpenseCurrency: string | null,
) {
  return { ...withReadableCurrencies(group), latestExpenseCurrency };
}

/**
 * The currency of each member's latest Expense in these Groups, by Group id: where their next
 * Expense starts (#710). Read from the Expenses; nothing new is stored.
 */
async function latestExpenseCurrencies(
  groupIds: unknown[],
  memberId: string,
): Promise<Map<string, string>> {
  if (!groupIds.length || !mongoose.isValidObjectId(memberId)) return new Map();
  const latest = await Expense.aggregate<{ _id: unknown; currency: string }>([
    {
      $match: {
        group: { $in: groupIds },
        createdBy: new mongoose.Types.ObjectId(memberId),
        isDeleted: { $ne: true },
        // One a recurring Expense added isn't one the member recorded.
        recurringExpense: null,
      },
    },
    { $sort: { createdAt: -1, _id: -1 } },
    { $group: { _id: '$group', currency: { $first: '$currency' } } },
  ]);
  return new Map(latest.map((entry) => [String(entry._id), entry.currency]));
}

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
  /** Request-scoped title read: authorize and project the name in one query. */
  getMemberName = cache(async (groupId: string, userId: string) => {
    await connectDB();
    return Group.findOne({ _id: groupId, 'members.user': userId })
      .select('name -_id')
      .lean<{ name: string }>();
  });

  /** A valid public invitation may name its Group without loading its members. */
  getInviteName = cache(async (code: string) => {
    await connectDB();
    return Group.findOne({
      inviteCode: code,
      inviteCodeExpiresAt: { $gt: new Date() },
      isArchived: false,
    })
      .select('name -_id')
      .lean<{ name: string }>();
  });

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

    return group.populate('members.user', PERSON_FIELDS);
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
    return existing.populate('members.user', PERSON_FIELDS);
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

    const groups = await Group.find(filter)
      .populate('members.user', PERSON_FIELDS)
      .sort({ updatedAt: -1 })
      .lean();
    const latest = await latestExpenseCurrencies(
      groups.map((group) => group._id),
      userId,
    );
    return groups.map((group) => readableFor(group, latest.get(String(group._id)) ?? null));
  }

  /**
   * Get a single group by ID.
   */
  async getById(groupId: string, viewerId?: string) {
    await connectDB();
    const group = await Group.findById(groupId).populate('members.user', PERSON_FIELDS).lean();
    if (!group) return group;
    if (!viewerId) return withReadableCurrencies(group);
    const latest = await latestExpenseCurrencies([group._id], viewerId);
    return readableFor(group, latest.get(String(group._id)) ?? null);
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

    // The Group's currency rule on what the Group will hold (#719): extra currencies sent are
    // checked against its main currency, and a new main currency against those it keeps. An
    // older Group's list is compared and saved as the rule reads it, so cleaning it up never
    // counts as a member's change.
    const mainCurrency = data.defaultCurrency ?? group.defaultCurrency;
    const storedExtras = normaliseExtraCurrencies(group.defaultCurrency, group.alternateCurrencies);
    const extraCurrencies = data.alternateCurrencies ?? storedExtras;
    if (JSON.stringify(extraCurrencies) === JSON.stringify(storedExtras))
      delete changes.alternateCurrencies;
    else changes.alternateCurrencies = { old: storedExtras, new: extraCurrencies };
    const problem = extraCurrenciesProblem(mainCurrency, extraCurrencies);
    /** A refusal of the currencies themselves; a locked main currency is said first. */
    const refuseCurrencies = () => {
      // The Group settings refusal, shown at its field: it shares money refusals' 422 answer.
      if (problem)
        throw new MoneyValidationError('INVALID_GROUP_CURRENCIES', problem, [
          'alternateCurrencies',
        ]);
    };
    data = { ...data, alternateCurrencies: extraCurrencies };

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
      refuseCurrencies();
      // First financial writes set the monotonic lock using the old currency predicate.
      const changed = await withGroupMutation(groupId, async () =>
        Group.findOneAndUpdate(
          {
            _id: groupId,
            defaultCurrency: group.defaultCurrency,
            currencyLocked: { $ne: true },
            members: { $elemMatch: { user: userId, role: 'admin' } },
          },
          { $set: data },
          { returnDocument: 'after', runValidators: true },
        ),
      );
      if (!changed) throw new Error('CURRENCY_LOCKED');
      await activityService.log(groupId, 'group_updated', userId, { changes });
      return this.readAfterUpdate(await changed.populate('members.user', PERSON_FIELDS), userId);
    }
    refuseCurrencies();
    Object.assign(group, data);
    await withGroupMutation(groupId, async () => group.save());

    if (Object.keys(changes).length > 0) {
      await activityService.log(groupId, 'group_updated', userId, { changes });
    }

    return this.readAfterUpdate(await group.populate('members.user', PERSON_FIELDS), userId);
  }

  /** The updated Group as its admin reads it, so the answer replaces their read whole (#719). */
  private async readAfterUpdate(group: InstanceType<typeof Group>, viewerId: string) {
    const latest = await latestExpenseCurrencies([group._id], viewerId);
    return readableFor(group.toJSON(), latest.get(String(group._id)) ?? null);
  }

  /**
   * Set whether members' Connected assistants may reach the Group (#621). Only admins set it, and
   * only a change is recorded: one Activity event naming the rule, in the same write.
   */
  async setAssistantRule(groupId: string, rule: AssistantRule, userId: string) {
    await connectDB();
    const admin = { members: { $elemMatch: { user: userId, role: 'admin' } } };
    // A Group stored without a rule is Allowed.
    const otherRule = rule === 'allowed' ? 'not_allowed' : { $ne: 'not_allowed' };
    const changed = await withGroupMutation(groupId, async () => {
      const group = await Group.findOneAndUpdate(
        { _id: groupId, ...admin, assistantRule: otherRule },
        { $set: { assistantRule: rule, assistantRuleSetBy: userId } },
      );
      if (group) await activityService.log(groupId, 'assistant_rule_changed', userId, { rule });
      return !!group;
    });
    if (!changed && !(await Group.exists({ _id: groupId, ...admin }))) throw new Error('FORBIDDEN');
    return { rule };
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
    await withGroupMutation(groupId, async () => group.save());

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
    await withGroupMutation(groupId, async () => group.save());

    await activityService.log(groupId, 'member_joined', userId, {
      userId,
      method: method || 'invite',
    });

    return group.populate('members.user', PERSON_FIELDS);
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
    await withGroupMutation(groupId, async () => group.save());

    await activityService.log(groupId, 'group_updated', actorId, {
      changes: {
        memberRole: {
          old: { userId: targetUserId, role: previousRole },
          new: { userId: targetUserId, role: newRole },
        },
      },
    });

    return group.populate('members.user', PERSON_FIELDS);
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
    await withGroupMutation(groupId, async () => group.save());

    await activityService.log(groupId, 'member_left', actorId, {
      userId: targetUserId,
      method: 'removed',
    });

    return group.populate('members.user', PERSON_FIELDS);
  }

  /**
   * The member leaves the Group. They must be settled up in every currency,
   * counting the recurring Expenses already due, which are added first. The
   * last admin must hand over first. The last member must explicitly consent
   * to permanently deleting the Group and its history.
   * Returns null when the Group doesn't exist.
   */
  async leave(
    groupId: string,
    actorId: string,
    deleteIfLastMember = false,
  ): Promise<{ archived: boolean } | GroupDeletionResult | null> {
    await connectDB();

    const previous = await findGroupDeletion(groupId, actorId);
    if (previous) {
      if (!deleteIfLastMember) throw new Error('GROUP_DELETION_CONFIRMATION_REQUIRED');
      return resumeGroupDeletion(groupId);
    }
    // A concurrent join or leave can change who remains between the read and
    // the conditional update; the update then matches nothing and we decide again.
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const group = await Group.findById(groupId).select('members isArchived').lean();
      if (!group) return null;

      const self = group.members.find((m) => m.user.toString() === actorId);
      if (!self) throw new Error('FORBIDDEN');
      const others = group.members.filter((m) => m.user.toString() !== actorId);

      if (others.length === 0) {
        if (!deleteIfLastMember) throw new Error('GROUP_DELETION_CONFIRMATION_REQUIRED');
        return requestGroupDeletion(groupId, actorId);
      }

      if (self.role === 'admin' && !others.some((m) => m.role === 'admin')) {
        throw new LeaveBlockedError('LAST_ADMIN');
      }

      // Balances follow Expense reads: add the recurring Expenses already due before
      // checking, and never let the member go on a run that may have missed one.
      const due = await recurringExpenseService.materializeDueExpenses(groupId);
      if (!due.complete) throw new Error('LEAVE_CONFLICT');

      const open = await balanceService.getMemberOpenBalances(groupId, actorId);
      if (open.length > 0) throw new LeaveBlockedError('OPEN_BALANCE', open);

      // An admin may leave only while another admin remains at the moment of the update.
      const stillHandedOver =
        self.role === 'admin'
          ? { members: { $elemMatch: { role: 'admin', user: { $ne: actorId } } } }
          : { 'members.1': { $exists: true } };
      const left = await withGroupMutation(groupId, async () =>
        Group.findOneAndUpdate(
          { $and: [{ _id: groupId }, { 'members.user': actorId }, stillHandedOver] },
          // The version bump makes a role change or removal loaded before this leave fail
          // instead of writing to a shifted member index.
          { $pull: { members: { user: actorId } }, $inc: { __v: 1 } },
        ),
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

  /** Internal adapters retain the existing fixture interface; HTTP callers must supply commands. */
  async addTag(groupId: string, name: string, userId: string) {
    await tagManagementService.submit(groupId, userId, {
      requestId: crypto.randomUUID(),
      intent: { action: 'create', name: name.trim() },
    });
    return Group.findById(groupId).populate('members.user', PERSON_FIELDS);
  }

  async updateTag(
    groupId: string,
    tagId: string,
    data: { name?: string; isArchived?: boolean },
    userId: string,
  ) {
    const current = await tagManagementService.snapshot(groupId, userId);
    const tag = current.tags.find((candidate) => candidate.id === tagId && !candidate.isDeleted);
    if (!tag) return null;
    if ((data.name !== undefined) === (data.isArchived !== undefined))
      throw new Error('INVALID_TAG');
    const intent =
      data.name !== undefined
        ? {
            action: 'rename' as const,
            tagId,
            expectedRevision: tag.revision,
            name: data.name.trim(),
          }
        : {
            action: data.isArchived ? ('archive' as const) : ('restore' as const),
            tagId,
            expectedRevision: tag.revision,
          };
    await tagManagementService.submit(groupId, userId, { requestId: crypto.randomUUID(), intent });
    return Group.findById(groupId).populate('members.user', PERSON_FIELDS);
  }

  async deleteTag(groupId: string, tagId: string, userId: string) {
    const current = await tagManagementService.snapshot(groupId, userId);
    const tag = current.tags.find((candidate) => candidate.id === tagId && !candidate.isDeleted);
    if (!tag) return null;
    await tagManagementService.submit(groupId, userId, {
      requestId: crypto.randomUUID(),
      intent: { action: 'delete', tagId, expectedRevision: tag.revision },
    });
    return Group.findById(groupId).populate('members.user', PERSON_FIELDS);
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
    await withGroupMutation(groupId, async () => group.save());

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
      .populate('members.user', PERSON_FIELDS)
      .lean()
      .then((group) => group && withReadableCurrencies(group));
  }
}

export const groupService = new GroupService();
