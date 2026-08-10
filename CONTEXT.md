# SplitWise Beta

Shared-expense ledger for personal groups and trips. This file is the project's ubiquitous language — the glossary every doc, variable, and UI string should agree with.

## Language

**Theme**:
A group's shape and identity, chosen once at creation and derived from the stored `Group.category` field. Drives chrome, copy nouns, default tags, and date semantics.
_Avoid_: group category, group type, vibe

**Category**:
The fixed, global classification of an expense (`Expense.category`: food, transport, stay, …). Belongs to expenses, never to groups.
_Avoid_: expense type, kind

**Tag**:
A group-scoped, user-managed label on an expense (`Expense.tag`, administered via `Group.tags`). Exactly one per expense, required.
_Avoid_: label, expense group

**Month**:
In a Household group, a read-only lens over expenses for one calendar month in the viewer's own timezone — never a ledger boundary. Answers "what did August cost us", never "what is owed".
_Avoid_: cycle, period, billing month
