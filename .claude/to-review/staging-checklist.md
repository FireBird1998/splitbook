# To review: staging checklist

Main at `272486f` has all of To review (#404–#410). Use fictional test Groups only: Save N ready creates real Expenses in whichever Group you use.

## 0. Decide first
- [ ] **The staging slot.** Staging currently runs PR #402 (custom Tags, `ac582c2`) for your phone acceptance. Deploying `main` replaces it. Either finish #402's phone check first, or merge #402 so that `main` carries both.
- [ ] **A test Group** on staging with at least two members (for example "TR Staging Test"), plus a second Group for the cross-Group checks.

## 1. Turn it on (web and server)
- [ ] In the staging Vercel project, set `PERSISTENT_DRAFTS_ENABLED=true` and `NEXT_PUBLIC_PERSISTENT_DRAFTS_ENABLED=true`. Check what's there first: staging may already have them from the MCP drafts rollout.
- [ ] Redeploy `main` (`272486f` or later). The public flag is only read at build time, so a redeploy is required.
- [ ] Signed in, `https://staging.splitbook.in/api/user/to-review` returns 200 with `{ total, groups }`. Signed out, it returns 401.
- [ ] Sign in with real Google on `staging.splitbook.in`. This was never confirmed after the domain change.

## 2. Connect an assistant
- [ ] Reconnect Claude or ChatGPT to the staging MCP server, with the Drafts permission. Staging connections had to re-authorise after the domain change.
- [ ] The Connected assistants page lists the connection.

## 3. Web
- [ ] Ask Claude to add 3 expenses to the test Group, one with no payer. Its reply says "Added 3 to To review in Splitbook" and gives a `/groups/<id>/review` link.
- [ ] The link opens the To review page.
- [ ] The Home card shows "To review · 3", with the Group row and "2 from Claude · 1 needs details".
- [ ] The Group banner appears on the Expenses tab, and the Group's tab says To review. The old `/groups/<id>/drafts` address redirects.
- [ ] Sections: Ready, Check before saving, Needs details. The no-payer row says "Who paid?", and its panel says "Claude didn't know who paid…".
- [ ] Fix the payer in the side panel. The change is kept without pressing anything, and the item moves to Ready.
- [ ] While the panel is open, ask Claude to change the amount. The panel updates and shows "Claude changed the amount a moment ago: … You're seeing the latest version."
- [ ] Save N ready: the confirmation lists each item with the exact total. Confirm, and the results show each item saved. Balances change.
- [ ] The saved Expenses show "prepared by Claude" in the list, the side panel and Activity.
- [ ] Possible duplicate: ask Claude to add one that matches a saved Expense. Save stays disabled until you tick "It's a different expense".
- [ ] Delete asks first, and the item disappears with Balances unchanged.
- [ ] Review one at a time: shows "1 of N", Next and Skip for now, and ends with "Done for now · Saved … · Deleted … · … left for later".
- [ ] Add expense form: type something, then close it. It asks Finish later, Delete or Keep editing.
  - [ ] Finish later shows "Kept in To review", with View.
  - [ ] An untouched form closes silently.
- [ ] Leave Group (with a second account): the confirmation says "You have N items in To review…".

## 4. Android APK
- [ ] Build a staging APK from `main` with `EXPO_PUBLIC_PERSISTENT_DRAFTS_ENABLED=true` and its origins set to `https://staging.splitbook.in`. The `/groups/<id>/review` app link only works with the new domain built in.
- [ ] Install it on your phone. Don't use emulator-5554 while other sessions might use it.

## 5. Android
- [ ] The Home card shows "To review · N" above Your balances. The Group banner shows on Expenses.
- [ ] Tapping Claude's `/groups/<id>/review` link in the chat app opens the Group's To review list in the app.
- [ ] The list shows its sections, and Save N ready shows the confirmation, the exact total and the results.
- [ ] Review one at a time runs across Groups from Home. The header shows the Group name and "3 of 5 · across 2 Groups", and the run ends with "Done for now".
- [ ] Missing payer: the tile is highlighted and Save is disabled with the reason. Possible duplicate: Save stays disabled until ticked.
- [ ] Finish later online shows "Kept in To review · View".
- [ ] Finish later offline (airplane mode) shows "You're offline, so it stays on this phone…", and the item appears as "On this phone".
- [ ] Back online, nothing uploads on its own. Opening the phone item and choosing Finish later moves it into your account.
- [ ] Closing a changed form offers Finish later, Delete or Keep editing. The back gesture does the same.
- [ ] Offline, account items are read-only, with "Connect to change or save this".
- [ ] "prepared by Claude" shows on Expense rows, details and Activity.
- [ ] Leave sheet: "You have 1 item…" (singular), or "N items".
- [ ] An older APK's "Continue" item shows up as "On this phone" after the update. Before updating, create an unfinished expense in the old build.
- [ ] Check dark mode and 130% text on the main screens.

## 6. Both together
- [ ] Fix an item on the web, and the phone shows the new version (pull to refresh, or reopen).
- [ ] Edit an item on the phone while the same item is open on the web. The web panel shows "You on another device changed …".
- [ ] Counts match on web Home, Android Home and the banners.

## 7. If something's wrong
- [ ] **Roll back:** set both Vercel flags to `false` and redeploy. Everything hides, and items stay stored, so nothing is lost. Reinstall the previous staging APK if needed.
- [ ] **Report:** note the step and a screenshot, and I'll turn it into a fix ticket.

## 8. Sign-off
- [ ] Every box above is ticked, so you're ready to decide on production. Production needs web and Android together (ADR 0008): the Vercel flags on, plus a production APK with the flag on.
- [ ] Close spec #403 after production.
