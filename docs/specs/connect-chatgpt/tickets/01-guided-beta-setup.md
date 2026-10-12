# Guide members through read-only ChatGPT beta setup

Status: Approved and published as [#399](https://github.com/FireBird1998/splitbook/issues/399) on 11 October 2026.

## Parent

[Connect ChatGPT spec #398](https://github.com/FireBird1998/splitbook/issues/398).

## What to build

A visitor can open a public Connect ChatGPT guide and follow manual read-only setup without understanding MCP terminology. Members find the guide from Connected assistants. The guide uses the current deployment's configuration and explains when setup is unavailable.

## Acceptance criteria

- [ ] Public guide is reachable without sign-in and linked from Settings → Connected assistants; it exposes no account-specific information.
- [ ] Explain Groups, balances and spending, access to current/future Groups, continuing authorization and disconnecting. Do not request Draft access or imply chat can save Expenses.
- [ ] Enabled deployments supply their own validated MCP resource URL through safe public configuration; disabled/invalid deployments retain the explanation but no active setup URL. Staging is clearly labeled; production never falls back to staging.
- [ ] Numbered instructions cover the current ChatGPT custom-MCP setup, with expandable OAuth/CIMD and scope details matching the tested read-only/refresh flow. No client secret or API key is requested from a member.
- [ ] Provide Open ChatGPT, copy URL and copy connection-test prompt controls with accessible success feedback and selectable fallback when copying fails.
- [ ] Explain that the test result appears in ChatGPT. Navigation and copied values never generate an authorization or test-success claim.
- [ ] Troubleshooting covers unavailable custom-server controls, sign-in/eligibility and consent problems, connection failure and copy failure; links point to official guidance without universal plan promises.
- [ ] Provide a sign-in/Settings management path using existing routes; no new consent or revocation implementation.
- [ ] Browser tests cover public access, Settings entry, safe configuration behavior, copy outcomes and external navigation at desktop/mobile widths with keyboard checks.
- [ ] No hosting/feature-flag changes, screenshots, published listing link or Claude setup are introduced.

## Blocked by

None within this feature. Reuse the existing implemented MCP connection foundation; do not rebuild it.
