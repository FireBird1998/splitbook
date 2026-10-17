## Problem Statement

To review (#403) is built and on staging. A full staging pass on 15 October 2026 showed that everything a member does in To review works, but the feature's main promise doesn't: **a Connected assistant can't add anything to To review.**

When Claude or ChatGPT connects, Splitbook invites it to ask for read access only. The assistant asks for exactly that. So the permission screen never offers the second permission, and the tools for preparing items are never available. Both real connections on staging hold read access only. Every check that depends on an assistant preparing an item is blocked: "Added 3 to To review", "prepared by Claude", "Claude didn't know who paid" and "N from Claude today".

The same pass found smaller problems that make To review look unfinished:
- **The permission screen** still talks about "private Draft access", "Prepared Drafts" and "Your Drafts".
- **The web review side panel** is a raw editor, with labels like "Currency (e.g. INR)" and "Date (YYYY-MM-DD)" and values like "equal". It shows messages with field paths in them, such as "Who paid?.0.amount: Enter the amount…".
- **"Save N ready"** is silently disabled while an item is open in the panel, and it reads "Save 0 ready" when nothing is ready.
- **"1 needs details"** appears twice.
- **The Home card** briefly shows its loading state to members with nothing waiting.
- **One server error:** the first visit to a Group's To review page after items were added once failed with a server error (React error #441). A reload worked.

## Solution

**Assistants can be given permission to prepare items.**
- When To review is switched on, Splitbook invites a connecting assistant to ask for both permissions, reading the ledger and preparing items, while still accepting a connection that has read access only.
- The permission screen then shows the second permission as an unticked choice, in To review words.
- If the member ticks it, the assistant gets the tools to prepare items, and every assistant flow in #403 works end to end.
- Existing read-only connections get the new permission by disconnecting and reconnecting.

**The web review side panel looks and behaves like the Add expense form,** with the same fields and pickers, and changes are still kept as you go. Problems are shown in member words.

**Small fixes:**
- "Save N ready" works while an item is open, keeping the pending edit first.
- It's hidden when nothing is ready.
- "N needs details" shows once.
- The Home card shows nothing until there's something waiting.

The one-off server error is diagnosed. It only becomes a fix if it reproduces.

## User Stories

1. As a member connecting Claude, I want Splitbook to offer the permission to prepare expenses, so that Claude can add items to my To review.
2. As a member connecting ChatGPT, I want the same choice, so that both assistants work the same way.
3. As a member, I want that permission unticked until I choose it, so that an assistant only prepares items when I've agreed.
4. As a member, I want the permission described in To review words, so that I understand what I'm allowing without knowing the word "Draft".
5. As a member, I want to read on the permission screen that only I can save prepared items as expenses, so that I know an assistant can't change Balances.
6. As a member, I want to read that prepared items don't change Balances until I save them, so that I feel safe allowing it.
7. As a member who allows only reading, I want my connection to keep working with read access, so that preparing items stays optional.
8. As a member who already connected with read access, I want to get the new permission by disconnecting and reconnecting, so that there's a clear way to turn it on.
9. As a member who allowed preparing items, I want Claude to be able to add expenses to my To review in a chat, so that the feature works as promised.
10. As a member, I want Claude's reply to say "Added N to To review in Splitbook" with a link, so that I can open them straight away.
11. As a member, I want items Claude prepared to say "From Claude" in To review, so that I know where they came from.
12. As a member, I want Claude to leave a fact empty when it doesn't know it, and To review to say so ("Claude didn't know who paid…"), so that nothing is guessed.
13. As a member, I want expenses saved from Claude's items to show "prepared by Claude", so that the Group understands where an entry came from.
14. As a member, I want the review side panel to use the same fields and pickers as Add expense, so that fixing an item feels familiar.
15. As a member, I want dates, currency, payer, split and Tag in the panel to look like they do everywhere else, not as raw text, so that I don't have to type codes or formats.
16. As a member, I want my changes in the panel still kept as I type, so that nothing is lost.
17. As a member, I want what's missing described in plain words (for example "Who paid?" or "The amount paid by Ankit Das?"), so that I never see field paths.
18. As a member, I want "Save N ready" to work while an item is open, so that I don't have to close the panel first.
19. As a member, I want a pending edit in the open item kept before Save N ready asks me to confirm, so that I save what I see.
20. As a member, I don't want a "Save 0 ready" button when nothing is ready, so that the page only offers what I can do.
21. As a member, I want "N needs details" shown once, so that the summary reads cleanly.
22. As a member with nothing waiting, I don't want the Home To review card to flash and disappear, so that Home stays calm.
23. As a member, I want the To review page to open reliably the first time, so that I'm not shown an error.
24. As the owner, I want a test that starts from the server's own connect challenge, so that this kind of permission mismatch can't come back unnoticed.
25. As the owner, I want the staging re-test of the assistant path to pass before production, so that the launch includes the main promise.

## Implementation Decisions

- **The connect challenge.**
  - While persistent Drafts are switched on, the MCP connection's authorization challenge names both the ledger read and the Draft scopes.
  - The scopes it *requires* stay the ledger read only, so read-only connections still work.
  - The authorization library already supports separate challenge scopes and required scopes; use that rather than custom header handling.
  - With Drafts switched off, the challenge stays ledger-read only.
- **The permission screen.**
  - The Draft permission stays opt-in and unticked by default, per ADR 0008. Only the words change, to To review words:
    - **Checkbox:** "Also let it prepare expenses for your To review".
    - **Help line:** "It can add, change and delete items in your To review. Only you can save them as expenses, in Splitbook."
    - **Notice:** "Prepared items don't change Balances until you save them."
    - **Footer:** "Your To review items stay yours."
  - Members never see "Draft", per `CONTEXT.md`.
- **Existing connections.** No upgrade flow. Members disconnect and reconnect. The MCP connections runbook says so in one line.
- **The web review side panel** reuses the Add expense form's fields and pickers (amount, description, date, paid by, split, Tag, and the optional details) instead of its own raw inputs.
  - It keeps the existing behaviour: changes are kept against the current version as you go, it handles a newer version from elsewhere with the "what changed and who" note, Save expense saves exactly the version shown, and Delete asks first.
- **Problems in member words.**
  - Problems and missing facts shown in the panel come from the shared To review model's member wording.
  - Server validation messages carrying field paths are never shown raw.
  - The shared model gains whatever member wording it lacks, for example per-payer amounts, so Android can reuse it.
- **"Save N ready".**
  - It stays available while an item is open; pressing it first keeps any pending edit, then shows the normal confirmation for exactly the ready versions.
  - It's hidden when nothing is ready.
- **The summary** shows each count once.
- **The Home card** renders nothing until the read shows items waiting, matching the Group banner.
- **The first-load server error** is investigated from the staging logs and a fresh-load reproduction. If it reproduces, it gets its own fix. If not, it's watched during the re-test.
- Everything stays behind the existing persistent-Drafts flags. Production remains off.

## Testing Decisions

- **What makes a good test:** it checks what a member or a real assistant experiences across a public boundary, not internal state. The MCP connection test must not choose its own scopes; it must follow the server's challenge as a real client does.
- **The MCP connection suite** (real OAuth plus the official MCP SDK; prior art: the existing connection test suite):
  - read the challenge from an anonymous request;
  - start authorization asking only for the scopes the challenge names;
  - confirm the permission-screen details offer the Draft permission;
  - consent with and without ticking it;
  - confirm the resulting tool list includes the Draft tools only when ticked;
  - confirm that with Drafts off, the challenge and tools stay ledger-only.
  - The existing tests that inject the Draft scope stay as they are.
- **Web Playwright journeys on the demo seed** (prior art: the To review page, Finish later and OAuth consent journeys):
  - the permission-screen wording, with the checkbox unticked by default;
  - the rebuilt panel: fixing a missing payer with the payer picker, and a date with the date picker;
  - member-word problems, with no field paths;
  - Save N ready while an item is open;
  - the button hidden at zero;
  - each count shown once;
  - no Home card flash with nothing waiting;
  - axe in light and dark at 130% text.
- **Shared unit tests** for any new member wording in the To review model, in the four CI time zones.

## Out of Scope

- An in-app "upgrade permissions" flow for existing connections.
- Android changes. Android has no permission screen, and its review card already uses the form's pickers. Android QA on the emulator happens after this, as a separate step.
- Production rollout and turning the flags on.
- Changing which tools an assistant gets, or the per-member limit.

## Further Notes

- **How it was found:** the staging QA on 2026-10-15, on the "TR QA Oct15" test Group. All member flows passed.
- **Why it was missed:** the existing connection tests asked for the Draft scope themselves, so nothing went through a real assistant's connect flow.
- **The staging re-test after the fix:**
  1. Redeploy staging.
  2. The owner reconnects Claude and ticks the new choice.
  3. Rerun the Claude checks: "Added N to To review" with the link, "From Claude", "Claude didn't know who paid", "prepared by Claude" on saved Expenses and in Activity, and "N from Claude today".
  4. Then do the Android QA on the emulator.
- **Parent:** #403.
