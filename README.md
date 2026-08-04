# SplitWise

SplitWise is an expense-splitting app for shared groups — track who paid, split costs fairly, and settle up when balances are due.

## Tech stack

- **Next.js 16** (App Router) + **React 19** + **TypeScript**
- **MUI v7** (Material UI + Emotion) for UI
- **MongoDB** + **Mongoose v9** for data
- **Auth.js v5** (NextAuth) with Google OAuth
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
   | `MONGODB_URI` | MongoDB connection string |
   | `AUTH_SECRET` | Random secret for Auth.js session signing ([generate one](https://generate-secret.vercel.app/32)) |
   | `AUTH_GOOGLE_ID` | Google OAuth client ID |
   | `AUTH_GOOGLE_SECRET` | Google OAuth client secret |
   | `NEXT_PUBLIC_APP_URL` | App URL (e.g. `http://localhost:3000`) |

3. Start the development server:

   ```bash
   pnpm dev
   ```

   Open [http://localhost:3000](http://localhost:3000).

## Scripts

| Command | Description |
| --- | --- |
| `pnpm dev` | Start the development server |
| `pnpm build` | Production build |
| `pnpm start` | Run the production server |
| `pnpm lint` | Run ESLint |
| `pnpm test` | Run Vitest unit tests |
| `pnpm typecheck` | Run TypeScript without emitting files |
| `pnpm format` | Format code with Prettier |
| `pnpm format:check` | Check formatting without writing |

## Notes

- Each group uses a **single currency** for balances and settlements.
- Email invites create **pending invitation records** in the database; the app does not send email yet.

## Documentation

See [`docs/`](docs/) for architecture, API, feature specs, and page-level design notes.
