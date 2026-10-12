# Show ChatGPT authorization and verify the complete setup journey

Status: Approved and published as [#400](https://github.com/FireBird1998/splitbook/issues/400) on 11 October 2026.

## Parent

[Connect ChatGPT spec #398](https://github.com/FireBird1998/splitbook/issues/398).

## What to build

Members can check whether ChatGPT is authorized from the guide, understand their actual permissions and manage the connection through existing Settings. Verify the finished guide in a real staging ChatGPT journey.

## Acceptance criteria

- [ ] Signed-out visitors are invited to sign in; no personalized connection data is rendered publicly or shared through caches.
- [ ] Reuse authenticated connections listing, no-store behavior and expected-account protection; match the exact recognized ChatGPT client identity and account for pagination before reporting no authorization.
- [ ] Show loading, not-authorized, authorized, unavailable and retryable failure states with an explicit status-refresh action. Failed checks never masquerade as disconnection.
- [ ] Show actual scopes for each matching grant, including preexisting broader Draft access; viewing the guide does not modify any grant.
- [ ] Link to existing Settings controls for disconnect/reconnect instead of adding a second permission editor. Returning and refreshing reflects the current grant state.
- [ ] Account change/sign-out clears prior personalized results; late/stale responses cannot restore them.
- [ ] Authorization is never labeled an automatic tool-test pass; the manual test prompt remains the way to verify in ChatGPT.
- [ ] Browser coverage exercises successful/absent/non-ChatGPT/paginated grants, broader permissions, revocation, retry, and stale-account states through the user-visible journey.
- [ ] Preserve existing backend authorization/revocation behavior; extend its tests only if contracts change.
- [ ] Record one real staging walkthrough from the finished guide: setup and consent, authorization display, connection-test tool success, disconnect using Settings and refreshed no-authorization state. Do not include credentials, tokens or private ledger data in evidence.
- [ ] If external ChatGPT access prevents the walkthrough, record it as pending and do not mark the ticket fully accepted or the guide verified. Claude and production rollout remain separate.

## Blocked by

- [#399 — Guide members through read-only ChatGPT beta setup](https://github.com/FireBird1998/splitbook/issues/399).
