# App Hardening Design (A + B + C)

**Date:** 2026-07-09  
**Status:** Approved for implementation  
**Decisions:** Security→Correctness→Polish→Foundation; single-currency-per-group (option B); no external FX API; no email provider (honest UX instead)

## Goal

Make SplitWise safe and correct for real use: close authz holes, make balances mathematically trustworthy under a single-currency rule, polish incomplete product surfaces, and add a test/CI foundation with continuous self-verification.

## Out of scope

- Receipt file upload / blob storage
- Real email delivery (Resend/SendGrid/etc.)
- SSE/WebSockets realtime
- Cross-group dashboard balances UI
- Full accessibility overhaul (only fix a11y when touching a control)
- Multi-currency FX conversion

## 1. Security

### Invitation accept/decline ownership
- `invitationService.accept(id, userId, userEmail)` must require `userEmail.toLowerCase() === invitation.invitedEmail`.
- `decline` must take `userEmail` and enforce the same match (or return not found).
- Mismatch → treat as not found / forbidden (do not leak invitation existence beyond current patterns).

### Invite-link GET membership
- `GET /api/groups/[id]/invite-link` must call `groupService.isMember(id, user.id)` and return 403 if false.

### Expense / settlement member + tag validation
- Before create/update expense: every `paidBy.user` and `splitBetween.user` must be a current group member.
- Expense `tag` must match an active (non-archived) group tag name.
- Expense `currency` must equal the group's `defaultCurrency` (see §2).
- Settlement `paidTo` (and `paidBy`) must be group members; settlement currency = group default.

### Search regex safety
- Escape user search input before `$regex` (escape `.*+?^${}()|[]\\`).

## 2. Single-currency correctness

- Group still stores `defaultCurrency` (+ optional alternate list may remain for future, but unused for expenses).
- Create/update expense and create settlement: reject if `currency !== group.defaultCurrency` with clear 422 message.
- Expense form: currency selector locked to group default (or hidden).
- Balances continue summing raw amounts — correct once all rows share one currency.
- Existing mixed-currency data: balances page shows a warning if any non-deleted expense/settlement currency differs from default; those rows are still included (no silent rewrite). Prefer documenting that admins should fix historical data.

## 3. Product polish

- Shared `fetcher` in `src/lib/utils/fetcher.ts` that throws on `!res.ok` (parse `{ error }` when present). Migrate all SWR usages.
- Settlement history: list on Balances tab (or sub-section) using existing GET settlements API.
- Wire duplicate-warning check into expense create form (call existing check-duplicate API before submit; show confirm if duplicate).
- Email invite UX: change success copy to make clear no email is sent; invite is pending for that email when they sign in (and prefer invite link).
- Delete dead `ExpenseDetailDialog.tsx`.
- Fix `GroupSettingsView` setState-during-render (use `useEffect`).

## 4. Foundation

- Vitest + `pnpm test` / `pnpm test:watch`.
- Unit tests for: `debt-simplifier`, regex escape helper, invitation email ownership logic (pure helpers or service with mocked models if needed — prefer extracting pure validators).
- GitHub Actions CI: install, lint, test, build (build may need env stubs).
- Replace boilerplate README with real setup docs; add `.env.example` (no secrets).

## Continuous improvement loop

After each task: run focused tests → full `pnpm test` + `pnpm lint` → commit. After all tasks: whole-branch review, then fix Critical/Important findings in one pass.

## Success criteria

1. Uninvited user cannot accept another email's invitation.
2. Non-member cannot fetch invite link.
3. Expense/settlement with non-member IDs or wrong currency/tag rejected.
4. Search cannot inject regex.
5. New expenses locked to group default currency; UI matches.
6. Client surfaces API errors instead of empty data.
7. Settlement history visible; duplicate warning works; dead dialog gone.
8. Vitest suite green in CI; README usable for onboarding.
