# To review: staging web QA, 2026-10-15

- **Build:** staging.splitbook.in, `main` 272486f, redeployed with the allowlist change.
- **Account:** www.das5471@gmail.com.
- **Test Group:** "TR QA Oct15" (`6ad0d65e0580d7c338e73389`), with one member.

## Passed
- Google sign-in on staging.splitbook.in works.
- **Allowlists:**
  - dasankit1998.20@gmail.com and ankit@thesys.dev were added to the staging allowlist.
  - ankit@thesys.dev was added to the Google test users; dasankit1998.20 was already there.
- **Address and tab:** `/drafts` redirects to `/review`, the tab is called "To review", and the privacy line shows.
- **Empty state:** "All caught up" with "Back to Expenses".
- **Add expense form:**
  - An untouched form closes silently.
  - A changed form asks "Finish this expense later?" with Finish later, Delete and Keep editing.
  - Finish later shows the "Kept in To review · View" snackbar.
  - The banner updates straight away: "1 to review · 1 needs details · Review".
- **Attribution:** items added through the app record `preparedBy: member`, and the source label reads "You set this aside".
- **Sections:** Ready, Check before saving and Needs details. Missing facts read "The amount?" and "Who paid?".
- **Side panel:**
  - Edits are kept as you type ("Changes kept in To review"), and the item moves to Ready.
  - Changed while open: "You on another device changed the amount a moment ago: ₹1,250.00 → ₹1,300.00; the payer: … You're seeing the latest version."
- **Save 3 ready:**
  - The confirmation lists each item with the exact total, ₹4,130.00, and "Balances there will change for everyone".
  - The results show "Expense saved" for each, then "All caught up".
- **Possible duplicate:**
  - It goes under "Check before saving" and is left out of Save N ready.
  - The panel shows "This might already be here · Dinner QA · ₹2,350.00 · Today · Added by Ankit Das".
  - Save stays disabled until the box is ticked.
- **Delete:** "Delete this item? It was never saved, so nothing in TR QA Oct15 changes. You can't undo this." with Keep item and Delete item.
- **One at a time:** "1 of 3" with Save, Next, Skip for now and Delete. It ends with "Done for now · Saved 1 · Deleted 1 · 1 left for later", and the skipped item stays.
- **Home card:** "To review · 1", with the Group row "1 needs details", "Only you see these", placed above Your balances and linking to `/review`.
- **Leave Group (last member):** "Your 1 item in To review will be permanently deleted with TR QA Oct15." Cancelled.
- **Connected assistants:** the names resolve as "Claude" and "ChatGPT" (#404).

## Findings
1. **Blocker:** assistants can never get `drafts:write`.
   - The MCP 401 challenge advertises only `scope="ledger:read"` (`connection.ts:99`, `requiredScopes: [MCP_LEDGER_SCOPE]`).
   - Claude and ChatGPT ask only for the permissions named there, so the consent screen never shows the Draft checkbox, and no draft tools are ever registered.
   - Both live connections hold `ledger:read` and `offline_access` only. This blocks the whole "Claude prepares it" path, and every check marked "prepared by Claude".
   - **Fix:** when drafts are enabled, advertise `ledger:read drafts:write` in the challenge while still requiring only `ledger:read`. Add a test that goes through a real client's connect flow.
2. **Copy:** the OAuth consent screen still says "Also allow private Draft access" and "Draft access allows … Drafts. Discard cannot be undone." It should use To review words.
3. **Copy:** the web panel shows "Who paid?.0.amount: Enter the amount paid by this member." A field path leaks through `reviewProblem()`.
4. **Polish:** the web review panel is a raw editor: "Currency (e.g. INR)", "Date (YYYY-MM-DD)", lowercase "other" and "equal". It doesn't follow the Expense side panel design.
5. **Usability:** "Save N ready" and "Review one at a time" are disabled while an item is open in the panel, with no reason shown.
6. **Copy:** "Save 0 ready" shows when nothing is ready. Hide it or reword it.
7. **Investigate:** the first client-side navigation to `/review` after items were added returned 500 plus React error #441 ("This page couldn't load"). A reload worked. Not seen again.
8. **Polish:** the Home "To review" card briefly shows its loading state for members with nothing waiting, then disappears. The same layout jump was fixed for the banner.
9. **Minor:** the summary shows "1 needs details" twice: in the summary line and as a separate line.

## Not covered yet
- Anything prepared by Claude: "Added N to To review" with the link, "prepared by Claude" on Expenses and Activity, "Claude didn't know who paid", and "N from Claude today". All blocked by finding 1.
- A second member: payer choice, and the non-last-member Leave copy.
- Dark mode and 130% text.
- Android on the emulator.

## Re-test after #418 (2026-10-16, staging 61f83de)

**Passed:**
- The Claude connection now holds `ledger:read drafts:write offline_access`; ChatGPT is still read-only and not reconnected.
- The permission screen offers "Also let it prepare expenses for your To review".
- Claude's `create_drafts` call added 3 items. Its reply: "All three are in your To review in TR QA Oct15 (not saved as expenses)", with an "Open To review" button. It left the Groceries payer empty instead of guessing.
- The items record `preparedBy: assistant "Claude"`.
- **Home:** "To review · 4", with the row "TR QA Oct15 · 3 from Claude · 4 needs details".
- **List:** "Today · From Claude".
- **Panel:**
  - "TR QA Oct15 · From Claude", "Claude didn't know who paid, so it left that to you." and "Claude didn't know the category, so it left that to you."
  - The new form-style layout (#420): the payer picker, split options and Tag chips.
  - No raw labels or field paths.
- **After a member edit:** `changedBy` is member and `preparedBy` stays Claude.
- **Save 1 ready:**
  - The confirmation shows "Dinner · ₹2,350.00 · Today · From Claude · Paid by Ankit Das · Split equally".
  - Then "Expense saved".
  - The Expense has `preparedBy` Claude, and so does the Activity `expense_added` entry.
  - The Expenses list shows "You · prepared by Claude".
- **#421 polish:** Save N ready is hidden at 0, and "needs details" shows once.

## New findings (assistant path)
- **A. Nothing Claude prepares can be Ready: a single payer with no amount counts as missing.**
  - Claude sent "paid by Ankit Das" without an amount, so `missingFields` includes `paidBy` and the panel shows "Who paid?" for Dinner and Taxi.
  - With exactly one payer, the payer's amount is the whole expense.
- **B. Category is required, but assistants can't see the options.**
  - Every Claude item shows "The category?".
  - `group_context` lists Tags but no categories, and the tool gives no category guidance, so Claude left it unset.
- **C (minor).** Claude's own words still said "I'll add these three as drafts". That comes from the tool name `create_drafts`. The reply after creation used "To review".

## Re-test after #425 (2026-10-16, staging c5d6614)
- **Deploy:** a clean archive of c5d6614 went to splitbook-staging (splitbook-staging-rg9xi087b), aliased to staging.splitbook.in.
  - Probes: home 200, to-review signed out 401, MCP challenge scope="ledger:read drafts:write".
- **Claude (new chat "Splitbook expenses TR QA Oct15").** Asked for "I paid ₹840 for lunch" and "I paid ₹300 for an auto-rickshaw", split equally.
  - Claude read Group context and called create_drafts with category food and transport, chosen from the listed choices, and one payer with no amount.
  - Its reply said "in your To review … ready for you to save".
  - **Finding D:** Claude omitted the Tag (required) and asked "Should I set those?" (Food/Transport). After "yes", replace_draft added the Tags and Claude said "nothing missing".
  - **Finding C remains:** before calling any tool, Claude said "I'll add both expenses as drafts". After loading the tools it used To review words.
- **Web To review:**
  - It shows "3 ready · 0 to check · 4 from Claude · 2 needs details".
  - Taxi (from the first re-test: one payer, no amount, no Category) is now Ready.
  - The Save 3 ready confirmation listed "Paid by Ankit Das" for each, with a total of ₹1,620.00. All three saved.
  - The stored Expenses: Auto-rickshaw transport, paid 300; Lunch food, 840; Taxi **other**, 480. All have preparedBy Claude.
- **First-load 500 / React #441 (#441 = "An error occurred in the Server Components render"):**
  - It did not reproduce. A fresh tab's first load after Claude added items was clean (no console errors, no 4xx/5xx), and the staging logs show no 5xx in the last hour.
  - The #441 entries were in tab-3's console buffer, which has been open since the 10-15 QA.
  - Likely cause: a tab left on the previous deployment after a redeploy (version skew). It stays watched; no ticket.
- **Android:**
  - APK c5d6614 was built and installed on emulator-5554: output/SplitBook-Staging-To-Review-c5d6614.apk, 33952493 bytes, sha256 6284fb87…2835, signer DD:96:E7.
  - The app is signed out, because the 10-14 snapshot predates the owner's sign-in. The Android checks wait for the owner's Google sign-in.
  - A test item, "Coffee (Android QA)" ₹180 (one payer, no amount, no Category), was added via the session connector; the server reports missingFields [].
- **Web checks after the deploy (2026-10-16, owner checks Android on their phone):**
  - **Home card:** "To review · 3" (Goa week end 1; TR QA Oct15 "1 from Claude · 2 needs details" 2). This matches the server read.
  - **Coffee (Android QA):** saved from the owner's phone at 15:02Z, ₹180 paid in full, Category food (chosen on the phone), preparedBy Claude.
  - **Groceries (Claude, no payer):**
    - the list asks only "Who paid?" and never "The category?";
    - the panel says "Claude didn't know who paid, so it left that to you", shows Category Other and disables Save;
    - after picking Ankit Das, the stored payer is ₹1,250 in one-payer mode, Category is still not stored, and the item moves to Ready;
    - Save expense recorded category other, paid 1250, preparedBy Claude.
  - **Expenses list:** every row reads "You paid · prepared by Claude" with its Tag.
  - **Activity:** "Ankit Das added “Groceries” · prepared by Claude" and the same for the others.
  - **Phone width, dark:**
    - The list shows "1 needs details" once and hides Save N ready.
    - The Parking QA panel fits with no overflow, no field paths or raw values.
  - **A fresh tab:** no console errors apart from two 429s on /api/auth/get-session (the Better Auth rate limit; several tabs and the phone were open). These are minor, not from #425, and stay watched.

## Tag guidance re-test (2026-10-16, staging f30efef4, PR #432)
- **Deploy:** a clean archive of f30efef4 went to splitbook-staging (splitbook-staging-bf97bthxj). Probes: home 200, to-review 401, challenge scope="ledger:read drafts:write".
- **First chat (Dinner ₹650 and Cab ₹220):** Claude still left the Tags out ("I didn't set them since you didn't specify").
  - Asked to quote its tool description, it had the #428 Category text but **no Tag line**.
  - claude.ai had cached the connector's tools list from before the deploy.
- **Fix:** claude.ai → Customize → Connectors → Yours → SplitBook Staging → ⋮ → **Refresh tools list** ("Tools list refreshed"). This doesn't change the connection or its permissions.
- **New chat after the refresh (Breakfast ₹540 and Metro ride ₹180, no Tags named):**
  - create_drafts carried tagId Food (…338b) and Transport (…338c), category food and transport, and one payer with no amount.
  - Claude replied "ready for you to save … Food & Drink / Food, Transport / Transport", with no extra reply needed.
- **Web:**
  - To review showed "2 ready · 4 from Claude · 3 needs details".
  - Save 2 ready confirmed Breakfast and Metro ride (Paid by Ankit Das, total ₹720.00) and saved both, with Tags Food and Transport, Categories food and transport, paid in full, preparedBy Claude.
  - Dinner and Cab (from the stale chat) showed "The tag?". Their panels said "Claude didn't know the tag, so it left that to you." Choosing Food and Transport with the Tag picker kept the tagId, enabled Save, and saved both.
- **Minor:** Claude's opening line still says "as drafts" before it loads the tools. The stale-tools reply also named `tagId`.
