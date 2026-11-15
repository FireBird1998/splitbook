import { testPhone } from '../test-utils/test-phone';
import { fakeSplitbook } from '../test-utils/fake-splitbook';
import { describe, expect, it } from 'vitest';

// An admin makes a member an admin or a member on Members and Group details (#1252). Fictional
// people and Groups only.
const alexId = 'a00000000000000000000001',
  samId = 'a00000000000000000000002',
  priyaId = 'a00000000000000000000003';
const groupId = 'b00000000000000000000001';
const iso = '2026-11-15T12:00:00.000Z',
  now = Date.parse(iso);
const person = (id: string, name: string, slug: string) => ({
  id,
  name,
  email: `${slug}@example.test`,
  image: null,
});
const alex = person(alexId, 'Alex Rivera', 'alex'),
  sam = person(samId, 'Sam Chen', 'sam'),
  priya = person(priyaId, 'Priya Shah', 'priya');
type Role = 'admin' | 'member';

function fixture(roles: Record<string, Role> = { [alexId]: 'admin', [samId]: 'member' }) {
  const people = [alex, sam, priya].filter(({ id }) => roles[id]);
  const group = {
    _id: groupId,
    name: 'Maple House',
    createdBy: alexId,
    category: 'home',
    defaultCurrency: 'INR',
    members: people.map(({ id, ...user }) => ({
      user: { ...user, _id: id },
      role: roles[id],
      joinedAt: iso,
    })),
    tags: [],
    createdAt: iso,
    updatedAt: iso,
  };
  const backend = fakeSplitbook();
  backend.world.people.alex = alex;
  backend.world.people.sam = sam;
  backend.world.people.priya = priya;
  backend.world.groups = [group];
  backend.world.groupsByAccount[alexId] = [group];
  backend.world.home = { buckets: [], groups: [{ groupId, balances: [] }] };
  backend.world.expenses[groupId] = {
    expenses: [],
    pagination: { page: 1, limit: 20, total: 0, totalPages: 0 },
    summary: { count: 0, totalsByCurrency: [], userOwes: 0, userGetsBack: 0, byMember: [] },
  };
  backend.world.balances[groupId] = { byCurrency: [] };
  /** What the server holds: a role change the server made shows in every later read. */
  const setRole = (userId: string, role: Role) => {
    const member = group.members.find(({ user }) => user._id === userId);
    if (member) member.role = role;
  };
  const removeMember = (userId: string) => {
    group.members = group.members.filter(({ user }) => user._id !== userId);
  };
  let answer: ((userId: string, role: Role) => Response | undefined) | null = null;
  const roleBodies: unknown[] = [];
  backend.reply('PATCH', '*', ({ url, body }) => {
    const match = new RegExp(`^/api/groups/${groupId}/members/([a-f\\d]{24})$`).exec(url.pathname);
    if (!match) return undefined;
    roleBodies.push(body);
    const role = body?.role as Role;
    const special = answer?.(match[1], role);
    if (special) return special;
    setRole(match[1], role);
    return Response.json({ data: group, status: 200 });
  });
  const phone = testPhone(backend, {
    origin: 'http://localhost:4147',
    now,
    parts: {
      pendingInvitation: undefined,
      draftRequests: undefined,
      tagRequests: undefined,
      groupCreations: undefined,
      netInfo: undefined,
      newSubmissionKey: undefined,
    },
  });
  phone.stores.owner.value = alexId;
  const controller = phone.open();
  return {
    controller,
    backend,
    roleBodies,
    setRole,
    removeMember,
    /** How the server answers the next role changes; undefined lets it make the change. */
    answer: (respond: (userId: string, role: Role) => Response | undefined) => {
      answer = respond;
    },
    /** Requests made since the last call, as "METHOD /path". */
    sent: (() => {
      let seen = 0;
      return () => {
        const all = backend.sent({ query: false });
        const fresh = all.slice(seen);
        seen = all.length;
        return fresh;
      };
    })(),
    cache: phone.stores.savedQueries.records,
  };
}

/** Signed in as Alex, on Maple House's Members and Group details. */
async function onMembers(roles?: Record<string, Role>) {
  const f = fixture(roles);
  await f.controller.signIn('alex');
  await f.controller.openGroup(groupId);
  f.controller.openMembers();
  f.sent();
  return f;
}

const rolePath = (userId: string) => `/api/groups/${groupId}/members/${userId}`;
const roleOf = (f: ReturnType<typeof fixture>, userId: string) =>
  f.controller.getSnapshot().detail.data?.members.find(({ user }) => user.id === userId)?.role;
const refusal = (status: number, code: string, error: string) =>
  Response.json({ error, status, code }, { status });

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
    f.answer(() => Response.json({ error: 'Internal error' }, { status: 500 }));
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
    f.answer((userId, role) => {
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
    f.answer(() => refusal(409, 'LAST_ADMIN', words));
    await f.controller.changeMemberRole(priyaId, 'member');
    expect(f.controller.getSnapshot().memberRole).toMatchObject({
      status: 'failed',
      message: words,
    });
    expect(roleOf(f, priyaId)).toBe('admin');
  });

  it('treats losing the admin role elsewhere as a refusal: the Group stays and reads as the member’s view', async () => {
    const f = await onMembers();
    f.answer(() => {
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
    f.answer(() => {
      f.backend.world.groupsByAccount[alexId] = [];
      f.backend.reply('GET', `/api/groups/${groupId}`, () =>
        refusal(403, 'FORBIDDEN', 'Forbidden'),
      );
      return refusal(403, 'FORBIDDEN', 'Forbidden');
    });
    await f.controller.changeMemberRole(samId, 'admin');
    const shown = f.controller.getSnapshot();
    expect(shown.detail).toMatchObject({ status: 'denied', data: null });
    expect(shown.memberRole.status).toBe('idle');
  });

  it('says a member removed meanwhile is no longer in the Group', async () => {
    const f = await onMembers();
    f.answer(() => {
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

  it('a change answered after Back shows nothing on the Group view', async () => {
    const f = await onMembers();
    const held = f.backend.hold('PATCH', rolePath(samId));
    const changing = f.controller.changeMemberRole(samId, 'admin');
    await held.arrived;
    await f.controller.back();
    held.release();
    await changing;
    expect(f.controller.getSnapshot()).toMatchObject({
      screen: 'group',
      memberRole: { status: 'idle', done: null, message: null },
    });
  });

  it('a new change clears an earlier failure', async () => {
    const f = await onMembers();
    f.answer(() => Response.json({ error: 'Internal error' }, { status: 500 }));
    await f.controller.changeMemberRole(samId, 'admin');
    expect(f.controller.getSnapshot().memberRole.status).toBe('failed');
    f.answer(() => undefined);
    await f.controller.changeMemberRole(samId, 'admin');
    expect(f.controller.getSnapshot().memberRole).toMatchObject({
      status: 'idle',
      message: null,
      done: 'Sam Chen is now an admin',
    });
  });
});
