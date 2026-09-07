---
status: accepted
date: 2026-09-07
---

# One pnpm-workspace monorepo for web, mobile, and shared code

Splitbook is a solo project about to grow a second client (Android and iOS). The balance and split math, the Zod validators, and the API types must stay identical across clients, and drift in money math is the worst bug class this product can have. We keep every client, the Next.js backend, and shared domain code in one repository as pnpm workspaces (`apps/*`, `packages/*`) rather than one repository per app, so that shared code is a single workspace package instead of something published and version-pinned across repositories.

## Considered options

- **One repository per app (web, mobile, backend).** Rejected: every feature becomes two or three pull requests, and the shared domain package would need publishing and version-pinning for one developer. Separate repositories pay off with separate teams, languages, or release cadences; none apply.
- **Stay a single package until mobile exists.** Rejected: moving the Next.js app is the disruptive step (every path, the Vercel root directory, CI). Doing it alone keeps that diff reviewable and unblocks `packages/shared` and `apps/mobile` as ordinary follow-ups.
- **Native Swift and Kotlin apps in their own repositories.** Rejected for now: nothing would be shared, so every screen and every calculation would exist three times.

## Consequences

- The Next.js app lives in `apps/web` (`@splitbook/web`). Vercel's Root Directory must be `apps/web`; Vercel detects the workspace and installs from the repository root.
- Workspace-wide scripts (`lint`, `typecheck`, `test`, `format`) run at the root across every package; app-specific scripts run as `pnpm web <script>`. `.env.local` lives in `apps/web/`.
- Documentation under `docs/` describes app paths relative to `apps/web/`.
- The Next.js API routes remain the backend. A standalone `apps/api` is warranted only when realtime connections, background jobs, or push notifications need a long-running process; the service layer already depends on Mongoose alone, so that move stays cheap.
- Before a mobile client, the API must return 401 JSON for unauthenticated `/api/*` requests instead of a 302 redirect, and needs a token-exchange sign-in path for native Google sign-in.
