---
status: accepted
date: 2026-09-08
---

# Better Auth replaces Auth.js for web and mobile sign-in

Splitbook ran on Auth.js v5, a release that stayed in beta for years, with stateless JWT cookies that a native client cannot obtain or send. The mobile app decided in ADR 0001 needs a server that verifies a Google ID token from the device and issues a session it can carry on every request. We migrate to Better Auth (MIT-licensed, self-hosted, all data in our MongoDB) because native ID-token sign-in, an Expo client, per-platform Google client ids and database-backed sessions are built in, and the library is actively maintained; hand-writing those pieces on Auth.js would mean owning token minting and refresh on top of a beta framework.

## Considered options

- **Keep Auth.js and add a Google ID-token exchange endpoint plus bearer support.** Cheapest today (about a day), rejected because it leaves the app on a beta framework with a hand-rolled mobile auth surface to maintain.
- **Hosted authentication (Clerk and similar).** Fastest mobile SDKs, rejected for vendor lock-in and cost, and because the architecture doc commits to self-hosted auth.
- **Better Auth with stateless sessions.** Rejected: device sign-out and the Expo integration expect database sessions; a five-minute cookie cache keeps ordinary requests cheap.

## Consequences

- Sessions live in the database; a session revoked on one device can stay valid elsewhere for up to five minutes (the cookie cache). Sessions last 30 days of use, refreshed after a day.
- The MongoDB adapter's default ObjectId ids keep the existing `users` collection and the demo persona ids unchanged; Auth.js account rows are set aside and Google logins re-link on the next sign-in, so every tester signs in once more after cutover.
- The allowlist is enforced by Better Auth's `validateUserInfo` gate on every Google sign-in; the demo personas are a custom plugin endpoint registered only when demo mode is allowed; the middleware is a `proxy.ts` that checks the session cookie optimistically while routes and pages validate the session.
- The built-in Google provider cannot be pointed at a mock issuer, so the Google flow is tested by asserting redirect parameters without contacting Google and by exercising the ID-token path with a locally signed token behind an environment-gated verifier override that production refuses.
- Environment variable names are unchanged (`AUTH_SECRET`, `AUTH_GOOGLE_ID`, `AUTH_GOOGLE_SECRET`, `AUTH_ALLOWED_EMAILS`, `AUTH_MODE`, `ALLOW_DEMO_AUTH`); `AUTH_TRUST_HOST` and `AUTH_GOOGLE_ISSUER` disappear. Mobile adds `AUTH_GOOGLE_IOS_ID` and `AUTH_GOOGLE_ANDROID_ID`.
- Specification: `docs/superpowers/specs/2026-09-08-better-auth-migration.md`.
