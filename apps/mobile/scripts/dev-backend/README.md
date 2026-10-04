# Fictional local backend for Android development

Prerequisites: Node 22+, installed workspace dependencies, and an existing local MongoDB server. These scripts use only `127.0.0.1`, a fictional database whose name starts with `splitbook_mobile_` (by default `splitbook_mobile_50`), and a fixed ownership marker. They refuse to claim an existing nonempty unmarked database. They never reset/drop a database or copy real credentials.

The default Mongo host port is **27018**, matching the development container used for the Android slice. If your local Mongo server uses another port, set `SPLITBOOK_NATIVE_MONGO_PORT` to that numeric port for **both** seed and start. Host and credentials are not configurable; incoming `MONGODB_URI` values are ignored.

From the repository root:

```sh
node apps/mobile/scripts/dev-backend/seed.mjs
node apps/mobile/scripts/dev-backend/start.mjs
```

Or, for an existing Mongo server on port 27017:

```sh
SPLITBOOK_NATIVE_MONGO_PORT=27017 node apps/mobile/scripts/dev-backend/seed.mjs
SPLITBOOK_NATIVE_MONGO_PORT=27017 node apps/mobile/scripts/dev-backend/start.mjs
```

`seed.mjs --check` validates script prerequisites/target without writing to Mongo, and prints the origin, Mongo port and database it would use. Seeding is idempotent and reuses the repository's fictional demo seed directly, through the web app's `tsx` configuration. The separate fixture scripts are JavaScript modules; no mobile TypeScript exclusion is needed.

The server listens on its origin, by default **http://127.0.0.1:4138**, trusts that exact origin, and enables the existing guarded development-persona endpoint with synthetic authentication settings. Its child process receives only an explicit development environment. Root/web `.env` files are refused because Next would otherwise load them; use a clean worktree without those files, preserving your working checkout's configuration. The mobile app's local development configuration is independent and may point at this loopback backend. No real Google sign-in is configured here.

For an Android emulator, reverse the origin port with ADB (`adb reverse tcp:4138 tcp:4138` by default) and set the mobile API URL and auth origin to this same loopback URL. Stop this owned server with Ctrl-C; it does not stop the existing Mongo service.

## One backend per worktree

**Agent worktrees: run `pnpm swarm up` from the repository root.** It picks a free loopback port and a fresh database for the worktree, seeds and starts this backend, and prints the `MOBILE_VERIFY_URL` to use. `pnpm swarm down` stops it and drops only that worktree's databases, and `pnpm swarm gate` runs every check a ticket needs, including every verifier against it. See [tools/swarm/README.md](../../../../tools/swarm/README.md). The steps below are what it does, by hand.

Each worktree can run its own backend, so several worktrees can run the verifiers at once. Three variables choose the backend. Seed, start and the controls below read the same ones:

| Variable                       | Default               | Accepted values                                                                                                          |
| ------------------------------ | --------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `SPLITBOOK_NATIVE_ORIGIN_PORT` | `4138`                | A TCP port, other than the Mongo port. The origin is always `http://127.0.0.1:<port>`.                                   |
| `SPLITBOOK_NATIVE_DATABASE`    | `splitbook_mobile_50` | `splitbook_mobile_` followed by lowercase letters, digits or underscores, 63 characters at most.                         |
| `SPLITBOOK_NATIVE_MONGO_PORT`  | `27018`               | The TCP port of the local Mongo server. Several backends can share one Mongo server, because each uses its own database. |

An invalid value is refused before anything connects. Without the variables, the backend is the default one above.

1. Pick a port and a database name that no other worktree uses. The ticket number makes a good pair: port `4186` and database `splitbook_mobile_186` for #186.
2. Seed, then start, with both variables on each command:

   ```sh
   SPLITBOOK_NATIVE_ORIGIN_PORT=4186 SPLITBOOK_NATIVE_DATABASE=splitbook_mobile_186 node apps/mobile/scripts/dev-backend/seed.mjs --check
   SPLITBOOK_NATIVE_ORIGIN_PORT=4186 SPLITBOOK_NATIVE_DATABASE=splitbook_mobile_186 node apps/mobile/scripts/dev-backend/seed.mjs
   SPLITBOOK_NATIVE_ORIGIN_PORT=4186 SPLITBOOK_NATIVE_DATABASE=splitbook_mobile_186 node apps/mobile/scripts/dev-backend/start.mjs
   ```

   A new database name gives a freshly seeded fictional database. Seeding an existing one again is idempotent. Start refuses a database that has not been seeded. Every seed, start and control command needs the same variables, so a terminal without them acts on the default backend.

3. In another terminal, run the verifiers with a matching `MOBILE_VERIFY_URL`:

   ```sh
   MOBILE_VERIFY_URL=http://127.0.0.1:4186 TZ=Asia/Kolkata pnpm mobile verify:all
   ```

   The verifiers read no `SPLITBOOK_NATIVE_*` variable. They take the backend only from `MOBILE_VERIFY_URL`, and without it they use the default backend on 4138, which may belong to another worktree.

Next allows one `next dev` per app directory, so a worktree runs at most one backend at a time. For an emulator, reverse the chosen port instead (`adb reverse tcp:4186 tcp:4186`) and point the app's API URL and auth origin at it.

## Fixtures and controls

Fictional personas Alex, Sam, and Priya share **Goa Friends Trip** and **Maple House**. **Alex private test Group** permits only Alex. The seed Trip contains seven fictional Expenses and one Settlement; the Household starts empty. This fixture does not claim verification of later mobile financial features. Verifier runs and manual QA add their own test Groups, so a database in use holds more Groups than the seed.

For native session/access recovery checks:

```sh
SPLITBOOK_NATIVE_DATABASE=splitbook_mobile_186 node apps/mobile/scripts/dev-backend/control.mjs describe
SPLITBOOK_NATIVE_DATABASE=splitbook_mobile_186 node apps/mobile/scripts/dev-backend/control.mjs revoke-member sam household
SPLITBOOK_NATIVE_DATABASE=splitbook_mobile_186 node apps/mobile/scripts/dev-backend/control.mjs restore-member sam household
SPLITBOOK_NATIVE_DATABASE=splitbook_mobile_186 node apps/mobile/scripts/dev-backend/control.mjs expire-sessions sam
```

These examples act on the database of the #186 example above. Give controls the same `SPLITBOOK_NATIVE_DATABASE` (and `SPLITBOOK_NATIVE_MONGO_PORT`, if set) as that backend's seed and start. Without them, controls act on the default `splitbook_mobile_50`. Controls allow only the fixed fictional personas and shared Groups, refuse removal of the fixture admin, and require the database ownership marker. Restore membership after revocation checks. Session expiry is immediate for the native app's token-only cookie handling; clients retaining Better Auth's signed session-data cookie may still have its five-minute cache. Signing in again creates a fresh fictional session.
