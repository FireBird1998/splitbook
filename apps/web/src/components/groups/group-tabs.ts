/**
 * A Group page's tabs as addresses (#305): each tab is a route under the Group, so reloading,
 * Back and a shared link all land on it. The routes, the tab bar, the sidebar's current Group
 * and the redirect for old links all read from here, so they always agree.
 */

/** The tabs, in the order the design canvas ("Web portal") shows them. */
export const GROUP_TABS = [
  { slug: 'expenses', label: 'Expenses' },
  { slug: 'balances', label: 'Balances' },
  // The Month against the Months before it (#314); a Trip's is its Trip summary (#316).
  { slug: 'insights', label: 'Insights' },
  { slug: 'activity', label: 'Activity' },
  { slug: 'members', label: 'Members' },
] as const;

export type GroupTab = (typeof GROUP_TABS)[number]['slug'];

/** Where a Group opens: `/groups/[id]` itself lands here. */
export const DEFAULT_GROUP_TAB: GroupTab = 'expenses';

const TAB_SLUGS: ReadonlySet<string> = new Set(GROUP_TABS.map((tab) => tab.slug));

export function isGroupTab(value: unknown): value is GroupTab {
  return typeof value === 'string' && TAB_SLUGS.has(value);
}

function groupPath(groupId: string) {
  return `/groups/${encodeURIComponent(groupId)}`;
}

/** A tab's address, with an optional query (`month=2026-08`). */
export function groupTabHref(
  groupId: string,
  tab: GroupTab,
  query?: URLSearchParams | string,
): string {
  const search = query === undefined ? '' : query.toString();
  return `${groupPath(groupId)}/${tab}${search ? `?${search}` : ''}`;
}

export function groupSettingsHref(groupId: string): string {
  return `${groupPath(groupId)}/settings`;
}

/** The Group settings' Recurring section, where recurring Expenses are managed (#315). */
export const RECURRING_SECTION_ID = 'recurring-expenses';

/** The Recurring section of a Group's settings: the Insights tab's Manage (#315). */
export function recurringSettingsHref(groupId: string): string {
  return `${groupSettingsHref(groupId)}#${RECURRING_SECTION_ID}`;
}

const TAB_PATH = /^\/groups\/[^/]+\/([^/]+)\/?$/;

/** The tab a path shows, or null when the path is not one of a Group's tabs. */
export function groupTabFromPath(pathname: string): GroupTab | null {
  const segment = TAB_PATH.exec(pathname)?.[1];
  return isGroupTab(segment) ? segment : null;
}

/** A page's search params as Next hands them to a server component. */
export type SearchParamsRecord = Record<string, string | string[] | undefined>;

/**
 * Where a link to the Group's own address lands. Old links keep working (#305):
 * `?tab=balances` opens the Balances tab, any other link opens Expenses, and every other
 * parameter goes along, so `?action=add-expense` still opens the Expense form and `?month=`
 * still picks a Household's Month.
 */
export function groupLandingHref(groupId: string, searchParams: SearchParamsRecord = {}): string {
  const query = new URLSearchParams();
  let tab: GroupTab = DEFAULT_GROUP_TAB;
  for (const [key, raw] of Object.entries(searchParams)) {
    if (raw === undefined) continue;
    const values = Array.isArray(raw) ? raw : [raw];
    if (key === 'tab') {
      if (isGroupTab(values[0])) tab = values[0];
      continue;
    }
    for (const value of values) query.append(key, value);
  }
  return groupTabHref(groupId, tab, query);
}

/** "Household · 3 members · INR": the line under the Group's name. */
export function groupSummaryLine(themeLabel: string, memberCount: number, currency: string) {
  return [themeLabel, `${memberCount} ${memberCount === 1 ? 'member' : 'members'}`, currency].join(
    ' · ',
  );
}

export interface GroupPerson {
  _id: string;
  name: string;
  image?: string | null;
}

/** The members with the viewer first, as the header's avatars and the roster show them. */
export function viewerFirst<T extends { user: { _id: string } }>(
  members: T[],
  userId: string,
): T[] {
  const viewer = members.filter((member) => member.user._id === userId);
  return [...viewer, ...members.filter((member) => member.user._id !== userId)];
}

/** "Members: you, Sam Chen and Priya Shah": what the header's avatars say, viewer first. */
export function membersLabel(people: GroupPerson[], userId: string): string {
  const names = viewerFirst(
    people.map((person) => ({ user: person })),
    userId,
  ).map(({ user }) => (user._id === userId ? 'you' : user.name));
  if (names.length === 0) return 'No members';
  const list =
    names.length === 1 ? names[0] : `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`;
  return `Members: ${list}`;
}

export type GroupRole = 'admin' | 'member';

export interface RosterRow {
  id: string;
  name: string;
  image?: string;
  role: GroupRole;
  roleLabel: 'Admin' | 'Member';
  isViewer: boolean;
}

/**
 * The Members tab's rows: each member's name and role, the viewer first. Built field by field
 * so nothing else the Group read carries about a member (their email) can reach the page.
 */
export function memberRoster(
  members: Array<{ user: GroupPerson; role: GroupRole }>,
  userId: string,
): RosterRow[] {
  return viewerFirst(members, userId).map(({ user, role }) => ({
    id: user._id,
    name: user.name,
    image: user.image ?? undefined,
    role,
    roleLabel: role === 'admin' ? 'Admin' : 'Member',
    isViewer: user._id === userId,
  }));
}
