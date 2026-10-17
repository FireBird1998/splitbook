
## Context for whoever picks this up

- **Spec:** #418, the To review staging fixes. Read it first: its decisions are final.
  - The parent feature is #403.
  - The staging QA that found these came first.
- **Rules that still apply:** ADR 0008, persistent assistant Expense Drafts. The Draft permission stays opt-in and unticked by default.
- **Words:**
  - Draft is the term in code and docs.
  - Members see To review, Finish later, Delete and Check again.
  - Never show "Draft", "revision", "request" or "collection" to members.
- **Flags:** everything stays behind the existing persistent-Drafts flags. Production keeps them off; turn them on locally and in tests.
- **House rules:**
  - Pure shared logic lives in `@splitbook/shared`, with no framework, DB or DOM imports (ADR 0002).
  - Changes to existing reads are additive.
  - Money is exact.
  - Fictional data only: the repo is public.
  - Unit tests must pass in UTC, Pacific/Pago_Pago, Pacific/Kiritimati and Pacific/Tongatapu.
  - Light and dark, 130% text, axe-clean.
  - Saving Drafts needs a MongoDB that supports transactions, so use your own single-node replica set for integration and browser tests.
- **PRs:**
  - Use the `full-ci` label.
  - Commit messages are plain, with no model names and no Co-Authored-By trailer.
  - Never delete branches.
  - Never use port 3100, any database on Mongo 27017, the backend on 4138, or emulator-5554.
- **Orchestration:** the owner's orchestrating session reviews and merges. Say which ticket the PR closes, and list any decision you made under "Notes for review".
