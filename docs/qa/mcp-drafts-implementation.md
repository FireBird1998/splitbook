# MCP and persistent Draft implementation — 11 October 2026

Authority: approved [spec #383](https://github.com/FireBird1998/splitbook/issues/383), tickets #384–394. The user authorized continuing all coding work while deferring staging and production hosting. Historical planning files remain unchanged. No deployment, DNS change, production secret change, commit, push or issue closure was performed.

## Implemented locally

| Tickets  | Implementation                                                                                                                                                                                                                                                 |
| -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| #384     | Existing OAuth/PKCE/refresh connection, separate consent, live grant checks and generation-based disconnect retained.                                                                                                                                          |
| #385–386 | Group discovery/context, canonical per-currency Balances and bounded Expense/spending queries. Inclusive UTC dates and full-window currency totals are explicit. Reads never generate recurring Expenses.                                                      |
| #387–389 | Persistent private Draft collection; manual Keep as Draft; web and native listing/edit/permanent discard; strict incomplete values; current membership and stale revisions; exact creation replay; 10/request and atomic 100/Group across owners.              |
| #390–391 | Member-only review, exact computed allocations, owner-private/saved-Expense duplicate warnings and revision/context-bound acknowledgment. Transactional conversion with durable outcomes, per-item selected-save results, retry-safe handling of lost replies. |
| #392–393 | Scoped MCP list/create/replace/discard using the same Draft operations; review URLs; explicit missing fields; current-grant checks at write authorization. No save tool.                                                                                       |
| #394     | Disabled-by-default release switches, bounded bodies, MCP rate limits, private responses, account/Group cleanup and local verification. Hosted and device acceptance remain release gates.                                                                     |

One collection is the set of records owned by a member in a Group; no additional collection entity is needed. Incomplete facts stay absent. Active Drafts never change ledger totals or Activity. Both Draft conversion and quota checks require transaction-capable MongoDB and share the existing Group mutation fence. Account deletion also fences the owner document so concurrent writes cannot recreate private content.

Native upload persists the exact request before sending. An unknown reply retains it; opening the collection or reconnecting never sends it automatically. Retrying uses the same payload and key. A recovered Expense with an uncertain existing save cannot be uploaded. Successful upload removes matching local recovery only after acknowledgment; a cleanup failure retains the receipt. Native request records participate in account sign-out and confirmed Group-access-loss cleanup. Web retains unresolved creation/save requests in account/Group-scoped tab storage.

Selected saves can report saved, failed or unresolved items. Validation failures remain editable; uncertain commits retain the original reviewed command. Duplicate warning changes, newer revisions, participant/Tag changes and leave/rejoin invalidate earlier reviews. The possible-duplicate rule uses same description ignoring case, amount, currency and UTC calendar date; it never merges records or reads another member’s private Drafts.

## Verification

- Web unit suite: **897 passed**, two pre-existing failures in `brand-surfaces.test.ts` against separately modified landing content. That work was preserved.
- Native suite: **2,089 passed** across 87 files, including the new rendered selection/review/outcome journey. Existing save timing and rendering ceilings pass.
- Shared suite: **1,487 passed**; an additional authentication-refused retry regression passes in the four-case Draft request recovery suite.
- Targeted real-database integration: **52 cases** across connection/tool authorization, persistent Drafts and Group cleanup (the final added Draft deletion race also passed separately). Covers quota concurrency, exact retries, private ownership, stale changes, rejoining, duplicate acknowledgment, transactional conversion, save/discard races, account/Group deletion and fault-injected Group deletion barriers.
- Real OAuth + official MCP SDK: ledger scope isolation; Group/Balance/spending calls; UTC boundary and pagination checks; separate INR/USD totals; multiple incomplete Draft creation/replay, revision-aware edits/discard, no save tool and no ledger/Activity mutation; membership and grant rejection.
- Actual native controller against the local Next backend: web-created Draft visible natively; native correction, stale rejection and permanent discard; local form upload with deliberately lost committed response; exact retry and recovery handoff; review/save creates one Expense. Reproducible script: `apps/mobile/scripts/verify-shared-drafts.ts` (loopback-only synthetic fixtures).
- Browser: existing Expense-form Keep as Draft; incomplete collection creation; reload persistence; edit and member review; save removes the Draft and produces the normal ledger Expense. Phone light/dark and desktop screenshots inspected; no browser console errors in the journey.
- Workspace typecheck, targeted lint and whitespace checks passed.
- Production-style Next.js build passed in an isolated app copy, using synthetic secrets, separate HTTPS app/MCP origins and enabled Draft flags.
- Android production JavaScript/Hermes bundle export passed with the Draft feature enabled. This is not an installed APK or emulator/device verification.

Screenshots: [desktop review](../../output/mcp-drafts/web-review.png), [phone light](../../output/mcp-drafts/web-mobile-light.png), [phone dark](../../output/mcp-drafts/web-mobile-dark.png).

The first broad cleanup integration run used a replica set without test commands and failed on `configureFailPoint`. A disposable replica set with `enableTestCommands=1` was provisioned locally; the required fault-injection suite then passed. Production databases were never used.

## Deferred acceptance and operation

Hosting, DNS, Google OAuth staging configuration, real ChatGPT/Claude account interoperability, hosted CIMD behavior and installed native Android/device acceptance are not verified. No public rollout is authorized by these local results. The repository has no local Android SDK/adb available in this session; the Android code, rendered tests, actual controller HTTP journey and bundle build are verified instead.

Use [the runbook](../runbooks/mcp-connections.md) for environment switches, transaction prerequisites, cleanup compatibility and disable behavior. Keep `MCP_ENABLED`, `PERSISTENT_DRAFTS_ENABLED`, `NEXT_PUBLIC_PERSISTENT_DRAFTS_ENABLED` and `EXPO_PUBLIC_PERSISTENT_DRAFTS_ENABLED` off in public environments until acceptance. The chosen resource URLs remain `https://mcp.staging.splitbook.in/api/mcp` and `https://mcp.splitbook.in/api/mcp`; neither was provisioned.

Example local verification (use an isolated replica set, never production):

```sh
pnpm typecheck
pnpm mobile test
pnpm --filter @splitbook/shared test
TEST_MONGODB_URI='mongodb://127.0.0.1:27030/?directConnection=true' pnpm web exec vitest run src/lib/mcp/connection.integration.test.ts src/lib/services/expense-draft.integration.test.ts src/lib/group-cleanup.integration.test.ts
MOBILE_VERIFY_URL=http://localhost:4138 pnpm mobile exec tsx scripts/verify-shared-drafts.ts
```

The HTTP journey needs a locally running demo backend with synthetic Alex seeded and `PERSISTENT_DRAFTS_ENABLED=true`; it creates its own fictional Group and archives it after verification. Fault-injection tests need MongoDB test commands enabled only on their disposable local database server.

## Follow-up review against the approved spec and tickets

Reviewed all tracked and untracked MCP/Draft work against `HEAD` (`9788b240a772fb7e9c7cbfe45250226efd47198d`) and freshly fetched GitHub spec #383 / tickets #384–394. This includes the earlier connection prototype. Unrelated landing work and historical plans were excluded. Two independent reviews covered repository standards and specification behavior; findings were fixed before final verification.

### Standards

Two documented standards gaps were fixed:

1. **ADR 0006 state ownership:** Android's Draft screen previously owned fetched data and form state directly. `shared-draft-collection.ts` now owns commands and projects state through the controller snapshot. TanStack owns online reads, using the shared account/environment/Group key, 30-second freshness and verification on opening. No offline collection copy is persisted. Web collection reads now use SWR and the same key factory. Membership denial clears native private content; stale edits preserve unsent corrections.
2. **ADR 0006 response decoding:** The shared client previously trusted successful HTTP bodies through type assertions before acknowledging an upload. Runtime shared schemas now validate Drafts, review responses and per-item outcomes, including Group/identity/count correspondence. Malformed or incomplete replies retain the original request and never invoke local recovery cleanup.

The duplication heuristic was addressed at the protocol boundary with common decoders, request recovery and key/path factories. Platform-specific presentation remains separate; Android's state transitions now live in its controller module.

### Spec

Six behavioral gaps were fixed:

1. **Unknown Category:** Complete Expense validation formerly defaulted an omitted Draft Category to Other. Draft review/conversion now requires explicit Category; ordinary Expense behavior is unchanged.
2. **Currency labeling:** Assistant spending responses no longer expose unlabeled legacy scalar totals calculated only in the Group's default currency. They return full-range per-currency totals and count alongside paginated Expenses.
3. **Retry outcomes:** Both clients display saved/failed/unresolved outcomes returned by an explicit retry, including after a lost reply and reopened collection. Missing display names fall back to stable Draft identities.
4. **Explicit write intent:** Native Keep as Draft no longer retries an unrelated retained operation, which could have been an earlier Expense conversion. It directs the member to the collection's explicit retry action.
5. **Duplicate explanation:** Both clients explain the similarity rule: matching description, amount, currency and UTC date. Acknowledgment still binds to the current warning set.
6. **Missing-fact clarity:** Missing Tag is reported even when other missing fields prevent schema refinements from running. Missing Date, Category, payer amounts and other facts have actionable messages rather than raw type errors. Nothing is invented or saved to resolve them.

No confirmed coding gaps remain from these reviews. This is not a claim that hosted or installed-device acceptance has passed. Issues remain open; hosting and release enablement are deferred.

### Final verification after corrections

- Native: **2,090 tests passed**, 87 files. The new rendered regressions exercise controller-owned selection/review, lost bulk-save reply, foreground/reconnect without automatic writes, explicit retry outcomes, stale corrections and membership denial.
- Shared: **1,497 tests passed**, 59 files. The 13-case recovery suite includes malformed creation acknowledgments, incomplete/mismatched save results and refused retries retaining their original identity.
- Backend: **29 integration tests passed** (17 Draft and 12 MCP) on the isolated replica set, including explicit Category resolution and per-currency response semantics. The final missing-fact copy assertions also passed in the 17-case Draft suite.
- Web: **897 unit tests passed**; the same two unrelated landing brand-surface tests fail. Their source remains untouched.
- Real browser: committed a selection of one valid and one incomplete Draft, deliberately dropped the save response, reloaded the page and explicitly retried. Both per-item outcomes appeared; only one Expense existed and the failed Draft remained active. [Captured outcome](../../output/mcp-drafts/retry-review.png) predates the final friendly missing-field copy change, which is covered by the backend regression.
- Actual native controller against local Next HTTP: web/native visibility, stale edit refusal, discard, local recovery handoff and deliberately lost creation reply followed by exact retry all pass; review/save produces one Expense.
- Workspace typecheck, targeted lint/formatting and whitespace checks passed.
- Final Next.js production build and Android JavaScript/Hermes export passed with Draft flags enabled. All values were synthetic; nothing was deployed.

Standards: **2 required findings fixed** (highest risk: acknowledging an unvalidated reply). Spec: **6 findings fixed** (highest risk: retrying a save without the corresponding explicit intent). Hosted assistant interoperability and installed Android acceptance remain pending as documented above.
