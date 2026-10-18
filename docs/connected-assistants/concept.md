# Connected assistants: concept

Updated 19 October 2026 from [spec #603](https://github.com/FireBird1998/splitbook/issues/603), which amends [spec #383](https://github.com/FireBird1998/splitbook/issues/383). See [Decisions](decisions.md) for the 4 October history.

## What members can do

Members ask about their Groups, Balances and spending. Splitbook supplies ledger figures per currency; assistants explain them without inventing missing facts or combining currencies.

With optional To review access, a Connected assistant can read, prepare, revise and permanently discard the member's private Expense Drafts, including manually prepared ones. These Drafts leave the ledger unchanged. Members review and save them in Splitbook on web or Android. A Draft collection is private to one member in one Group; To review brings the member's unfinished work together.

There is no assistant save tool. Recording, editing or deleting saved Expenses or Settlements, changing Group data or membership, an approvals queue, Group amount limits and a “Read only” Assistant rule are outside #603. The 4 October insight tools are also outside its scope; their earlier definitions are proposals, not shipped capabilities.

## Chosen member controls

The chosen reach is the member's current Groups, including Groups joined later, minus that connection's Excluded Groups and Groups whose Assistant rule is Not allowed. All Groups start ticked at approval. The member sees a warning that unticked Groups are left out of answers. An assistant never learns that those Groups exist.

Group admins set the Assistant rule to Allowed (the default) or Not allowed. Every member sees the rule; admins additionally see which members' assistants can reach the Group, with assistant names and last used. Rule changes apply at once, add an Activity event naming the admin and new value, and keep existing Drafts. See [Access and safety](access-and-safety.md).

Connecting and approving is the opt-in. There is **no per-member switch**. The deployment-wide switch remains. Connections unused for 90 days expire and appear as gone; members can reconnect.

## Screens

The owner and Designer own the [canvas](https://claude.ai/artifact/R73Hkvu43SAkDqWDoKLMN9). #603 identifies these boards; this table records requirements, not design approval or implementation completion.

| Board                           | Chosen behavior                                                                                                                                                  |
| ------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Connect an assistant            | ChatGPT, Claude and Other assistant picker; keep the ChatGPT guide, verify the Claude guide on staging, and show the server address and standard steps for Other |
| Approve access                  | Assistant name with address in small text; Groups all ticked; leave-out warning; optional To review access; explicit “It can't” list                             |
| Settings · Connected assistants | Name, Ledger or Ledger + To review, N of M Groups, last used                                                                                                     |
| One assistant                   | Change Groups immediately; Disconnect after confirmation; reconnect to change To review access                                                                   |
| Maple House · Assistant rule    | Admin changes Allowed/Not allowed; members see the rule; admins also see the reach list                                                                          |
| What assistants can use         | Short explanation of ledger reads and Draft preparation; only members save Expenses                                                                              |
| Android · Connected assistants  | Account screen with name, access and last used; confirmed Disconnect sheet; banner directing Group changes and connecting to the web                             |

Per-tool switches, a call log and “Waiting for you” are superseded canvas ideas, not requirements. To review is not an assistant approval queue.

## Production gates

#603 requires all of the following before assistants are switched on in production:

- Excluded Groups and the Assistant rule;
- the approval page;
- Settings with names, last used and confirmed Disconnect;
- 90-day idle expiry.

The Claude and Other setup, help section and Android connection-management screen may follow production. This does not defer the web and Android Draft review/save requirement of ADR 0008. Real ChatGPT and Claude staging acceptance must cover connection, exclusion, Not allowed, Draft preparation, disconnect and reconnect, plus expiry using a staging-only shortened setting. Production enablement remains a separate owner decision (#394).

## Implemented baseline

At `5c700703`, ledger tools, separate Draft permission, live grant checks, immediate disconnect and a ChatGPT guide exist. Group access is membership-only; consent still says all current and future Groups. Settings renders raw client IDs and disconnects without confirmation. The new Group controls, last-used tracking, 90-day expiry, setup picker and Android connection-management screen remain implementation work. See [Research](research.md) for source evidence. This docs change implements none of those screens or controls.
