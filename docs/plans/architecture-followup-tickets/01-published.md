## Parent

https://github.com/FireBird1998/splitbook/issues/72

## What to build

Members can browse the same complete, validated Group list on web and Android, including the web dashboard, and recover visibly when a response is invalid.

## Acceptance criteria

- [ ] Adopt one pure shared Group read definition through the existing list route and both real consumer adapters. Preserve server wire fields, ordering, supported values and each client’s presentation model.
- [ ] Cover known optional omissions and all fields consumed by web; reject malformed required identities, members, timestamps and unsupported required currency/Theme. Preserve alternate currency codes and retired Tag identity; tolerate unrelated extra response fields.
- [ ] Show a safe, accessible whole-list error with Retry for invalid responses. Never silently filter a Group or turn a failed load/refresh into “No groups yet”; preserve existing valid-cache, account and logout behavior.
- [ ] Exercise real authenticated Group list responses through both adapters, plus web list/dashboard recovery and native list/controller recovery. Include wrong-account and late-response protection.
- [ ] Keep detail, creation and invitation flows working during staged adoption; remove duplicated list interpretation rather than adding aliases over the same casts.

## Blocked by

None — can start immediately.
