# Design system v1 — contributor guide

Scope: runtime foundations, the local catalogue, Dashboard, and group Balances.
The owner must review the pilot before Expenses or Settings/Recurring conversion.
Specification: [GitHub #15](https://github.com/FireBird1998/splitbook/issues/15).

## Explore locally

Run `pnpm dev` and open `http://localhost:4127/dev/design-system`. The lab uses
actual shared modules and synthetic in-memory examples. It requires no MongoDB,
OAuth credentials, or application API calls. Reload restores the examples. Both
the HTML route and the client-navigation representation are unavailable in
production, including previews. There is no production-enable flag.

Visual providers are shared globally; auth providers remain on the home, sign-in,
join, and authenticated app routes. Only the exact lab URL bypasses Auth.js in
middleware; its server page enforces production exclusion. Never add a general
development-path auth exception or weaken the existing demo/Google safeguards.

## Which tool to use

| Need                            | Use                                                                                 |
| ------------------------------- | ----------------------------------------------------------------------------------- |
| Repeated control styling        | MUI theme defaults and variants                                                     |
| An amount                       | `MoneyText` with explicit currency and existing sign/tone behavior                  |
| A status                        | `StatusLabel`, with a semantic tone and meaningful text                             |
| Failed data / existing recovery | `ErrorState`, with safe copy and optional retry callback                            |
| No results                      | `EmptyState`, with explanation and an optional existing action                      |
| Loading                         | Content-shaped MUI Skeletons inside an appropriately named loading status           |
| Screen arrangement              | `sx`, Stack, Box, and MUI responsive values                                         |
| Heavy repeated rules            | A small shared module, only when removing it would duplicate those rules in callers |

These presentation modules do not fetch data, establish sessions, decide
permissions, or write expenses/settlements. Screen controllers retain those jobs.
Do not pass raw server diagnostic messages to feedback UI.

`src/lib/theme/` is authoritative. Define matching light/dark semantics and expose
them through the MUI theme. `status.*` foregrounds are measured against `tint.*`,
paper, and page backgrounds. Decorative accent colors are not automatically safe
for small text. Keep money formatting, currency separation, and precision unchanged.

Use Outfit for UI and IBM Plex Mono for amounts. Preserve semantic HTML headings
independently of visual variants. Use the existing MUI 8px spacing scale and
600/900/1200/1536px breakpoints. Navigation height and sidebar width share runtime
constants. The trip strip's original 640px stacking threshold is deliberately
retained in v1; changing it requires review of the signature layout, not a blind
replacement with the nearest MUI breakpoint.

## Verification

Useful focused commands:

```sh
pnpm typecheck
pnpm check:design-system
pnpm exec vitest run src/lib/theme/createAppTheme.test.ts src/lib/theme/style-policy.test.ts
pnpm test:design-system --grep-invert 'visual baseline'
```

The catalogue suite starts its own credential-free dev server on 4128, does not
seed a database, and refuses to reuse an existing server. The pilot suite uses
the established local `splitbook-demo` database on port 3100 and reseeds only that
test data. Real Google-mode journeys use the existing local OIDC stand-in and
their separate test database. Never point these seed/reset workflows at Atlas.

### Reproducible visual comparisons

Baselines use Chromium from Playwright **1.62.1**, **Linux amd64 / Ubuntu Noble**.
The browser version must match the installed Playwright package. Use the same
container locally and in CI; native macOS rendering is not a matching baseline.
No application files or credentials need to be mounted into the browser container.

```sh
docker run --name splitbook-design-browser --platform linux/amd64 --rm -d --init \
  --ipc=host -p 127.0.0.1:9323:9323 \
  mcr.microsoft.com/playwright:v1.62.1-noble \
  /bin/sh -c 'npx -y playwright@1.62.1 run-server --port 9323 --host 0.0.0.0'

DESIGN_BROWSER_WS=ws://127.0.0.1:9323/ pnpm test:design-system
DESIGN_BROWSER_WS=ws://127.0.0.1:9323/ pnpm test:pilot

docker stop splitbook-design-browser
```

Wait for the browser container to report `Listening` before starting comparisons.
Playwright forwards only loopback traffic from that browser to the local test
servers. Ports must be free. Linux screenshots are tested against the real pilot
routes with fixed public HTTP fixtures; authentication is real demo auth. Existing
real-data journeys remain a separate required check.

Pilot baselines cover both screens at 390×844 and 1280×800 in both modes. Additional
catalogue comparisons protect error/recovered states. Stable data, dates, timezone,
fonts, and reduced motion are part of the test contract. Only the Next.js developer
overlay is excluded; money, status, and actions must never be masked.

Initial baselines are review candidates until the owner approves the pilot.
Intentional later changes require an explanation, before/after images, and review
before using Playwright's `--update-snapshots`. CI never updates baselines.

After building, `pnpm test:production-ui` checks lab exclusion on port 4129. The
Google suite also checks exclusion after a real successful test-provider login
when run against a production build. Full unit/integration and existing browser
journeys remain required; skipped/environment-blocked checks are not passes.

## Adoption and exceptions

The style checker contains an explicit list of adopted files. Extend it whenever
a screen or shared pattern migrates. It checks literal style colors and static
palette references against the actual runtime theme, without confusing user
content with colors. Dynamic expressions and arbitrary computed keys still need
type and browser checks; this is not a proof of every possible `sx` expression.

No new style-policy exceptions are currently registered. To request one, record
the exact scope, reason, owner, and removal condition here and include the test or
visual evidence. Do not add blanket disables or treat an old exception as permission
for new violations. Screen-specific spacing is allowed and needs no exception.

Changing a shared pattern requires updated examples, usage guidance, relevant
tests, and a smoke check of its consumers. Compare serious/critical axe findings,
keyboard/focus behavior, narrow layouts, error announcements, and reduced motion.
Automated scans alone do not establish full WCAG conformance.

## Scope still deferred

Expenses and Settings/Recurring conversion, a public package, Storybook, paid
services, token generation, and full legacy-screen accessibility certification.
Known legacy debt includes scattered local typography/radius choices and feedback
outside the adopted screens. Owner: Splitbook maintainer; revisit with each
subsequent migration. Do not mix OAuth credential repair, OCR, production cutover,
or ledger changes into this initiative.
