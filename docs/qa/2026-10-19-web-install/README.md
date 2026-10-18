# Web installation — 19 October 2026

Issue #607. Application commit `b0bb7656`, based on `5c700703`. All data below is fictional local demo data.

## Regression and automated checks

- The root-layout manifest-link assertion failed on the unchanged baseline: expected `/manifest.webmanifest`, received `undefined`. Adding the shared metadata link made all eight layout tests pass.
- The manifest contract test then failed because the manifest module did not exist. With the manifest and generated icons, all nine layout tests pass. The test checks the name, Home start URL, standalone display, brand colours, ordinary/maskable icon entries, PNG signatures and dimensions.
- The brand generator and its check pass for all 152 outputs, including both new web maskable copies. No artwork was hand-edited.
- Production build passes. `/manifest.webmanifest` returns HTTP 200 with `application/manifest+json`; all four icon URLs return HTTP 200 with `image/png`. The shared layout emits one manifest link, including on the public sign-in page.
- `pnpm swarm gate --mongo-port 27607` passes all 18 steps on `b0bb7656`: lint, typecheck, format, 5,223 workspace unit tests, ceilings and all 11 HTTP verifiers.
- `TEST_MONGODB_URI='mongodb://127.0.0.1:27607/?directConnection=true' STANDALONE_TEST_MONGODB_URI='mongodb://127.0.0.1:27608/?directConnection=true' VITEST_MAX_WORKERS=2 pnpm web test:integration` passes: 68 files, 637 tests.
- The first gate used an existing standalone Mongo server on 27018; transaction verifiers failed. The successful gate above used this worktree's dedicated replica set. The compatibility suite used a separate standalone server on 27608.

## Browser evidence

Desktop Chrome exposes **Install Splitbook** for the local production build at `http://127.0.0.1:64091`. The install manifest opens `/dashboard` and requests a standalone window. The owner then confirmed the standalone launch (see Manual installation confirmation below).

This change adds installation metadata and generated icon copies, with no page layout or theme changes. The existing Home was exercised at desktop 1440×1000 and phone 390×844 in both themes. These are post-change smoke screenshots, not a claimed visual redesign or before/after comparison. They stay on GitHub in PR #625 (commit `162bda3b`), not in the repository.

No service worker, offline feature or in-app installation prompt is included. Signed-out launches still follow the existing sign-in flow. No public HTTP data contract or permission changes.

## Manual installation confirmation

Later on 19 October, the owner completed Chrome's installation confirmation for the local test build and reported: “Installed; Home opened.” This completes the standalone launch check. The test app is local only; no production installation or deployment was performed.
