# Proposed ticket breakdown

Draft only. No GitHub issues have been created. Numbers below are local review identifiers; replace them with issue links after approval. Each slice includes its own behavior verification. No broad prefactor is required before the first two independent slices.

1. **Connect and revoke an assistant** — Blocked by: None — can start immediately. A member connects an assistant over public HTTPS, verifies the connection, and disconnects it from SplitBook Settings.

2. **Read Group Balances through a connected assistant** — Blocked by: T01. An authorized assistant discovers current Groups and answers Balance questions using canonical SplitBook results.

3. **Answer spending questions through a connected assistant** — Blocked by: T02. Members ask about expenses and spending within an authorized Group and receive bounded, understandable answers.

4. **Keep and revisit private Drafts on web** — Blocked by: None — can start immediately. A member explicitly keeps incomplete expenses as Drafts on web and finds them after reopening the Group.

5. **Keep and revisit the shared collection on Android** — Blocked by: T04. Android members retain incomplete expenses online and see the same private Drafts as on web.

6. **Revise and permanently discard Drafts on both clients** — Blocked by: T04, T05. Members correct or permanently remove individual Drafts on web and Android without overwriting a newer revision.

7. **Review and save one Draft on both clients** — Blocked by: T06. Members review a Draft in SplitBook, resolve missing fields and duplicate warnings, and save exactly one Expense.

8. **Save a selection with per-Draft outcomes** — Blocked by: T07. Members select multiple Drafts in either client and save valid items while failures remain for correction.

9. **Prepare persistent Drafts from a connected assistant** — Blocked by: T01, T04. A member asks an assistant to prepare several expenses, then follows a SplitBook link to the retained collection.

10. **Revise and discard Drafts from a connected assistant** — Blocked by: T06, T09. An authorized assistant corrects or permanently discards the member’s Drafts and both clients show the result.

11. **Verify and enable the complete connected-Draft journey** — Blocked by: T03, T08, T10. The release is enabled only after both assistant hosts and both review clients complete the approved experience.

## Review requested

Do the two proposed test boundaries in the spec match your expectations? Is this ticket granularity right, are these dependencies genuine blockers, and should any slices be merged or split?

After approval: publish the spec with ready-for-agent, publish these tickets in dependency order with ready-for-agent, reference the new parent, and add native GitHub blocking relationships. Do not modify or close the parent after creating it. Implementation remains paused pending the user’s direction.
