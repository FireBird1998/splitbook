## Problem Statement

To review now works end to end. A Connected assistant prepares items, the member fixes what's missing and saves them. But clearing the list is slow:
- **Every item needing anything has to be opened.** On the web that's the side panel; on Android, the editor or the guided review.
- **Most items lack only one fact.** Assistant batches usually miss **who paid**, a Finish later item may miss its **Tag**, and each still takes several taps.
- **A Ready item still takes two steps to save:** either open it and press Save expense, or use Save N ready with its confirmation. There's no quick way to save one item from the list.
- **Deleting means opening the item first.**
- **Desktop members have no keyboard path** through the list.

The staging re-tests on 16 October 2026 showed the pattern: Claude adds a batch, and the member then opens each item to pick the same payer or an obvious Tag.

## Solution

To review gets a fast path on the list itself, the same on the web (desktop and phone width) and on Android:
- **One-tap quick fixes.** An item missing **who paid** or its **Tag** shows those choices as chips on its row. Tapping one fills in that fact and keeps it at once. If nothing else is missing, the item moves to Ready. It never saves an Expense.
- **A one-tap Save on Ready rows,** below a summary line of what will be recorded ("You paid · Split equally · Food"). It saves exactly the version shown, as the panel's Save expense does.
- **Delete under each row's ⋯ menu,** with today's confirmation.
- **"Who paid? You for all N"** when several items miss the payer, with Undo.
- **Suggestions, never guesses.** "You" leads the payer chips, and the Tag matching the item's Category leads the Tag chips. Nothing is picked for the member.
- **A small keyboard set on desktop** to move, open, choose and save without the mouse.

Items that need typing (an amount, a description, a split by amounts) keep a **Fix the rest** button that opens the full editor. Review one at a time, the side panel and Save N ready stay as they are.

## User Stories

1. As a member, I want an item missing who paid to show the Group's members as chips on its row, so that I can fix it with one tap.
2. As a member, I want an item missing its Tag to show the Group's Tags as chips on its row, so that I can fix it with one tap.
3. As a member, I want "You" to come first among the payer chips, so that the usual answer is the easiest.
4. As a member, I want the Tag that matches the item's Category (a meal → Food) to come first and be highlighted, so that the likely Tag is quick to pick.
5. As a member, I want nothing chosen for me, so that every fact on my Expenses is one I picked.
6. As a member, I want a chip tap to be kept straight away, so that I don't lose it if I leave.
7. As a member, I want an item with nothing else missing to move to Ready after a chip tap, so that I can see it's done.
8. As a member, I want a chip tap never to save the Expense, so that Balances only change when I decide.
9. As a member, I want an item that also misses something I must type to show the chips and a "Fix the rest" button, so that I can still make progress from the list.
10. As a member, I want the row to say what's still needed ("Still needs: the amount"), so that I know what Fix the rest will ask.
11. As a member, I want at most four chips on a row, with "More…" for the rest, so that rows stay readable when a Group has many members or Tags.
12. As a member, I want More… to open the full picker for that fact, so that I can still choose anyone or any Tag.
13. As a member, I want each Ready row to show a summary line, such as "You paid · Split equally · Food", so that I know what Save will record.
14. As a member, I want the Category in that line only when it isn't Other, so that the line stays short.
15. As a member, I want a Save button on each Ready row, so that I can save one item without opening it.
16. As a member, I want that Save to record exactly the version shown, so that I never save something I haven't seen.
17. As a member, I want a Save that finds the item changed elsewhere to refuse and show the change note, so that a newer version is never saved unseen.
18. As a member, I want "Lunch saved · View" after a row Save, so that I can open the new Expense.
19. As a member, I want possible duplicates still to need opening, so that I always see the matching Expense before saving.
20. As a member, I want Delete in each row's ⋯ menu, with the usual confirmation, so that I can remove an item without opening it.
21. As a member, I want "Who paid? You for all 3" when several items miss the payer, so that a whole assistant batch is fixed in one tap.
22. As a member, I want that bulk action to apply at once and then offer Undo, so that it's fast and easy to take back.
23. As a member, I want the bulk action to skip an item that changed elsewhere and tell me, so that it never overwrites a newer version.
24. As a member, I want Undo to put back only the items it changed and that haven't changed since, so that Undo is safe too.
25. As a member, I want no bulk action for Tags, so that different items don't all get the same Tag by mistake.
26. As a desktop member, I want ↑/↓ or J/K to move between rows, so that I can go through the list without a mouse.
27. As a desktop member, I want Enter to open the selected item, so that the full editor is a key away.
28. As a desktop member, I want 1–9 to pick the selected row's chips, so that a quick fix is one key.
29. As a desktop member, I want S to save the selected Ready row, so that saving is one key.
30. As a desktop member, I want Esc to close the panel and return to the row, so that I keep my place.
31. As a desktop member, I want shortcuts off while I'm typing in a field, so that typing never triggers them.
32. As a desktop member, I want a small "Keyboard shortcuts" hint, so that I can find them.
33. As a member, I want Save N ready to keep its confirmation, with Enter to confirm, so that a multi-item save that changes Balances is still deliberate.
34. As a member on a phone browser, I want the same chips, row Save, ⋯ Delete and bulk payer action, so that phone and desktop work alike.
35. As a member on Android, I want the same row behaviour in the app, so that both apps clear To review the same way.
36. As a screen reader user, I want each chip set labelled ("Who paid for Lunch"), so that I know what each choice is for.
37. As a screen reader user, I want to hear "Lunch moved to Ready" after a fix, so that I know it worked.
38. As a member, I want the list to pass accessibility checks in light and dark at 130% text, so that the fast path works for everyone.
39. As a member, I want Review one at a time and the side panel to stay as they are, so that the thorough path is unchanged.
40. As a member, I want "On this phone" items, the Home card and the Group banner unchanged, so that only the list gets faster.
41. As the owner, I want the rules for which quick fixes, their order and the suggestion in one shared place, so that web and Android can't drift apart.

## Implementation Decisions

- **The shared To review model gains a quick-fix projection.** It is a pure function in the shared package, used by web and Android. Given an account item, the Group's members and Tags, and the viewer, it returns:
  - the item's **quick fixes**: for each of who paid and Tag that is missing, the options in order, with the suggested option marked and at most four visible before "More…";
  - **what's still needed** beyond those, in the shared member wording ("the amount");
  - the **Ready summary line**, for example "You paid · Split equally · Food", built with the app's formatters, with the Category only when it isn't Other;
  - the values to keep when an option is chosen: a lone payer with no amount for who paid (the #425 completion rule then makes them pay the whole amount), or the Tag's identity for Tag.
- **Suggestions.** The viewer leads the payer options. The Tag whose name matches the item's Category label leads the Tag options. Nothing is ever pre-selected.
- **Bulk payer.** The model also returns, per Group, the items missing who paid and the "You for all N" option. Applying it is one revision-checked replace per item.
  - An item whose revision has moved is skipped, keeps the usual "changed" note and isn't overwritten.
  - Undo replaces back only the items it changed that are still at the revision it wrote.
- **No server or API changes.** Quick fixes, bulk payer and Undo use the existing revision-checked replace. Row Save uses the existing review then save, exactly as the panel's Save expense does, including the fingerprint and the duplicate rule. Row Delete uses the existing revision-checked discard.
- **The web list.**
  - A row becomes a container with a primary "open this item" control plus its own controls: chips, Save, Fix the rest, ⋯. Interactive controls are never nested inside the open control.
  - The side panel, Review one at a time and Save N ready are unchanged, apart from Enter confirming Save N ready.
- **Desktop keyboard.**
  - The list keeps one selected row: ↑/↓ or J/K move it, Enter opens it, 1–9 choose its chips, S saves it when Ready, Esc closes the panel back to the row.
  - Shortcuts are off while a text field, picker or dialog has focus, and don't clash with the app's ⌘K search.
  - A "Keyboard shortcuts" hint lists them.
- **Android** gets the same row chips, row Save, ⋯ Delete and bulk payer action on its To review list. It uses the shared projection and the controller's existing replace, review, save and discard, so there's no new data path.
  - It is built only after #433, #435 and #436 merge, because they rework the same Android To review screen.
- **Unchanged:** on-this-phone items, the Home card, the Group banner, the guided review and the side panel.
- **Words.** Members never see "Draft". The copy uses the shared member wording ("Who paid?", "The tag?", "Still needs: …", "Lunch saved", "Lunch moved to Ready").
- **Flags.** Everything stays behind the existing persistent-Drafts flags.

## Testing Decisions

- **What makes a good test:** it checks what a member sees and does at a public boundary (the shared model's output, the list in a real browser, the Android list), not internal state.
- **Main seam: the shared To review model.** Prior art: the shared To review tests. Unit tests run in the four CI time zones:
  - which quick fixes an item gets;
  - option order and the suggestion (You first; Tag matched by Category);
  - the four-plus-More rule;
  - what's still needed;
  - the Ready summary line, including Category only when it isn't Other;
  - the values kept per choice (a lone payer with no amount, the Tag identity);
  - the bulk payer grouping.
- **Web: Playwright journeys on the demo seed.** Prior art: the To review page journeys, seeded with the To review fixtures.
  - A chip fix moves an item to Ready, and a row Save records it.
  - The bulk payer action and its Undo, including an item changed elsewhere being skipped.
  - Row Delete with confirmation.
  - The keyboard set.
  - Phone width.
  - Axe in light and dark at 130% text.
- **Android: component tests for the list,** when it's built. Prior art: the To review list and review run tests.

## Out of Scope

- Any change to Review one at a time, the side panel, the Home card, the Group banner or on-this-phone items.
- Bulk Tag actions, and any automatic choice of payer or Tag.
- Quick fixes for facts that need typing (amount, description, date, a split by amounts or percentages).
- Server, API or schema changes.
- Undo of a saved Expense.
- Building the Android part before #433, #435 and #436 merge.

## Further Notes

- **Grilled 2026-10-16:** the owner accepted every recommendation. The decisions are recorded locally in `.claude/to-review/quick-fix-decisions.md`.
- **Relies on #425:** a lone payer with no amount pays the whole Expense, and a missing Category saves as Other. #432's Tag guidance means fewer assistant items reach the Tag chips at all.
- **Parent:** #403.
