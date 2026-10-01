## Parent

https://github.com/FireBird1998/splitbook/issues/73

## What to build

Both manual writers attempt recoverable Activity publication before preparing the response, and share only coordination that demonstrably reduces duplicated retry knowledge.

## Acceptance criteria

- [ ] Apply the approved Activity-before-response ordering on fresh creation, replay and collision recovery; keep bounded publication failures recoverable without invalidating committed financial writes.
- [ ] Preserve writer-specific authorization, participant checks, normalization, historical Tag identity, scoped immutable fingerprints, currency-lock ordering, existing response/error formats and unkeyed behavior.
- [ ] Keep financial record and pending intent in one atomic document commit. Match exact scoped retries after unique collisions and rethrow unrelated collisions; reuse existing indexes and Activity recovery.
- [ ] Expose two explicit creation operations with the common protocol internal and concrete persistence adapters. Callers must not configure the creation sequence through policy callbacks.
- [ ] Compare caller knowledge before/after. If consolidation only introduces indirection or a callback-heavy interface, retain explicit writers and record the justified deferral while still delivering the approved ordering and tests.
- [ ] Update characterization expectations only for the approved ordering change. Prove postcommit response failure plus retry retains one record, one Balance effect and eventual single Activity; preserve every other characterized policy.

## Blocked by

- https://github.com/FireBird1998/splitbook/issues/77
