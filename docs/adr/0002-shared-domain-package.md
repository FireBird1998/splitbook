---
status: accepted
date: 2026-09-07
---

# `@splitbook/shared` owns types, validators and pure domain logic as source

The mobile client must compute balances, splits and validation exactly like the web app, so those modules cannot stay inside `apps/web`. We keep them in one workspace package, `@splitbook/shared` (`packages/shared`), consumed as TypeScript source through a wildcard export map (`"./*": "./src/*.ts"`) with no build step; Next.js compiles it via `transpilePackages`, Vitest and tsx read it directly, and a future Expo app can do the same through Metro.

## What belongs

- Belongs: the API and domain types, the Zod request validators, and every module that is pure over plain data: money and currency formatting, date windows, split calculation, debt simplification, expense summary and validation invariants, recurring due periods, the group theme registry, categories, default tags and predefined items.
- Stays in the app: anything importing Next, React, MUI, Mongoose, the database, Auth.js or DOM APIs; the Mongoose services and models; demo seed and personas; the MUI theme and design tokens (a candidate for later once mobile needs them).

## Considered options

- **Build the package to JavaScript with declaration files.** Rejected for now: a build step adds a watch process to every dev loop and an artifact nobody consumes; `transpilePackages` and Vitest already handle source. Revisit if a consumer cannot compile TypeScript.
- **Re-export shims in `apps/web` at the old paths.** Rejected: two import paths for one module invite drift and hide the boundary; every importer was rewritten instead.
- **Group by domain (`@splitbook/shared/balances`) instead of one file per module.** Deferred: the flat layout mirrors the modules as they were and keeps the move reviewable; the export map can grow domain barrels later without breaking existing imports.

## Consequences

- `pnpm lint`, `pnpm typecheck` and `pnpm test` run at the workspace root in CI so the package is covered; app steps still run inside `apps/web`.
- The shared unit tests moved with their modules (`packages/shared/src/*.test.ts`); the app keeps only tests that need Mongoose, Next or its own modules.
- The package depends on `zod` and `date-fns` only; adding a dependency there is a decision about every future client, not just the web app.
