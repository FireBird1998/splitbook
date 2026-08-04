# SplitWise

SplitWise is an expense-splitting app for shared groups — track who paid, split costs fairly, and settle up when balances are due.

## Tech stack

- **Next.js 16** (App Router) + **React 19** + **TypeScript**
- **MUI v7** (Material UI + Emotion) for UI
- **MongoDB** + **Mongoose v9** for data
- **Auth.js v5** (NextAuth) with Google OAuth or temporary demo personas
- **SWR** for client-side data fetching
- **Zod v4** for request validation
- **pnpm** as the package manager

## Setup

1. Clone the repository and install dependencies:

   ```bash
   git clone <repo-url>
   cd split
   pnpm install
   ```

2. Copy the environment template and fill in values:

   ```bash
   cp .env.example .env.local
   ```

   | Variable | Description |
   | --- | --- |
   | `MONGODB_URI` | MongoDB connection string (use a dedicated DB for demo, e.g. `splitwise-demo`) |
   | `AUTH_SECRET` | Random secret for Auth.js session signing ([generate one](https://generate-secret.vercel.app/32)) |
   | `AUTH_GOOGLE_ID` | Google OAuth client ID (required when `AUTH_MODE=google`) |
   | `AUTH_GOOGLE_SECRET` | Google OAuth client secret (required when `AUTH_MODE=google`) |
   | `NEXT_PUBLIC_APP_URL` | App URL (e.g. `http://localhost:3000`) |
   | `AUTH_MODE` | `google` (default) or `demo` for private-beta personas |
   | `ALLOW_DEMO_AUTH` | Must be `true` to allow demo auth when `NODE_ENV=production` |

3. Start MongoDB locally (if needed):

   ```bash
   docker run -d --name split-mongo -p 27017:27017 mongo:7
   # if the container already exists:
   docker start split-mongo
   ```

4. Start the development server:

   ```bash
   pnpm dev
   ```

   Open [http://localhost:3000](http://localhost:3000).

## Demo mode (private beta)

Demo mode uses real Auth.js JWT sessions with three fixed seeded personas (Alex, Sam, Priya). Downstream APIs still receive a real `session.user.id` ObjectId string.

1. Point `MONGODB_URI` at a **dedicated demo database**, for example:

   ```bash
   MONGODB_URI=mongodb://localhost:27017/splitwise-demo?directConnection=true
   AUTH_MODE=demo
   ```

2. Seed (or reset) the trip:

   ```bash
   pnpm demo:seed    # idempotent — safe to re-run
   pnpm demo:reset   # wipe demo trip data, then reseed
   ```

3. Run the app (`pnpm dev`) and open `/`. Pick **Alex** (organizer), **Sam**, or **Priya**.

4. A small **Demo mode** badge appears in the navbar while demo auth is active.

### Production guard

Demo auth is **fail-closed** in production:

- `AUTH_MODE=demo` alone is ignored when `NODE_ENV=production`
- Set `ALLOW_DEMO_AUTH=true` only if you intentionally need demo personas in a production-like environment

### Restore Google OAuth later

1. Set `AUTH_MODE=google` (or remove `AUTH_MODE`)
2. Ensure `AUTH_GOOGLE_ID` / `AUTH_GOOGLE_SECRET` are set
3. Restart the app — marketing landing + Google sign-in return

## Scripts

| Command | Description |
| --- | --- |
| `pnpm dev` | Start the development server |
| `pnpm build` | Production build |
| `pnpm start` | Run the production server |
| `pnpm lint` | Run ESLint |
| `pnpm test` | Run all Vitest tests (unit + integration; needs MongoDB) |
| `pnpm test:unit` | Run only DB-free unit tests |
| `pnpm test:integration` | Run only MongoDB integration tests |
| `pnpm test:e2e` | Run Playwright browser journeys (demo mode) |
| `pnpm test:e2e:headed` | Run Playwright journeys with a visible browser |
| `pnpm typecheck` | Run TypeScript without emitting files |
| `pnpm format` | Format code with Prettier |
| `pnpm format:check` | Check formatting without writing |
| `pnpm demo:seed` | Idempotently seed demo personas + Goa friends trip |
| `pnpm demo:reset` | Wipe demo trip data and reseed |

## Testing

SplitWise has three layers of tests; all of them run in CI.

### Unit tests (no database)

Pure helpers and services with mocked models: split calculations, debt
simplification, dashboard currency buckets, auth-mode guards, demo persona
selection, seed plan invariants, settlement authorization.

```bash
pnpm test:unit
```

### Integration tests (isolated MongoDB)

Service-level tests against a real MongoDB: group membership enforcement,
expense participants/tags/currency validation, edit history, soft delete,
settlement authorization, invitation ownership, balance integrity, and demo
seed idempotency.

- Each test file gets its **own database** on the shared MongoDB instance,
  named `splitwise-test-<file>` (dropped on teardown), so files can run in
  parallel without clobbering each other.
- The helper refuses to run against anything resembling the demo/production
  databases — `splitwise-demo` is never touched.
- Requires MongoDB running locally (the `split-mongo` container works).
  Override the base connection with `TEST_MONGODB_URI` (any database segment
  is replaced with the per-file test name).

```bash
pnpm test:integration   # or the full suite: pnpm test
```

### Browser journeys (Playwright)

Persona journeys in demo mode — enter as Alex/Sam/Priya, inspect balances,
create a trip, add/edit an expense, switch persona, record a settlement, and
verify balances update — plus theme and accessibility checks.

- Runs the app on **port 3100** with `AUTH_MODE=demo`; global setup resets and
  reseeds the `splitwise-demo` database before the run.
- Four projects cover **desktop (1280×800) and mobile (390×844)** in **light
  and dark** themes; axe-core checks for critical accessibility violations.
- Review screenshots are written to `playwright/artifacts/<project>/`
  (gitignored).

```bash
pnpm exec playwright install chromium   # one-time browser install
pnpm test:e2e
```

## Notes

- Each group uses a **single currency** for balances and settlements; the
  dashboard aggregates cross-trip balances in separate currency buckets that
  are never combined into one number.
- Email invites create **pending invitation records** in the database; the app does not send email yet.

## Documentation

See [`docs/`](docs/) for architecture, API, feature specs, and page-level design notes.
