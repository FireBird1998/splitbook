# Connected assistants: decisions

Updated 21 October 2026. [#603](https://github.com/FireBird1998/splitbook/issues/603) publishes the owner's Q16–Q24 outcome and amends [#383](https://github.com/FireBird1998/splitbook/issues/383). The numbers below refer to the **4 October decision list in unmerged PR #242**, not to interview question numbers. The comparison preserves that history without treating it as current implementation.

## Disposition of the 4 October decisions

| Earlier decision                                              | Status on 21 October                                                                                                                                                                                   |
| ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1. Read-only first; recording later                           | **Replaced in part by ADR 0008/#383:** optional read/create/revise/permanent-discard access to private Expense Drafts exists. Assistant ledger saves and changes to saved records remain out of scope. |
| 2. Splitbook computes figures, assistants explain             | **Still holds:** exact money and per-currency totals; no inferred approval to build new insight tools.                                                                                                 |
| 3. Four insight tools in the first version                    | **Deferred/out of scope in #603:** trends, across-Groups and Trip insights are not promised by this release. The old spending-summary API is not the current `group_spending` contract.                |
| 4. Excluded Groups; all ticked; future Groups included        | **Reaffirmed by #603:** replaces #383's unrestricted all-current-and-future-Groups consent. Not implemented at baseline.                                                                               |
| 5. Excluded Groups never disclosed                            | **Reaffirmed:** absent from lists and answers; no existence/count hint; the member sees the leave-out warning.                                                                                         |
| 6. Admin Assistant rule, Allowed by default                   | **Reaffirmed:** Allowed/Not allowed; Not allowed applies immediately to every member's assistants.                                                                                                     |
| 7. Admins see reach and last used; members only the rule      | **Reaffirmed:** admin-only member/assistant/last-used list.                                                                                                                                            |
| 8. No per-tool switches                                       | **Still holds:** separate optional To review permission is retained, not a set of switches for individual tools.                                                                                       |
| 9. No member call log; last used instead                      | **Still holds:** the older operational logging proposal is not a delivered audit log.                                                                                                                  |
| 10. Other members by name and id only                         | **Still holds:** no emails or account details.                                                                                                                                                         |
| 11. Immediate disconnect                                      | **Still holds and implemented:** live grant/generation checks supersede ADR 0005's token-expiry-only proposal; Settings now requires confirmation (#615).                                              |
| 12. Expiry after 90 days unused                               | **Implemented (#618):** server-side last-use checks enforce 90 days; refresh lifetime does not shorten it, and expired connections appear as gone.                                                     |
| 13. Client ID Metadata Documents only                         | **Still holds for rollout:** DCR stays off. Current code retains an off-by-default compatibility flag.                                                                                                 |
| 14. Standards-based clients; no assistant targeted first      | **Updated:** retain the existing ChatGPT guide, add guided Claude and Other setup. Both real ChatGPT and Claude require staging verification.                                                          |
| 15. Private beta per-member switch, off by default            | **Superseded:** connecting and approving is opt-in; no per-member switch. Keep the deployment-wide switch and production gates.                                                                        |
| 16. Deferred approvals queue, amount limits, “Read only” rule | **Still outside scope:** persistent Drafts/To review replace the earlier temporary-preview direction, without approving “Waiting for you” or an assistant save queue.                                  |
| 17. Drop tool switches, member call log and 30-day reminder   | **Still holds:** use last used and 90-day expiry.                                                                                                                                                      |
| 18. “Paid” rather than “fronted”                              | **Retained as wording guidance:** does not authorize a new glossary term or unrelated UI rename. Use the current glossary throughout.                                                                  |
| 19. Documentation home here                                   | **Retained:** this folder links current decisions, historical specs and the private canvas; dated records remain intact.                                                                               |

## Former derived decisions

The 4 October draft asked for three confirmations. #603 now explicitly confirms that a Not allowed Group is indistinguishable from a nonexistent or Excluded Group. The across-Groups Category breakdown and proposed `compare_months` behavior remain outside this implementation scope. The [glossary](../../GLOSSARY.md) independently says a Month is excluded from its own comparison average; Tags remain Group-scoped. None of these points authorizes the deferred insight tools.

## Additional 19 October requirements

- Names on approval and Settings; address in small text at approval. Settings shows Ledger or Ledger + To review, N of M Groups and last used.
- Per-assistant Group edits apply at once without renewed consent; changing To review permission requires reconnecting. Disconnect requires confirmation.
- Assistant rule changes add Activity naming the admin/new value and preserve existing Drafts. The filter covers reads and Draft tools alike.
- Connect offers ChatGPT, Claude and Other assistant plus a short capabilities explanation.
- Android Account lists assistants and supports confirmed Disconnect; Group edits and connecting stay on the web, with a banner explaining that boundary.
- Production waits for Excluded Groups, the Assistant rule, approval, Settings controls and idle expiry. Claude/Other setup, help and Android connection management may follow production; owner approval and staging acceptance still apply.

See [Concept](concept.md) and [Access and safety](access-and-safety.md) for the complete chosen behavior, and [Research](research.md) for the implementation gap. This documentation ticket does not release any waiting-design implementation ticket.
