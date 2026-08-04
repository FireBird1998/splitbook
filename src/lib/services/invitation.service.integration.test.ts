/**
 * Integration tests for InvitationService against a real, isolated MongoDB
 * database (`splitwise-test-invitation-service`). Covers invitation
 * ownership boundaries: only the invited email may accept or decline.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import Invitation from '@/lib/models/Invitation';
import Group from '@/lib/models/Group';
import Activity from '@/lib/models/Activity';
import { groupService } from '@/lib/services/group.service';
import { invitationService } from '@/lib/services/invitation.service';
import { integrationTestDb } from '@/lib/test-utils/integration-db';
import { createTestUsers, TEST_USER_IDS } from '@/lib/test-utils/fixtures';

const db = integrationTestDb('invitation-service');
const { alice, bob, carol } = TEST_USER_IDS;

const BOB_EMAIL = 'bob.test@splitwise-test.local';
const CAROL_EMAIL = 'carol.test@splitwise-test.local';

beforeAll(db.connect);
beforeEach(async () => {
  await db.reset();
  await createTestUsers('alice', 'bob', 'carol');
});
afterAll(db.teardown);

async function createTrip(): Promise<string> {
  const group = await groupService.create(
    { name: 'Invite Trip', category: 'trip', defaultCurrency: 'INR', alternateCurrencies: [] },
    alice,
  );
  return group._id.toString();
}

describe('InvitationService integration', () => {
  it('creates a pending invitation with a normalised email', async () => {
    const groupId = await createTrip();

    const invitation = await invitationService.create(
      groupId,
      'Bob.Test@Splitwise-Test.LOCAL',
      alice,
    );

    expect(invitation.status).toBe('pending');
    expect(invitation.invitedEmail).toBe(BOB_EMAIL);
    expect(invitation.token).toMatch(/^[a-f0-9]{32}$/);
  });

  it('refuses a duplicate pending invitation for the same email and trip', async () => {
    const groupId = await createTrip();

    await invitationService.create(groupId, BOB_EMAIL, alice);
    await expect(invitationService.create(groupId, BOB_EMAIL, alice)).rejects.toThrow(
      'ALREADY_INVITED',
    );

    expect(await Invitation.countDocuments({ group: groupId })).toBe(1);
  });

  it('lists pending invitations scoped to the invited email only', async () => {
    const groupId = await createTrip();
    await invitationService.create(groupId, BOB_EMAIL, alice);
    await invitationService.create(groupId, CAROL_EMAIL, alice);

    const forBob = await invitationService.getPendingByEmail(BOB_EMAIL);
    expect(forBob).toHaveLength(1);
    expect(forBob[0].invitedEmail).toBe(BOB_EMAIL);

    // Case-insensitive lookup
    const forBobUpper = await invitationService.getPendingByEmail('BOB.TEST@SPLITWISE-TEST.LOCAL');
    expect(forBobUpper).toHaveLength(1);

    await expect(invitationService.getPendingByEmail('nobody@example.com')).resolves.toHaveLength(
      0,
    );
  });

  it('lets the invited email accept and joins the trip exactly once', async () => {
    const groupId = await createTrip();
    const invitation = await invitationService.create(groupId, BOB_EMAIL, alice);

    const accepted = await invitationService.accept(
      invitation._id.toString(),
      bob,
      'Bob.Test@Splitwise-Test.Local', // case variants still match
    );

    expect(accepted?.status).toBe('accepted');

    const group = await Group.findById(groupId);
    const bobMemberships = group!.members.filter((m) => m.user.toString() === bob);
    expect(bobMemberships).toHaveLength(1);
    expect(bobMemberships[0].role).toBe('member');

    const joinActivity = await Activity.findOne({ group: groupId, type: 'member_joined' });
    expect(joinActivity?.actor.toString()).toBe(bob);
  });

  it('denies acceptance by any other email, leaving the invitation pending', async () => {
    const groupId = await createTrip();
    const invitation = await invitationService.create(groupId, BOB_EMAIL, alice);

    // Carol tries to accept Bob's invitation
    const result = await invitationService.accept(invitation._id.toString(), carol, CAROL_EMAIL);
    expect(result).toBeNull();

    const stored = await Invitation.findById(invitation._id);
    expect(stored!.status).toBe('pending');

    const group = await Group.findById(groupId);
    expect(group!.members.map((m) => m.user.toString())).not.toContain(carol);
  });

  it('denies declining by any other email', async () => {
    const groupId = await createTrip();
    const invitation = await invitationService.create(groupId, BOB_EMAIL, alice);

    const result = await invitationService.decline(invitation._id.toString(), CAROL_EMAIL);
    expect(result).toBeNull();

    const stored = await Invitation.findById(invitation._id);
    expect(stored!.status).toBe('pending');

    const declined = await invitationService.decline(invitation._id.toString(), BOB_EMAIL);
    expect(declined?.status).toBe('declined');
  });

  it('rejects accepting an invitation that is no longer pending', async () => {
    const groupId = await createTrip();
    const invitation = await invitationService.create(groupId, BOB_EMAIL, alice);
    await invitationService.decline(invitation._id.toString(), BOB_EMAIL);

    await expect(
      invitationService.accept(invitation._id.toString(), bob, BOB_EMAIL),
    ).rejects.toThrow('INVITATION_NOT_PENDING');
  });

  it('marks expired invitations and refuses acceptance', async () => {
    const groupId = await createTrip();
    const invitation = await invitationService.create(groupId, BOB_EMAIL, alice);

    await Invitation.findByIdAndUpdate(invitation._id, {
      expiresAt: new Date(Date.now() - 60_000),
    });

    await expect(
      invitationService.accept(invitation._id.toString(), bob, BOB_EMAIL),
    ).rejects.toThrow('INVITATION_EXPIRED');

    const stored = await Invitation.findById(invitation._id);
    expect(stored!.status).toBe('expired');
  });

  it('accepting as an existing member resolves without duplicating membership', async () => {
    const groupId = await createTrip();
    await groupService.addMember(groupId, bob);
    const invitation = await invitationService.create(groupId, BOB_EMAIL, alice);

    await invitationService.accept(invitation._id.toString(), bob, BOB_EMAIL);

    const group = await Group.findById(groupId);
    expect(group!.members.filter((m) => m.user.toString() === bob)).toHaveLength(1);
  });
});
