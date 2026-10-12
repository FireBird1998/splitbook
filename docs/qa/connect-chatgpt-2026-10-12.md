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

Pending: deploy the finished guide to staging, then complete setup/consent from the guide, confirm its authorization display, run `connection_status` in ChatGPT, disconnect in existing Settings and refresh to confirm no authorization. Earlier MCP connection evidence does not verify this new guide. Do not close #400 or claim the guide fully verified until this walkthrough is recorded. Claude and production rollout remain outside scope.
