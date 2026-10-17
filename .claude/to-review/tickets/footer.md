
## Context for whoever picks this up

- **Parent spec:** #403. Read it first: its decisions are final.
- **Design:** the canvas https://claude.ai/artifact/R73Hkvu43SAkDqWDoKLMN9, page **"Phone: To review"**.
  - Boards: ReviewHome, ReviewGroup, ReviewList, ReviewCard and ReviewForm. Each has a **State** switch in the properties panel showing every state; use it.
  - The green "Settled in review" note lists all 16 decisions.
  - The web follows the same rules using the web's existing patterns (Home cards, the Expense side panel).
- **Rules that still apply:** ADR 0008 (persistent assistant Expense Drafts) and the 11 October drafts review spec under `docs/specs/mcp-drafts-review/`, for lifecycle, revocation, retention, deletion fencing, replay identity and per-item save outcomes. #403 overrides them only on the limit: **100 per member per Group**.
- **Words:**
  - **Draft** is the term in code and docs.
  - Members see **To review**, **Finish later**, **Delete** and **Check again**.
  - Never show "Draft", "revision", "request" or "collection" to members.
- **Flags.** Everything stays behind the existing persistent-drafts flags (server, web public and Android public). Production has them off; turn them on locally and in tests.
- **House rules:**
  - Pure shared logic lives in `@splitbook/shared`, with no framework, DB or DOM imports (ADR 0002).
  - Changes to existing reads are additive: Android and the mobile HTTP verifiers read them.
  - Money is exact minor units.
  - Fictional data only: the repo is public.
  - Unit tests must pass with `TZ` set to UTC, Pacific/Pago_Pago, Pacific/Kiritimati and Pacific/Tongatapu. Build date labels with the app's own formatter, never hard-coded.
  - Tables that scroll sideways need a focusable named region.
  - Light and dark, 130% text, and axe-clean.
- **PRs:**
  - Need the `full-ci` label.
  - Re-record pilot screenshot baselines only if they really change, in CI's Linux Playwright container, in their own commit.
  - Commit messages are plain, with no model names and no Co-Authored-By trailer.
  - Never delete branches.
- **Orchestration.** The owner's orchestrating session reviews and merges these tickets. Say in the PR which ticket it closes, and list any decision you had to make under "Notes for review".
