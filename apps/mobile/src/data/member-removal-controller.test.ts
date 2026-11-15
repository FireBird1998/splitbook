import {
  alexId,
  groupId,
  onMembersPage,
  priyaId,
  refusal,
  samId,
  type MembersFixture,
  type Role,
} from '../test-utils/members-fixture';
import { describe, expect, it } from 'vitest';

// An admin removes a member from Members and Group details, with each refusal explained (#1253).
// Fictional people and Groups only.
const onMembers = (
  roles: Record<string, Role> = { [alexId]: 'admin', [samId]: 'member', [priyaId]: 'member' },
) => onMembersPage(roles);
type Fixture = MembersFixture;

const memberPath = (userId: string) => `/api/groups/${groupId}/members/${userId}`;
const removals = (sent: string[]) => sent.filter((call) => call.startsWith('DELETE '));
const listed = (f: Fixture) =>
  f.controller.getSnapshot().detail.data?.members.map(({ user }) => user.id);
const closed = {
  groupId: null,
  userId: null,
  name: null,
  status: 'closed',
  code: null,
  message: null,
  check: null,
};

describe('Removing a member', () => {
  it('asks first, naming the member, and sends nothing until confirmed', async () => {
    const f = await onMembers();
    expect(f.controller.getSnapshot().memberRemoval).toEqual(closed);
    f.controller.reviewRemoveMember(priyaId);
    expect(f.controller.getSnapshot().memberRemoval).toEqual({
      groupId,
      userId: priyaId,
      name: 'Priya Shah',
      status: 'confirm',
      code: null,
      message: null,
      check: null,
    });
    f.controller.cancelRemoveMember();
    expect(f.controller.getSnapshot().memberRemoval).toEqual(closed);
    expect(f.sent()).toEqual([]);
  });

  it('removes them: the Group is read again, their row goes, and a Snackbar says so', async () => {
    const f = await onMembers();
    f.controller.reviewRemoveMember(priyaId);
    const held = f.backend.hold('DELETE', memberPath(priyaId));
    const removing = f.controller.removeMember();
    await held.arrived;
    expect(f.controller.getSnapshot().memberRemoval.status).toBe('removing');
    // Not dismissible while it is sent, nor can Back leave the page.
    f.controller.cancelRemoveMember();
    await f.controller.back();
    expect(f.controller.getSnapshot()).toMatchObject({
      screen: 'members',
      memberRemoval: { status: 'removing' },
    });
    expect(listed(f)).toEqual([alexId, samId, priyaId]);
    held.release();
    await removing;
    expect(f.sent()).toEqual([`DELETE ${memberPath(priyaId)}`, `GET /api/groups/${groupId}`]);
    expect(listed(f)).toEqual([alexId, samId]);
    expect(f.controller.getSnapshot()).toMatchObject({
      memberRemoval: closed,
      memberRole: { status: 'idle', done: 'Priya Shah was removed from Maple House' },
    });
  });

  it('shows not settled up in the server’s words, with Balances and no way to send it again', async () => {
    const f = await onMembers();
    const words = 'Priya Shah owes ₹300.00 in this Group. Settle up before removing them.';
    f.answerRemoval(() =>
      refusal(409, 'OPEN_BALANCE', words, { balances: [{ currency: 'INR', amount: -300 }] }),
    );
    f.controller.reviewRemoveMember(priyaId);
    await f.controller.removeMember();
    expect(f.controller.getSnapshot().memberRemoval).toMatchObject({
      status: 'refused',
      code: 'OPEN_BALANCE',
      message: words,
      check: 'balances',
    });
    await f.controller.removeMember();
    expect(removals(f.sent())).toHaveLength(1);
    expect(listed(f)).toEqual([alexId, samId, priyaId]);

    // Go to Balances closes the sheet and the page, on the Group's Balances.
    await f.controller.showRemovalBalances();
    expect(f.controller.getSnapshot()).toMatchObject({
      screen: 'group',
      destination: 'balances',
      memberRemoval: closed,
    });
  });

  it('says a broken recurring Expense is fixed on the web, in Android’s own sentence', async () => {
    const f = await onMembers();
    // Built from the recurring Expenses the refusal names, not from the server's wording.
    f.answerRemoval(() =>
      refusal(409, 'RECURRING_EXPENSE_PROBLEM', 'Rent (recurring) is in the way.', {
        recurringExpenses: [{ id: 'e00000000000000000000001', description: 'Rent' }],
      }),
    );
    f.controller.reviewRemoveMember(priyaId);
    await f.controller.removeMember();
    expect(f.controller.getSnapshot().memberRemoval).toMatchObject({
      status: 'refused',
      code: 'RECURRING_EXPENSE_PROBLEM',
      message:
        'Rent (recurring) still includes Priya Shah. Remove them from it on the web before removing them from the Group.',
      check: 'web',
    });
    f.controller.cancelRemoveMember();

    f.answerRemoval(() =>
      refusal(409, 'RECURRING_EXPENSE_PROBLEM', 'Rent and Wi-Fi are in the way.', {
        recurringExpenses: [
          { id: 'e00000000000000000000001', description: 'Rent' },
          { id: 'e00000000000000000000002', description: 'Wi-Fi' },
        ],
      }),
    );
    f.controller.reviewRemoveMember(priyaId);
    await f.controller.removeMember();
    expect(f.controller.getSnapshot().memberRemoval.message).toBe(
      'Rent (recurring) and Wi-Fi (recurring) still include Priya Shah. Remove them from each on the web before removing them from the Group.',
    );
    // Without the Expenses named, Android still says where it is fixed.
    f.controller.cancelRemoveMember();
    f.answerRemoval(() => refusal(409, 'RECURRING_EXPENSE_PROBLEM', 'Something is in the way.'));
    f.controller.reviewRemoveMember(priyaId);
    await f.controller.removeMember();
    expect(f.controller.getSnapshot().memberRemoval.message).toBe(
      'A recurring Expense still includes Priya Shah. Remove them from it on the web before removing them from the Group.',
    );
  });

  it('keeps Remove after the Group changed meanwhile, and sends again only when asked', async () => {
    const f = await onMembers();
    const words = 'This Group changed while you were removing this member. Try again.';
    f.answerRemoval(() => refusal(409, 'REMOVAL_CONFLICT', words));
    f.controller.reviewRemoveMember(priyaId);
    await f.controller.removeMember();
    expect(f.controller.getSnapshot().memberRemoval).toMatchObject({
      status: 'refused',
      code: 'REMOVAL_CONFLICT',
      message: words,
      check: null,
    });
    expect(removals(f.sent())).toHaveLength(1);
    f.answerRemoval(() => undefined);
    await f.controller.removeMember();
    expect(removals(f.sent())).toHaveLength(1);
    expect(listed(f)).toEqual([alexId, samId]);
    expect(f.controller.getSnapshot().memberRole.done).toBe(
      'Priya Shah was removed from Maple House',
    );
  });

  it('shows the last-admin refusal as the server sends it', async () => {
    const f = await onMembers({ [alexId]: 'admin', [priyaId]: 'admin' });
    const words = 'Maple House needs an admin. Make someone else an admin first.';
    f.answerRemoval(() => refusal(409, 'LAST_ADMIN', words));
    f.controller.reviewRemoveMember(priyaId);
    await f.controller.removeMember();
    expect(f.controller.getSnapshot().memberRemoval).toMatchObject({
      status: 'refused',
      code: 'LAST_ADMIN',
      message: words,
      check: null,
    });
    await f.controller.removeMember();
    expect(removals(f.sent())).toHaveLength(1);
  });

  it('sends nothing offline, and nothing later', async () => {
    const f = await onMembers();
    f.controller.reviewRemoveMember(priyaId);
    f.backend.online = false;
    await f.controller.refresh();
    expect(f.controller.getSnapshot().offline.active).toBe(true);
    await f.controller.removeMember();
    expect(f.controller.getSnapshot().memberRemoval.status).toBe('confirm');
    f.backend.online = true;
    await f.controller.refresh();
    expect(removals(f.sent())).toEqual([]);
  });

  it('reports a dropped request and sends it again only when asked', async () => {
    const f = await onMembers();
    f.controller.reviewRemoveMember(priyaId);
    const dropped = f.backend.hold('DELETE', memberPath(priyaId), { at: 'request' });
    const removing = f.controller.removeMember();
    await dropped.arrived;
    dropped.release('lost-reply');
    await removing;
    expect(f.controller.getSnapshot().memberRemoval).toMatchObject({
      status: 'error',
      message: 'Couldn’t remove Priya Shah. Try again.',
    });
    expect(listed(f)).toEqual([alexId, samId, priyaId]);
    await f.controller.refresh('foreground');
    expect(removals(f.sent())).toHaveLength(1);
    await f.controller.removeMember();
    expect(removals(f.sent())).toHaveLength(1);
    expect(listed(f)).toEqual([alexId, samId]);
  });

  it('confirms a removal whose reply was lost once the Group no longer lists them', async () => {
    const f = await onMembers();
    f.answerRemoval((userId) => {
      f.removeMember(userId);
      throw new TypeError('Network request failed');
    });
    f.controller.reviewRemoveMember(priyaId);
    await f.controller.removeMember();
    expect(listed(f)).toEqual([alexId, samId]);
    expect(f.controller.getSnapshot()).toMatchObject({
      memberRemoval: closed,
      memberRole: { done: 'Priya Shah was removed from Maple House' },
    });
  });

  it('treats losing the admin role elsewhere as a refusal: the Group stays, as the member’s view', async () => {
    const f = await onMembers();
    f.answerRemoval(() => {
      f.setRole(alexId, 'member');
      return refusal(403, 'FORBIDDEN', 'Forbidden');
    });
    f.controller.reviewRemoveMember(priyaId);
    await f.controller.removeMember();
    const shown = f.controller.getSnapshot();
    expect(shown.memberRemoval).toMatchObject({
      status: 'refused',
      code: 'FORBIDDEN',
      message: 'You’re no longer an admin of Maple House.',
      check: null,
    });
    expect(shown.detail).toMatchObject({ status: 'ready', id: groupId });
    expect(shown.detail.data?.members.find(({ user }) => user.id === alexId)?.role).toBe('member');
    expect(shown.groups.data.map(({ id }) => id)).toEqual([groupId]);
  });

  it('says a member removed meanwhile is no longer in the Group', async () => {
    const f = await onMembers();
    f.answerRemoval((userId) => {
      f.removeMember(userId);
      return refusal(404, 'NOT_FOUND', 'Group not found');
    });
    f.controller.reviewRemoveMember(priyaId);
    await f.controller.removeMember();
    expect(listed(f)).toEqual([alexId, samId]);
    expect(f.controller.getSnapshot()).toMatchObject({
      memberRemoval: closed,
      memberRole: { done: 'Priya Shah is no longer in this Group' },
    });
  });

  it('never asks to remove yourself, or anyone for a member who isn’t an admin', async () => {
    const f = await onMembers();
    f.controller.reviewRemoveMember(alexId);
    f.controller.reviewRemoveMember('a00000000000000000000009');
    expect(f.controller.getSnapshot().memberRemoval).toEqual(closed);
    const g = await onMembers({ [alexId]: 'member', [samId]: 'admin', [priyaId]: 'member' });
    g.controller.reviewRemoveMember(priyaId);
    expect(g.controller.getSnapshot().memberRemoval).toEqual(closed);
    await g.controller.removeMember();
    expect(g.sent()).toEqual([]);
  });

  // #1252 review, for removals: a Snackbar says so only when the Group read after it agrees.
  it('says nothing when the read after a removal still lists them: the list speaks', async () => {
    const f = await onMembers();
    f.answerRemoval(() => Response.json({ data: { message: 'Member removed' }, status: 200 }));
    f.controller.reviewRemoveMember(priyaId);
    await f.controller.removeMember();
    expect(listed(f)).toEqual([alexId, samId, priyaId]);
    expect(f.controller.getSnapshot()).toMatchObject({
      memberRemoval: closed,
      memberRole: { done: null },
    });
  });

  it('a sign-out while removing publishes nothing of it into the next session', async () => {
    const f = await onMembers();
    f.controller.reviewRemoveMember(priyaId);
    const held = f.backend.hold('DELETE', memberPath(priyaId));
    const removing = f.controller.removeMember();
    await held.arrived;
    await f.controller.signOut();
    held.release();
    await removing;
    await f.controller.signIn('sam');
    expect(f.controller.getSnapshot()).toMatchObject({
      auth: { user: { id: samId } },
      screen: 'groups',
      memberRemoval: closed,
      memberRole: { done: null },
    });
  });

  // MembersRolesNotes: the member removed by someone else while the sheet is open.
  it('closes the sheet when a read no longer lists the member, saying so', async () => {
    const f = await onMembers();
    f.controller.reviewRemoveMember(priyaId);
    f.removeMember(priyaId);
    await f.controller.refresh();
    expect(listed(f)).toEqual([alexId, samId]);
    expect(f.controller.getSnapshot()).toMatchObject({
      memberRemoval: closed,
      memberRole: { done: 'Priya Shah is no longer in this Group' },
    });
    expect(removals(f.sent())).toEqual([]);
  });

  // User story 22: made a member by another admin while the sheet is open.
  it('closes the sheet when a read shows you are no longer an admin', async () => {
    const f = await onMembers();
    f.controller.reviewRemoveMember(priyaId);
    f.setRole(alexId, 'member');
    await f.controller.refresh();
    expect(f.controller.getSnapshot()).toMatchObject({
      memberRemoval: closed,
      memberRole: { done: null },
    });
    expect(removals(f.sent())).toEqual([]);
  });

  it('leaving the page closes the sheet', async () => {
    const f = await onMembers();
    f.controller.reviewRemoveMember(priyaId);
    await f.controller.back();
    expect(f.controller.getSnapshot()).toMatchObject({ screen: 'group', memberRemoval: closed });
  });
});
