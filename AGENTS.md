## Learned User Preferences

- Prefer implementing from attached plans without editing the plan files themselves.
- For private-beta UX work, keep Google OAuth available behind `AUTH_MODE` rather than removing it; use switchable demo personas for local product iteration.
- Private-beta visual direction: hybrid Travel Ledger structure + Calm Finance restraint — one signature itinerary/boarding-pass trip strip; indigo (brand), sky (info), coral (owed), mint (settled); Outfit for UI and IBM Plex Mono for money; design light and dark together via semantic tokens.
- The repo is an intentional silent fork — do not propose syncing with or comparing against the original source repo.

## Learned Workspace Facts

- pnpm workspace monorepo (#20, 2026-09-07): the Next.js app is the `apps/web` package `@splitbook/web`; `.env.local` lives in `apps/web/`. Only the workspace-wide scripts (`lint`, `typecheck`, `test`, `test:unit`, `test:integration`, `format`, `format:check`) and the `dev`/`build`/`start` shortcuts exist at the root; every other app script is `pnpm web <script>` (or bare inside `apps/web`), and app binaries are `pnpm web exec <bin>`. New clients go under `apps/*`, shared code under `packages/*`. `src/…` paths in `docs/` and in this file are relative to `apps/web/`. Decision record: `docs/adr/0001-pnpm-workspace-monorepo.md`.
- `@splitbook/shared` (`packages/shared`, #23, 2026-09-07) holds the types, the Zod validators and every pure domain module, each its own subpath: `money`, `currency`, `date`, `dashboard`, `activity-timeline`, `split-calculation`, `debt-simplifier`, `expense-summary`, `expense-validation`, `settlement-authorization`, `invitation-ownership`, `recurring-due-periods`, `group-themes`, `trip-codes`, `trip-setup`, `escape-regex`, `categories`, `default-tags`, `predefined-items`. It is TypeScript source with a `./*` export map, no build step: import subpaths such as `@splitbook/shared/currency` or `@splitbook/shared/validators/expense`. Nothing in it may import Next, React, MUI, Mongoose, the DB or DOM APIs; keep it that way so the mobile app can consume it unchanged. Decision record: `docs/adr/0002-shared-domain-package.md`.
- Canonical GitHub repository: private `FireBird1998/splitbook`, with `main` as the default branch and sole source of authority. The repository transfer completed on 2026-08-24; remaining production cutover work is tracked under GitHub issue #3.
- `main` is fully merged and stable: the duplicate-index fix, `feat/app-hardening`, and `feat/private-beta` were merged on 2026-08-05; GitHub Actions CI (verify + playwright jobs) is green.
- Feature worktrees: `.worktrees/private-beta` tracks `feat/private-beta`; `.worktrees/app-hardening` tracks `feat/app-hardening`.
- Authentication is Better Auth (#26, 2026-09-08; ADR 0003): database sessions with a five-minute cookie cache, `src/proxy.ts` with an optimistic session-cookie check, `getAuthUser()` over `auth.api.getSession`, Google gated by `AUTH_ALLOWED_EMAILS` on every sign-in. Databases from the Auth.js era need `pnpm web migrate:auth` once (it also renames the `users.email` index to `users_email_uidx`).
- `AUTH_MODE=demo` registers the demo persona plugin (`POST /api/auth/demo-persona/sign-in`; Alex, Sam, Priya); seed/reset with `pnpm web demo:seed` / `pnpm web demo:reset`. Demo auth is blocked in production.
- Standalone private-beta visual prototypes live under `docs/design/private-beta/` (HTML/CSS mockups with light/dark tokens).
- Local MongoDB is commonly run via Docker (container name often `split-mongo`) on `localhost:27017`.
- The production data target is a fresh MongoDB Atlas database named `splitbook` with a least-privilege application user; provisioning and cutover are tracked under issue #9. Local development can use Docker container `split-mongo` at `mongodb://localhost:27017/splitbook?directConnection=true`.
- `mongodb+srv://` (Atlas) URIs must not get `directConnection: true` — `src/lib/mongodb-client.ts` applies it only for non-SRV local URIs; hardcoding it 500s every page.
- Vercel project `splitbook` (scope `ankit-das-projects`) is connected to `FireBird1998/splitbook`, with `main` as its production branch. The free project blocks deployments whose commit author lacks Vercel project access, so production-triggering commits must be attributed to a connected Vercel member. The project's **Root Directory must be `apps/web`** (a Vercel project setting, not in the repo); Vercel then installs from the workspace root.
- Google mode requires a normalized `AUTH_ALLOWED_EMAILS` allowlist and fails closed when it is missing or empty. Demo mode does not use this allowlist.
- Playwright CI runs `next start` (production mode), so the webServer env sets `ALLOW_DEMO_AUTH=true`, `AUTH_RATE_LIMIT_ENABLED=false` (no client IP behind `next start` on loopback) and, for the Google suite, `ALLOW_TEST_ID_TOKEN=true`; without them demo auth fails closed, persona entries share one rate-limit bucket, and the test ID-token verifier is refused.
- Product direction v4 (docs in `docs/v4/`): the app is not just trips — group category acts as a theme (Trip/Household/Couple/Work/General); Household groups are long-running with month-on-month expense cycles.

## Agent skills

### Issue tracker

Issues are tracked as GitHub issues on `FireBird1998/splitbook` via the `gh` CLI. See `docs/agents/issue-tracker.md`.

### Triage labels

The five canonical triage labels are used as-is (`needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`). See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: `CONTEXT.md` + `docs/adr/` at the repo root. See `docs/agents/domain.md`.
