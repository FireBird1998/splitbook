# To review: clear items faster (grilled 2026-10-16, owner accepted every recommendation)

**Goal:** fewer taps to clear To review, on web (desktop and phone width) and Android. Android is designed now and built after Porter's #433–#436 merge.

1. **Quick fixes on the row.** Items in Needs details get one-tap chips for **who paid** (the Group's members) and **Tag** (the Group's Tags). Facts that need typing open the full editor.
2. **A chip fills in the fact only.** It keeps the fact on the item at once, like the panel's edits. If nothing else is missing, the item moves to Ready. It never saves an Expense.
3. **Row actions.**
   - Ready rows get a one-tap **Save**: exactly the version shown, no dialog, as the panel's Save expense.
   - Every row's **⋯** menu has **Delete**, with today's confirmation.
   - Rows marked Check before saving (possible duplicates) still need opening.
4. **Bulk payer action.** When two or more items miss who paid, the section offers "Who paid? **You** for all N". There is no bulk action for Tags.
5. **Suggest, never guess.** **You** leads the payer chips. The Tag matching the item's Category leads the Tag chips (food → Food). Chips are ordered and highlighted, never pre-selected.
6. **Desktop keyboard** (inactive while typing in a field):
   - ↑/↓ or J/K move between rows;
   - Enter opens the item;
   - 1–9 pick the selected row's chips;
   - S saves a Ready row;
   - Esc closes;
   - a "Keyboard shortcuts" hint.
   - Save N ready keeps its confirmation, with Enter to confirm.
7. **Same everywhere.** Web at phone width and Android get the same chips, row Save, ⋯ Delete and bulk payer action (no keyboard on phones). The rules (which quick fixes, their order, the suggestion) live in the shared To review model.
8. **A Ready row's summary line**, e.g. "You paid · Split equally · Food". The Category appears only when it isn't Other.
9. **The bulk payer action** applies at once, then shows "You set as payer on N items · Undo".
10. **After a row Save:** "Lunch saved · View". No Undo.
11. **Items missing other facts** show chips **plus** **Fix the rest**, and say "Still needs: the amount".
12. **At most 4 chips**, with the suggested one first, then **More…** opens the full picker.
13. **Accessibility:**
    - chip sets are labelled choices ("Who paid for Lunch");
    - number keys work;
    - "Lunch moved to Ready" is announced;
    - axe passes in light and dark at 130% text.
14. **One at a time and the side panel are unchanged** this round. Chips appear only on list rows.
15. **Tests:**
    - the shared model (which quick fixes, their order and the suggestion), unit tests in the 4 CI time zones;
    - web Playwright on the demo seed: chip fix → Ready → row Save, bulk payer + Undo, row Delete, keyboard, phone width;
    - Android component tests when built.

**Defaults assumed, not asked:**
- The bulk payer action applies item by item. An item that changed elsewhere is skipped, shows the usual "changed" note and isn't overwritten. Undo skips items that changed since.
- On this phone items (Android device recovery), the Home card and the Group banner are unchanged.
- The keyboard shortcuts don't clash with the app's ⌘K search, and are off while a field has focus.
