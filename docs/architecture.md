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
| Auth.js v5   | MongoDB adapter | Self-hosted auth; Google OAuth + demo personas       |
| Zod          | v4              | Type-safe validation with TS inference               |
| SWR          | v2              | Client data fetching, caching, revalidation          |

---

## Folder Structure

```
src/
├── app/
│   ├── (auth)/                     # Auth route group (no sidebar)
│   │   └── login/
│   │       └── page.tsx
│   ├── (main)/                     # Authenticated route group (with sidebar)
│   │   ├── layout.tsx              # Fixed navbar + sidebar + main layout
│   │   ├── dashboard/
│   │   │   └── page.tsx            # Home dashboard
│   │   ├── groups/
│   │   │   ├── page.tsx            # List all groups
│   │   │   ├── new/
│   │   │   │   └── page.tsx        # Create group form (theme picker first)
│   │   │   └── [id]/
│   │   │       ├── page.tsx        # Group detail (expenses tab)
│   │   │       └── settings/
│   │   │           └── page.tsx    # Group settings (admin)
│   │   └── settings/
│   │       └── page.tsx            # User settings
│   ├── api/
│   │   ├── auth/
│   │   │   └── [...nextauth]/
│   │   │       └── route.ts        # Auth.js catch-all
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
│   │   ├── Sidebar.tsx             # Fixed sidebar (lg+), MUI Box
│   │   ├── Navbar.tsx              # Fixed navbar + mobile drawer
│   │   └── BrandMark.tsx
│   ├── landing/
│   │   └── LandingPage.tsx         # Public landing page
│   ├── auth/
│   │   ├── LoginForm.tsx           # Google button
│   │   └── DemoLoginClient.tsx     # Demo persona sign-in
│   ├── demo/
│   │   ├── DemoModeBadge.tsx       # Navbar badge while demo auth is active
│   │   └── DemoPersonaPicker.tsx
│   ├── trip/
│   │   └── TripStrip.tsx           # Boarding-pass header — trip theme only
│   ├── groups/
│   │   ├── GroupCard.tsx
│   │   ├── GroupsListView.tsx
│   │   ├── GroupDetailView.tsx     # Tabs: expenses, balances, activity
│   │   ├── GroupHeader.tsx         # Neutral header — non-trip themes
│   │   ├── GroupSettingsView.tsx   # Admin settings (info, currency, members, tags)
│   │   ├── MonthCycleBar.tsx       # Household month switcher
│   │   ├── MonthMemberTable.tsx    # Per-member fronted/share/net for the month
│   │   ├── RecurringExpensesSection.tsx
│   │   └── InviteDialog.tsx
│   ├── expenses/
│   │   ├── ExpenseListView.tsx     # Filters, summary bar, grouped list
│   │   ├── ExpenseCard.tsx         # Expandable card with inline detail
│   │   ├── ExpenseFormDialog.tsx   # Create + edit (two-tier form)
│   │   ├── DeleteExpenseDialog.tsx
│   │   ├── expense-form-helpers.ts # Pure, unit-tested
│   │   └── expense-duplicate-check.ts
│   ├── settlements/
│   │   └── SettleUpDialog.tsx
│   ├── balances/
│   │   └── BalancesView.tsx        # Balance summary + simplified debts
│   ├── dashboard/
│   │   ├── DashboardView.tsx       # Groups overview + invitations
│   │   └── InvitationCard.tsx
│   ├── activity/
│   │   └── ActivityView.tsx        # Activity feed (single page, no Load More)
│   ├── join/
│   │   └── JoinGroupClient.tsx
│   └── common/
│       └── MoneyText.tsx           # Money typography treatment
├── lib/
│   ├── auth.ts                     # Auth.js + MongoDB adapter (Node runtime)
│   ├── auth.config.ts              # Auth.js config (Edge-compatible) — providers,
│   │                               #   callbacks, route protection
│   ├── auth-mode.ts                # AUTH_MODE resolution + production guard
│   ├── auth-sign-in.ts
│   ├── demo-credentials.ts         # Demo authorize() — fails closed in prod
│   ├── demo-personas.ts
│   ├── group-themes.ts             # category → theme registry (v4)
│   ├── recurring-due-periods.ts    # Pure due-period math
│   ├── db.ts                       # Mongoose connection singleton (server-only)
│   ├── mongodb-client.ts           # MongoDB client for Auth.js adapter (server-only)
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
│   │   ├── expense-validation.ts   # Shared assert* invariants
│   │   ├── expense-summary.ts
│   │   ├── split-calculation.ts
│   │   ├── recurring-expense.service.ts
│   │   ├── settlement.service.ts
│   │   ├── balance.service.ts
│   │   ├── invitation.service.ts
│   │   ├── invitation-ownership.ts
│   │   └── activity.service.ts
│   ├── validators/                 # Zod v4 schemas
│   │   ├── group.validator.ts
│   │   ├── expense.validator.ts
│   │   ├── recurring-expense.validator.ts
│   │   └── settlement.validator.ts
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
│   ├── utils/
│   │   ├── currency.ts             # Currency helpers + formatting
│   │   ├── money.ts
│   │   ├── debt-simplifier.ts      # Min-transaction algorithm
│   │   ├── dashboard.ts            # Cross-group currency bucketing
│   │   ├── api-response.ts         # Consistent API response helpers
│   │   ├── fetcher.ts              # SWR fetcher
│   │   ├── date.ts                 # Date helpers (UTC-inclusive bounds)
│   │   ├── settlement-authorization.ts
│   │   ├── activity-timeline.ts
│   │   ├── trip-codes.ts           # Airport-code derivation — trip theme only
│   │   ├── trip-setup.ts
│   │   └── escape-regex.ts
│   └── constants/
│       ├── categories.ts           # Expense categories
│       ├── default-tags.ts         # Per-theme default tags
│       └── predefined-items.ts     # Predefined expense items
├── types/
│   ├── index.ts                    # Shared TypeScript interfaces
│   └── next-auth.d.ts              # Session type augmentation
├── providers/
│   ├── AuthProvider.tsx            # NextAuth SessionProvider
│   └── ThemeProvider.tsx           # MUI ThemeProvider + CssBaseline
└── middleware.ts                   # Auth middleware for route protection
```

There is **no `src/hooks` directory** — SWR is called directly in components.

---

## Data Flow

### API Request Flow

```
Client Component
  → fetch / SWR (called directly — there is no hooks layer)
    → middleware (authorized callback — redirects anonymous requests)
      → Next.js API Route (/api/...)
        → Auth guard (getAuthUser)
          → Membership / admin guard (groupService.isMember, or service-side assertAdmin)
            → Zod validation (parse body/query)
              → Service layer (business logic + assert* invariants)
                → Mongoose model (database)
                  → Return JSON response
```

Guards are layered, and the layers are not equivalent: `getAuthUser` establishes
*who*, `isMember` establishes *access to this group*, and only some services then
check *role*. Expense mutation stops at membership.

> **Two GET routes write.** `GET /api/groups/[id]` and
> `GET /api/groups/[id]/expenses` call `recurringExpenseService.generateDueExpenses`
> after the membership check, materializing any due recurring expenses. This is a
> deliberate design choice (see [`v4/README.md`](v4/README.md) Phase 3), but it
> means those reads are not side-effect free.

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

Two providers are registered simultaneously; `AUTH_MODE` decides which the UI
offers, so switching needs no rebuild.

```
AUTH_MODE=google (default)
  User clicks "Sign in with Google"
    → Auth.js redirects to Google OAuth
      → User authorizes
        → Auth.js callback creates/updates User in MongoDB (adapter)
          → JWT session cookie set (id copied onto the token)
            → Redirect to /dashboard

AUTH_MODE=demo (private beta)
  User picks a persona (Alex / Sam / Priya)
    → Credentials provider authorize() resolves the seeded user
      → fails closed unless NODE_ENV!=production or ALLOW_DEMO_AUTH=true
        → same JWT session shape, real ObjectId as session.user.id
```

Sessions are **JWT**, not database-backed. The `jwt` callback copies `user.id`
onto the token and the `session` callback copies it back onto `session.user.id`,
which is what every service treats as the actor.

Route protection lives in the `authorized` callback in `auth.config.ts`. Note
that Auth.js converts a `false` return into a **302 redirect to `/login`**,
including for `/api/*` requests — API clients do not receive a 401 from
middleware.

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
# Auth
AUTH_SECRET=                   # Random secret for Auth.js
AUTH_GOOGLE_ID=                # Google OAuth Client ID (required when AUTH_MODE=google)
AUTH_GOOGLE_SECRET=            # Google OAuth Client Secret
AUTH_MODE=                     # google (default) | demo
ALLOW_DEMO_AUTH=               # Must be "true" to allow demo auth when NODE_ENV=production

# Database
MONGODB_URI=                   # MongoDB connection string

# App
NEXT_PUBLIC_APP_URL=           # Public app URL (for invite links) — no fallback in code

# Testing (optional)
TEST_MONGODB_URI=              # Base URI for integration tests; each file derives
                               # its own splitwise-test-<file> database
```

`.env.example` is the authoritative list. There is no file-upload integration —
receipts are unimplemented (see [`features/receipts.md`](features/receipts.md)).
