# Connect ChatGPT implementation verification — 12 October 2026

Scope: spec #398, tickets #399 and #400. Public route: `/connect/chatgpt`.

## Local verification

- TDD at the approved browser journey seam: observed the missing public guide fail, implemented it, then observed the missing authorization status fail before implementing it.
- Enabled configuration: 24 Playwright checks passed across desktop/mobile and light/dark. Covers public access, Settings entry, exact configured staging URL, copy success/fallback, keyboard disclosure, external navigation without false success, paginated exact ChatGPT matching, actual broader permissions, refresh/errors/revocation/unavailability, and account switching/sign-out with a delayed old response.
- Disabled configuration: 8 checks passed across the same four projects; enabled-only checks intentionally skipped.
- Invalid configuration: 4 public-guide checks passed across the four projects; setup remains unavailable.
- Workspace typecheck passed. Workspace lint passed with five preexisting navigation warnings outside this change. Design-system style policy passed.
- Full workspace suite: shared 1,503, tooling 122, mobile 2,107 tests passed. Web rerun with CI's required replica-set failure injection and standalone database configuration: 1,369 tests passed (115 files), including existing real-HTTP OAuth/PKCE/MCP and revocation suites. Initial web run used a replica set without failpoints and omitted the standalone URI; its infrastructure failures were resolved by matching CI configuration.
- Standards review found no actionable violations. Spec review found two gaps (pagination test fixture and a mandatory instruction hidden in optional details); both were fixed and re-reviewed successfully.

## Reproduce the browser matrix

From the repository root, use `MCP_GUIDE_TEST_MODE=enabled pnpm web exec playwright test --config playwright.connect-chatgpt.config.ts`, then repeat with `disabled` and `invalid`.

The configuration uses the disposable `splitbook-demo` database on local port 27017, the existing demo reset fixture, and a synthetic staging MCP URL. It does not change deployed feature flags. Connection-list responses are controlled at the browser's HTTP boundary to test client states; protocol behavior is covered by the existing real-HTTP suites.

## Hosted acceptance

Completed against the existing `splitbook-staging` Vercel project, without changing environment variables, DNS or production:

- Source commit: `68211ee` (clean Git archive; no untracked workspace files uploaded).
- Deployment: `dpl_CySwYbLdCQ6fxx39Jjy3mSSy1zqC`, READY. Vercel production build and TypeScript checks passed. This is the staging project's primary deployment target, not the separate production project.
- Guide: https://splitbook-staging.vercel.app/connect/chatgpt
- MCP: https://mcp.staging.splitbook.in/api/mcp
- Public guide rendered with a Staging badge and the correct endpoint. Copy URL and copy prompt controls reported success; desktop dark appearance was visually inspected.
- Reused the already-installed private SplitBook Staging plugin. Verified its configured URL and OAuth setting. The guide displayed the existing exact ChatGPT grant with ledger and continued-access permissions.
- Disconnected only the ChatGPT grant through existing Settings. Returning to the guide showed “ChatGPT is not authorized for this account.”
- Reconnected that same account in ChatGPT and completed renewed SplitBook consent for `ledger:read` and `offline_access`; no Draft scope was requested. Explicit status refresh showed “ChatGPT authorized”.
- Sent the guide's exact connection-only test prompt in the existing test chat on 12 October at approximately 12:30 PM IST. ChatGPT returned `connected: true`, `mode: connection-test`, success. The displayed work summary was “Verified SplitBook connection status”; no ledger data was requested.
- Finally disconnected ChatGPT through Settings again. Refreshing the still-open guide changed authorized to not authorized. The ChatGPT staging grant is intentionally left revoked after the acceptance test. Claude was not used or modified.

One consent attempt encountered a transient staging MongoDB network/overload failure. The error log reported `MongoServerSelectionError` with `SystemOverloadedError`; restarting the OAuth flow succeeded without a code or configuration change. Reloading an interrupted scrubbed OAuth page correctly instructed the member to restart from the assistant.

The walkthrough reused the installed private plugin rather than creating a duplicate plugin listing. Production rollout and Claude verification remain separate. No credentials, callback parameters or private ledger details are retained in this evidence.
