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
One calendar month in the viewer's own time zone, in a Group of any Theme. It is a read-only way of looking at that month's Expenses, never a line drawn in the ledger: it answers "what did August cost us", never "what is owed". An Expense late on 31 August can fall in September for a member in another time zone. When a Month is compared with the months before it, it is never part of its own average.
_Avoid_: cycle, period, billing month

**Trip day**:
One calendar day of a Trip in the viewer's own time zone, numbered from the Trip's first day ("Day 2 · Fri 18 Sep"). The Trip's dates and its Expenses' dates are read in the same zone, so an Expense on the first day is always on Day 1. An Expense dated before the first day or after the last still counts toward the whole trip, but is never on a Trip day.
_Avoid_: trip date, itinerary day

**Saved copy**:
Server data stored on a member's device so a Group can be shown offline. It always shows when it was last verified and is never treated as current.
_Avoid_: cache (in product copy), offline data, local data

**Draft**:
What a member has entered in an Expense, Settlement or Group form but not yet sent. A draft never changes the ledger.
_Avoid_: pending Expense, unsaved Expense, local Expense

**Unconfirmed save**:
A save whose reply never arrived, so it may or may not be recorded. Only the member retries it, and a retry can never record it twice.
_Avoid_: pending write, queued save, offline save

**Connected assistant**:
An external AI assistant a member has authorized to act as them in Splitbook, limited to the access that member granted and revocable at any time. Acts only as that one member.
_Avoid_: bot, agent, integration

**Balance**:
A per-currency running position across a Group’s Expenses and recorded Settlements, expressing what a member owes or is owed. A Month does not reset or bound it.
_Avoid_: monthly balance, month-end balance

**Settlement**:
A ledger record of a payment that has already happened between members. It changes running Balances but does not transfer money or close a Month.
_Avoid_: transfer, payment processing, month closure

**Expense draft**:
An unfinished Expense entry retained for a member in a Group. It is not a saved Expense and has no effect on Balances.
_Avoid_: pending expense, offline expense
