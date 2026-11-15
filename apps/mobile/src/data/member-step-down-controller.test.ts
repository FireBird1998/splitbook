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

// An admin steps down to member from their own row, when another admin exists (#1254).
// Fictional people and Groups only.
const onMembers = (
  roles: Record<string, Role> = { [alexId]: 'admin', [samId]: 'admin', [priyaId]: 'member' },
) => onMembersPage(roles);
const rolePath = (userId: string) => `/api/groups/${groupId}/members/${userId}`;
const roleOf = (f: MembersFixture, userId: string) =>
  f.controller.getSnapshot().detail.data?.members.find(({ user }) => user.id === userId)?.role;
const patches = (sent: string[]) => sent.filter((call) => call.startsWith('PATCH '));
const closed = { groupId: null, status: 'closed', code: null, message: null };

describe('Stepping down to member', () => {
  it('asks first, and sends nothing until confirmed', async () => {
    const f = await onMembers();
    expect(f.controller.getSnapshot().stepDown).toEqual(closed);
    f.controller.reviewStepDown();
    expect(f.controller.getSnapshot().stepDown).toEqual({
      groupId,
      status: 'confirm',
      code: null,
      message: null,
    });
    f.controller.cancelStepDown();
    expect(f.controller.getSnapshot().stepDown).toEqual(closed);
    expect(f.sent()).toEqual([]);
  });

  it('is offered only while another admin exists, and only to an admin', async () => {
    const only = await onMembers({ [alexId]: 'admin', [samId]: 'member' });
    only.controller.reviewStepDown();
    expect(only.controller.getSnapshot().stepDown).toEqual(closed);
    const member = await onMembers({ [alexId]: 'member', [samId]: 'admin' });
    member.controller.reviewStepDown();
    expect(member.controller.getSnapshot().stepDown).toEqual(closed);
    await member.controller.stepDown();
    expect(member.sent()).toEqual([]);
  });

  it('steps down: the Group is read again, the page is the member’s, and a Snackbar says so', async () => {
    const f = await onMembers();
    f.controller.reviewStepDown();
    const held = f.backend.hold('PATCH', rolePath(alexId));
    const stepping = f.controller.stepDown();
    await held.arrived;
    expect(f.controller.getSnapshot().stepDown.status).toBe('stepping');
    // Not dismissible while it is sent, nor can Back leave the page.
    f.controller.cancelStepDown();
    await f.controller.back();
    expect(f.controller.getSnapshot()).toMatchObject({
      screen: 'members',
      stepDown: { status: 'stepping' },
    });
    held.release();
    await stepping;
    expect(f.roleBodies).toEqual([{ role: 'member' }]);
    expect(f.sent()).toEqual([`PATCH ${rolePath(alexId)}`, `GET /api/groups/${groupId}`]);
    expect(roleOf(f, alexId)).toBe('member');
    expect(f.controller.getSnapshot()).toMatchObject({
      stepDown: closed,
      memberRole: { status: 'idle', done: 'You’re now a member of Maple House' },
    });
  });

  it('shows the last-admin refusal as the server sends it, when the other admin left meanwhile', async () => {
    const f = await onMembers();
    const words = 'Maple House needs an admin. Make someone else an admin first.';
    f.answerRole(() => {
      f.setRole(samId, 'member');
      return refusal(409, 'LAST_ADMIN', words);
    });
    f.controller.reviewStepDown();
    await f.controller.stepDown();
    expect(f.controller.getSnapshot().stepDown).toMatchObject({
      status: 'refused',
      code: 'LAST_ADMIN',
      message: words,
    });
    expect(roleOf(f, alexId)).toBe('admin');
    await f.controller.stepDown();
    expect(patches(f.sent())).toHaveLength(1);
  });

  it('sends nothing offline, and nothing later', async () => {
    const f = await onMembers();
    f.controller.reviewStepDown();
    f.backend.online = false;
    await f.controller.refresh();
    await f.controller.stepDown();
    expect(f.controller.getSnapshot().stepDown.status).toBe('confirm');
    f.backend.online = true;
    await f.controller.refresh();
    expect(patches(f.sent())).toEqual([]);
  });

  it('reports a dropped request and sends it again only when asked', async () => {
    const f = await onMembers();
    f.controller.reviewStepDown();
    const dropped = f.backend.hold('PATCH', rolePath(alexId), { at: 'request' });
    const stepping = f.controller.stepDown();
    await dropped.arrived;
    dropped.release('lost-reply');
    await stepping;
    expect(f.controller.getSnapshot().stepDown).toMatchObject({
      status: 'error',
      message: 'Couldn’t step down. Try again.',
    });
    expect(roleOf(f, alexId)).toBe('admin');
    await f.controller.refresh('foreground');
    expect(patches(f.sent())).toHaveLength(1);
    await f.controller.stepDown();
    expect(patches(f.sent())).toHaveLength(1);
    expect(roleOf(f, alexId)).toBe('member');
  });

  it('confirms a step-down whose reply was lost once the Group shows you a member', async () => {
    const f = await onMembers();
    f.answerRole((userId, role) => {
      f.setRole(userId, role);
      throw new TypeError('Network request failed');
    });
    f.controller.reviewStepDown();
    await f.controller.stepDown();
    expect(roleOf(f, alexId)).toBe('member');
    expect(f.controller.getSnapshot()).toMatchObject({
      stepDown: closed,
      memberRole: { done: 'You’re now a member of Maple House' },
    });
  });

  it('closes when a read shows you a member already, or the other admins gone', async () => {
    const f = await onMembers();
    f.controller.reviewStepDown();
    f.setRole(samId, 'member');
    await f.controller.refresh();
    expect(f.controller.getSnapshot().stepDown).toEqual(closed);
    expect(patches(f.sent())).toEqual([]);
  });

  it('leaving the page closes it', async () => {
    const f = await onMembers();
    f.controller.reviewStepDown();
    await f.controller.back();
    expect(f.controller.getSnapshot()).toMatchObject({ screen: 'group', stepDown: closed });
  });
});
