# Coding standards

Read during review, by `/code-review` and any reviewer. These are judgement calls; mechanical rules are enforced by lint, typecheck and CI instead (the shared-package framework ban, the TanStack-mutation ban, formatting, render and request ceilings). Use the terms in `GLOSSARY.md`.

## Money safety

The product's promise: a member's ledger is exact, recorded once, and only ever changed by that member.

- **Writes are Member-started and online.** An Expense, Settlement, Group or Draft save is sent only when a member starts it, and only while online. Nothing queues, resumes or replays a write (ADR 0004, ADR 0006).
- **One retry identity per save.** A create sends an `Idempotency-Key` and an edit or delete sends `X-Splitbook-Revision`. The device stores both before sending, and a retry reuses them unchanged, so a lost reply can never record twice.
- **Exact money.** Amounts are integer minor units through `@splitbook/shared/exact-money`, both when shown and when sent.
- **Any read of a Group's ledger brings it up to date first.** The Group ledger read module records due recurring Expenses before ledger data is read, for members and Connected assistants. Member metadata operations use the same admission without generation; the choices are listed in `docs/architecture.md`. No caller selects a generation setting.
- **A Connected assistant prepares only Drafts.** A member saves them (ADR 0008). As the owner decided in #1126, assistant Group operations also trigger the ordinary recurring generator, attributed to the template creator.

## Accounts and access

- **One account's data per screen.** Sign-out and an account change purge account-local storage; losing access to a Group removes its cached and saved copies (ADR 0006).
- **Saved copies show their age.** A saved copy keeps its verification time and is never presented as current.
- **Every API route authenticates.** Group ledger reads use `apps/web/src/lib/group-ledger-read.ts` for actor admission, the admitted Group and delivery-time access checks. Review the read's named settings against the read record; do not add a route/service membership gate or a read-time generator call. `pnpm check:reads` enforces the boundary with site-specific, stale-checked exceptions. Writes keep access checks in their own recording or Group mutation.

## Structure

- **Record the ledger through `ledger-recording.ts`.** A new Expense or Settlement writer supplies a description to `recordLedger`; an existing Expense changes through `changeLedgerExpense`. The module owns the fence, event, audience, persistence and publication order. Do not assemble that sequence in a writer. `pnpm check:recordings` enforces it in the gate and CI; reviewed maintenance/projection exceptions name one exact site and fail when stale.

- **Android flows declare their transitions** in `apps/mobile/src/data/flow-transitions.ts`, and the controller snapshot is the only client-state store (ADR 0006).
- **Pure domain logic lives in `@splitbook/shared`**, so web and Android compute money the same way (ADR 0002).
- **A web model registers every model its schema's `ref`s name,** so a cold server instance can populate it whatever route loaded it first (#947). `apps/web/src/app/api/route-models.test.ts` checks every API route.

## Tests

- **Test at the seam:** Android through the controller's commands and snapshot; web through HTTP (route integration tests and Playwright). Mock only the network edge.
- **A fix lands with a test that fails without it.**
