# Architecture

## Tech Stack Detail

| Component    | Choice          | Why                                                  |
| ------------ | --------------- | ---------------------------------------------------- |
| Next.js 16   | App Router      | Server components, API routes, middleware, SSR       |
| TypeScript 5 | Strict mode     | Type safety across frontend + backend                |
| React 19     | Latest          | Server components, concurrent features               |
| Material UI  | v7 (Emotion)    | Full design system — layout, styling, and components |
| MongoDB      | Atlas (cloud)   | Flexible schema, good for nested expense data        |
| Mongoose     | v9              | Schema validation, middleware, population            |
| Better Auth  | MongoDB adapter | Self-hosted auth; Google OAuth + demo personas       |
| Zod          | v4              | Type-safe validation with TS inference               |
| SWR          | v2              | Client data fetching, caching, revalidation          |

---

## Folder Structure

Splitbook is a pnpm workspace. The Next.js app is the `apps/web` package
(`@splitbook/web`). Workspace-wide scripts (`lint`, `typecheck`, `test`, `format`)
run at the root across every package; other app scripts run as `pnpm web <script>`
(the rule is spelled out in the [README](../README.md#repository-layout)).
Future clients go under `apps/*` and shared code under `packages/*`
(see [ADR 0001](adr/0001-pnpm-workspace-monorepo.md)).

```
splitbook/
├── package.json            # workspace root: delegating scripts, packageManager pin, Prettier
├── pnpm-workspace.yaml     # apps/*, packages/*
├── pnpm-lock.yaml
├── .github/workflows/      # CI runs the app steps inside apps/web
├── docs/                   # this documentation
├── apps/
│   └── web/                # the Next.js app — the tree below
└── packages/shared/        # @splitbook/shared: types, validators, pure domain logic
```

Everything below is relative to `apps/web/`.

```
src/
├── app/
│   ├── (auth)/                     # Auth route group (no sidebar)
│   │   └── login/
│   │       └── page.tsx
│   ├── (main)/                     # Authenticated route group (with sidebar)
│   │   ├── layout.tsx              # Session guards + AppShell (sidebar, top bar, main)
│   │   ├── dashboard/
│   │   │   └── page.tsx            # Home (the route stays /dashboard)
│   │   ├── groups/
│   │   │   ├── page.tsx            # List all groups
│   │   │   ├── new/
│   │   │   │   └── page.tsx        # Create group form (theme picker first)
│   │   │   └── [id]/
│   │   │       ├── page.tsx        # Redirect: lands on Expenses; old ?tab= and ?action= links
│   │   │       ├── (tabs)/         # One route per tab (#305)
│   │   │       │   ├── layout.tsx  # Group read, header, trip strip, tabs, dialogs
│   │   │       │   ├── expenses/page.tsx
│   │   │       │   ├── balances/page.tsx
│   │   │       │   ├── activity/page.tsx
│   │   │       │   └── members/page.tsx
│   │   │       └── settings/
│   │   │           └── page.tsx    # Group settings (admin)
│   │   └── settings/
│   │       └── page.tsx            # User settings
│   ├── api/
│   │   ├── auth/
│   │   │   └── [...all]/
│   │   │       └── route.ts        # Better Auth catch-all
│   │   ├── groups/
│   │   │   ├── route.ts            # POST (create), GET (list — no query params)
│   │   │   └── [id]/
│   │   │       ├── route.ts        # GET, PATCH, DELETE
│   │   │       ├── expenses/
│   │   │       │   ├── route.ts    # POST (create), GET (list + filters + summary)
│   │   │       │   ├── check-duplicate/
│   │   │       │   │   └── route.ts # GET (duplicate check)
│   │   │       │   └── [expenseId]/
│   │   │       │       └── route.ts # GET, PATCH, DELETE
│   │   │       ├── recurring/      # Household-only templates (admin writes)
│   │   │       │   ├── route.ts    # POST (create), GET (list)
│   │   │       │   └── [recurringId]/
│   │   │       │       └── route.ts # PATCH (edit/pause), DELETE
│   │   │       ├── settlements/
│   │   │       │   └── route.ts    # POST, GET
│   │   │       ├── balances/
│   │   │       │   └── route.ts    # GET (balances + simplified debts)
│   │   │       ├── activity/
│   │   │       │   └── route.ts    # GET (paginated)
│   │   │       ├── invite/
│   │   │       │   └── route.ts    # POST (send invite)
│   │   │       ├── invite-link/
│   │   │       │   └── route.ts    # POST (generate), GET (info)
│   │   │       ├── tags/
│   │   │       │   ├── route.ts    # POST (create tag)
│   │   │       │   └── [tagId]/
│   │   │       │       └── route.ts # PATCH (archive/rename), DELETE
│   │   │       └── members/
│   │   │           └── [userId]/
│   │   │               └── route.ts # PATCH (role), DELETE (remove)
│   │   ├── invitations/
│   │   │   ├── route.ts            # GET (my pending)
│   │   │   └── [id]/
│   │   │       └── route.ts        # POST (accept/reject)
│   │   ├── join/
│   │   │   └── [code]/
│   │   │       └── route.ts        # GET (public preview), POST (join via link)
│   │   └── user/
│   │       ├── activity/
│   │       │   └── route.ts        # GET (latest Activity across the member's Groups)
│   │       ├── profile/
│   │       │   └── route.ts        # GET, PATCH
│   │       └── balances/
│   │           └── route.ts        # GET (cross-group, bucketed by currency)
│   ├── join/
│   │   └── [code]/
│   │       └── page.tsx            # Join group page (public)
│   ├── layout.tsx                  # Root layout (providers, fonts)
│   ├── page.tsx                    # Landing / persona picker (redirect if auth'd)
│   └── globals.css                 # Minimal (body margin reset only)
├── components/
│   ├── layout/
│   │   ├── AppShell.tsx            # Sidebar (lg+) or drawer, top bar, main up to 1320 px
│   │   ├── Sidebar.tsx             # Logo, Home, Group list, Settings, account
│   │   ├── SidebarGroups.tsx       # Live Group list with each Group's balance line
│   │   ├── TopBar.tsx              # Menu button + logo (phones), demo badge, theme switch, Add expense
│   │   ├── AccountMenu.tsx         # Avatar + name; Settings and Sign out
│   │   ├── BrandLogo.tsx
│   │   └── BrandMark.tsx
│   ├── landing/
│   │   └── LandingPage.tsx         # Public landing page
│   ├── auth/
│   │   ├── LoginForm.tsx           # Google button
│   │   └── DemoLoginClient.tsx     # Demo persona sign-in
│   ├── demo/
│   │   ├── DemoModeBadge.tsx       # Top bar badge while demo auth is active
│   │   └── DemoPersonaPicker.tsx
│   ├── trip/
│   │   └── TripStrip.tsx           # Boarding-pass header — trip theme only
│   ├── groups/
│   │   ├── GroupCard.tsx
│   │   ├── GroupsListView.tsx
│   │   ├── GroupDetailView.tsx     # The Group page's layout around its tabs
│   │   ├── GroupPageHeader.tsx     # Icon, name, Theme · members · currency, avatars, Invite
│   │   ├── GroupTabs.tsx           # Tabs as links: Expenses, Balances, Activity, Members
│   │   ├── group-tabs.ts           # Tab addresses, old-link redirect, roster (pure)
│   │   ├── GroupExpensesTab.tsx    # Month bar (Household) + Expense list
│   │   ├── GroupTabPanels.tsx      # Balances, Activity and Members tabs
│   │   ├── GroupMembersView.tsx    # Read-only roster with roles and Invite
│   │   ├── GroupHeader.tsx         # Neutral header — non-trip Group cards
│   │   ├── GroupSettingsView.tsx   # Admin settings (info, currency, members, tags)
│   │   ├── MonthCycleBar.tsx       # Household Month bar: Spent, Your share, You paid
│   │   ├── MonthMemberTable.tsx    # Per-member paid/share/net for the month
│   │   ├── RecurringExpensesSection.tsx
│   │   └── InviteDialog.tsx
│   ├── expenses/
│   │   ├── ExpenseListView.tsx     # Toolbar, summary, table or cards (#310)
│   │   ├── ExpenseToolbar.tsx      # Search, filters and sort, kept in the address
│   │   ├── ExpenseTable.tsx        # The table on computers
│   │   ├── ExpenseCard.tsx         # A card on phones
│   │   ├── ExpenseDetails.tsx      # An opened Expense, with Edit and Delete
│   │   ├── expense-list-query.ts   # The view ↔ the address (pure)
│   │   ├── ExpenseFormDialog.tsx   # Create + edit (two-tier form)
│   │   ├── DeleteExpenseDialog.tsx
│   │   ├── AddExpenseLauncher.tsx  # Top bar Add expense: the Group's form, or choose a Group first
│   │   ├── GroupChooserDialog.tsx  # "Choose a Group": active Groups only
│   │   ├── add-expense.ts          # Pure, unit-tested
│   │   ├── expense-form-helpers.ts # Pure, unit-tested
│   │   └── expense-duplicate-check.ts
│   ├── settlements/
│   │   └── SettleUpDialog.tsx
│   ├── balances/
│   │   └── BalancesView.tsx        # Balance summary + simplified debts
│   ├── dashboard/
│   │   ├── DashboardView.tsx       # Groups overview + invitations
│   │   ├── InvitationCard.tsx
│   │   └── LatestChangesCard.tsx   # Home's latest changes across Groups (#309)
│   ├── activity/
│   │   └── ActivityView.tsx        # Activity feed (single page, no Load More)
│   ├── join/
│   │   └── JoinGroupClient.tsx
│   └── common/
│       └── MoneyText.tsx           # Money typography treatment
├── lib/
│   ├── auth.ts                     # Better Auth instance + MongoDB adapter (Node runtime)
│   ├── auth-client.ts              # Browser client (signInWithGoogle, signOutToHome)
│   ├── auth/                       # allowlist, proxy-rules, create-auth, demo persona
│   │                               # plugin (+ client), test-id-token, migrate-auth
│   │                               #   callbacks, route protection
│   ├── auth-mode.ts                # AUTH_MODE resolution + production guard
│   ├── demo-personas.ts
│   ├── db.ts                       # Mongoose connection singleton (server-only)
│   ├── mongodb-client.ts           # Native driver Db for Better Auth's adapter (server-only)
│   ├── models/
│   │   ├── User.ts
│   │   ├── Group.ts                # Includes tags subdocument array
│   │   ├── Expense.ts              # Uses `tag` (singular, required)
│   │   ├── RecurringExpense.ts     # Household templates
│   │   ├── Settlement.ts
│   │   ├── Activity.ts
│   │   └── Invitation.ts
│   ├── services/
│   │   ├── group.service.ts        # Includes tag CRUD + member management
│   │   ├── expense.service.ts      # Includes summary aggregation
│   │   ├── recurring-expense.service.ts
│   │   ├── settlement.service.ts
│   │   ├── balance.service.ts
│   │   ├── invitation.service.ts
│   │   ├── activity.service.ts
│   │   └── user-activity.service.ts # Latest Activity across Groups (read-only)
│   ├── theme/
│   │   ├── tokens.ts               # Semantic light/dark design tokens
│   │   └── createAppTheme.ts       # MUI theme + palette augmentation
│   ├── demo/
│   │   ├── seed.ts                 # Idempotent demo seed
│   │   └── seed-plan.ts
│   ├── test-utils/
│   │   ├── integration-db.ts       # Per-file isolated test database
│   │   ├── fixtures.ts
│   │   └── stubs/server-only.ts    # No-op stand-in under Vitest
│   └── utils/
│       ├── api-response.ts         # Consistent API response helpers
│       └── fetcher.ts              # SWR fetcher
├── types/
├── providers/
│   └── ThemeProvider.tsx           # MUI ThemeProvider + CssBaseline
└── proxy.ts                        # Route protection (optimistic session-cookie check)
```

### `packages/shared` (`@splitbook/shared`)

Types, Zod validators and pure domain logic shared by every app. TypeScript
source exported as `@splitbook/shared/<module>` (see
[ADR 0002](adr/0002-shared-domain-package.md)); nothing here imports Next,
React, MUI, Mongoose, the database or DOM APIs.

```
packages/shared/src/
├── types.ts                    # Shared TypeScript interfaces (API + domain)
├── validators/                 # Zod v4 request schemas
│   ├── group.ts
│   ├── expense.ts
│   ├── recurring-expense.ts
│   └── settlement.ts
├── currency.ts                 # Currency helpers + formatting
├── money.ts
├── date.ts                     # Date helpers (UTC-inclusive bounds)
├── split-calculation.ts
├── debt-simplifier.ts          # Min-transaction algorithm
├── expense-summary.ts          # Per-member breakdown maths
├── expense-validation.ts       # Shared assert* invariants
├── settlement-authorization.ts
├── invitation-ownership.ts
├── dashboard.ts                # Cross-group currency bucketing
├── activity-timeline.ts
├── recurring-due-periods.ts    # Pure due-period math
├── group-themes.ts             # category → theme registry (v4)
├── trip-codes.ts               # Airport-code derivation — trip theme only
├── trip-setup.ts
├── escape-regex.ts
├── categories.ts               # Expense categories
├── default-tags.ts             # Per-theme default tags
└── predefined-items.ts         # Predefined expense items
```

There is **no `src/hooks` directory** — SWR is called directly in components.

---

## Data Flow

### API Request Flow

```
Client Component
  → fetch / SWR (called directly — there is no hooks layer)
    → proxy (session-cookie check — 401 JSON for anonymous /api/*)
      → Next.js API Route (/api/...)
        → Auth guard (getAuthUser)
          → Membership / admin guard (groupService.isMember, or service-side assertAdmin)
            → Zod validation (parse body/query)
              → Service layer (business logic + assert* invariants)
                → Mongoose model (database)
                  → Return JSON response
```

Guards are layered, and the layers are not equivalent: `getAuthUser` establishes
_who_, `isMember` establishes _access to this group_, and only some services then
check _role_. Expense mutation stops at membership.

> **Four GET routes write.** `GET /api/groups/[id]`,
> `GET /api/groups/[id]/expenses` and `GET /api/groups/[id]/balances` call
> `recurringExpenseService.generateDueExpenses` after the membership check,
> materializing any due recurring expenses. This is a deliberate design choice
> (see [`v4/README.md`](v4/README.md) Phase 3), but it means those reads are not
> side-effect free. Balances materialize too because clients start the Balances
> read beside the Group and Expense reads; computing first would show last
> month's figures next to this month's Expense (#240). The cross-group
> `GET /api/user/balances` materializes too (#306), for every Group of the
> member that has a recurring template, one Group after another, so Home and the
> sidebar agree with each Group's page. Leaving a Group
> (`POST /api/groups/[id]/leave`) materializes too, before its settle-up check,
> and is refused with `LEAVE_CONFLICT` when that run didn't finish (#253). An
> archived Group generates nothing on any of these reads or a leave, and its
> templates' markers don't move, so a member who still has an archived Household
> open never adds a month's Expenses to it.

### Real-time Sync Flow

```
SWR calls use refreshInterval (e.g. 10s for expenses, 30s for groups)
  → Automatic background revalidation
  → UI updates seamlessly via keepPreviousData option
  → After a mutation, the component calls mutate() to revalidate
```

There are no optimistic updates — no call site passes `optimisticData` or
`rollbackOnError`. The UI waits for the server round-trip.

### Auth Flow

One Better Auth instance; `AUTH_MODE` decides whether the demo persona plugin
is registered and which entry the UI offers, so switching needs no rebuild.

```
AUTH_MODE=google (default)
  User clicks "Sign in with Google"
    → Better Auth redirects to Google OAuth
      → User authorizes
        → callback: validateUserInfo checks AUTH_ALLOWED_EMAILS
          → user created, or Google account linked to the existing user (same _id)
            → session row + httpOnly cookie (+ 5-minute signed cookie cache)
              → Redirect to callbackURL (/dashboard)

AUTH_MODE=demo (private beta)
  User picks a persona (Alex / Sam / Priya)
    → POST /api/auth/demo-persona/sign-in (plugin, absent outside demo mode)
      → seeded user found by its fixed ObjectId → session row + cookie
        → same session shape, real ObjectId as user.id
```

Sessions are **database-backed** (30 days, refreshed after a day of use).
`getAuthUser()` reads `auth.api.getSession`, and `user.id` is what every
service treats as the actor.

Route protection lives in `src/proxy.ts`, backed by the pure decision table in
`src/lib/auth/proxy-rules.ts`. It only checks that a session cookie exists;
anonymous `/api/*` requests get **401 JSON** (`{ error: 'Unauthorized', status: 401 }`),
anonymous pages redirect to `/login?callbackUrl=…`, and expired sessions are
rejected by `getAuthUser` (401) or the authenticated layout (redirect).

---

## Key Patterns

### API Route Pattern

```typescript
// Every API route follows this pattern. Note: `params` is a Promise in Next 16,
// and the session is read through the `getAuthUser` helper.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await getAuthUser();
    if (!user) return unauthorized();

    const { id } = await params;

    const isMember = await groupService.isMember(id, user.id!);
    if (!isMember) return forbidden();

    const body = await req.json();
    const parsed = schema.safeParse(body);
    if (!parsed.success) return validationError(parsed.error);

    const result = await someService.create(id, parsed.data, user.id!);
    return success(result, 201);
  } catch (err) {
    // Services throw sentinel strings; routes map them to status codes.
    if (err instanceof Error && err.message in validationMessages) {
      return error(validationMessages[err.message], 422);
    }
    return serverError(err);
  }
}
```

Routes do not call `connectDB()` — each service awaits it as its first statement.

**Error convention.** Services throw bare sentinel `Error` messages
(`INVALID_MEMBERS`, `INVALID_TAG`, `CURRENCY_MISMATCH`, `FORBIDDEN`,
`NOT_HOUSEHOLD`, `LAST_ADMIN`, …) and the route translates them into status codes
and human-readable text. Anything unmapped falls through to `serverError`, which
logs it and returns a generic 500 — so an unmapped sentinel reaches the client as
"Internal server error".

### Service Layer Pattern

```typescript
// Services contain business logic, called by API routes
class ExpenseService {
  async create(data: CreateExpenseInput, userId: string): Promise<IExpense> {
    // 1. Validate business rules
    // 2. Create expense
    // 3. Log activity
    // 4. Return result
  }
}
```

### Client Data Fetching Pattern

```typescript
// SWR used directly in components (no custom hooks layer)
const fetcher = (url: string) => fetch(url).then((r) => r.json());

const { data, isLoading, isValidating, mutate } = useSWR(
  `/api/groups/${groupId}/expenses?${params}`,
  fetcher,
  { refreshInterval: 10_000, keepPreviousData: true },
);
```

---

## Environment Variables

```env
# Auth (Better Auth)
AUTH_SECRET=                   # Signs sessions and the cookie cache
AUTH_GOOGLE_ID=                # Google OAuth Client ID (required when AUTH_MODE=google)
AUTH_GOOGLE_SECRET=            # Google OAuth Client Secret
AUTH_ALLOWED_EMAILS=           # Invited Google addresses; empty denies everyone
AUTH_MODE=                     # google (default) | demo
ALLOW_DEMO_AUTH=               # Must be "true" to allow demo auth when NODE_ENV=production
AUTH_TEST_ID_TOKEN_SECRET=     # Test-only: locally signed Google ID tokens (browser suite)
ALLOW_TEST_ID_TOKEN=           # Test-only: honour the above under NODE_ENV=production
AUTH_RATE_LIMIT_ENABLED=       # Optional override; default on in production only

# Database
MONGODB_URI=                   # MongoDB connection string

# App
NEXT_PUBLIC_APP_URL=           # Public app URL (invite links, Better Auth baseURL + trusted origin)
RECURRING_EXPENSES_ENABLED=    # "true" offers recurring Expenses; hidden otherwise (the default)

# Testing (optional)
TEST_MONGODB_URI=              # Base URI for integration tests; each file derives
                               # its own splitbook-test-<file> database
```

`.env.example` is the authoritative list. There is no file-upload integration —
receipts are unimplemented (see [`features/receipts.md`](features/receipts.md)).
