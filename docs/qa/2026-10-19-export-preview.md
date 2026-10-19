# Export preview (#611)

Checked against an isolated fictional demo backend on 19 October 2026.

- CSV preview uses the download's query, column builders, ordering and formula guarding. A real route test compares its header and first five rows to the parsed CSV, including a formula-like description and quoted comma. Existing CSV and zip download browser journeys still pass.
- Backup preview counts come from the actual downloaded JSON. The fixture includes an edited Expense, a Deleted Expense, a Payment, an existing recurring template and Activity records. It checks the earliest Expense Month, exact file bytes and exported counts.
- Statement preview projects the printable statement service. A period fixture excludes an earlier Expense and compares exact minor-unit totals, named per-person contributions and the first five rows. Current all-time balances are not shown as period Net.
- Real HTTP integration covers missing Groups (422), missing session (401), nonmembership (403), oversized exports (413, with 50,001 stored Expenses) and an empty period. Replies validate against the shared preview schema.
- Component tests cover CSV, backup, statement, no selection, loading, empty and retryable error states. Hook tests verify the 300 ms debounce, late-response isolation, Retry and malformed replies.
- Desktop and 390 px phone layouts were inspected in light and dark themes. Preview is beside the form at desktop width and below it on phones. Tables scroll within their cards and retain whole money amounts. Phone document width equals viewport width. Screenshots were captured outside Git. The available GitHub browser session was signed out, so PR media upload was unavailable; no screenshot was committed as a workaround.
- The browser journey exercises Group selection, period, Include, all three formats, an empty period and recovery from an intercepted preview failure.

## Known backup limitation

The existing `splitbook-backup/1` schema, builder and service contain no recurring-template or Activity-event arrays. Its optional Expense edit history is supported. The preview labels these unsupported exported categories explicitly; zero exported does not imply zero records in a Group. The requested nonzero recurring-template and Activity backup counts cannot be met without extending the backup download contract. This change keeps that contract unchanged and reports the limitation for the owner's decision.

## Validation

- Export route integration: 43 tests passed; the strengthened statement case also passes with one Payment inside and one outside the period.
- Export component and hook tests: 26 passed.
- Web integration: 67 of 68 files passed in the full run (640 of 643 tests). Three CLI tests hit the machine's missing pnpm launcher. Rerunning the complete 14-test CLI file with pinned pnpm passed; no product change was needed.
- Export browser suite: 16 passed across desktop/phone and light/dark, including download content, accessibility checks and preview error recovery.
- Design-system style policy passed. The complete local gate covers workspace lint, typecheck, formatting, unit tests, ceilings and every HTTP verifier.
