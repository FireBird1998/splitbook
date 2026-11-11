import { readIds, type ReadCase } from './fixture';
export type ReadParams = { id?: string; expenseId?: string; requestId?: string };
export interface ReadModule {
  GET?(request: Request, context: { params: Promise<ReadParams> }): Promise<Response>;
  POST?(request: Request, context: { params: Promise<ReadParams> }): Promise<Response>;
}
export interface HttpRead {
  name: string;
  file: string;
  load: () => Promise<ReadModule>;
  path: (groupId: string) => string;
  addsDue: boolean;
  scope: 'group' | 'across' | 'export';
  memberStatus?: number;
  method?: 'GET' | 'POST';
  body?: (state: ReadCase) => unknown;
}
const group = (suffix: string) => (id: string) => `/api/groups/${id}${suffix}`;
export const groupSections = ['core', 'details', 'settings', 'drafts'] as const;
export type GroupRead = HttpRead & { section: (typeof groupSections)[number] };
export const groupReads: GroupRead[] = [
  {
    name: 'Group',
    section: 'core',
    file: 'groups/[id]/route.ts',
    load: () => import('@/app/api/groups/[id]/route'),
    path: group(''),
    addsDue: true,
    scope: 'group',
  },
  {
    name: 'Expenses',
    section: 'core',
    file: 'groups/[id]/expenses/route.ts',
    load: () => import('@/app/api/groups/[id]/expenses/route'),
    path: group(
      '/expenses?sortBy=date&sortOrder=asc&includeMemberBreakdown=1&includeUserByCurrency=1&includeRecurringCount=1',
    ),
    addsDue: true,
    scope: 'group',
  },
  {
    name: 'Balances',
    section: 'core',
    file: 'groups/[id]/balances/route.ts',
    load: () => import('@/app/api/groups/[id]/balances/route'),
    path: group('/balances'),
    addsDue: true,
    scope: 'group',
  },
  {
    name: 'Activity',
    section: 'core',
    file: 'groups/[id]/activity/route.ts',
    load: () => import('@/app/api/groups/[id]/activity/route'),
    path: group('/activity'),
    addsDue: false,
    scope: 'group',
  },
  {
    name: 'One Expense',
    section: 'details',
    file: 'groups/[id]/expenses/[expenseId]/route.ts',
    load: () => import('@/app/api/groups/[id]/expenses/[expenseId]/route'),
    path: group('/expenses/e10000000000000000000001'),
    addsDue: false,
    scope: 'group',
  },
  {
    name: 'Duplicate warning',
    section: 'details',
    file: 'groups/[id]/expenses/check-duplicate/route.ts',
    load: () => import('@/app/api/groups/[id]/expenses/check-duplicate/route'),
    path: group('/expenses/check-duplicate?description=Due%20rent&amount=600&date=2026-11-01'),
    addsDue: false,
    scope: 'group',
  },
  {
    name: 'Payments',
    section: 'details',
    file: 'groups/[id]/settlements/route.ts',
    load: () => import('@/app/api/groups/[id]/settlements/route'),
    path: group('/settlements'),
    addsDue: false,
    scope: 'group',
  },
  {
    name: 'Insights',
    section: 'details',
    file: 'groups/[id]/insights/route.ts',
    load: () => import('@/app/api/groups/[id]/insights/route'),
    path: group('/insights?tz=UTC&month=2026-11&compare=1'),
    addsDue: true,
    scope: 'group',
  },
  {
    name: 'Recurring templates',
    section: 'details',
    file: 'groups/[id]/recurring/route.ts',
    load: () => import('@/app/api/groups/[id]/recurring/route'),
    path: group('/recurring'),
    addsDue: false,
    scope: 'group',
  },
  {
    name: 'Currencies',
    section: 'settings',
    file: 'groups/[id]/currencies/route.ts',
    load: () => import('@/app/api/groups/[id]/currencies/route'),
    path: group('/currencies'),
    addsDue: false,
    scope: 'group',
  },
  {
    name: 'Rate suggestion',
    section: 'settings',
    file: 'groups/[id]/rates/route.ts',
    load: () => import('@/app/api/groups/[id]/rates/route'),
    path: group('/rates?from=INR&to=EUR'),
    addsDue: false,
    scope: 'group',
  },
  {
    name: 'Tags',
    section: 'settings',
    file: 'groups/[id]/tag-actions/route.ts',
    load: () => import('@/app/api/groups/[id]/tag-actions/route'),
    path: group('/tag-actions'),
    addsDue: false,
    scope: 'group',
  },
  {
    name: 'Tag receipt',
    section: 'settings',
    file: 'groups/[id]/tag-actions/[requestId]/route.ts',
    load: () => import('@/app/api/groups/[id]/tag-actions/[requestId]/route'),
    path: group('/tag-actions/00000000-0000-4000-8000-000000001120'),
    addsDue: false,
    scope: 'group',
  },
  {
    name: 'Invite link',
    section: 'settings',
    file: 'groups/[id]/invite-link/route.ts',
    load: () => import('@/app/api/groups/[id]/invite-link/route'),
    path: group('/invite-link'),
    addsDue: false,
    scope: 'group',
  },
  {
    name: 'Assistant reach',
    section: 'settings',
    memberStatus: 403,
    file: 'groups/[id]/assistant-reach/route.ts',
    load: () => import('@/app/api/groups/[id]/assistant-reach/route'),
    path: group('/assistant-reach'),
    addsDue: false,
    scope: 'group',
  },
  {
    name: 'Trip summary',
    section: 'settings',
    memberStatus: 409,
    file: 'groups/[id]/trip-summary/route.ts',
    load: () => import('@/app/api/groups/[id]/trip-summary/route'),
    path: group('/trip-summary?tz=UTC'),
    addsDue: false,
    scope: 'group',
  },
  {
    name: 'Drafts',
    section: 'drafts',
    file: 'groups/[id]/drafts/route.ts',
    load: () => import('@/app/api/groups/[id]/drafts/route'),
    path: group('/drafts'),
    addsDue: false,
    scope: 'group',
  },
  {
    name: 'Draft review',
    section: 'drafts',
    file: 'groups/[id]/drafts/review/route.ts',
    method: 'POST',
    load: () => import('@/app/api/groups/[id]/drafts/review/route'),
    path: group('/drafts/review'),
    body: (state) => ({ ids: [state === 'admin' ? readIds.otherDraft : readIds.draft] }),
    addsDue: false,
    scope: 'group',
  },
];
export const acrossReads: HttpRead[] = [
  {
    name: 'Groups list',
    file: 'groups/route.ts',
    load: () => import('@/app/api/groups/route'),
    path: () => '/api/groups',
    addsDue: false,
    scope: 'across',
  },
  {
    name: 'Home balances',
    file: 'user/balances/route.ts',
    load: () => import('@/app/api/user/balances/route'),
    path: () => '/api/user/balances',
    addsDue: true,
    scope: 'across',
  },
  {
    name: 'Spending',
    file: 'user/spending/route.ts',
    load: () => import('@/app/api/user/spending/route'),
    path: () => '/api/user/spending?tz=UTC&months=3',
    addsDue: true,
    scope: 'across',
  },
  {
    name: 'Home Activity',
    file: 'user/activity/route.ts',
    load: () => import('@/app/api/user/activity/route'),
    path: () => '/api/user/activity',
    addsDue: false,
    scope: 'across',
  },
  {
    name: 'Search',
    file: 'search/route.ts',
    load: () => import('@/app/api/search/route'),
    path: () => '/api/search?q=rent',
    addsDue: false,
    scope: 'across',
  },
  {
    name: 'To review',
    file: 'user/to-review/route.ts',
    load: () => import('@/app/api/user/to-review/route'),
    path: () => '/api/user/to-review',
    addsDue: false,
    scope: 'across',
  },
  {
    name: 'Assistant approval list',
    file: 'user/assistant-groups/route.ts',
    load: () => import('@/app/api/user/assistant-groups/route'),
    path: () => '/api/user/assistant-groups',
    addsDue: false,
    scope: 'across',
  },
];
export const exportReads: HttpRead[] = [
  ...['csv', 'json', 'statement'].map((format) => ({
    name: `Export ${format} preview`,
    file: 'export/route.ts',
    load: () => import('@/app/api/export/route'),
    path: (id: string) =>
      `/api/export?groups=${id}&format=${format}&preview=1&include=payments,shares,history&tz=UTC`,
    addsDue: true,
    scope: 'export' as const,
  })),
  ...['csv', 'json'].map((format) => ({
    name: `Export ${format} download`,
    file: 'export/route.ts',
    load: () => import('@/app/api/export/route'),
    path: (id: string) =>
      `/api/export?groups=${id}&format=${format}&include=payments,shares,history&tz=UTC`,
    addsDue: true,
    scope: 'export' as const,
  })),
];
export const acrossCases: readonly ReadCase[] = [
  'member',
  'admin',
  'left',
  'outsider',
  'archived',
  'deleting',
  'deletion-marker',
];
export const inapplicableReadCases = {
  across: ['missing', 'malformed'],
  reason:
    'Across-Group reads accept no Group id. Left and outsider cases retain an accessible control Group to show filtering.',
  httpAssistantRestrictions:
    'Excluded Group and Not allowed restrict a Connected assistant, not a member HTTP request.',
};
