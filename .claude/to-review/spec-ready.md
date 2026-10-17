## Problem Statement

The staging re-test on 16 October 2026 showed that a Connected assistant can now add items to To review, and an Expense saved from one says "prepared by Claude". But **nothing an assistant prepares can ever be Ready.** "Save N ready" never applies to assistant items, so the member has to open and fix every one.

Two rules cause this:
- **A lone payer without an amount counts as missing.**
  - When a member tells Claude "I paid for dinner", Claude records who paid but gives no separate amount for them, because there is only one payer.
  - To review treats that payer's amount as missing and shows "Who paid?". Add expense never asks for it: with one payer, they paid the whole Expense.
  - On web, the review panel also opens in the several-payers mode, with an empty amount.
- **Category is required in To review but optional everywhere else, and assistants can't see the choices.**
  - Add expense keeps Category among the optional details and saves Other when none is chosen.
  - To review instead marks every item without a Category as needing "the category".
  - Assistants can't supply one. The item tools take Category as free text without listing the choices, and the Group details they read list Tags only.

There is also a smaller wording issue. Before creating the items, Claude said it would add them "as drafts", because of the tool name. Its reply afterwards correctly said To review. Members should never see "Draft".

## Solution

- **One payer means they paid it all.**
  - An item with exactly one payer and no amount for them counts as that member paying the whole Expense, as in Add expense.
  - The item is no longer missing anything, the panel shows "Paid by Ankit Das", and saving records that member paying the full amount.
  - With several payers, each still needs their amount.
- **Category works as it does in Add expense.**
  - A missing Category no longer holds an item back. The item is saved as Other.
  - Both review panels show Other as the chosen Category until the member changes it.
- **Assistants can choose a Category.** The item tools list the Category choices, and the Group details list them next to Tags. An assistant chooses one only when the member's words make it clear, and otherwise leaves it out.
- **Assistants say "To review".** The item tools' descriptions tell assistants to call these items in the member's To review, not drafts. Tool names don't change.

The result: an item Claude prepares with a description, amount, date, one payer, the split and a Tag is Ready, and "Save N ready" saves it along with the others.

## User Stories

1. As a member, I want an item Claude prepared from "I paid ₹1,200 for dinner" to be Ready, so that I can save it with Save N ready.
2. As a member, I want an item with one payer to count that member as paying the whole amount, so that To review matches Add expense.
3. As a member, I want the review panel to show "Paid by Ankit Das" for that item, not an empty per-person amount, so that it looks like the Add expense form.
4. As a member, I want the payer's share of a one-payer item to follow when I change the Expense amount, so that I don't have to update two numbers.
5. As a member, I want an item with several payers to still ask for any payer's missing amount, so that nothing about a shared payment is guessed.
6. As a member, I want an item whose single payer has an amount different from the total to still say what's wrong, so that a real mismatch isn't hidden.
7. As a member, I want the saved Expense to record the lone payer paying the full amount, so that Balances are right.
8. As a member, I want an item without a Category not to need details, so that, as in Add expense, Category never holds back saving.
9. As a member, I want that item to show Other as its Category in the panel, so that I can see what will be saved.
10. As a member, I want to pick a different Category in the panel before saving, so that I can correct it.
11. As a member, I want an item saved without a Category to be saved as Other, so that it matches an Expense I added by hand without one.
12. As a member, I want Claude to set the Category when it's clear from what I said (dinner → Food & Drink), so that my Expenses are classified without extra taps.
13. As a member, I want Claude to leave the Category out when it isn't clear, so that it doesn't make things up.
14. As a member using ChatGPT, I want the same behaviour, so that both assistants work the same way.
15. As a member, I want Claude to talk about "your To review", not "drafts", so that its words match the app.
16. As a member on Android, I want the same items to be Ready and to show the same Other Category, so that web and Android agree.
17. As a member, I want an item with no payer at all to still say "Claude didn't know who paid, so it left that to you", so that unknown facts still come to me.
18. As a member, I want the Save N ready confirmation to show the payer and the total for these items, so that I know what I'm saving.
19. As a member, I want items I kept myself with Finish later to follow the same rules, so that there is one rule for every item.
20. As the owner, I want readiness, missing facts, the confirmation and saving to share one rule, so that an item never shows Ready and then fails to save.
21. As the owner, I want a test that creates an item through the assistant tools exactly as Claude did on staging, then sees it Ready and saved, so that this can't regress unnoticed.
22. As the owner, I want the staging re-test to show Save N ready saving Claude's items before production, so that the launch includes the quick path.

## Implementation Decisions

- **One shared completion step.**
  - The shared Draft validators gain one step that turns Draft values into Expense input. It applies two rules:
    - a lone payer with no amount pays the whole Expense amount;
    - a missing Category becomes Other.
  - It never fills in anything else. Payers, participants, the split, amounts, dates, the Tag and the description come only from the member or the assistant.
- **Every check uses that step.**
  - The users are:
    - readiness and the named missing facts in the shared To review model;
    - the server's missing fields and problems;
    - the server's review, meaning the allocation and the duplicate check;
    - the Save N ready selection and its totals;
    - saving.
  - Because they all use the same step, they can't disagree.
  - Stored Draft values aren't rewritten, so the rule doesn't change the review fingerprint.
- **The server stops listing Category as a missing fact.** An invalid Category is still refused when an item is created or replaced.
- **This reverses an earlier choice.**
  - Persistent Drafts (#396) deliberately didn't give review the ordinary form's default Category.
  - Category is optional in Add expense and never affects Balances, yet requiring it blocked every assistant item. So To review now follows Add expense.
  - ADR 0008's rule that "an assistant must not invent missing facts" still holds. The assistant doesn't fill in the Category; the app applies the same default as Add expense.
- **Payer rules that don't change.**
  - With two or more payers, each needs an amount ("The amount paid by Ankit Das?").
  - A lone payer whose amount differs from the total is a problem, shown in member words.
- **The review panels.**
  - **Web:** an item with one payer and no amount opens in the one-payer mode ("Paid by …"). Changing the amount keeps that payer paying all of it.
  - **Web and Android:** when no Category is stored, the Category control shows Other, as in Add expense. Changing it stores the member's choice.
  - **Android** already shows a lone payer in the one-payer mode. It gets the readiness change through the shared model.
- **The assistant tools (MCP).**
  - The item tools' input lists the Category choices as a fixed set with their labels, replacing free text.
  - The Group context tool returns the Category choices alongside members, Tags and currency.
  - **Tool guidance:**
    - "For one payer, give who paid; they paid the whole amount. For several payers, give each amount."
    - "Choose a Category only when the member's words make it clear; otherwise omit it, and it's saved as Other."
  - The descriptions refer to "items in the member's To review" and ask assistants not to call them drafts. Tool names stay the same.
- **Flags.** Everything stays behind the existing persistent-Drafts flags. Production remains off.

## Testing Decisions

- **What makes a good test:** it checks what a member or a real assistant sees at a public boundary, such as the To review states, the tools an assistant calls and the saved Expense. It doesn't check internal state.
- **Seam 1: the shared To review model and Draft completion.**
  - Prior art: the shared To review and expense-draft tests.
  - Run in the four CI time zones:
    - one payer with no amount, everything else present → Ready, counted in Save N ready and its total;
    - no Category → Ready, and the completed Expense input has Other;
    - two payers, one amount missing → Needs details, naming that payer's amount;
    - one payer with a different amount → Needs details, in member words;
    - no payer → still needs "who paid".
- **Seam 2: the server, through the assistant tools.**
  - Prior art: the MCP connection suite (real OAuth and the official MCP SDK), and the Draft and To review integration tests.
  - The tool list shows the Category choices, and the Group context returns them.
  - Create an item exactly as Claude did on staging (one payer without an amount, no Category). The To review read shows no missing fields.
  - Save it. The result is an Expense with that payer paying the whole amount, Category Other, prepared by the assistant.
  - An unknown Category is refused.
- **Seam 3: one web journey on the demo seed.**
  - Prior art: the To review page journey.
  - An assistant-prepared item with one payer and no Category shows as Ready.
  - The panel shows "Paid by …" and Other.
  - Save 1 ready saves it.
- **Android:** the existing review form and review run tests gain the Other Category display and a one-payer item counted as Ready.

## Out of Scope

- Renaming the assistant tools.
- Letting assistants fill in unknown payers, participants, amounts or dates.
- Changing Category in Add expense, or making Category a per-Group list.
- Inferring a Category on the server from the Tag or the description.
- Production rollout and the flags.

## Further Notes

- **How it was found:**
  - The staging re-test after #418, on 16 October 2026, in the Group "TR QA Oct15".
  - Claude prepared Dinner, Taxi and Groceries.
  - Dinner and Taxi showed "Who paid?", and every item needed "the category".
  - After the member filled these in, Dinner saved as "You · prepared by Claude".
- **The re-test after this ships:**
  1. Redeploy staging.
  2. Ask Claude to add two expenses with one payer each.
  3. Confirm they show Ready, Save 2 ready saves them with "prepared by Claude", and Claude talks about To review.
  4. Then do the Android QA.
- **Parent:** #403. This follows #418.
