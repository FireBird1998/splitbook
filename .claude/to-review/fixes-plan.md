# To review: fixes after the staging QA (agreed 2026-10-15)

Source: `staging-qa-web.md`. A light grilling; the owner accepted every recommendation.

1. **Blocker: assistants can't get `drafts:write`.**
   - When `PERSISTENT_DRAFTS_ENABLED=true`, the MCP challenge names `ledger:read drafts:write` through `challengeScopes`. Access still requires only `ledger:read`.
   - Add a test that walks the real connect flow: the challenge, then the permission screen offering the second permission, then the token, then the tools appearing.
   - **Owner:** orchestrator. One PR, together with item 2.
2. **The permission screen speaks To review.**
   - The checkbox stays **unticked by default** (explicit opt-in, ADR 0008).
   - **Checkbox:** "Also let it prepare expenses for your To review".
   - **Help line:** "It can add, change and delete items in your To review. Only you can save them as expenses, in Splitbook."
   - **Notice:** "Prepared items don't change Balances until you save them."
   - **Footer:** "Your To review items stay yours."
   - Never show "Draft" to members.
   - **Owner:** orchestrator, in the same PR as item 1.
3. **Existing read-only connections:** members disconnect and reconnect to add the permission. No upgrade flow. Add one line to the MCP runbook.
4. **Rebuild the web review panel** with the Add expense form's fields and pickers, keeping edits as you go.
   - Must be fixed before production; it doesn't block the staging re-test.
   - **Owner:** an agent ticket.
5. **Web polish ticket:**
   - Save N ready stays enabled while a panel is open; pressing it keeps the pending edit first, then shows the confirmation.
   - Hide Save N ready when 0 items are ready.
   - Show "1 needs details" only once.
6. **In the same polish ticket:**
   - Problems use the shared model's member words, never server field paths (no more "Who paid?.0.amount: …").
   - The Home card renders nothing until the read shows items waiting.
7. **The first-load 500 / React #441:** diagnose from staging logs and try to reproduce. It becomes a ticket only if it reproduces. **Owner:** orchestrator.
8. **After item 1 is on staging:**
   - redeploy staging;
   - the owner reconnects Claude and ticks the new checkbox;
   - rerun the Claude checks;
   - then do the Android QA on the emulator before production.
