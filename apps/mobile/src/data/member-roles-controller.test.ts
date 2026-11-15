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
import { describe, expect, it, vi } from 'vitest';

// An admin makes a member an admin or a member on Members and Group details (#1252). Fictional
// people and Groups only.
const onMembers = (roles: Record<string, Role> = { [alexId]: 'admin', [samId]: 'member' }) =>
  onMembersPage(roles);
type Fixture = MembersFixture;

const rolePath = (userId: string) => `/api/groups/${groupId}/members/${userId}`;
const roleOf = (f: Fixture, userId: string) =>
  f.controller.getSnapshot().detail.data?.members.find(({ user }) => user.id === userId)?.role;

describe('Changing a member’s role', () => {
  it('makes a member an admin at once: the row says so while sent, then the server’s roles and a Snackbar', async () => {
    const f = await onMembers();
    expect(f.controller.getSnapshot().memberRole).toEqual({
      groupId: null,
      userId: null,
      name: null,
      role: null,
      status: 'idle',
      message: null,
      done: null,
    });
    const held = f.backend.hold('PATCH', rolePath(samId));
    const changing = f.controller.changeMemberRole(samId, 'admin');
    await held.arrived;
    expect(f.controller.getSnapshot().memberRole).toMatchObject({
      groupId,
      userId: samId,
      name: 'Sam Chen',
      role: 'admin',
      status: 'changing',
      message: null,
    });
    // Nothing on screen guesses the outcome: Sam is still a member until the server answers.
    expect(roleOf(f, samId)).toBe('member');
    held.release();
    await changing;

    expect(f.roleBodies).toEqual([{ role: 'admin' }]);
    // The Group is read again from the server after the change.
    expect(f.sent()).toEqual([`PATCH ${rolePath(samId)}`, `GET /api/groups/${groupId}`]);
    expect(roleOf(f, samId)).toBe('admin');
    expect(f.controller.getSnapshot().memberRole).toMatchObject({
      status: 'idle',
      message: null,
      done: 'Sam Chen is now an admin',
    });
  });

  it('makes an admin a member, naming them', async () => {
    const f = await onMembers({ [alexId]: 'admin', [priyaId]: 'admin', [samId]: 'member' });
    await f.controller.changeMemberRole(priyaId, 'member');
    expect(f.roleBodies).toEqual([{ role: 'member' }]);
    expect(roleOf(f, priyaId)).toBe('member');
    expect(f.controller.getSnapshot().memberRole).toMatchObject({
      status: 'idle',
      done: 'Priya Shah is now a member',
    });
  });

  it('dismisses the Snackbar, and leaving the page ends it', async () => {
    const f = await onMembers();
    await f.controller.changeMemberRole(samId, 'admin');
    f.controller.dismissMemberRoleDone();
    expect(f.controller.getSnapshot().memberRole.done).toBeNull();

    await f.controller.changeMemberRole(samId, 'member');
    expect(f.controller.getSnapshot().memberRole.done).toBe('Sam Chen is now a member');
    await f.controller.back();
    expect(f.controller.getSnapshot().screen).toBe('group');
    expect(f.controller.getSnapshot().memberRole).toMatchObject({ status: 'idle', done: null });
  });

  it('sends nothing offline, and nothing later', async () => {
    const f = await onMembers();
    f.backend.online = false;
    await f.controller.refresh();
    expect(f.controller.getSnapshot().offline.active).toBe(true);
    f.sent();
    await f.controller.changeMemberRole(samId, 'admin');
    expect(f.controller.getSnapshot().memberRole.status).toBe('idle');
    f.backend.online = true;
    await f.controller.refresh();
    expect(f.sent().filter((call) => call.startsWith('PATCH'))).toEqual([]);
    expect(roleOf(f, samId)).toBe('member');
  });

  it('sends nothing for a member who isn’t an admin, for yourself, or for the role they have', async () => {
    const f = await onMembers({ [alexId]: 'member', [samId]: 'admin', [priyaId]: 'member' });
    await f.controller.changeMemberRole(priyaId, 'admin');
    const g = await onMembers();
    await g.controller.changeMemberRole(alexId, 'member');
    await g.controller.changeMemberRole(samId, 'member');
    await g.controller.changeMemberRole('a00000000000000000000009', 'admin');
    for (const each of [f, g]) {
      expect(each.sent()).toEqual([]);
      expect(each.controller.getSnapshot().memberRole.status).toBe('idle');
    }
  });

  it('changes one role at a time', async () => {
    const f = await onMembers({ [alexId]: 'admin', [samId]: 'member', [priyaId]: 'member' });
    const held = f.backend.hold('PATCH', rolePath(samId));
    const first = f.controller.changeMemberRole(samId, 'admin');
    await held.arrived;
    await f.controller.changeMemberRole(priyaId, 'admin');
    held.release();
    await first;
    expect(f.roleBodies).toEqual([{ role: 'admin' }]);
    expect(roleOf(f, priyaId)).toBe('member');
  });

  it('explains a failure above the details, shows the server’s roles and never resends', async () => {
    const f = await onMembers();
    f.answerRole(() => Response.json({ error: 'Internal error' }, { status: 500 }));
    await f.controller.changeMemberRole(samId, 'admin');
    expect(f.controller.getSnapshot().memberRole).toMatchObject({
      groupId,
      userId: samId,
      status: 'failed',
      message: 'Couldn’t make Sam Chen an admin. Try again.',
      done: null,
    });
    expect(f.sent()).toEqual([`PATCH ${rolePath(samId)}`, `GET /api/groups/${groupId}`]);
    expect(roleOf(f, samId)).toBe('member');
    // Coming back online or to the foreground reads again; it never sends the change again.
    await f.controller.refresh('foreground');
    expect(f.sent().filter((call) => call.startsWith('PATCH'))).toEqual([]);
  });

  it('reports a dropped request and resends nothing; the read after it shows what the server has', async () => {
    const f = await onMembers();
    // Dropped on the way: the server never got it.
    const dropped = f.backend.hold('PATCH', rolePath(samId), { at: 'request' });
    const second = f.controller.changeMemberRole(samId, 'admin');
    await dropped.arrived;
    dropped.release('lost-reply');
    await second;
    expect(f.controller.getSnapshot().memberRole).toMatchObject({
      status: 'failed',
      message: 'Couldn’t make Sam Chen an admin. Try again.',
    });
    expect(f.sent().filter((call) => call.startsWith('PATCH'))).toEqual([
      `PATCH ${rolePath(samId)}`,
    ]);
    expect(roleOf(f, samId)).toBe('member');
  });

  it('confirms a change whose reply was lost once the server shows it made', async () => {
    const f = await onMembers();
    f.answerRole((userId, role) => {
      // The server made the change, then the reply was lost on the way back.
      f.setRole(userId, role);
      throw new TypeError('Network request failed');
    });
    await f.controller.changeMemberRole(samId, 'admin');
    expect(roleOf(f, samId)).toBe('admin');
    expect(f.controller.getSnapshot().memberRole).toMatchObject({
      status: 'idle',
      message: null,
      done: 'Sam Chen is now an admin',
    });
    expect(f.roleBodies).toHaveLength(1);
  });

  it('shows the last-admin refusal in the server’s words', async () => {
    const f = await onMembers({ [alexId]: 'admin', [priyaId]: 'admin' });
    const words = 'Maple House needs an admin. Make someone else an admin first.';
    f.answerRole(() => refusal(409, 'LAST_ADMIN', words));
    await f.controller.changeMemberRole(priyaId, 'member');
    expect(f.controller.getSnapshot().memberRole).toMatchObject({
      status: 'failed',
      message: words,
    });
    expect(roleOf(f, priyaId)).toBe('admin');
  });

  it('treats losing the admin role elsewhere as a refusal: the Group stays and reads as the member’s view', async () => {
    const f = await onMembers();
    f.answerRole(() => {
      // Another admin made Alex a member a moment ago.
      f.setRole(alexId, 'member');
      return refusal(403, 'FORBIDDEN', 'Forbidden');
    });
    await f.controller.changeMemberRole(samId, 'admin');
    const shown = f.controller.getSnapshot();
    expect(shown.memberRole).toMatchObject({
      status: 'failed',
      message: 'You’re no longer an admin of Maple House.',
    });
    expect(shown.screen).toBe('members');
    expect(shown.detail).toMatchObject({ status: 'ready', id: groupId });
    expect(roleOf(f, alexId)).toBe('member');
    expect(roleOf(f, samId)).toBe('member');
    // The Group, its saved copies and its place on Home are kept.
    expect(shown.groups.data.map(({ id }) => id)).toEqual([groupId]);
    expect([...f.cache.keys()].some((key) => key.includes(groupId))).toBe(true);
  });

  it('shows the Group as unavailable when the read after a refusal is refused too', async () => {
    const f = await onMembers();
    f.answerRole(() => {
      f.backend.world.groupsByAccount[alexId] = [];
      f.backend.reply('GET', `/api/groups/${groupId}`, () =>
        refusal(403, 'FORBIDDEN', 'Forbidden'),
      );
      return refusal(403, 'FORBIDDEN', 'Forbidden');
    });
    expect([...f.cache.keys()].some((key) => key.includes(groupId))).toBe(true);
    await f.controller.changeMemberRole(samId, 'admin');
    const shown = f.controller.getSnapshot();
    expect(shown.detail).toMatchObject({ status: 'denied', data: null });
    expect(shown.memberRole.status).toBe('idle');
    // As on any refusal: its place on Home and its saved copies go too.
    expect(shown.groups.data.map(({ id }) => id)).toEqual([]);
    await vi.waitFor(() =>
      expect([...f.cache.keys()].filter((key) => key.includes(groupId))).toEqual([]),
    );
  });

  it('says a member removed meanwhile is no longer in the Group', async () => {
    const f = await onMembers();
    f.answerRole(() => {
      f.removeMember(samId);
      return refusal(404, 'NOT_FOUND', 'Group not found');
    });
    await f.controller.changeMemberRole(samId, 'admin');
    const shown = f.controller.getSnapshot();
    expect(shown.detail.data?.members.map(({ user }) => user.id)).toEqual([alexId]);
    expect(shown.memberRole).toMatchObject({
      status: 'idle',
      message: null,
      done: 'Sam Chen is no longer in this Group',
    });
  });

  it('says a member whose options were open is no longer in the Group, while no change runs', async () => {
    const f = await onMembers();
    const held = f.backend.hold('PATCH', rolePath(samId));
    const changing = f.controller.changeMemberRole(samId, 'admin');
    await held.arrived;
    f.controller.noteMemberGone(priyaId, 'Priya Shah');
    expect(f.controller.getSnapshot().memberRole.status).toBe('changing');
    held.release();
    await changing;
    f.controller.noteMemberGone(priyaId, 'Priya Shah');
    expect(f.controller.getSnapshot().memberRole).toMatchObject({
      status: 'idle',
      done: 'Priya Shah is no longer in this Group',
    });
    expect(f.sent().filter((call) => call.startsWith('PATCH'))).toHaveLength(1);
  });

  it('a change answered after Back shows nothing on the Group view', async () => {
    const f = await onMembers();
    const held = f.backend.hold('PATCH', rolePath(samId));
    const changing = f.controller.changeMemberRole(samId, 'admin');
    await held.arrived;
    await f.controller.back();
    f.sent();
    held.release();
    await changing;
    expect(f.controller.getSnapshot()).toMatchObject({
      screen: 'group',
      memberRole: { status: 'idle', done: null, message: null },
    });
    // The change may have been made: the Group view reads the Group again after its answer.
    await vi.waitFor(() => expect(f.sent()).toContain(`GET /api/groups/${groupId}`));
  });

  it('a sign-out while a change is sent publishes nothing of it into the next session', async () => {
    const f = await onMembers();
    const held = f.backend.hold('PATCH', rolePath(samId));
    const changing = f.controller.changeMemberRole(samId, 'admin');
    await held.arrived;
    await f.controller.signOut();
    held.release();
    await changing;
    await f.controller.signIn('sam');
    expect(f.controller.getSnapshot()).toMatchObject({
      auth: { user: { id: samId } },
      screen: 'groups',
      memberRole: { status: 'idle', done: null, message: null, userId: null },
    });
  });

  // #1252 review: a Snackbar says a change was made only when this tap made it.
  it('says nothing was made when the server refused, though the read shows the role already given', async () => {
    const f = await onMembers({ [alexId]: 'admin', [samId]: 'member', [priyaId]: 'admin' });
    const words = 'This Group changed. Reload and try again.';
    f.answerRole((userId, role) => {
      // Another admin gave Sam the role a moment before; this request is refused.
      f.setRole(userId, role);
      return refusal(409, 'GROUP_CHANGED', words);
    });
    await f.controller.changeMemberRole(samId, 'admin');
    expect(roleOf(f, samId)).toBe('admin');
    expect(f.controller.getSnapshot().memberRole).toMatchObject({
      status: 'failed',
      message: words,
      done: null,
    });
  });

  // #1253 review: a refusal whose read shows you a member is explained as that, whatever its code.
  it('says you are no longer an admin when the read after any refusal shows it', async () => {
    const f = await onMembers();
    f.answerRole(() => {
      f.setRole(alexId, 'member');
      return refusal(409, 'GROUP_CHANGED', 'This Group changed. Reload and try again.');
    });
    await f.controller.changeMemberRole(samId, 'admin');
    expect(f.controller.getSnapshot().memberRole).toMatchObject({
      status: 'failed',
      message: 'You’re no longer an admin of Maple House.',
    });
  });

  it('says nothing when the read after a change shows another role: the list speaks', async () => {
    const f = await onMembers();
    f.answerRole((userId, role) => {
      // Made, then put back by another admin before the read.
      f.setRole(userId, role);
      const answered = Response.json({
        data: structuredClone(f.backend.world.groups[0]),
        status: 200,
      });
      f.setRole(userId, 'member');
      return answered;
    });
    await f.controller.changeMemberRole(samId, 'admin');
    expect(roleOf(f, samId)).toBe('member');
    expect(f.controller.getSnapshot().memberRole).toMatchObject({
      status: 'idle',
      message: null,
      done: null,
    });
  });

  it('sends no second change while the first is unanswered, across a visit to the Group', async () => {
    const f = await onMembers({ [alexId]: 'admin', [samId]: 'member', [priyaId]: 'member' });
    const held = f.backend.hold('PATCH', rolePath(samId));
    const first = f.controller.changeMemberRole(samId, 'admin');
    await held.arrived;
    await f.controller.back();
    f.controller.openMembers();
    // The later visit shows the change still being made: its row busy, the options waiting.
    expect(f.controller.getSnapshot().memberRole).toMatchObject({
      status: 'changing',
      userId: samId,
      role: 'admin',
    });
    await f.controller.changeMemberRole(priyaId, 'admin');
    expect(f.roleBodies).toEqual([{ role: 'admin' }]);
    held.release();
    await first;
    expect(f.controller.getSnapshot().memberRole.status).toBe('idle');
    await f.controller.changeMemberRole(priyaId, 'admin');
    expect(f.roleBodies).toEqual([{ role: 'admin' }, { role: 'admin' }]);
  });

  it('leaving the page clears a failure', async () => {
    const f = await onMembers();
    f.answerRole(() => Response.json({ error: 'Internal error' }, { status: 500 }));
    await f.controller.changeMemberRole(samId, 'admin');
    expect(f.controller.getSnapshot().memberRole.status).toBe('failed');
    await f.controller.back();
    expect(f.controller.getSnapshot().memberRole).toMatchObject({ status: 'idle', message: null });
  });

  it('a new change clears an earlier failure', async () => {
    const f = await onMembers();
    f.answerRole(() => Response.json({ error: 'Internal error' }, { status: 500 }));
    await f.controller.changeMemberRole(samId, 'admin');
    expect(f.controller.getSnapshot().memberRole.status).toBe('failed');
    f.answerRole(() => undefined);
    await f.controller.changeMemberRole(samId, 'admin');
    expect(f.controller.getSnapshot().memberRole).toMatchObject({
      status: 'idle',
      message: null,
      done: 'Sam Chen is now an admin',
    });
  });
});
