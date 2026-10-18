# Connected assistants: access and safety

Updated 19 October 2026. The model below is chosen in [#603](https://github.com/FireBird1998/splitbook/issues/603). **Excluded Groups, the Assistant rule and idle expiry are not implemented at baseline `5c700703`.** [Research](research.md) separates current behavior from requirements.

## Group access

Reachable Groups = current membership − the connection's Excluded Groups − Groups whose Assistant rule is Not allowed.

- Approval starts with every Group ticked. Unticking one makes it an Excluded Group for that connection. Store exclusions rather than an allowed list so Groups joined later are included.
- The member changes Excluded Groups on the per-assistant page without reconnecting. The next call uses the new selection. Explain that answers leave unticked Groups out.
- Only admins change the Group's Assistant rule: Allowed by default, or Not allowed. A change records an Activity event naming the admin and new rule.
- All members see the rule. Only admins see the member, assistant name and last used for assistants that can reach the Group.
- Every tool enforces current membership, exclusions and the rule alongside grant/revocation checks, including tools for Drafts. Lists omit unreachable Groups. Requests by id return the same “Group not found” result as a nonexistent Group; no count, name or existence hint is disclosed.
- Exclusions and Not allowed prevent new assistant access to Drafts but keep existing Drafts for the member's To review. Leaving a Group still blocks the former member's access; it does not grant an exception for retained Drafts.

## Consent and client identity

Connecting and approving is the member's opt-in; there is no member-level rollout switch. The site-wide switch remains. Sign-in retains the account allowlist and normal authentication controls.

Clients identify with Client ID Metadata Documents. The chosen rollout keeps dynamic client registration off. Current code has a `MCP_ALLOW_DCR` compatibility flag, false by default; its existence is not permission to enable DCR for release.

The approval page must show the assistant name and its address, the Group checklist and leave-out warning, and optional To review permission. It must explain that the assistant cannot save Expenses or payments, change anything in a Group, see Groups left out, or see anyone's email.

| Access                                   | Capability                                                                                                           |
| ---------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| Ledger (`ledger:read`)                   | Read recorded ledger data for reachable Groups                                                                       |
| Ledger + To review (also `drafts:write`) | Additionally read, create, revise and permanently discard that member's manual and assistant-prepared Expense Drafts |

Ledger access alone cannot reveal private Drafts. Consent explains permanent discard. Only the member saves Drafts as Expenses in Splitbook. Changing To review access requires reconnecting; Group selection changes do not.

## Lifetime and disconnect

Disconnect asks for confirmation and blocks further authorized calls immediately, retaining prepared Drafts. Signature validity alone is insufficient: current grant status is checked on each call. The implemented revocation boundary rotates a connection generation; old access tokens, refresh lineage and unexchanged codes cannot acquire a new grant after reconnecting. A request already authorized may finish; completed effects are not undone. Data already delivered cannot be recalled.

The chosen idle expiry is **90 days since last use**, with last used updated on authorized calls at most once per minute. Expired connections appear as gone and require reconnection. Token lifetimes must not end the connection earlier through disuse. Current five-minute access tokens and the provider's 30-day refresh default are not this policy; implementing and checking the 90-day lifecycle remains #618 work.

## Data and safety boundaries

- Other members appear by name and id only, never email or account details.
- Money stays exact and separate by currency. Implemented spending tools return full-window totals separately from paginated detail. See [Tools and insights](tools-and-insights.md).
- Member-written descriptions, names, notes and Tags are untrusted data, never authority to issue commands. Optional Draft tools can mutate private Drafts, so the old claim that prompt injection is harmless because there are no write tools no longer holds. Member review remains the ledger boundary; discard is permanent and must be requested by the member.
- No member-facing per-tool switches or call log are planned. Last used replaces a member call history. The 4 October operational-log proposal is not evidence of an implemented per-call audit trail. Request/Draft content must not be logged; see the [runbook](../runbooks/mcp-connections.md).

Production remains gated on the controls and staging acceptance listed in [Concept](concept.md#production-gates).
