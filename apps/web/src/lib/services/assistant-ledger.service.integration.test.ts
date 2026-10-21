/**
 * The approval page's Groups (#617, #621) against a real, isolated MongoDB database
 * (`splitbook-test-assistant-ledger-approval`): every Group the member belongs to, with every
 * currency it uses, and for a Group whose admins don't allow assistants, who stopped them.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import Group from '@/lib/models/Group';
import { assistantLedgerService } from '@/lib/services/assistant-ledger.service';
import { groupService } from '@/lib/services/group.service';
import { integrationTestDb } from '@/lib/test-utils/integration-db';
import { createTestUsers, TEST_USER_IDS } from '@/lib/test-utils/fixtures';

const db = integrationTestDb('assistant-ledger-approval');
const { alice, bob } = TEST_USER_IDS;

beforeAll(db.connect);
beforeEach(async () => {
  await db.reset();
  await createTestUsers('alice', 'bob');
});
afterAll(db.teardown);

async function createGroup(name: string, alternateCurrencies: string[] = []) {
  const group = await groupService.create(
    { name, category: 'trip', defaultCurrency: 'INR', alternateCurrencies },
    alice,
  );
  const groupId = String(group._id);
  await groupService.addMember(groupId, bob);
  return groupId;
}

describe('the approval page’s Groups', () => {
  it('names every currency a Group uses, its default first (#621)', async () => {
    await createGroup('Lisbon Offsite', ['EUR', 'JPY']);
    const [listed] = await assistantLedgerService.approvalGroups(bob);
    expect(listed).toMatchObject({ name: 'Lisbon Offsite', currencies: ['INR', 'EUR', 'JPY'] });
  });

  it('marks a Group whose admins don’t allow assistants, with the admin who stopped them (#621)', async () => {
    const stopped = await createGroup('Maple House');
    const reopened = await createGroup('Weekend Hike');
    await groupService.setAssistantRule(stopped, 'not_allowed', alice);
    // Allowed again: no one is stopping assistants there now.
    await groupService.setAssistantRule(reopened, 'not_allowed', alice);
    await groupService.setAssistantRule(reopened, 'allowed', alice);

    const listed = await assistantLedgerService.approvalGroups(bob);
    expect(listed.map(({ name, rule, ruleSetBy }) => ({ name, rule, ruleSetBy }))).toEqual([
      { name: 'Maple House', rule: 'not_allowed', ruleSetBy: { id: alice, name: 'Alice Tester' } },
      { name: 'Weekend Hike', rule: 'allowed', ruleSetBy: null },
    ]);
  });

  it('names no one once the admin who stopped assistants is no longer an admin (#621)', async () => {
    const stopped = await createGroup('Maple House');
    await groupService.setAssistantRule(stopped, 'not_allowed', alice);
    await groupService.updateMemberRole(stopped, bob, 'admin', alice);
    await groupService.updateMemberRole(stopped, alice, 'member', bob);

    const [listed] = await assistantLedgerService.approvalGroups(bob);
    expect(listed).toMatchObject({ name: 'Maple House', rule: 'not_allowed', ruleSetBy: null });
  });

  it('reads a Group stored before the rule as Allowed (#621)', async () => {
    const legacy = await createGroup('Old Flat');
    await Group.collection.updateOne(
      { _id: (await Group.findById(legacy))!._id },
      { $unset: { assistantRule: '', assistantRuleSetBy: '' } },
    );
    const [listed] = await assistantLedgerService.approvalGroups(bob);
    expect(listed).toMatchObject({ name: 'Old Flat', rule: 'allowed', ruleSetBy: null });
  });
});
