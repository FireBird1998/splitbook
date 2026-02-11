# Architecture

## Tech Stack Detail

| Component       | Choice                | Why                                                        |
| --------------- | --------------------- | ---------------------------------------------------------- |
| Next.js 16      | App Router            | Server components, API routes, middleware, SSR              |
| TypeScript      | Strict mode           | Type safety across frontend + backend                      |
| Tailwind CSS    | v4                    | Utility-first, fast iteration                              |
| Material UI     | v6                    | Pre-built components (dialogs, inputs, tables, snackbars)  |
| MongoDB         | Atlas (cloud)         | Flexible schema, good for nested expense data              |
| Mongoose        | v8                    | Schema validation, middleware, population                  |
| Auth.js v5      | MongoDB adapter       | Self-hosted auth, Google OAuth built-in                    |
| Zod             | Request validation    | Type-safe validation with TS inference                     |
| SWR or React Query | Client data fetching | Caching, revalidation, optimistic updates               |

---

## Folder Structure

```
src/
├── app/
│   ├── (auth)/                     # Auth route group (no sidebar)
│   │   └── login/
│   │       └── page.tsx
│   ├── (main)/                     # Authenticated route group (with sidebar)
│   │   ├── layout.tsx              # Sidebar + navbar layout
│   │   ├── dashboard/
│   │   │   └── page.tsx            # Home dashboard
│   │   ├── groups/
│   │   │   ├── page.tsx            # List all groups
│   │   │   ├── new/
│   │   │   │   └── page.tsx        # Create group form
│   │   │   └── [id]/
│   │   │       ├── page.tsx        # Group detail (expenses tab)
│   │   │       ├── balances/
│   │   │       │   └── page.tsx    # Balance summary
│   │   │       ├── activity/
│   │   │       │   └── page.tsx    # Activity feed
│   │   │       └── settings/
│   │   │           └── page.tsx    # Group settings
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
│   │   │       │   ├── route.ts    # POST (create), GET (list + filters)
│   │   │       │   └── [expenseId]/
│   │   │       │       └── route.ts # GET, PATCH, DELETE
│   │   │       ├── settlements/
│   │   │       │   └── route.ts    # POST, GET
│   │   │       ├── balances/
│   │   │       │   └── route.ts    # GET
│   │   │       ├── activity/
│   │   │       │   └── route.ts    # GET (paginated)
│   │   │       ├── invite/
│   │   │       │   └── route.ts    # POST (send invite)
│   │   │       └── invite-link/
│   │   │           └── route.ts    # POST (generate), GET (info)
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
│   └── globals.css
├── components/
│   ├── ui/                         # Generic reusable components
│   │   ├── LoadingSpinner.tsx
│   │   ├── EmptyState.tsx
│   │   ├── ConfirmDialog.tsx
│   │   ├── CurrencySelect.tsx
│   │   └── AvatarGroup.tsx
│   ├── layout/
│   │   ├── Sidebar.tsx
│   │   ├── Navbar.tsx
│   │   └── MobileNav.tsx
│   ├── groups/
│   │   ├── GroupCard.tsx
│   │   ├── GroupForm.tsx
│   │   ├── GroupMemberList.tsx
│   │   └── InviteDialog.tsx
│   ├── expenses/
│   │   ├── ExpenseList.tsx
│   │   ├── ExpenseCard.tsx
│   │   ├── ExpenseForm.tsx
│   │   ├── SplitMethodSelector.tsx
│   │   ├── TagSelector.tsx
│   │   └── ReceiptUpload.tsx
│   ├── settlements/
│   │   ├── SettleUpDialog.tsx
│   │   └── SettlementList.tsx
│   ├── balances/
│   │   ├── BalanceSummary.tsx
│   │   ├── DebtCard.tsx
│   │   └── SimplifiedDebts.tsx
│   ├── dashboard/
│   │   ├── QuickFilters.tsx
│   │   ├── FilterBar.tsx
│   │   └── ExpenseDashboard.tsx
│   └── activity/
│       ├── ActivityFeed.tsx
│       └── ActivityItem.tsx
├── lib/
│   ├── auth.ts                     # Auth.js configuration
│   ├── db.ts                       # MongoDB/Mongoose connection singleton
│   ├── models/
│   │   ├── User.ts
│   │   ├── Group.ts
│   │   ├── Expense.ts
│   │   ├── Settlement.ts
│   │   ├── Activity.ts
│   │   └── Invitation.ts
│   ├── services/
│   │   ├── group.service.ts
│   │   ├── expense.service.ts
│   │   ├── settlement.service.ts
│   │   ├── balance.service.ts
│   │   ├── invitation.service.ts
│   │   └── activity.service.ts
│   ├── validators/                 # Zod schemas
│   │   ├── group.validator.ts
│   │   ├── expense.validator.ts
│   │   └── settlement.validator.ts
│   ├── utils/
│   │   ├── currency.ts             # Currency helpers + conversion
│   │   ├── debt-simplifier.ts      # Min-transaction algorithm
│   │   ├── api-response.ts         # Consistent API response helpers
│   │   └── date.ts                 # Date formatting utilities
│   └── constants/
│       ├── currencies.ts           # Supported currencies list
│       ├── categories.ts           # Expense categories
│       └── predefined-items.ts     # Predefined expense items
├── hooks/
│   ├── useGroups.ts
│   ├── useExpenses.ts
│   ├── useBalances.ts
│   ├── useActivity.ts
│   └── useRealtime.ts
├── types/
│   └── index.ts                    # Shared TypeScript interfaces
└── providers/
    ├── AuthProvider.tsx             # Session provider
    ├── ThemeProvider.tsx            # MUI theme provider
    └── QueryProvider.tsx            # SWR/React Query provider
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
Client opens SSE connection → /api/groups/[id]/events
Server sends events when:
  - New expense added
  - Expense updated/deleted
  - Settlement recorded
  - Member joined/left
Client receives event → SWR revalidation → UI updates
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
// SWR hook for client components
function useExpenses(groupId: string, filters?: ExpenseFilters) {
  const params = new URLSearchParams(filters);
  return useSWR(`/api/groups/${groupId}/expenses?${params}`);
}
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

