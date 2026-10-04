---
status: proposed
date: 2026-10-04
---

# TanStack Query owns Android display reads inside the controller; financial writes stay outside it

The Android controller (`createMobileController`) has become a hand-written query cache. It coalesces, reuses and saves reads, and its request counters (ten at `7afd15e`), one of them a global view token, decide whether a response is still current. That cache is where the client's hardest bugs live: three of the four controller bugs in the beta fixes (#189, #190 and #192) share one cause, the global view token plus reads started by hand, and the file grew from 448 to 4,961 lines in under a week (measured at `7afd15e`). We move ownership of display reads to TanStack Query v5, run headless inside the controller, and keep every financial write out of it. The controller's public commands and its snapshot (`getSnapshot` and `subscribe`) stay the interface screens use and the seam every test drives, so each step is checked against the existing behaviour suite.

## Decision

**Server state**

- TanStack Query is the only owner of display reads in `apps/mobile`. It runs inside the controller through its framework-free core; screens do not call query hooks. The current screen decides which queries are active, the snapshot is projected from their results, and commands only navigate, write and invalidate. The per-view request tokens are deleted.
- Query defaults: no automatic read retries, so a failed read falls back to the saved copy at once; structural sharing on; a 30-second stale time; the account and environment in every query key; `networkMode: 'always'`, so queries never pause.
- The network layer is the only owner of "offline". Connection failures, stalled bodies, timeouts, and 502, 503 or 504 responses without a SplitBook error code count as "can't reach the server" and fall back to the saved copy. A plain 500 is shown with Retry. The next successful request clears offline. Reconnecting (NetInfo) and returning to the foreground (`focusManager` over `AppState`) only re-fetch active queries. The controller's own foreground refresh is deleted view by view as each view migrates, so no view has two foreground triggers.
- A refresh re-reads the pages already loaded, up to 5 pages (100 rows). Loaded rows stay visible, marked as refreshing, until the re-read lands. Past 5 pages a list slides: loading more drops the newest page, and "Load newer" brings it back.
- Balances follow Expense reads. Whenever a read of a Group or its Expenses ends (it succeeds, fails or is cancelled, including the checks a save makes before it is sent), the transport marks that Group's Balances and Home as stale.

**Financial writes**

- No TanStack mutations in `apps/mobile`, enforced by a lint rule. Writes stay explicit and online in the controller. Each save's payload, with its idempotency key (creates) or revision (edits and deletes), is stored before it is sent, and a retry reuses them unchanged. Nothing is queued, resumed or replayed.
- After a write that may have reached the server, confirmed or unconfirmed, the queries on screen re-fetch. That Group's other cached queries and Home's totals are removed, together with their saved copies. If removing a saved copy fails, the copy is no longer trusted; the member is never signed out for it.
- When the reply to an edit is lost, the edit counts as confirmed only if the saved revision is exactly one higher and its fields equal what was sent. When the reply to a delete is lost, the delete counts as confirmed once the Expense is gone.

**Saved copies**

- A custom persister stores one row per query, in the wire format, in the existing expo-sqlite cache database. Every write goes through the account lease and checks the session at write time, so nothing lands after sign-out.
- A restored copy keeps its original verification time, is marked as restored, and is never fresh. It reaches queries through an envelope whose stale time is 0, so a fallback to a saved copy is never treated as fresh for the normal 30 seconds.
- Drafts, stored save attempts and their clean-up are written through a strict queue, in order, and nothing on it is ever dropped; that is what keeps a retry key. Saved copies use a separate queue, where the latest write per query wins. Sign-out and account change wait for the first queue, cancel the second, then purge everything account-local, including the query cache.
- Saved copies are capped at 20 MB per account and removed least recently used first, never the open Group or Home. There is no age limit, because the verification time is always shown.
- Losing access to a Group removes its cached queries and saved copies. Its draft stays blocked, with Discard, while the member is on it. Once a read of that Group is refused (403 or 404), the draft and any unconfirmed save are deleted. A Group missing from the Group list is not enough, because the list also leaves out archived Groups. This amends ADR 0004 in one case: an unconfirmed save's retry identity does not outlive access to its Group. If access returns, the app asks the member to check the Group's Expenses before saving again.
- A 401 shows the signed-out screen but does not purge. It clears memory, credentials and the query cache, and cancels the saved-copy queue. Account-local data on disk stays until the same account returns or another account purges it.

**Errors**

- The transport turns failures into a small typed union (network, timeout, signed out, access denied, stale revision, server error), and query functions throw those.
- The transport moves into its own module, unchanged in behaviour, before anything else in the migration. It tells a cancelled request apart from being offline.

**Client state, forms, lists and navigation**

- The snapshot stays the only client-state store. Screens read it through a selector hook built on `use-sync-external-store/with-selector`.
- The save, Settlement and Group-creation flows stay hand-written. Each gets a declared table of allowed state changes, which tests enforce. A save in progress is never persisted as "saving".
- The controller owns every draft; there is no form library. The field validators keep their product copy, and tests catch drift from the shared schemas.
- Long lists move to memoized rows first. They move to `FlatList` only if the device numbers (#194) miss, and to FlashList only if `FlatList` misses too. Returning to a list restores the position by an anchor row, falling back to the scroll offset.
- The controller keeps owning navigation. The route becomes one explicit value, in a refactor of its own.

**Web, shared code and sign-in**

- The web app keeps SWR.
- `@splitbook/shared` gains query key factories, path builders and Zod response decoders, with no new dependency. Android moves to them before the engine swap (migration step 2). A lint rule keeps React, React Native, Expo, Next, MUI, SWR, TanStack, Better Auth, Mongoose, the database drivers and DOM APIs out of it (ADR 0002).
- The hand-rolled Better Auth exchange stays.

## Migration and gates

The order:

1. Move the transport out.
2. Move Android's response parsing to the shared decoders, and build query keys with the shared key factories.
3. Swap the cache engine under the existing read path, for every resource, in one change.
4. Make the route one explicit value.
5. Move the Groups list and Home to declarative queries, with their saved copies on the new persister.
6. Move the other views the same way, in this order: a Group with its Expenses and Balances; an Expense record and its history; Activity. Each list gets its 5-page window and "Load newer" in the same change.
7. Cap saved copies at 20 MB and delete the old saved-copy store.
8. Delete the controller cache and the view tokens.

The beta fixes under #184 land first, in the current controller. Their tests become migration gates.

Next, a pilot of about one agent-week covers steps 3 to 5. It lands on an integration branch, and main gets it only if the owner decides to continue. It passes only if all of these hold:

- the behaviour suite passes unchanged;
- the checks for restarting offline (with original verification times), account switch, losing access, delayed responses and delayed writes of saved copies pass;
- losing access resets the queries on screen, because removing a query does not notify the observers that show it;
- no render or request-count ceiling rises (the render ceilings come from the refreshed #183, and request-count ceilings are added before the pilot);
- `mobile-controller.ts` gets shorter, and the production code under `apps/mobile/src` doesn't grow overall;
- no mutation is ever persisted;
- the app bundle grows by no more than 10 KB gzip.

If any gate fails, we stop and deepen the existing cache instead (#145). The route change (step 4) still moves to main, because it helps either way.

Each later view migration (step 6) passes the same per-resource checklist as the pilot: the controller checks and mutation checks in the pilot record (#221).

Every pull request runs a ratchet: no render or request count may rise unless the owner approves a re-record. One re-record is planned: re-reading loaded pages on refresh sends more requests than today. Device numbers are recorded before the migration and measured again at the end.

## Considered options

- **Deepen the controller's own cache (#145).** This is the fallback if the pilot fails. It's not preferred, because the cache, its freshness rules and its token checks would stay hand-written and keep growing.
- **Query hooks in screens.** Rejected for now: it breaks the seam that more than 400 tests drive, and it mixes two migrations. It is a separate, later decision.
- **TanStack for Activity only (#108, PR #173).** Rejected: the pilot added a second cache with its own freshness, invalidation and persistence, and a 31-line change to the controller alone matched or beat it.
- **TanStack mutations, or the stock persister.** Rejected, because each breaks ADR 0004:
  - paused mutations resume automatically on focus or reconnect, and no setting stops it;
  - the default dehydration persists paused mutations;
  - the stock persister was measured writing a signed-out account's data back after sign-out.
- **Effect in app code.** Deferred:
  - Effect 4.0 has been stable only since 2026-10-01;
  - a Hermes-on-Android date bug (effect#8689) is fixed on Effect's main branch but not yet released;
  - its HTTP modules are marked unstable;
  - typed errors with a timeout cost about 30 KB gzip, three times the pilot's budget;
  - its Schema duplicates Zod.

  Effect is allowed only in standalone tooling, starting with the planned `tools/swarm`. Revisit when 4.0 has patch releases, the effect#8689 fix ships in one, and an on-device Hermes check passes.

- **MMKV or op-sqlite for saved copies.** Rejected: MMKV has a per-account delete crash, and op-sqlite can't coexist with expo-sqlite.
- **Expo Router or React Navigation.** Deferred:
  - either would be a second owner of the current screen;
  - React Navigation adds about 43 KB gzip, and Expo Router more;
  - predictive Back is broken upstream;
  - React Navigation 8 needs TypeScript 6.

  Revisit when one of these happens: an iOS build is scheduled; native transitions are wanted; upstream predictive Back is fixed; #178 has landed; React Navigation 8 is stable on TypeScript 6.

- **XState.** Deferred: about 14 KB gzip for flows the controller already owns, and version 6 is still in alpha. Revisit when XState 6 is stable.
- **A form library, or Zustand.** Rejected: each adds a second store or more bundle weight, for state the controller already owns.
- **TanStack Query on the web.** Rejected: it adds about 4 KB gzip and pause-and-resume defaults, and gains no money safety over SWR.
- **@better-auth/expo.** Rejected: it would be a second owner of the session. Revisit only if browser OAuth is needed.

## Consequences

- `apps/mobile` gains these dependencies:
  - TanStack Query's core package;
  - `@react-native-community/netinfo`, a native module, so the development client and the staging APK must be rebuilt;
  - `use-sync-external-store`.
- Two lint rules are added. One bans TanStack mutation APIs in `apps/mobile`; the other bans framework imports in `@splitbook/shared`.
- Freshness uses TanStack's clock, so tests use fake timers rather than the controller's injected clock.
- The migration by itself does not cut renders. Render work (#178) and list virtualization (#179) proceed on their own, gated by the render ceilings and the device numbers.
- Issues change as follows:
  - #145 becomes the server-state specification;
  - #181 is superseded by the Activity slice;
  - #182 stays open; its questions about the next deep modules are answered by the specifications #208, #212, #230 and #215.
- Earlier ADRs are affected:
  - ADR 0002 is widened: shared code also holds query key factories, path builders and response decoders, still with no framework imports;
  - ADR 0003 cited Better Auth's built-in Expo client, which the app does not use; it keeps its own exchange;
  - ADR 0004 is amended in one case, losing access to a Group (see Saved copies).
- `CONTEXT.md` gains **saved copy**, **draft** and **unconfirmed save**.
- Decision issue: #195. Map: #176.

## Evidence

All lines are on `origin/main` at `9805550` (2026-10-04), unless a line names another commit. `mobile-controller.ts` means `apps/mobile/src/data/mobile-controller.ts`; any other bare file name is in `apps/mobile/src/data/`.

### Code claims

- The controller is `createMobileController` (`mobile-controller.ts:357`). Screens read it through `getSnapshot` and `subscribe` (`:5232-5233`), used at `apps/mobile/App.tsx:104`.
- The file had 448 lines at `4e43baa` (2026-09-28), 4,961 at `7afd15e` (2026-10-03) and 5,247 at `9805550`.
- Ten request counters decide whether a response is still current (`:373-382`); `viewRequest` (`:373`) is the global view token. #213 added an eleventh, `leaveRequest` (`:4305`).
- The read cache is `reads`, `inflight`, `versions` and `invalidatedAt` (`:393-398`), with `sharedRead` (`:1000-1047`) and `readCached` (`:1054-1105`). The 30-second window is `DISPLAY_FRESHNESS_MS` (`:108`).
- #189, #190 and #192 share one cause:
  - #190: the Groups list read takes the global token (`:1222`) and drops its answer once the token moves (`:1248`, `:1284`);
  - #189: a created Group's screen is published by hand, and no Expense or Balances read starts (`:4922-4935`);
  - #192: Retry on an Expense re-reads only the session and the Group (`:5050`, `:5058`).
- Saved copies have their own expo-sqlite file, separate from drafts and payment attempts (`account-record-storage.ts:16-20`, wired at `apps/mobile/src/runtime.ts:48-50`). Each account's saved copies are one JSON document today (`read-cache-storage.ts:14`, `:26`).
- The account lease is `accountStorage` (`:507-533`); each write checks the signed-in account at write time (`:522-527`). Drafts, attempts and saved copies share one queue today (`:501-505`).
- Sign-out (`:5126`) and account change (`:1315-1316`) run `clearAccount` (`:535-579`), which clears every store registered at `runtime.ts:95-99`.
- A 401 runs `failSession` (`:707-714`), not `clearAccount`: memory and credentials are cleared (`:613`, `:617`) and data on disk stays.
- A 403, or a 404 on the Group, calls `forgetGroup` (`:716-723`, `:1833-1853`). A Groups list that leaves out a Group drops its reads and saved copies (`:1253-1276`); a failed removal signs the member out today (`:1849`, `:1274`).
- The Groups list leaves out archived Groups (`apps/web/src/app/api/groups/route.ts:40`, `apps/web/src/lib/services/group.service.ts:97-99`); a member can still read an archived Group (`apps/web/src/app/api/groups/[id]/route.ts:22`, `:29`).
- The Group GET and the Expense list GET materialize due recurring Expenses (`apps/web/src/app/api/groups/[id]/route.ts:31-33`, `apps/web/src/app/api/groups/[id]/expenses/route.ts:66-68`).
- Balances follow Expense reads by hand: `beginExpenseRead` (`:2080-2087`) and `trackExpenseRead` (`:919-930`) mark Balances and Home stale, but only Expense page reads are tracked (`:2188`), not the Group read (`:1710`) or the checks before a save (`:3410`, `:3619`, `:3771`).
- Writes: `Idempotency-Key` and `If-Match` are set at `:689-690`; `ledgerWrite` invalidates the Group's reads in `finally` (`:3082-3086`); creates store their key and body before sending (`:3628-3645`, `:4031-4035`); edits and deletes store their revision and body (`:3419-3432`); Group creation keeps its key in memory only (`:4877-4890`, #203).
- Content on screen keeps its verification time (`:1348-1349`); `peek` refuses a saved copy older than an invalidation (`:985`), but the offline fallback does not check that yet (`:1080-1103`, #191).
- `predictiveBackGestureEnabled: true` is at `apps/mobile/app.config.ts:23` (PR #248 turns it off). The web uses SWR (`apps/web/package.json:44`). No package depends on TanStack Query or Effect, and the Google exchange is hand-written (`mobile-controller.ts:1560-1563`).

### Tests that keep the money-safety rules

These pass on `9805550` (CI's `pnpm test`, `.github/workflows/ci.yml:48`). Gaps name the ticket that closes them.

- **Writes are online and explicitly started; nothing is queued, resumed or replayed:** `expense-controller.test.ts:1183`, `read-cache-controller.test.ts:717`, `offline-controller.test.ts:313`, `loading-states-controller.test.ts:698`. Gap: an Expense delete and Group creation are not blocked offline (#200).
- **A retry reuses the same key or revision:** `expense-controller.test.ts:1250`, `:436`, `:271`; `settlement-controller.test.ts:353`; `mobile-controller.test.ts:842`. Gaps: a rejected Expense retry drops its key (#196); a Group's key does not survive a restart (#203); the web Settlement sheet (#198).
- **No cross-account data:** `mobile-controller.test.ts:257`, `:1225`; `read-cache-controller.test.ts:847`; `offline-controller.test.ts:472`. Gaps: a crash during an account switch (#200); a stale web tab (#199).
- **Sign-out and account change purge account-local data:** `mobile-controller.test.ts:400`, `:214` (also pins the 401 rule); `offline-controller.test.ts:408`, `:422`; `settlement-controller.test.ts:274`.
- **Losing access removes cached and saved content:** `read-cache-controller.test.ts:822`; `offline-controller.test.ts:343`, `:391`. Gap: no test deletes the draft or unconfirmed save; today's tests keep them (#233). The web side is #201.
- **Cached content keeps its verification time and is never fresh:** `read-cache-controller.test.ts:744`; `offline-controller.test.ts:237`; `financial-controller.test.ts:710`. Gaps: a saved copy older than a confirmed write (#191); restored copies in the query cache are a pilot gate (#212, #217).
- **Balances follow Expense reads:** `read-cache-controller.test.ts:519`, `:549`; `financial-controller.test.ts:296`. Gaps: the Group read and save checks (#219); the web side (#240).
- **`@splitbook/shared` stays framework-free:** no test on `main`; the guards are `packages/shared/tsconfig.json:4` (`"lib": ["ES2022"]`, no DOM) and `:12`, and only `date-fns` and `zod` as dependencies (`packages/shared/package.json:16-19`). PR #249 (#207) adds the lint rule and its tests.
