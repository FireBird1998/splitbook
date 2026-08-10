## Learned User Preferences

- Prefer implementing from attached plans without editing the plan files themselves.
- For private-beta UX work, keep Google OAuth available behind `AUTH_MODE` rather than removing it; use switchable demo personas for local product iteration.
- Private-beta visual direction: hybrid Travel Ledger structure + Calm Finance restraint — one signature itinerary/boarding-pass trip strip; indigo (brand), sky (info), coral (owed), mint (settled); Outfit for UI and IBM Plex Mono for money; design light and dark together via semantic tokens.
- The repo is an intentional silent fork — do not propose syncing with or comparing against the original source repo.

## Learned Workspace Facts

- Git remotes: `origin` only — `ankit-thesys/splitwise-beta`. The `upstream` remote (tipra34/split) was removed on 2026-08-05; the project is now fully standalone.
- `main` is fully merged and stable: the duplicate-index fix, `feat/app-hardening`, and `feat/private-beta` were merged on 2026-08-05; GitHub Actions CI (verify + playwright jobs) is green.
- Feature worktrees: `.worktrees/private-beta` tracks `feat/private-beta`; `.worktrees/app-hardening` tracks `feat/app-hardening`.
- On `feat/private-beta`, `AUTH_MODE=demo` enables Credentials-based personas (Alex, Sam, Priya); seed/reset with `pnpm demo:seed` / `pnpm demo:reset`. Demo auth is blocked in production.
- Standalone private-beta visual prototypes live under `.worktrees/private-beta/docs/design/private-beta/` (HTML/CSS mockups with light/dark tokens).
- Local MongoDB is commonly run via Docker (container name often `split-mongo`) on `localhost:27017`.
- The app DB moved to a MongoDB Atlas cluster (`SplidWiseMain`, database `splitwise`); `.env.local` points at Atlas with the local Docker URI kept commented for switching back. Local dev runs on port 3000 in demo mode against Atlas.
- `mongodb+srv://` (Atlas) URIs must not get `directConnection: true` — `src/lib/mongodb-client.ts` applies it only for non-SRV local URIs; hardcoding it 500s every page.
- Vercel hosting prepared but not deployed: project `splitwise-beta` (scope `ankit-das-projects`) linked via `.vercel/`; env vars pushed to production + preview; production intentionally has no `AUTH_MODE`/`ALLOW_DEMO_AUTH` so it defaults to Google OAuth.
- Playwright CI runs `next start` (production mode), so the webServer env sets `ALLOW_DEMO_AUTH=true` and `AUTH_TRUST_HOST=true`; without them demo auth fails closed and Auth.js throws UntrustedHost.
- Product direction v4 (docs in `docs/v4/`): the app is not just trips — group category acts as a theme (Trip/Household/Couple/Work/General); Household groups are long-running with month-on-month expense cycles.

## Agent skills

### Issue tracker

Issues are tracked as GitHub issues on `ankit-thesys/splitwise-beta` via the `gh` CLI. See `docs/agents/issue-tracker.md`.

### Triage labels

The five canonical triage labels are used as-is (`needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`). See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: `CONTEXT.md` + `docs/adr/` at the repo root. See `docs/agents/domain.md`.
