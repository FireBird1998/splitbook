# Evaluation of interrupted implementation

11 October 2026. Implementation stopped at the user's request. These changes are uncommitted prototype work and have not been deployed, published as a PR, or accepted as completed tickets. Unrelated landing-page changes belong to separate work and are excluded from this assessment.

## Evidence already obtained

- Nine persistent-Draft integration tests passed against an isolated replica-set MongoDB: private incomplete entries, Group-wide capacity and races, exact retry identity, permanent content discard, revisions, membership removal/rejoin, Group deletion and authenticated route behavior.
- Five MCP connection tests passed: an actual SDK client used a local synthetic OAuth setup for discovery, PKCE/consent/token exchange, tool discovery/call, protocol compatibility, invalid credentials/origin rejection, refresh and revoked-consent rejection.
- Web typechecking passed before the last test-harness cookie-handling adjustment. No full final lint/build/regression run has been completed. These results are evidence from the interrupted work, not a new full acceptance run.

## Reusable candidates

- Pure incomplete-Draft validators and hard limits already express 10 per request and 100 active per Group across all members.
- Draft service and authenticated routes implement owner isolation, persisted collections, whole-batch creation, exact creation identity, revisions and permanent discard with content-free replay receipts.
- The mutation path uses the existing Group transaction fence. Group cleanup inventory was extended to include Draft records.
- A connection factory uses the official MCP SDK and Better Auth token verification, with an injected live-authorization check. It exposes only a synthetic connection-status tool and is deliberately not mounted in the application.

## Gaps and required evaluation before reuse

1. **Connection is only a harness.** There is no mounted production MCP endpoint, real consent/connection management UI, durable per-connection generation, production account-eligibility enforcement, or actual ChatGPT/Claude interoperability result. The harness's dynamic client registration and local callbacks do not demonstrate hosted client metadata support.
2. **The feature is not usable yet.** There are no web/native Android persistent-Draft screens, complete review/save conversion, duplicate detection/acknowledgment, mixed save outcomes, or MCP ledger/Draft tools.
3. **Membership is only partly handled.** Reads/writes check current membership. Fresh review after a leave/rejoin cycle is not implemented and must not be inferred from the passing rejoin test.
4. **Deletion needs completion.** Group cleanup integration exists; account cleanup is not established. Adding a required Draft count to a cleanup manifest can invalidate existing manifests; assess compatibility or safe regeneration and run lifecycle regression tests.
5. **Operational requirements changed.** Draft writes fail when MongoDB transactions are unavailable. A replica set or other supported transaction-capable deployment is required. The Group fence must remain effective for all relevant writers; no unsafe standalone fallback is acceptable.
6. **Replay details need final contracts.** Discard removes values but retains request identity and fingerprint metadata. Review data minimization and deletion of receipts. Conversion must preserve durable saved outcomes, including retry behavior after the resulting Expense is later changed or deleted.
7. **Tests are partial.** Several existing Draft cases exercise the service directly with mocked authentication. Consolidate coverage toward authenticated HTTP/MCP boundaries and add real UI journeys. No broad security, performance or complete repository regression claim is justified.
8. **Dependencies require integration review.** The prototype installed MCP SDK server/client 2.3.1 and Better Auth MCP/CIMD 1.7.7, pinning Better Auth utilities 0.4.2 for peer compatibility. This proves local installation and selected behavior, not ongoing latest-version status or host compatibility.

## Disposition

Preserve the prototype without further implementation. Review and reuse individual pieces under the approved tickets; passing tests do not close tickets whose user-visible acceptance criteria are missing. The new spec carries the user's corrected Group-wide quota and supersedes the earlier readiness brief's per-member interpretation. Earlier plan files remain unchanged.
