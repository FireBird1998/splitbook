# Splitbook

Shared-expense ledger for personal groups and trips. This file is the project's ubiquitous language — the glossary every doc, variable, and UI string should agree with.

## Language

**Theme**:
A group's shape and identity, chosen once at creation and derived from the stored `Group.category` field. Drives chrome, copy nouns, default tags, and date semantics.
_Avoid_: group category, group type, vibe

**Category**:
The fixed, global classification of an expense (`Expense.category`: food, transport, stay, …). Belongs to expenses, never to groups.
_Avoid_: expense type, kind

**Tag**:
A Group-scoped, user-managed label with a stable identity independent of its name. Exactly one is required on each Expense; renaming or retiring a Tag preserves its historical associations.
_Avoid_: label, expense group

**Month**:
In a Household group, a read-only lens over expenses for one calendar month in the viewer's own timezone — never a ledger boundary. Answers "what did August cost us", never "what is owed".
_Avoid_: cycle, period, billing month

**Saved copy**:
Server data stored on a member's device, so a Group can still be shown offline. It always shows when it was last verified with the server and is never treated as current. Belongs to one account; sign-out, an account change or losing access to the Group removes it.
_Avoid_: cache (in product copy), offline data, local data

**Draft**:
What a member has entered into an Expense, Settlement or Group form but not yet sent to the server. A draft never changes the ledger. An Expense draft is kept on the device across restarts ("Draft saved"), one per Group and account.
_Avoid_: pending Expense, unsaved Expense, local Expense

**Unconfirmed save**:
A save whose reply never arrived, so it may or may not have reached the server (status `uncertain` in code; "not confirmed" in product copy). It keeps the payload and idempotency key it was sent with, and for an edit the revision too. Only the member retries it, and a retry reuses them, so a lost reply never turns one action into two records. It is never queued, resumed or replayed automatically. Sign-out, an account change, or its Group leaving the member's Group list removes it.
_Avoid_: pending write, queued save, offline save

**Connected assistant**:
An external AI assistant a member has authorized to act as them in Splitbook, limited to the access that member granted and revocable at any time. Acts only as that one member.
_Avoid_: bot, agent, integration
