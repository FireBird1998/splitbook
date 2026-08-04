# App Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close authz holes, enforce single-currency balances, polish incomplete product surfaces, and add Vitest + CI with continuous self-verification.

**Architecture:** Keep existing API → Zod → service → Mongoose layering. Extract small pure helpers (regex escape, member/tag/currency checks) for unit testing. Prefer service-level validation throwing typed string errors (`FORBIDDEN`, `INVALID_MEMBERS`, `INVALID_TAG`, `CURRENCY_MISMATCH`) mapped to HTTP in routes.

**Tech Stack:** Next.js 16, MUI v7, Mongoose 9, Zod 4, SWR, Vitest, GitHub Actions, pnpm.

## Global Constraints

- Package manager: **pnpm only** (never npm/yarn).
- Response shape: `{ data: T }` success, `{ error: string }` failure via `@/lib/utils/api-response`.
- Expense `tag` is a singular required string; group tags are embedded subdocuments.
- Expenses soft-delete only (`isDeleted`); never hard-delete expenses.
- Single-currency rule: expense and settlement `currency` must equal `group.defaultCurrency`.
- No external FX API; no email provider integration.
- Do not commit `.env.local` or secrets; `.env.example` may list key names only.
- Follow existing feature-scoped component layout under `src/components/{feature}/`.
- Commits: concise why-focused messages; commit after each task.
- TDD for pure logic tasks (debt-simplifier tests, escapeRegex, invitation ownership helper).

## File structure

| File                                                     | Responsibility                                          |
| -------------------------------------------------------- | ------------------------------------------------------- |
| `src/lib/utils/escape-regex.ts`                          | Escape user input for Mongo `$regex`                    |
| `src/lib/utils/fetcher.ts`                               | Shared SWR fetcher that throws on `!res.ok`             |
| `src/lib/services/invitation.service.ts`                 | Email ownership on accept/decline                       |
| `src/app/api/invitations/[id]/route.ts`                  | Pass user email into service                            |
| `src/app/api/groups/[id]/invite-link/route.ts`           | Membership check on GET                                 |
| `src/lib/services/expense.service.ts`                    | Member/tag/currency validation; escaped search          |
| `src/lib/services/settlement.service.ts`                 | Member + currency validation                            |
| `src/lib/services/group.service.ts`                      | Helpers to list member IDs / active tag names if needed |
| `src/components/expenses/ExpenseFormDialog.tsx`          | Lock currency; wire duplicate check                     |
| `src/components/balances/BalancesView.tsx`               | Settlement history + mixed-currency warning             |
| `src/components/groups/InviteDialog.tsx`                 | Honest “no email sent” copy                             |
| `src/components/groups/GroupSettingsView.tsx`            | Fix setState-during-render                              |
| Delete `src/components/expenses/ExpenseDetailDialog.tsx` | Dead code                                               |
| `vitest.config.ts`, `src/**/*.test.ts`                   | Unit test foundation                                    |
| `.github/workflows/ci.yml`                               | lint + test + build                                     |
| `README.md`, `.env.example`                              | Onboarding                                              |

---

### Task 1: Vitest foundation + debt-simplifier tests

**Files:**

- Create: `vitest.config.ts`
- Create: `src/lib/utils/debt-simplifier.test.ts`
- Modify: `package.json` (scripts + devDependency)

**Interfaces:**

- Consumes: existing `simplifyDebts`, `calculateNetBalances` from `src/lib/utils/debt-simplifier.ts`
- Produces: `pnpm test` runs Vitest; green suite for debt math

- [ ] **Step 1: Add Vitest**

```bash
pnpm add -D vitest
```

Add to `package.json` scripts:

```json
"test": "vitest run",
"test:watch": "vitest"
```

Create `vitest.config.ts`:

```ts
import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
});
```

- [ ] **Step 2: Write failing tests for debt simplifier**

Create `src/lib/utils/debt-simplifier.test.ts` covering:

1. Two-person settle: A paid 100, split equal with B → B owes A 50 (one transaction).
2. Three-person simplify: nets collapse to minimal transfers.
3. Settlements reduce balances to zero when fully paid.
4. Near-zero amounts (< 0.01) ignored.
5. Empty inputs → empty balances / empty transactions.

Use exact expected numbers with 2-decimal rounding.

- [ ] **Step 3: Run tests — expect PASS** (functions already exist; if any assertion fails, fix test or confirm bug)

```bash
pnpm test
```

Expected: all tests pass. If a real bug in `debt-simplifier` is found, fix it in this task.

- [ ] **Step 4: Commit**

```bash
git add package.json pnpm-lock.yaml vitest.config.ts src/lib/utils/debt-simplifier.test.ts
git commit -m "$(cat <<'EOF'
test: add Vitest and debt-simplifier coverage

EOF
)"
```

---

### Task 2: Escape regex helper + wire into expense search

**Files:**

- Create: `src/lib/utils/escape-regex.ts`
- Create: `src/lib/utils/escape-regex.test.ts`
- Modify: `src/lib/services/expense.service.ts` (search filter ~line 121)

**Interfaces:**

- Consumes: none
- Produces: `export function escapeRegex(input: string): string`

- [ ] **Step 1: Write failing test**

```ts
import { describe, it, expect } from 'vitest';
import { escapeRegex } from './escape-regex';

describe('escapeRegex', () => {
  it('escapes regex metacharacters', () => {
    expect(escapeRegex('a+b*c?')).toBe('a\\+b\\*c\\?');
    expect(escapeRegex('(test)')).toBe('\\(test\\)');
    expect(escapeRegex('foo.bar')).toBe('foo\\.bar');
  });

  it('leaves plain text unchanged', () => {
    expect(escapeRegex('coffee')).toBe('coffee');
  });
});
```

- [ ] **Step 2: Run test — expect FAIL**

```bash
pnpm test src/lib/utils/escape-regex.test.ts
```

Expected: cannot find module / escapeRegex not defined.

- [ ] **Step 3: Implement**

```ts
export function escapeRegex(input: string): string {
  return input.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
```

In `expense.service.ts` search filter:

```ts
import { escapeRegex } from '@/lib/utils/escape-regex';
// ...
if (filters.search) {
  query.description = { $regex: escapeRegex(filters.search), $options: 'i' };
}
```

- [ ] **Step 4: Run tests — expect PASS**

```bash
pnpm test
```

- [ ] **Step 5: Commit**

```bash
git add src/lib/utils/escape-regex.ts src/lib/utils/escape-regex.test.ts src/lib/services/expense.service.ts
git commit -m "$(cat <<'EOF'
fix: escape expense search regex to prevent injection

EOF
)"
```

---

### Task 3: Invitation email ownership (accept + decline)

**Files:**

- Modify: `src/lib/services/invitation.service.ts`
- Modify: `src/app/api/invitations/[id]/route.ts`
- Create: `src/lib/services/invitation-ownership.test.ts` (pure helper)

**Interfaces:**

- Consumes: invitation `invitedEmail`, user email
- Produces: `export function invitationEmailMatches(invitedEmail: string, userEmail: string): boolean`
- `accept(invitationId, userId, userEmail)` and `decline(invitationId, userEmail)` reject mismatch

- [ ] **Step 1: Write failing ownership tests**

```ts
import { describe, it, expect } from 'vitest';
import { invitationEmailMatches } from './invitation-ownership';

describe('invitationEmailMatches', () => {
  it('matches case-insensitively', () => {
    expect(invitationEmailMatches('A@B.com', 'a@b.com')).toBe(true);
  });
  it('rejects different emails', () => {
    expect(invitationEmailMatches('a@b.com', 'c@d.com')).toBe(false);
  });
});
```

Create `src/lib/services/invitation-ownership.ts` exporting that helper (implement after RED).

- [ ] **Step 2: Run — expect FAIL, then implement helper, expect PASS**

- [ ] **Step 3: Wire into service**

In `accept`: after loading invitation, if `!invitationEmailMatches(invitation.invitedEmail, userEmail)` return `null` (same as not found).

Change signature: `accept(invitationId: string, userId: string, userEmail: string)`.

In `decline(invitationId, userEmail)`: same ownership check before status change; return `null` on mismatch.

Route: pass `user.email!` into both calls. Ensure Auth.js user email is available (session user has email).

- [ ] **Step 4: Run `pnpm test` + `pnpm lint`**

- [ ] **Step 5: Commit**

```bash
git commit -m "$(cat <<'EOF'
fix: require invitation email ownership on accept/decline

EOF
)"
```

---

### Task 4: Invite-link GET membership check

**Files:**

- Modify: `src/app/api/groups/[id]/invite-link/route.ts`

**Interfaces:**

- Consumes: `groupService.isMember(id, userId)`
- Produces: GET returns 403 for non-members

- [ ] **Step 1: Add membership check after auth**

```ts
const isMember = await groupService.isMember(id, user.id!);
if (!isMember) return forbidden();
```

Place before `groupService.getById` (or after not-found — prefer: load group, 404 if missing, then membership 403 so non-members of missing groups still get 404 if you check existence first; **required behavior:** non-member of existing group → 403).

Recommended order: auth → getById → 404 if null → isMember → 403 → return invite data.

- [ ] **Step 2: Lint**

```bash
pnpm lint
```

- [ ] **Step 3: Commit**

```bash
git commit -m "$(cat <<'EOF'
fix: require group membership to fetch invite link

EOF
)"
```

---

### Task 5: Expense member / tag / currency validation

**Files:**

- Modify: `src/lib/services/expense.service.ts` (create + update)
- Modify: `src/app/api/groups/[id]/expenses/route.ts` and `[expenseId]/route.ts` to map new errors
- Create: `src/lib/services/expense-validation.ts` + `.test.ts` (pure validators)

**Interfaces:**

- Produces:
  - `assertExpenseParticipants(memberIds: Set<string>, paidBy, splitBetween): void` throws `INVALID_MEMBERS`
  - `assertActiveTag(activeTagNames: Set<string>, tag: string): void` throws `INVALID_TAG`
  - `assertGroupCurrency(defaultCurrency: string, currency: string): void` throws `CURRENCY_MISMATCH`

- [ ] **Step 1: TDD pure validators** in `expense-validation.ts` with tests for happy path + each throw.

- [ ] **Step 2: In `ExpenseService.create` / `update`**, load group, build member ID set and active tag name set (`!tag.isArchived`), call validators before save. On update, validate only fields present.

- [ ] **Step 3: Map errors in routes** to 422 with messages:
  - `INVALID_MEMBERS` → `'All payers and split participants must be group members'`
  - `INVALID_TAG` → `'Tag must be an active group tag'`
  - `CURRENCY_MISMATCH` → `'Currency must match the group default currency'`

- [ ] **Step 4: `pnpm test` + `pnpm lint`**

- [ ] **Step 5: Commit**

```bash
git commit -m "$(cat <<'EOF'
fix: validate expense members, tag, and group currency

EOF
)"
```

---

### Task 6: Settlement member + currency validation

**Files:**

- Modify: `src/lib/services/settlement.service.ts`
- Modify: `src/app/api/groups/[id]/settlements/route.ts`
- Reuse: `assertGroupCurrency` from Task 5; add `assertSettlementMembers(memberIds, paidBy, paidTo)`

**Interfaces:**

- Produces: create settlement rejects non-members and wrong currency

- [ ] **Step 1: Add pure helper + test** (can live in `expense-validation.ts` or `settlement-validation.ts`)

- [ ] **Step 2: Wire into `settlementService.create`** — load group, validate `paidBy`/`paidTo` in members, currency === defaultCurrency

- [ ] **Step 3: Map errors in route to 422**

- [ ] **Step 4: Test + lint + commit**

```bash
git commit -m "$(cat <<'EOF'
fix: validate settlement members and currency

EOF
)"
```

---

### Task 7: Lock expense form currency + mixed-currency balance warning

**Files:**

- Modify: `src/components/expenses/ExpenseFormDialog.tsx`
- Modify: `src/components/balances/BalancesView.tsx`
- Modify: `src/lib/services/balance.service.ts` (optional flag `hasMixedCurrencies`)

**Interfaces:**

- Consumes: `group.defaultCurrency`
- Produces: form always submits `defaultCurrency`; balances API may include `hasMixedCurrencies: boolean` and UI shows Alert if true

- [ ] **Step 1: Expense form** — set currency state to `group.defaultCurrency` only; remove/disable alternate currency picker (or show read-only chip).

- [ ] **Step 2: Balance service** — when mapping expenses/settlements, set `hasMixedCurrencies` if any row's currency !== `group.defaultCurrency`.

- [ ] **Step 3: BalancesView** — if flag true, show MUI `Alert` severity warning: balances may be inaccurate because some expenses use other currencies.

- [ ] **Step 4: Lint + commit**

```bash
git commit -m "$(cat <<'EOF'
fix: lock expenses to group currency and warn on mixed history

EOF
)"
```

---

### Task 8: Shared SWR fetcher + migrate call sites

**Files:**

- Create: `src/lib/utils/fetcher.ts`
- Create: `src/lib/utils/fetcher.test.ts` (mock Response if feasible; otherwise skip heavy mock and keep helper tiny)
- Modify: all components with local `const fetcher = ...` (dashboard, groups, expenses, balances, activity, settings, etc.)

**Interfaces:**

- Produces: `export async function fetcher<T>(url: string): Promise<T>` — `fetch` → if `!res.ok` throw `Error` with server `error` string or status text; else return `json` (or `json.data` if existing callers expect unwrapped — **match current caller expectations**).

Inspect existing fetchers first: many do `res.json()` and SWR uses `data?.data`. Keep returning full JSON body `{ data, error }` so callers stay `data?.data`.

```ts
export async function fetcher(url: string) {
  const res = await fetch(url);
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error((json as { error?: string }).error || res.statusText || 'Request failed');
  }
  return json;
}
```

- [ ] **Step 1: Add fetcher + unit test** with a mocked global fetch (Vitest).

- [ ] **Step 2: Replace duplicated fetchers**; ensure SWR error UI shows somewhere sensible where missing (at least don't swallow).

- [ ] **Step 3: Lint + commit**

```bash
git commit -m "$(cat <<'EOF'
fix: share SWR fetcher that surfaces API errors

EOF
)"
```

---

### Task 9: Settlement history UI + duplicate warning + invite copy + dead code + settings fix

**Files:**

- Modify: `src/components/balances/BalancesView.tsx` (list settlements via SWR `GET /api/groups/[id]/settlements`)
- Modify: `src/components/expenses/ExpenseFormDialog.tsx` (call check-duplicate before create)
- Modify: `src/components/groups/InviteDialog.tsx` (honest copy)
- Delete: `src/components/expenses/ExpenseDetailDialog.tsx`
- Modify: `src/components/groups/GroupSettingsView.tsx` (useEffect for form init)

**Interfaces:**

- Duplicate check: existing `POST/GET` check-duplicate route — read route and call correctly; if duplicate, `window.confirm` or MUI Dialog before proceed.
- Invite success: e.g. `'Invitation saved. No email is sent — share the invite link, or they will see it after signing in with that email.'`

- [ ] **Step 1: Implement each polish item** (keep UI consistent with MUI patterns).

- [ ] **Step 2: Lint + commit**

```bash
git commit -m "$(cat <<'EOF'
feat: settlement history, duplicate warning, and invite UX polish

EOF
)"
```

---

### Task 10: README, .env.example, GitHub Actions CI

**Files:**

- Modify: `README.md`
- Create: `.env.example`
- Create: `.github/workflows/ci.yml`
- Modify: `package.json` if needed (`"typecheck": "tsc --noEmit"`)

**Interfaces:**

- CI jobs: `pnpm install --frozen-lockfile`, `pnpm lint`, `pnpm test`, `pnpm build` with dummy env vars for Auth/Mongo so build can compile.

`.env.example` keys (names only):

```
MONGODB_URI=
AUTH_SECRET=
AUTH_GOOGLE_ID=
AUTH_GOOGLE_SECRET=
NEXT_PUBLIC_APP_URL=http://localhost:3000
```

README: what the app is, pnpm setup, env vars, scripts (`dev`, `test`, `lint`, `build`).

- [ ] **Step 1: Write files**

- [ ] **Step 2: Run full verification**

```bash
pnpm lint && pnpm test && pnpm exec tsc --noEmit
```

Build if env allows:

```bash
AUTH_SECRET=test MONGODB_URI=mongodb://127.0.0.1:27017/split-test NEXT_PUBLIC_APP_URL=http://localhost:3000 pnpm build
```

- [ ] **Step 3: Commit**

```bash
git commit -m "$(cat <<'EOF'
chore: add README, env example, and CI workflow

EOF
)"
```

---

## Self-review checklist (plan author)

1. Spec coverage: security, single-currency, polish, foundation — all have tasks.
2. No placeholders / TBD steps.
3. Validators produced in Task 5 reused in Task 6.
4. Out of scope (receipts, real email, FX) not scheduled.
