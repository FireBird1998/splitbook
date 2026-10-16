# Coding standards

Read during review, by `/code-review` and any reviewer. These are judgement calls; mechanical rules are enforced by lint, typecheck and CI instead (the shared-package framework ban, the TanStack-mutation ban, formatting, render and request ceilings). Use the terms in `GLOSSARY.md`.

## Money safety

The product's promise: a member's ledger is exact, recorded once, and only ever changed by that member.

- **Writes are Member-started and online.** An Expense, Settlement, Group or Draft save is sent only when a member starts it, and only while online. Nothing queues, resumes or replays a write (ADR 0004, ADR 0006).
- **One retry identity per save.** A create sends an `Idempotency-Key` and an edit or delete sends `X-Splitbook-Revision`. The device stores both before sending, and a retry reuses them unchanged, so a lost reply can never record twice.
- **Exact money.** Amounts are integer minor units through `@splitbook/shared/exact-money`, both when shown and when sent.
- **Balances follow Expense reads.** Any read that shows totals adds due recurring Expenses first, so every view agrees.
- **A Connected assistant writes only Drafts.** A member saves them (ADR 0008).

## Accounts and access

- **One account's data per screen.** Sign-out and an account change purge account-local storage; losing access to a Group removes its cached and saved copies (ADR 0006).
- **Saved copies show their age.** A saved copy keeps its verification time and is never presented as current.
- **Every API route authenticates,** and every route that touches a Group checks membership before reading or writing its ledger.

## Structure

- **Android flows declare their transitions** in `apps/mobile/src/data/flow-transitions.ts`, and the controller snapshot is the only client-state store (ADR 0006).
- **Pure domain logic lives in `@splitbook/shared`**, so web and Android compute money the same way (ADR 0002).

## Tests

- **Test at the seam:** Android through the controller's commands and snapshot; web through HTTP (route integration tests and Playwright). Mock only the network edge.
- **A fix lands with a test that fails without it.**
