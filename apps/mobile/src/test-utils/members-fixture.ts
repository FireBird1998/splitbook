import { testPhone } from './test-phone';
import { fakeSplitbook } from './fake-splitbook';

// Maple House on a fake Splitbook, for an admin's changes on Members and Group details: role
// changes (#1252) and removals (#1253). Fictional people and Groups only.
export const alexId = 'a00000000000000000000001',
  samId = 'a00000000000000000000002',
  priyaId = 'a00000000000000000000003';
export const groupId = 'b00000000000000000000001';
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
export type Role = 'admin' | 'member';

/** Maple House with these members and roles; Alex's phone open on it, not yet signed in. */
export function membersFixture(roles: Record<string, Role>) {
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
  /** What the server holds: a change it made shows in every later read. */
  const setRole = (userId: string, role: Role) => {
    const member = group.members.find(({ user }) => user._id === userId);
    if (member) member.role = role;
  };
  const removeMember = (userId: string) => {
    group.members = group.members.filter(({ user }) => user._id !== userId);
  };
  const memberRoute = new RegExp(`^/api/groups/${groupId}/members/([a-f\\d]{24})$`);
  let roleAnswer: ((userId: string, role: Role) => Response | undefined) | null = null,
    removalAnswer: ((userId: string) => Response | undefined) | null = null;
  const roleBodies: unknown[] = [];
  backend.reply('PATCH', '*', ({ url, body }) => {
    const match = memberRoute.exec(url.pathname);
    if (!match) return undefined;
    roleBodies.push(body);
    const role = body?.role as Role;
    const special = roleAnswer?.(match[1], role);
    if (special) return special;
    setRole(match[1], role);
    return Response.json({ data: group, status: 200 });
  });
  backend.reply('DELETE', '*', ({ url }) => {
    const match = memberRoute.exec(url.pathname);
    if (!match) return undefined;
    const special = removalAnswer?.(match[1]);
    if (special) return special;
    removeMember(match[1]);
    return Response.json({ data: { message: 'Member removed' }, status: 200 });
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
  let seen = 0;
  return {
    controller,
    backend,
    roleBodies,
    setRole,
    removeMember,
    /** How the server answers the next role changes; undefined lets it make the change. */
    answerRole: (respond: (userId: string, role: Role) => Response | undefined) => {
      roleAnswer = respond;
    },
    /** How the server answers the next removals; undefined lets it remove them. */
    answerRemoval: (respond: (userId: string) => Response | undefined) => {
      removalAnswer = respond;
    },
    /** Requests made since the last call, as "METHOD /path". */
    sent: () => {
      const all = backend.sent({ query: false });
      const fresh = all.slice(seen);
      seen = all.length;
      return fresh;
    },
    cache: phone.stores.savedQueries.records,
  };
}
export type MembersFixture = ReturnType<typeof membersFixture>;

/** Signed in as Alex, on Maple House's Members and Group details. */
export async function onMembersPage(roles: Record<string, Role>) {
  const f = membersFixture(roles);
  await f.controller.signIn('alex');
  await f.controller.openGroup(groupId);
  f.controller.openMembers();
  f.sent();
  return f;
}

/** A refusal as the server answers it. */
export const refusal = (status: number, code: string, error: string, extra: object = {}) =>
  Response.json({ error, status, code, ...extra }, { status });
