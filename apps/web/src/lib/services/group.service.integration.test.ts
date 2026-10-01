/**
 * Integration tests for GroupService against a real, isolated MongoDB
 * database (`splitbook-test-group-service`). Covers membership enforcement
 * and admin boundaries that unit tests cannot reach.
 */

import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import Group from '@/lib/models/Group';
import Activity from '@/lib/models/Activity';
import { groupService } from '@/lib/services/group.service';
import { integrationTestDb } from '@/lib/test-utils/integration-db';
import { createTestUsers, TEST_USER_IDS } from '@/lib/test-utils/fixtures';
import { DEFAULT_GROUP_TAGS } from '@splitbook/shared/default-tags';

const db = integrationTestDb('group-service');
const { alice, bob, carol, dave } = TEST_USER_IDS;

beforeAll(db.connect);
beforeEach(async () => {
  await db.reset();
  await createTestUsers('alice', 'bob', 'carol', 'dave');
});
afterAll(db.teardown);

async function createTrip(creatorId: string = alice, name = 'QA Trip') {
  const group = await groupService.create(
    {
      name,
      category: 'trip',
      defaultCurrency: 'INR',
      alternateCurrencies: [],
    },
    creatorId,
  );
  return group;
}

describe('GroupService integration', () => {
  describe('group creation', () => {
    it('makes the creator the only admin and seeds active default tags', async () => {
      const group = await createTrip();

      const stored = await Group.findById(group._id).lean();
      expect(stored!.members).toHaveLength(1);
      expect(stored!.members[0].user.toString()).toBe(alice);
      expect(stored!.members[0].role).toBe('admin');
      expect(stored!.tags.map((tag) => tag.name)).toEqual([...DEFAULT_GROUP_TAGS]);
      expect(stored!.tags.every((tag) => !tag.isArchived)).toBe(true);

      const activity = await Activity.findOne({ group: group._id, type: 'group_created' });
      expect(activity?.actor.toString()).toBe(alice);
    });

    const cabin = {
      name: 'Cabin Weekend',
      category: 'trip' as const,
      defaultCurrency: 'INR',
      alternateCurrencies: [],
    };

    it('returns the Group a keyed request already created instead of creating another', async () => {
      const key = randomUUID();
      const first = await groupService.create(cabin, alice, key);
      const replay = await groupService.create(cabin, alice, key);

      expect(String(replay._id)).toBe(String(first._id));
      expect(await Group.countDocuments({ createdBy: alice })).toBe(1);
      expect(await Activity.countDocuments({ type: 'group_created' })).toBe(1);
      // Retry metadata is private persistence data, never part of the Group response.
      expect(JSON.parse(JSON.stringify(first))).not.toHaveProperty('creationRequest');
      expect(JSON.parse(JSON.stringify(replay))).not.toHaveProperty('creationRequest');
      expect(JSON.parse(JSON.stringify(replay)).members[0].user.name).toBeTruthy();
    });

    it('converges concurrent same-key requests on one Group', async () => {
      const key = randomUUID();
      let arrivals = 0;
      let release!: () => void;
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      const insert = Group.collection.insertOne;
      // Hold real Mongo insertions until both requests have passed their initial lookup.
      const barrier = vi.spyOn(Group.collection, 'insertOne').mockImplementation(async function (
        ...args
      ) {
        arrivals += 1;
        if (arrivals === 2) release();
        await gate;
        return insert.apply(Group.collection, args);
      });
      try {
        const [one, two] = await Promise.all([
          groupService.create(cabin, alice, key),
          groupService.create(cabin, alice, key),
        ]);
        expect(String(one._id)).toBe(String(two._id));
      } finally {
        barrier.mockRestore();
      }
      expect(await Group.countDocuments({ createdBy: alice })).toBe(1);
    });

    it('refuses a reused key with different Group details', async () => {
      const key = randomUUID();
      await groupService.create(cabin, alice, key);
      await expect(
        groupService.create({ ...cabin, name: 'Cabin Weekend 2' }, alice, key),
      ).rejects.toThrow('IDEMPOTENCY_CONFLICT');
      expect(await Group.countDocuments({ createdBy: alice })).toBe(1);
    });

    it('scopes creation keys to the creator', async () => {
      const key = randomUUID();
      const alicesGroup = await groupService.create(cabin, alice, key);
      const bobsGroup = await groupService.create(cabin, bob, key);
      expect(String(bobsGroup._id)).not.toBe(String(alicesGroup._id));
      expect(bobsGroup.members.map((member) => String(member.user._id))).toEqual([bob]);
    });

    it('still creates a Group for each unkeyed request', async () => {
      await groupService.create(cabin, alice);
      await groupService.create(cabin, alice);
      expect(await Group.countDocuments({ createdBy: alice })).toBe(2);
    });
  });

  describe('membership enforcement', () => {
    it('recognises members and rejects strangers', async () => {
      const group = await createTrip();

      await expect(groupService.isMember(group._id.toString(), alice)).resolves.toBe(true);
      await expect(groupService.isMember(group._id.toString(), dave)).resolves.toBe(false);
    });

    it('adds members idempotently and logs membership once', async () => {
      const group = await createTrip();
      const groupId = group._id.toString();

      await groupService.addMember(groupId, bob);
      await groupService.addMember(groupId, bob);

      const stored = await Group.findById(groupId);
      const bobMemberships = stored!.members.filter((m) => m.user.toString() === bob);
      expect(bobMemberships).toHaveLength(1);
      expect(bobMemberships[0].role).toBe('member');

      await expect(groupService.isMember(groupId, bob)).resolves.toBe(true);

      const joins = await Activity.countDocuments({
        group: groupId,
        type: 'member_joined',
        'metadata.userId': bob,
      });
      expect(joins).toBe(1);
    });

    it('scopes group listings to the member and hides archived trips by default', async () => {
      const aliceTrip = await createTrip(alice, 'Alice trip');
      await createTrip(bob, 'Bob trip');

      const aliceGroups = await groupService.getUserGroups(alice);
      expect(aliceGroups.map((g) => g.name)).toEqual(['Alice trip']);

      await groupService.archive(aliceTrip._id.toString(), alice);
      await expect(groupService.getUserGroups(alice)).resolves.toHaveLength(0);
      await expect(groupService.getUserGroups(alice, true)).resolves.toHaveLength(1);
    });
  });

  describe('admin boundaries', () => {
    it('rejects updates from non-admin members and strangers', async () => {
      const group = await createTrip();
      const groupId = group._id.toString();
      await groupService.addMember(groupId, bob);

      await expect(groupService.update(groupId, { name: 'Hacked' }, bob)).rejects.toThrow(
        'FORBIDDEN',
      );
      await expect(groupService.update(groupId, { name: 'Hacked' }, dave)).rejects.toThrow(
        'FORBIDDEN',
      );

      const stored = await Group.findById(groupId);
      expect(stored!.name).toBe('QA Trip');
    });

    it('lets admins update and records the change in the activity feed', async () => {
      const group = await createTrip();
      const groupId = group._id.toString();

      await groupService.update(groupId, { name: 'Renamed trip' }, alice);

      const stored = await Group.findById(groupId);
      expect(stored!.name).toBe('Renamed trip');

      const activity = await Activity.findOne({ group: groupId, type: 'group_updated' });
      const metadata = activity?.metadata as
        | { changes?: { name?: { old: string; new: string } } }
        | undefined;
      expect(metadata?.changes?.name).toMatchObject({
        old: 'QA Trip',
        new: 'Renamed trip',
      });
    });

    it('rejects archiving by non-admins', async () => {
      const group = await createTrip();
      const groupId = group._id.toString();
      await groupService.addMember(groupId, bob);

      await expect(groupService.archive(groupId, bob)).rejects.toThrow('FORBIDDEN');
      await expect(groupService.archive(groupId, dave)).rejects.toThrow('FORBIDDEN');
    });

    it('protects the last admin from demotion or removal', async () => {
      const group = await createTrip();
      const groupId = group._id.toString();
      await groupService.addMember(groupId, bob);

      await expect(groupService.updateMemberRole(groupId, alice, 'member', alice)).rejects.toThrow(
        'LAST_ADMIN',
      );

      // Promote bob, then alice can be demoted safely
      await groupService.updateMemberRole(groupId, bob, 'admin', alice);
      await groupService.updateMemberRole(groupId, alice, 'member', bob);

      const stored = await Group.findById(groupId);
      expect(stored!.members.find((m) => m.user.toString() === alice)?.role).toBe('member');
      expect(stored!.members.find((m) => m.user.toString() === bob)?.role).toBe('admin');
    });

    it('records the previous and new role when a member role changes', async () => {
      const group = await createTrip();
      const groupId = group._id.toString();
      await groupService.addMember(groupId, bob);

      await groupService.updateMemberRole(groupId, bob, 'admin', alice);
      await groupService.updateMemberRole(groupId, alice, 'member', bob);

      const changes = await Activity.find({ group: groupId, type: 'group_updated' })
        .sort({ createdAt: 1, _id: 1 })
        .lean();
      expect(changes.map((activity) => activity.metadata)).toEqual([
        {
          changes: {
            memberRole: {
              old: { userId: bob, role: 'member' },
              new: { userId: bob, role: 'admin' },
            },
          },
        },
        {
          changes: {
            memberRole: {
              old: { userId: alice, role: 'admin' },
              new: { userId: alice, role: 'member' },
            },
          },
        },
      ]);
    });

    it('blocks self-removal and removal of the last admin', async () => {
      const group = await createTrip();
      const groupId = group._id.toString();
      await groupService.addMember(groupId, bob);
      await groupService.addMember(groupId, carol);

      await expect(groupService.removeMember(groupId, alice, alice)).rejects.toThrow('SELF_REMOVE');

      // Non-admin cannot remove anyone
      await expect(groupService.removeMember(groupId, carol, bob)).rejects.toThrow('FORBIDDEN');

      await groupService.removeMember(groupId, carol, alice);
      const stored = await Group.findById(groupId);
      expect(stored!.members.map((m) => m.user.toString()).sort()).toEqual([alice, bob].sort());
    });
  });

  describe('invite codes', () => {
    it('only members can generate invite codes', async () => {
      const group = await createTrip();
      const groupId = group._id.toString();

      await expect(groupService.generateInviteCode(groupId, dave)).rejects.toThrow('FORBIDDEN');

      const invite = await groupService.generateInviteCode(groupId, alice);
      expect(invite?.inviteCode).toMatch(/^[a-f0-9]{8}$/);

      const found = await groupService.findByInviteCode(invite!.inviteCode);
      expect(found?._id.toString()).toBe(groupId);
    });
  });
});
