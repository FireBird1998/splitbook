# Android usability ticket breakdown

Drafts for review before GitHub publication. Core release tickets are 01–08 and 10; 09 is optional research-backed adoption work.

Testing uses the existing installed Android → real staging HTTP → authorized ledger-read seam, with public-controller regressions and focused rendered form interactions.

| Ticket                                                            | Blocked by     | Delivers                                                                                                                                               |
| ----------------------------------------------------------------- | -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| [01 Required Expense fields and actionable corrections](01.md)    | None           | Complete the create/edit correction loop for Amount, Description, date and Tag, including clear required labels, inline errors, and first-error focus. |
| [02 Explain payer and split errors inside native editors](02.md)  | 01             | Make all supported payer and split combinations correctable in place using the same field feedback.                                                    |
| [03 Keep financial content visible during refresh](03.md)         | None           | Keep the current authorized view readable while refreshing and show one progress cue appropriate to the operation.                                     |
| [04 Reuse cached views and coalesce foreground reads](04.md)      | 03             | Show validated matching cached content promptly and combine redundant foreground/reconnect requests without weakening authorization.                   |
| [05 Clarify draft recovery history and return navigation](05.md)  | None           | Resume and recover Expenses predictably, explain edits in human terms, and return to the originating Group and Month.                                  |
| [06 Explain Group and Settlement form corrections](06.md)         | 01             | Extend the established feedback pattern to Group creation and recording an actual payment.                                                             |
| [07 Prototype the compact Android form and navigation](07.md)     | None           | Produce and review an OpenDesign Local Codex prototype for the native surface, including realistic errors and refresh states.                          |
| [08 Implement the reviewed compact native surface](08.md)         | 02, 03, 07     | Deliver the reviewed Android navigation and Expense layout using existing financial behavior and validation.                                           |
| [09 Pilot TanStack Query for Activity reads](09.md)               | 04             | Optionally migrate one complete Activity read flow to TanStack Query and measure whether it simplifies reads without weakening recovery or cleanup.    |
| [10 Verify the hardened Android journeys for beta release](10.md) | 04, 05, 06, 08 | Establish integrated device evidence that the corrected forms and refresh behavior work together before promoting the beta.                            |
