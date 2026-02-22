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
| Auth.js v5   | MongoDB adapter | Self-hosted auth, Google OAuth built-in              |
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
│   │   │   │   └── page.tsx        # Create group form
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
│   │   │   ├── route.ts            # POST (create), GET (list)
│   │   │   └── [id]/
│   │   │       ├── route.ts        # GET, PATCH, DELETE
│   │   │       ├── expenses/
│   │   │       │   ├── route.ts    # POST (create), GET (list + filters + summary)
│   │   │       │   ├── check-duplicate/
│   │   │       │   │   └── route.ts # GET (duplicate check)
│   │   │       │   └── [expenseId]/
│   │   │       │       └── route.ts # GET, PATCH, DELETE
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
│   │   │       └── route.ts        # POST (join via link)
│   │   └── user/
│   │       └── profile/
│   │           └── route.ts        # GET, PATCH
│   ├── join/
│   │   └── [code]/
│   │       └── page.tsx            # Join group page (public)
│   ├── layout.tsx                  # Root layout (providers)
│   ├── page.tsx                    # Landing page (redirect if auth'd)
│   └── globals.css                 # Minimal (body margin reset only)
├── components/
│   ├── layout/
│   │   ├── Sidebar.tsx             # Fixed sidebar (lg+), MUI Box
│   │   └── Navbar.tsx              # Fixed navbar + mobile drawer
│   ├── landing/
│   │   └── LandingPage.tsx         # Public landing page
│   ├── groups/
│   │   ├── GroupCard.tsx
│   │   ├── GroupsListView.tsx
│   │   ├── GroupDetailView.tsx     # Tabs: expenses, balances, activity
│   │   ├── GroupSettingsView.tsx   # Admin settings (info, currency, members, tags)
│   │   └── InviteDialog.tsx
│   ├── expenses/
│   │   ├── ExpenseListView.tsx     # Filters, summary bar, grouped list
│   │   ├── ExpenseCard.tsx         # Expandable card with inline detail
│   │   ├── ExpenseFormDialog.tsx   # Create + edit (two-tier form)
│   │   ├── ExpenseDetailDialog.tsx # Full detail modal (legacy)
│   │   └── DeleteExpenseDialog.tsx
│   ├── settlements/
│   │   └── SettleUpDialog.tsx
│   ├── balances/
│   │   └── BalancesView.tsx        # Balance summary + simplified debts
│   ├── dashboard/
│   │   ├── DashboardView.tsx       # Groups overview + invitations
│   │   └── InvitationCard.tsx
│   └── activity/
│       └── ActivityView.tsx        # Paginated activity feed
├── lib/
│   ├── auth.ts                     # Auth.js config (Node.js runtime)
│   ├── auth.config.ts              # Auth.js config (Edge-compatible)
│   ├── db.ts                       # MongoDB/Mongoose connection singleton
│   ├── mongodb-client.ts           # MongoDB client for Auth.js adapter
│   ├── models/
│   │   ├── User.ts
│   │   ├── Group.ts                # Includes tags subdocument array
│   │   ├── Expense.ts              # Uses `tag` (singular, required)
│   │   ├── Settlement.ts
│   │   ├── Activity.ts
│   │   └── Invitation.ts
│   ├── services/
│   │   ├── group.service.ts        # Includes tag CRUD + member management
│   │   ├── expense.service.ts      # Includes summary aggregation
│   │   ├── settlement.service.ts
│   │   ├── balance.service.ts
│   │   ├── invitation.service.ts
│   │   └── activity.service.ts
│   ├── validators/                 # Zod v4 schemas
│   │   ├── group.validator.ts
│   │   ├── expense.validator.ts
│   │   └── settlement.validator.ts
│   ├── utils/
│   │   ├── currency.ts             # Currency helpers + formatting
│   │   ├── debt-simplifier.ts      # Min-transaction algorithm
│   │   ├── api-response.ts         # Consistent API response helpers
│   │   └── date.ts                 # Date formatting utilities
│   └── constants/
│       ├── categories.ts           # Expense categories
│       └── predefined-items.ts     # Predefined expense items
├── types/
│   └── index.ts                    # Shared TypeScript interfaces
├── providers/
│   ├── AuthProvider.tsx            # NextAuth SessionProvider
│   └── ThemeProvider.tsx           # MUI ThemeProvider + CssBaseline
└── middleware.ts                   # Auth middleware for route protection
```

---

## Data Flow

### API Request Flow

```
Client Component
  → fetch / SWR hook
    → Next.js API Route (/api/...)
      → Auth guard (check session)
        → Zod validation (parse body/query)
          → Service layer (business logic)
            → Mongoose model (database)
              → Return JSON response
```

### Real-time Sync Flow

```
SWR hooks use refreshInterval (e.g. 10s for expenses, 30s for groups)
  → Automatic background revalidation
  → UI updates seamlessly via keepPreviousData option
```

### Auth Flow

```
User clicks "Sign in with Google"
  → Auth.js redirects to Google OAuth
    → User authorizes
      → Auth.js callback creates/updates User in MongoDB
        → Session cookie set
          → Redirect to /dashboard
```

---

## Key Patterns

### API Route Pattern

```typescript
// Every API route follows this pattern:
export async function POST(req: Request, { params }: { params: { id: string } }) {
  try {
    const session = await auth();
    if (!session?.user) return unauthorized();

    const body = await req.json();
    const parsed = schema.safeParse(body);
    if (!parsed.success) return validationError(parsed.error);

    await connectDB();
    const result = await someService.create(parsed.data, session.user.id);

    return success(result, 201);
  } catch (error) {
    return serverError(error);
  }
}
```

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
AUTH_SECRET=                    # Random secret for Auth.js
AUTH_GOOGLE_ID=                 # Google OAuth Client ID
AUTH_GOOGLE_SECRET=             # Google OAuth Client Secret

# Database
MONGODB_URI=                   # MongoDB connection string

# App
NEXT_PUBLIC_APP_URL=           # Public app URL (for invite links)

# File Upload (optional — for receipts)
CLOUDINARY_CLOUD_NAME=
CLOUDINARY_API_KEY=
CLOUDINARY_API_SECRET=
```
