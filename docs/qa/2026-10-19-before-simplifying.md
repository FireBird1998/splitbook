# Before simplifying on web Balances

19 October 2026. Issue #608; parent spec #602.

## Scope

The Settle up card defaults to Suggested and preserves its existing rows, Record
actions and closing line. Before simplifying shows pairwise Debt sentences and
exact money, without Record actions or the paid-payment subtitle. The count note appears in both views only
when Suggested uses fewer payments. A settled-up Group keeps its existing message
and hides the switch. An older reply without the new list keeps Suggested.

The response adds `debtsBeforeSimplifying` beside the unchanged legacy `debts`
field, per currency and in the default-currency top-level figures. The new shared
calculation nets each pair after proportional Expense allocation and Settlements.

## Failing-first checks

- `divides a two-payer Expense without losing a paise from either payer or share`
  failed with Sam owing 33334 minor units rather than 33333 when shares were rounded
  independently. Reconciling payer totals within each Expense fixed it while
  retaining Priya's 66667 / 33333 split.
- `keeps currencies separate by refusing a mixed-currency invocation` failed when
  an Expense in another currency was accepted, then passed with the currency guard.
- `rejects malformed optional Debts before simplifying: %j` rejected neither null
  nor invalid list values before the optional contract field was declared.
- `returns the worked-example Debts beside unchanged Suggested payments and reduces
only the paid pair` failed at the missing response field, then passed through the
  real route and database. The existing Suggested payments were unchanged.
- `keeps the settled-up message and hides the switch even if pairwise Debts form a
cycle` failed with a visible switch and a zero-payments note, then passed with
  the settled-up condition.

These tests are committed. The first new calculation and component suites also
failed to import before their modules existed; those import failures are not
presented as the behavioral proofs above.

## Verification

- Shared calculation: ten cases, including the two worked examples, opposite
  Expenses, partial/opposite/excess Settlements, zero-pair removal, currency refusal,
  and 800 deterministic generated ledgers, each with several Expenses and six Settlements
  across three pairs in both directions. Every member's net of Debts matched
  their balance; reversing Expense, Settlement and payer/share input order preserved the output.
- Shared contract: 34 cases, accepting old and new replies and refusing malformed
  optional lists.
- Settle up component: nine cases covering both views, defaults, labels, exact
  amounts, no Record, note presence/absence, singular wording, settled-up and legacy
  replies.
- Route and balance-integrity integration: the worked example, recurring Expense
  reads, refusal checks, legacy mixed currencies, Settlement effects and a former
  member with zero net in a Debt cycle passed against an isolated replica set.
- A committed demo Household browser journey switches both ways, compares all
  Debt sentences with the read, checks the note, absence of Record, accessibility
  and page width, and captures both views in each configured theme and viewport.

## Visual verification status

Local browser verification is blocked by a saved origin permission, including
after the owner approved access and reported changing the setting. No alternate
browser or local origin was used to bypass that denial. The required CI browser
matrix runs against its own isolated build; its results and review images are
linked in the PR’s CI reports. Screenshots and logs are not committed.

## QA follow-up

- `orders member IDs by code unit regardless of locale` failed with lowercase `a`
  before uppercase `Z`; code-unit sorting fixes the order independently of locale.
- `shows the paid-payment subtitle only in Suggested` failed before the card header
  moved into the component that owns the view. It now covers Suggested, Before,
  settled-up and legacy replies.
- `can omit the Debt calculation while preserving Suggested payments` failed because
  the opt-out still returned Debts. The assistant read now opts out of the calculation;
  the regular Balances read still includes it.
- `names the Group when stored Settlement money prevents calculating Debts` failed
  with empty error ids when the new calculation lacked its stored-money boundary.
  It now reports the Group id with the stored-data error.
