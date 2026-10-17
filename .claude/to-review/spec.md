## Problem Statement

Splitbook now lets a Connected assistant (Claude, ChatGPT) prepare expenses for a member, and members can keep an unfinished expense instead of saving it. Today these unfinished expenses are confusing:

- On the phone there are three separate ideas for the same thing:
  - Home's "Continue" rows (forms left half-done, kept only on that phone);
  - a Group's "Resume draft" button;
  - a hidden "Your private Drafts" screen for what the assistant prepared.

  Each has its own name, place and rules.
- When Claude prepares four expenses, nothing on Home or in the Group says so; they sit behind a button inside each Group.
- The screens use engineering words ("Load latest and replace unsent entries", "Retry original request", "Exact allocation", "No active Drafts").
- Saving takes two steps with checkboxes ("Review selected Drafts", then "Save reviewed Drafts"), which is heavy on a phone.
- A Draft missing who paid or the split doesn't clearly say what's left to do.
- The limit is 100 active Drafts per Group across all members. A member can be told "full" while seeing only three of their own items, because they can't see anyone else's.

## Solution

One place, called **To review**, holds every expense waiting for the member across all their Groups: what an assistant prepared, what they chose to **Finish later**, and anything left unfinished on that phone.

- **On the phone:**
  - Home shows a To review card with what's waiting in each Group.
  - Each Group shows a banner when it has items.
  - Review happens one item at a time: fix what's missing, then Save, Delete or Skip for now.
  - "Save N ready" saves every item that needs nothing, after a short confirmation that lists each item and the total.
- **On the web:** the same rules, as a list where each item opens in the side panel.
- **Wording.** Every item says where it came from. Nothing changes Balances until the member saves it. "Draft" stays the term in code and docs; members see To review, Finish later, Delete and Check again.

The design is on the canvas page "Phone: To review": https://claude.ai/artifact/R73Hkvu43SAkDqWDoKLMN9

## User Stories

1. As a member, I want one place for every expense waiting for me, so that I never have to look in several places.
2. As a member, I want that place called To review, so that its name says what I need to do.
3. As a member, I want Home to show how many items are waiting in each Group, so that I notice when Claude has prepared something.
4. As a member, I want the Home card to disappear when nothing is waiting, so that Home stays calm.
5. As a member, I want a banner inside a Group when that Group has items waiting, so that I see them where I work.
6. As a member, I want every item to say where it came from (Claude, ChatGPT, me, or this phone only), so that I know how far to trust it.
7. As a member, I want to be told that only I can see these items until I save them, so that I'm not worried others see unfinished work.
8. As a member, I want to be told that items in To review don't change Balances, so that I understand nothing has happened yet.
9. As a member, I want items grouped as Ready, Check before saving, Needs details and On this phone, so that I can see what each one needs.
10. As a member, I want an item missing information to say exactly what's missing ("Who paid?"), so that I can finish it quickly.
11. As a member, I want an assistant never to fill in facts it doesn't know, and the item to say "Claude didn't know who paid, so it left that to you", so that I can trust what it did fill in.
12. As a member, I want to review items one at a time with clear progress ("3 of 5"), so that reviewing on a phone is easy.
13. As a member, I want a review run from Home to go through every Group, with the Group name prominent on each item, so that I never save into the wrong Group.
14. As a member, I want the run to go Ready first, then possible duplicates, then needs details, then on this phone, so that the quick ones are done first.
15. As a member, I want Skip for now to leave an item where it is, so that I can come back to it.
16. As a member, I want a summary at the end of a run ("Saved 2 · Deleted 1 · 2 left for later"), so that I know where everything ended up.
17. As a member, I want "Save N ready" to save every item that needs nothing, so that I don't open each one.
18. As a member, I want "Save N ready" to first show exactly what will be saved, with the total and a warning that Balances will change, so that I know what I'm agreeing to.
19. As a member, I want each saved item to report its own result, so that one failure doesn't hide the others.
20. As a member, I want an item whose save reply never arrived to say it may already be saved and offer Check again, so that I can't record it twice.
21. As a member, I want a possible duplicate to show the existing expense it resembles, so that I can decide whether it's different.
22. As a member, I want to tick "It's a different expense, save it anyway" before saving a possible duplicate, so that real repeats are still possible.
23. As a member, I want possible duplicates left out of "Save N ready", so that they never get saved without my look.
24. As a member, I want changes I make to an item kept straight away, so that nothing I typed is lost if I skip or leave.
25. As a member, I want Save to save exactly what I'm looking at, so that nothing I haven't seen gets recorded.
26. As a member, I want to be told when Claude (or I, on another device) changed an item while I was looking, and what changed, so that I'm not surprised.
27. As a member, I want Delete to ask first and say it can't be undone, so that I don't lose an item by accident.
28. As a member, I want Delete to say nothing in the Group changes, so that I know deleting an unsaved item is harmless.
29. As a member, I want Finish later in the Add expense form, so that I can keep an expense I can't complete now.
30. As a member, I want closing a half-filled form to ask Finish later, Delete or Keep editing, so that I never lose work silently.
31. As a member, I want closing an empty form not to ask anything, so that the prompt only appears when it matters.
32. As a member, I want Finish later when offline to keep the item on this phone and say so, so that I can still put it aside.
33. As a member, I want an item kept on this phone to move into my account only when I choose, so that nothing uploads behind my back.
34. As a member, I want what I left unfinished before a crash to appear as "On this phone", so that it isn't lost.
35. As a member, I want items in my account to be read-only while offline, with a clear message, so that I know why I can't change them.
36. As a member, I want the limit to be 100 waiting items per Group for me alone, so that any "full" message is about my own items and I can fix it.
37. As a member, I want the limit message to tell me how to fix it, so that I'm not stuck.
38. As a member leaving a Group, I want to be told how many of my items there will be kept but hidden, so that I'm not surprised later.
39. As a member who rejoins a Group, I want my kept items back but reviewed again before saving, so that old context can't record an expense.
40. As a Group member, I want an expense that an assistant prepared to say "prepared by Claude" once saved, in the list and in Activity, so that I understand where an entry came from.
41. As a member chatting with Claude, I want it to say "Added 3 to To review in Splitbook" with a link, so that I know exactly where to go.
42. As a member, I want that link to open To review in the app if it's installed, otherwise on the web, so that I land in the right place.
43. As a web member, I want the same Home card and Group banner, so that the web and the phone match.
44. As a web member, I want To review as a list where each item opens in the side panel, so that it works like the rest of the web app.
45. As a web member, I want the same "Save N ready" confirmation and per-item results, so that the rules are the same everywhere.
46. As a member, I want every screen to work in light and dark, at large text sizes and with a screen reader, so that everyone can use it.
47. As a member upgrading the Android app, I want my old "Continue" and "Resume draft" items to appear in To review as "On this phone", so that nothing disappears.

## Implementation Decisions

- **Terms.** Draft stays the domain term in code, ADRs and docs. To review and Finish later are product words, added to `CONTEXT.md`. Member-facing copy never says Draft, revision or request.
- **One shared, pure To review model** in `@splitbook/shared` (no framework imports, ADR 0002). It turns Drafts and device-kept items into what both clients show:
  - each item's state: ready, possible duplicate, needs details (with the named missing facts), or on this phone;
  - the run order;
  - per-Group and total counts;
  - the "Save N ready" selection and total;
  - the end-of-run summary.

  It reuses the existing incomplete and complete Expense validation, and the existing duplicate result.
- **Where an item came from.**
  - A Draft records who prepared it: the member, or a Connected assistant with its display name ("Claude", "ChatGPT").
  - That comes from the authenticated connection, never from tool or request arguments.
  - Existing Drafts without it read as the member's own.
- **Per-member limit.**
  - The active limit becomes 100 Drafts per member per Group. It's counted per owner, still serialized under the Group transaction fence, with at most 10 per creation request.
  - At the limit, creation fails with a member-specific message ("You have 100 items waiting in this Group. Save or delete some before keeping more.") and removes nothing.
  - This follows ADR 0008's wording and supersedes the Group-wide clarification in the 11 October drafts review spec.
- **A cross-Group To review read.**
  - A new members-only read returns the member's active Drafts across all their current Groups, grouped by Group, with counts, for the Home card, the banners and the cross-Group run.
  - It follows the shared path, query key and decoder pattern of the other reads.
  - Groups the member has left are left out. The existing per-Group list stays.
- **Edits are kept as you go.**
  - Each change replaces the Draft at its current revision.
  - On a revision conflict the client gets the latest version, shows it, and tells the member what changed and who changed it (Claude, ChatGPT, or "you on another device").
- **Saving.**
  - "Save N ready" sends exactly the revisions listed in the confirmation, so the confirmation is the review.
  - One-at-a-time Save sends the revision on screen.
  - The existing per-item outcomes (saved, failed, unconfirmed) and replay identity are kept. Check again retries with the original identity and can never save twice.
- **"Prepared by" on Expenses.**
  - An Expense saved from an assistant-prepared Draft records that, together with the assistant's display name. The member stays the creator.
  - The Group's Expense list, the Expense details and Activity show "prepared by Claude".
  - The field is additive to every existing read, because Android and the verifiers read them.
- **MCP tools.**
  - Descriptions and results use "To review" for anything the assistant tells the member.
  - Creation results carry a To review link (a web URL that Android app links can open) and the per-member limit wording.
  - Draft scope and grant rules are unchanged, and there is still no save-from-chat tool.
- **Web.**
  - A To review card on Home, and a banner in each Group.
  - A To review page replaces the Group's Drafts tab, and the old address redirects to it. It is a list in the same groups, and an item opens in the side panel (the Expense side panel pattern) to fix, save or delete it.
  - "Review one at a time" steps through items with Next.
  - The Add expense form's "Keep as Draft" becomes Finish later, and closing a changed form asks Finish later, Delete or Keep editing.
  - Expenses show "prepared by Claude".
- **Android.**
  - To review replaces the "Your private Drafts" modal, Home's "Continue" rows and the Group's "Resume draft". It brings:
    - the Home card and Group banner;
    - the list with the "Save N ready" confirmation and results;
    - the one-at-a-time run (across Groups from Home), with the end summary.
  - The form's Finish later and close sheet.
  - Offline, items in the account are read-only.
  - Device-local recovery stays for crashes and offline. Those items appear as "On this phone", and Finish later moves one into the account by an explicit upload. Any uncertain earlier save is resolved first (ADR 0008).
  - Existing local "Continue" and "Resume draft" entries carry over as "On this phone".
- **Leaving a Group.** The Leave confirmation states how many of the member's items in that Group will be kept but hidden.
- **Rollout.**
  - Everything stays behind the existing persistent-drafts flags. Web and Android ship together, as ADR 0008 requires.
  - Production has the flag off (checked 14 October 2026), so there are no server Drafts to migrate.
  - No push notifications.

## Testing Decisions

- **What a good test is here.** Test only behaviour someone outside could see: what the member sees, what the HTTP and MCP boundary returns and refuses, and the resulting ledger state. Not internal queries or component structure. Every money assertion is exact, in minor units.
- **Seam 1: the server boundary.** Route integration tests and MCP client calls against an isolated, transaction-capable MongoDB. They cover:
  - the per-member limit, including a concurrent race at 95 plus 5, and other members' items not counting;
  - the cross-Group read: membership, a Group left, a Group rejoined;
  - who prepared a Draft being recorded from the connection, not from arguments;
  - "prepared by" on the saved Expense and in Activity;
  - the confirmation saving only the listed revisions;
  - a stale revision returning the latest version;
  - Check again never saving twice;
  - tool result wording and links;
  - refusal for non-members and revoked connections.

  Prior art: the expense Draft service integration tests, the MCP connection test suite, the route integration tests, and the expense-access refusal matrix.
- **Seam 2: the shared To review model.** Unit tests for classification, missing facts, run order, counts, the ready selection and total, and the run summary. They must hold in UTC and the CI time zones (Pago_Pago, Kiritimati, Tongatapu), with labels built by the app's formatter. Prior art: the shared module tests, such as insights, statement and trip summary.
- **Seam 3: web Playwright journeys.** On the demo seed:
  - Home card to the list to the side panel;
  - fixing a missing payer;
  - the "Save N ready" confirmation and results;
  - a possible-duplicate tick;
  - Delete;
  - Finish later and the close prompt;
  - "prepared by Claude" in the Expense list and Activity;
  - axe in light and dark.

  Prior art: the Expense side panel, Export and Trip summary specs.
- **Seam 4: Android.** Render tests through the mobile controller for:
  - the Home card, the banner, the list and confirmation;
  - the one-at-a-time run across Groups and its summary;
  - the close sheet;
  - read-only items while offline;
  - "On this phone" items and their explicit move into the account.

  Plus the existing mobile HTTP verifier for To review reads and writes. Prior art: the current shared Drafts, Home and form tests, and the drafts verifier script.

## Out of Scope

- Push notifications.
- Drafts for Settlements or Groups.
- Saving from chat.
- Editing account items while offline, and any automatic upload or merge on reconnect.
- iOS.
- Several collections per member per Group.
- Recoverable delete or a Deleted view.
- Receipt reading.
- Changes to Connected assistant consent or grants.

## Further Notes

- **Source of the decisions.** These come from a design review with the owner on 14 October 2026 (16 decisions, recorded on the canvas's "Settled in review" note). They sit on top of ADR 0008 (persistent assistant Expense Drafts) and the 11 October drafts review spec, which stays the reference for lifecycle, revocation, retention and deletion rules. Only the Group-wide limit is replaced.
- **Glossary already drafted.** The "To review" and "Finish later" entries are written on a local branch (`docs/to-review`) and should land with the first ticket.
- **Phone first.** The web board on the canvas is still to be drawn; the web tickets follow the same rules using existing web patterns.
