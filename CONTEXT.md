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

**Connected assistant**:
An external AI assistant a member has authorized to act as them in Splitbook, limited to the access that member granted and revocable at any time. Acts only as that one member.
_Avoid_: bot, agent, integration

**Excluded Group**:
A Group a member keeps out of one Connected assistant's reach. The assistant otherwise reaches every Group the member belongs to, including Groups joined later.
_Avoid_: hidden group, blocked group, private group

**Assistant rule**:
A Group admin's choice of whether members' Connected assistants may reach that Group at all. It limits every member's assistant, whatever each member granted.
_Avoid_: assistant policy, AI setting

**Paid**:
What a member put toward Expenses as their payer over a period. Different from a Settlement, which pays back a balance.
_Avoid_: fronted, contributed
