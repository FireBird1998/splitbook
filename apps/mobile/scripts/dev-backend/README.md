# Fictional local backend for Android development

Prerequisites: Node 22+, installed workspace dependencies, and an existing local MongoDB server. These scripts use only `127.0.0.1`, database `splitbook_mobile_50`, and a fixed ownership marker. They refuse to claim an existing nonempty unmarked database. They never reset/drop a database or copy real credentials.

The default Mongo host port is **27018**, matching the development container used for the Android slice. If your local Mongo server uses another port, set `SPLITBOOK_NATIVE_MONGO_PORT` to that numeric port for **both** seed and start. Host, database name, and credentials are not configurable; incoming `MONGODB_URI` values are ignored.

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

`seed.mjs --check` validates script prerequisites/target without writing to Mongo. Seeding is idempotent and reuses the repository's fictional demo seed directly, through the web app's `tsx` configuration. The separate fixture scripts are JavaScript modules; no mobile TypeScript exclusion is needed.

The server listens on **http://127.0.0.1:4138**, trusts that exact origin, and enables the existing guarded development-persona endpoint with synthetic authentication settings. Its child process receives only an explicit development environment. Root/web `.env` files are refused because Next would otherwise load them; use a clean worktree without those files, preserving your working checkout's configuration. The mobile app's local development configuration is independent and may point at this loopback backend. No real Google sign-in is configured here.

For an Android emulator, reverse port 4138 with ADB and set the mobile API URL and auth origin to this same loopback URL. Stop this owned server with Ctrl-C; it does not stop the existing Mongo service.

Fictional personas Alex, Sam, and Priya share **Goa Friends Trip** and **Maple House**. **Alex private test Group** permits only Alex. The seed Trip contains seven fictional Expenses and one Settlement; the Household starts empty. This fixture does not claim verification of later mobile financial features.

For native session/access recovery checks:

```sh
node apps/mobile/scripts/dev-backend/control.mjs describe
node apps/mobile/scripts/dev-backend/control.mjs revoke-member sam household
node apps/mobile/scripts/dev-backend/control.mjs restore-member sam household
node apps/mobile/scripts/dev-backend/control.mjs expire-sessions sam
```

Use the same Mongo-port override for controls when needed. Controls allow only the fixed fictional personas and shared Groups, refuse removal of the fixture admin, and require the database ownership marker. Restore membership after revocation checks. Session expiry is immediate for the native app's token-only cookie handling; clients retaining Better Auth's signed session-data cookie may still have its five-minute cache. Signing in again creates a fresh fictional session.
