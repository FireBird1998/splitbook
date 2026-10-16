# SplitBook

A shared-expense ledger in one pnpm workspace: the Next.js web app (`apps/web`), the Expo Android app (`apps/mobile`), framework-free domain code (`packages/shared`) and the local gate (`tools/swarm`). Name domain concepts with the terms in `GLOSSARY.md`.

## Where to look

- **Money, saves and saved copies:** read ADR 0004 and ADR 0006 (Android), ADR 0008 (assistant Drafts) in `docs/adr/` before changing an Expense, Settlement, Draft or Group write, or anything a device stores. Review rules live in `CODING_STANDARDS.md`.
- **Tests:** `docs/testing.md` for the layers and commands. Before pushing, run `pnpm swarm gate`: it mirrors CI's PR checks on a backend of its own (`tools/swarm/README.md`).
- **UI:** `docs/ui.md` for the design system and visual direction; `docs/design/brand/README.md` for logos, icons, brand colours and size variants (use `assets/brand/` and `tools/brand/`, and verify the generated assets).
- **Auth:** `docs/auth.md`. **HTTP contract:** `docs/api.md`. **Android client:** `apps/mobile/README.md`. **Product direction:** `docs/v4/`.

## Conventions no config states

- Scripts run per package: `pnpm web <script>`, `pnpm mobile <script>`; app binaries are `pnpm web exec <bin>`.
- In older docs, a bare `src/…` path means `apps/web/src/…`.
- Implement from attached plans and leave the plan files as they are.
- Work only from this repository: it is an intentional silent fork, and the original source is out of scope.
- Keep Google sign-in available behind `AUTH_MODE`; local product work uses the demo personas (`pnpm web demo:seed`).

## Gotchas

- Draft and To review saves use MongoDB transactions, so their integration and Playwright tests need a replica set. CI starts one per job (`EXPENSE_ACCESS_MONGO_PORT`, `pnpm swarm up --mongo-port`).
- Give `directConnection: true` to local URIs only; on a `mongodb+srv://` URI it breaks every page (`apps/web/src/lib/mongodb-client.ts`).
- PR checks run a fast subset. Integration, Playwright and the time-zone matrix run nightly, or on a PR labelled `full-ci`: add it to any PR touching money, auth or data access.
- Merging to `main` doesn't deploy production (`apps/web/vercel.json`); production deploys are the owner's. The Vercel project's Root Directory is `apps/web` (a dashboard setting), and a deploy's commit author needs access to the Vercel project.

## Agent skills

### Issue tracker

Issues are tracked as GitHub issues on `FireBird1998/splitbook` via the `gh` CLI. See `docs/agents/issue-tracker.md`.

### Triage labels

The five canonical triage labels are used as-is (`needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`). See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: `GLOSSARY.md` + `docs/adr/` at the repo root. See `docs/agents/domain.md`.
