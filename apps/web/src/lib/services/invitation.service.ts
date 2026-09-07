import connectDB from '@/lib/db';
import Invitation from '@/lib/models/Invitation';
import Group from '@/lib/models/Group';
import { activityService } from './activity.service';
import { invitationEmailMatches } from './invitation-ownership';
import crypto from 'crypto';

export class InvitationService {
  /**
   * Create an email invitation.
   */
  async create(groupId: string, email: string, invitedById: string) {
    await connectDB();

    // Check if already a member
    const group = await Group.findById(groupId);
    if (!group) throw new Error('Group not found');

    // Check for existing pending invitation
    const existing = await Invitation.findOne({
      group: groupId,
      invitedEmail: email.toLowerCase(),
      status: 'pending',
      expiresAt: { $gt: new Date() },
    });

    if (existing) {
      throw new Error('ALREADY_INVITED');
    }

    const token = crypto.randomBytes(16).toString('hex');
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 7); // 7 day expiry

    const invitation = await Invitation.create({
      group: groupId,
      invitedBy: invitedById,
      invitedEmail: email.toLowerCase(),
      token,
      expiresAt,
    });

    return invitation.populate([
      { path: 'group', select: 'name category' },
      { path: 'invitedBy', select: 'name email image' },
    ]);
  }

  /**
   * Get pending invitations for a user's email.
   */
  async getPendingByEmail(email: string) {
    await connectDB();
    return Invitation.find({
      invitedEmail: email.toLowerCase(),
      status: 'pending',
      expiresAt: { $gt: new Date() },
    })
      .populate('group', 'name category members')
      .populate('invitedBy', 'name email image')
      .sort({ createdAt: -1 })
      .lean();
  }

  /**
   * Accept an invitation.
   */
  async accept(invitationId: string, userId: string, userEmail: string) {
    await connectDB();

    const invitation = await Invitation.findById(invitationId);
    if (!invitation) return null;

    if (!invitationEmailMatches(invitation.invitedEmail, userEmail)) return null;

    if (invitation.status !== 'pending') {
      throw new Error('INVITATION_NOT_PENDING');
    }

    if (new Date() > invitation.expiresAt) {
      invitation.status = 'expired';
      await invitation.save();
      throw new Error('INVITATION_EXPIRED');
    }

    // Update invitation status
    invitation.status = 'accepted';
    await invitation.save();

    // Add user to group
    const group = await Group.findById(invitation.group);
    if (!group) return null;

    const alreadyMember = group.members.some((m) => m.user.toString() === userId);

    if (!alreadyMember) {
      group.members.push({
        user: userId as unknown as import('mongoose').Types.ObjectId,
        role: 'member',
        joinedAt: new Date(),
      });
      await group.save();

      await activityService.log(group._id.toString(), 'member_joined', userId, {
        method: 'invite',
      });
    }

    return invitation;
  }

  /**
   * Decline an invitation.
   */
  async decline(invitationId: string, userEmail: string) {
    await connectDB();

    const invitation = await Invitation.findById(invitationId);
    if (!invitation) return null;

    if (!invitationEmailMatches(invitation.invitedEmail, userEmail)) return null;

    invitation.status = 'declined';
    await invitation.save();

    return invitation;
  }
}

export const invitationService = new InvitationService();
