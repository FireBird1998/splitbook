# Group response and ledger creation ticket handoff

Status: approved and published on 2026-09-28. Both parent specs and all six tickets have the ready-for-agent label. Publication preserves the approved scope and test approach.

## Parent specifications

- [Group response consistency — #72](https://github.com/FireBird1998/splitbook/issues/72) · [local spec](../specs/2026-09-28-group-response-consistency.md)
- [Ledger creation coordination — #73](https://github.com/FireBird1998/splitbook/issues/73) · [local spec](../specs/2026-09-28-ledger-creation-coordination.md)

## Published tickets

| Ticket                                                     | Title                                                                 | Blocked by                                                 |
| ---------------------------------------------------------- | --------------------------------------------------------------------- | ---------------------------------------------------------- |
| [#74](https://github.com/FireBird1998/splitbook/issues/74) | Validate Group lists consistently on web and Android                  | None                                                       |
| [#75](https://github.com/FireBird1998/splitbook/issues/75) | Validate Group details and settings across clients                    | [#74](https://github.com/FireBird1998/splitbook/issues/74) |
| [#76](https://github.com/FireBird1998/splitbook/issues/76) | Verify complete Group read compatibility and recovery                 | [#75](https://github.com/FireBird1998/splitbook/issues/75) |
| [#77](https://github.com/FireBird1998/splitbook/issues/77) | Characterize Expense and Settlement retry failures                    | [#70](https://github.com/FireBird1998/splitbook/issues/70) |
| [#78](https://github.com/FireBird1998/splitbook/issues/78) | Unify safe postcommit Activity ordering and narrow retry coordination | [#77](https://github.com/FireBird1998/splitbook/issues/77) |
| [#79](https://github.com/FireBird1998/splitbook/issues/79) | Verify ledger creation and recovery end to end                        | [#78](https://github.com/FireBird1998/splitbook/issues/78) |

Native sub-issue relationships connect #74–76 to #72 and #77–79 to #73. Native blockers are #74 → #75 → #76 and #70 → #77 → #78 → #79. Group work is independent of ledger work. #70 was open when checked for publication; its completion evidence is required before #77 begins.

Individual approved draft bodies and published bodies are retained under architecture-followup-tickets. The manifest maps all 26 Group stories and all 26 ledger stories to ticket acceptance work; published.json records the GitHub identifiers and relationship verification.

## Approved testing seam

Use existing authenticated HTTP reads/writes through an isolated real app and MongoDB as the main seam. Verify actual Group responses through both client adapters and financial results through authorized record/Balance/Activity reads. Supplement with focused decoder cases, real-Mongo creation fault tests and desktop/mobile browser journeys. Retain the native controller smoke journey and report actual Android device coverage separately.

No new runtime tests have run for this planning/publication task. The implementation agent owns full regression verification and must preserve local persistent and production data, concurrent work and parent issue bodies/state.

## Starter prompt

Copy the [complete starter prompt](2026-09-28-architecture-followup-agent-prompt.md) into the new implementation chat. It contains the actual issue URLs, dependency order, working constraints and thorough verification requirements. Start with #74; respect #70 before starting #77.
