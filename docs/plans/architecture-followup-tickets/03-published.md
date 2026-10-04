## Parent

https://github.com/FireBird1998/splitbook/issues/72

## What to build

Demonstrate that list-to-detail journeys remain consistent and recoverable across clients, with concrete evidence for the completed Group response work.

## Acceptance criteria

- [ ] Run complete list/dashboard/detail/settings journeys against an isolated real app and MongoDB, asserting identity, Theme, dates, members, currencies and historical Tag behavior through both adapters.
- [ ] Verify whole-response invalid-data failure, Retry, harmless extra fields, legacy optional omissions and refresh/cache behavior. Confirm no Group is silently omitted and no error is reported as an empty account.
- [ ] Retain other-account, requested-ID, logout, unauthorized, recurring-generation, creation and invitation regressions. Check the existing native smoke journey and Android UI where available; distinguish controller-only coverage from device evidence.
- [ ] Complete relevant lint, formatting, type checks, shared/web/mobile suites and applicable builds; inspect desktop/mobile web layouts and accessibility of error/Retry controls. Investigate failures without weakening tests.
- [ ] Report the tested revision, commands, exact outcomes, remaining risks and any unavailable device coverage. Use disposable test data, preserve user work and leave the parent specification open and unmodified.

## Blocked by

- https://github.com/FireBird1998/splitbook/issues/75
