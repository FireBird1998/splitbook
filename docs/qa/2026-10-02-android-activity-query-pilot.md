# Android Activity reads: TanStack Query pilot (#108)

This is the pilot and decision record for [#108](https://github.com/FireBird1998/splitbook/issues/108) ("Pilot TanStack Query for Activity reads"). It starts from `main` at `35abf4e`. The ticket is optional and does not gate the release.

## Decision: revert

**Do not adopt TanStack Query for Activity.** Close the pilot code unmerged. Keep this record and the measurement script, and port the two policy changes behind the pilot's gains into the controller, which already has them for other views.

- **The gains are the controller's own policies.** The pilot read Activity less often and showed it sooner after a restart, but only because it applied #103's display freshness window and saved-copy preview to Activity. The controller already gives both to every other view (`freshRead`, `peek`).
  - A controller-only variant changes 31 diff lines in `mobile-controller.ts` and adds no dependency. It measured the same or better on every journey (see [Measurements](#measurements)).
  - The 447 existing mobile tests pass on that variant, with the same two test updates as the pilot (see [Gates](#gates)).
- **The pilot regresses one common journey.** After a confirmed change with older Activity loaded, TanStack's infinite-query refetch reads every loaded page again, in sequence: 2 requests and 718 ms to first content, against 1 request and 385 ms on `main`. Focus refetches past the freshness window cost the same.
- **It adds a second cache rather than replacing one.** Every other display read stays on #137's read cache, so the app now has two freshness rules, two invalidation paths and two persistence paths. Activity's guards (account lease, cache epoch, ledger versions, `invalidatedAt`) still have to come from the controller, through adapters.
  - Production code grows by 369 lines net (`activity-reads.ts` 228, controller +213 −79, App.tsx +7) to replace the 82-line `readActivity`.
  - The dependency adds 32.0 KB minified (9.4 KB gzip) of `@tanstack/query-core` and process-wide singletons (`focusManager`, `environmentManager`).

What would change this decision: moving _every_ display read onto TanStack, so the controller's read cache can be deleted. That is a much larger change across the money views, and nothing measured here suggests it would pay for itself.

## What the pilot did

### Ownership on `main` (mapped before the change)

- **Readers.** Activity pages (`/api/groups/:id/activity?page=N&limit=20`, read scope `ledger:<id>`) are read by `readActivity` through `readCached`, from five places:
  - `showGroup` when the destination is Activity
  - `selectDestination` while Activity is idle
  - Pull and Retry (`refreshActivity`)
  - the foreground refresh on Activity
  - Load older (`loadMoreActivity`)
- **Invalidation.**
  - Confirmed Expense and Settlement writes (`ledgerChanged`, including `ledgerWrite`'s `finally`).
  - Denial: `request()` 403/404 bumps the epoch and versions, evicts content and purges the device copy (`invalidateGroup`).
  - Groups no longer listed: `listGroups` invalidates their scopes and calls `retainGroups`.
  - Sign-out and account change: `invalidate()` plus `clearAccount`.
- **Event details** (`selectActivity`) read the Group and the linked Expense through `readCached`. They stayed with the controller.

### Ownership in the pilot

- **TanStack owns Activity pages.** `apps/mobile/src/data/activity-reads.ts` holds one `QueryClient` and one `InfiniteQueryObserver`, keyed `['activity', accountId, groupId]`, and owns fetching, cached state, staleness and invalidation. The competing owner (`readActivity`, `activityRequest`) is deleted.
- **Fetches are network-only.** Each fetch is one validated `request()` (`parseActivityPage`), revalidating the session first when offline. The fallback is never wrapped as a network success.
- **Persistence is an explicit adapter.**
  - Only pages read from the network are saved, each once, with the controller-clock time it was read. Saves go through the account lease, with the epoch and version checked when the write runs, as in `sharedRead`. They use the same paths, so `invalidateGroup` and `retainGroups` still purge them.
  - A saved copy is restored with `setQueryData` and keeps its original time.
  - Each page carries its own provenance (`refreshedAt`, `restored`), so a restored page is never fresh, never saved again and never labelled as verified.
  - Saved pages after the first are restored only while their `total` matches the first page, which leaves out pages saved at another moment of the timeline.
- **Freshness** is a `staleTime` function on the controller's clock (the 30 s display freshness window). TanStack's own timestamps use the real clock.
- **Focus.**
  - App.tsx wires `focusManager` once to Android `AppState` (`watchAppFocus`), and the controller's foreground refresh no longer reads Activity, so the two never duplicate.
  - Overlapping focus events join one read, and a hidden timeline is not observed or refetched.
  - Switching back to Activity within a Group visit keeps what was read, as before (`keep`).
  - An explicit Group refresh expires the cached timeline, so the next visit reads again.
- **Invalidation hooks.**
  - `ledgerChanged` cancels reads in flight, which are therefore neither shown nor saved, and marks the Group's timelines stale.
  - Denial and unlisted Groups remove them.
  - Sign-out and account change clear the client.
- **Pull and Retry** read the first page again and replace the timeline, as before.
- **Auth, drafts and financial mutations** stay outside: there are no mutations in the client, so none are persisted or resumed.
- **The snapshot is unchanged.** `snapshot.activity` keeps its shape, so Activity UI work (#156, #157) is unaffected.

## Acceptance criteria

| Criterion                                                                                                                  | Pilot                                                                                                                                                                                                                                                                      |
| -------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Map invalidation dependencies; transfer fetch, state and invalidation together; remove the competing owner                 | Done (above)                                                                                                                                                                                                                                                               |
| Network-only validated fetches; explicit persistence adapter preserving timestamps and scope; no fallback as fresh success | Done; gated by tests and mutation checks                                                                                                                                                                                                                                   |
| Native online and focus listeners once; duplicate controller triggers suppressed; paused/offline distinct from loading     | Focus done. **Online: not done.** This build has no connectivity listener (NetInfo), so the pilot uses `networkMode: 'always'` and maps a network failure to the offline state (saved copy with its time, or "This view was not saved on this device"), never to a loader. |
| Auth, drafts and financial mutations outside; mutations excluded from persistence and resume                               | Done                                                                                                                                                                                                                                                                       |
| Offline restart, account switch, denial, delayed response and persistence, request-count gates                             | Pass (10 controller tests)                                                                                                                                                                                                                                                 |
| Keep/revise/revert decision with measurements                                                                              | **Revert** (this record)                                                                                                                                                                                                                                                   |

## Measurements

**Method:** the public controller, over real HTTP, against an isolated fictional ledger.

- **Script:** `apps/mobile/scripts/measure-activity-reads.ts`.
  - It creates and archives its own Household Group, with 24 seeded Expenses (two Activity pages).
  - It adds 300 ms to every request.
  - It counts requests per journey and times first content (Activity shown with events) and settling.
  - A foreground event is what App.tsx does on Android: the controller's foreground refresh plus a focus event.
- **Environment:**
  - Backend: `apps/web` at `35abf4e` (Next 16.1.6 dev server) through `apps/mobile/scripts/dev-backend` on `127.0.0.1:4138`, database `splitbook_mobile_50`.
  - Database: MongoDB 7.0.43 (`mongo@sha256:9854f713…`) in a throwaway container.
  - Runtime: Node 22.22.0, UTC.
- **Variants:** all three ran the same script twice. The table shows the second (warm) run; the first run had identical request counts and first-content times within 125 ms. The controller-only variant is the [appendix](#appendix-controller-only-variant) diff, measured as a throwaway and not committed.
  - **main:** `main`'s controller.
  - **TanStack:** this pilot.
  - **Controller:** `main` plus freshness and saved-copy preview for Activity.

| Journey                                         | main                          | TanStack              | Controller            |
| ----------------------------------------------- | ----------------------------- | --------------------- | --------------------- |
| Open the Group on Activity (first time)         | 2 req, 867 ms                 | 2 req, 773 ms         | 2 req, 779 ms         |
| Expenses, then Activity again within 30 s       | 0 Activity reads              | 0                     | 0                     |
| Three overlapping foreground events within 30 s | 1 read                        | **0**                 | **0**                 |
| Three overlapping foreground events after 30 s  | 1 read                        | 1                     | 1                     |
| Pull to refresh                                 | 1 read                        | 1                     | 1                     |
| Load older                                      | 1 read, 368 ms                | 1, 403 ms             | 1, 359 ms             |
| Home, then the Group on Activity within 30 s    | 3 req                         | **2**                 | **2**                 |
| Confirmed Expense create (returns to Expenses)  | 6 req                         | 6                     | 6                     |
| Activity after that create (2 pages loaded)     | 1 read, 385 ms                | **2 reads, 718 ms**   | 1 read, 379 ms        |
| Restart: open on Activity (saved views)         | 2 req, 756 ms                 | 2 req, **377 ms**     | 2 req, **355 ms**     |
| Offline restart: open on Activity               | 603 ms, 20 events             | **305 ms, 27 events** | **305 ms**, 20 events |
| **All journeys**                                | 22 requests, 8 Activity reads | 21, 7                 | 20, 6                 |

- **Restart (saved views).** Activity now appears from the device copy while the network read runs. On `main` it waits for the read.
- **Offline restart.** The pilot also restores the consistently saved older page (27 events, against 20). That is the only gain the controller variant lacks; it is a small addition to `savedActivity`-style restore and does not need TanStack.
- **Slow device saves.** `main` and the controller variant show a read only after it is saved (`sharedRead` awaits the write). The pilot shows it first. This applies to every view and could be changed in `sharedRead` itself.

**Cost:**

|                                                               | main                      | TanStack pilot                                                 |
| ------------------------------------------------------------- | ------------------------- | -------------------------------------------------------------- |
| Production code for Activity reads                            | 82 lines (`readActivity`) | `activity-reads.ts` 228 lines; controller +213 −79; App.tsx +7 |
| Bundled dependency (used exports, esbuild, minified)          |                           | 32.0 KB, 9.4 KB gzip                                           |
| Caches with their own freshness, invalidation and persistence | 1                         | 2                                                              |

## Gates

`apps/mobile/src/data/activity-query-controller.test.ts` (10 tests) drives the public controller against a fictional ledger. It covers:

- **Request counts.** One read per freshness window across destination switches, reopening, overlapping foreground and focus events; one more read after the window; a pull always reads.
- **Pages.** Focus re-reads every loaded page; a pull reads only the first and replaces the timeline.
- **Hidden timelines.** Activity is not observed or refetched while another destination is shown.
- **Offline restart.**
  - Saved pages are restored with their original time and an offline notice, with no progress cue.
  - Nothing is saved again.
  - Once online, a restored copy is read again even inside the window of its original read.
  - An inconsistent older page is left out.
  - An unsaved timeline shows "not saved on this device", not a loader.
- **Account switch.** A read in flight across sign-out is neither shown nor saved, and the next account reads its own timeline.
- **Denial.** The timeline leaves memory and the device; after access returns, nothing cached shows while Activity is read again.
- **Delayed response.** A read made obsolete by a confirmed Expense is neither shown nor saved; the next visit shows the change.
- **Delayed persistence.** A slow save does not hold back the timeline and records the time of its read.

**Mutation checks:** each of these broken guards fails at least one gate:

- not cancelling reads on a ledger change
- saving restored pages
- treating a restored copy as fresh
- not removing a denied timeline
- not clearing on sign-out
- restoring inconsistent pages
- ignoring freshness
- observing while hidden

**Existing suites:** all 447 earlier mobile tests pass, with two deliberate changes in `app.test.tsx`:

- The automatic Activity refresh test now moves past the 30 s window, as the other foreground tests already do. `main` re-read Activity on every foreground.
- The test helper sends `background` before `active`, as Android does.

The 10 new tests bring the mobile total to 457. Typecheck, lint and Prettier pass for the mobile package.

## Not verified

- No installed-Android or ADB run: this environment has no Android SDK or emulator. `AppState` focus wiring is covered only by rendered tests with a mocked `AppState`.
- No connectivity listener, so "paused" is never distinguished from a failed attempt. A real NetInfo integration was not tried.
- Timings use an injected 300 ms per request on loopback, not a phone network.

## Follow-up if the decision is accepted

1. Close this PR's pilot commit unmerged. Land this record and `measure-activity-reads.ts` without its `@tanstack/query-core` import (its focus event does nothing without a `QueryClient`).
2. Port the policy into `readActivity`:
   - reuse a first page verified within the display freshness window (foreground, reopening);
   - preview the saved copy while reading.
   - Optionally, restore consistent older pages offline.
3. Port the pilot's gates with it. Handle the case the throwaway variant does not: with older pages loaded, a reused first page must not replace them.

## Appendix: controller-only variant

Measured against `35abf4e`. Not committed; hunk headers abbreviated. It reuses a fresh first page for foreground and reopening, and shows the saved copy while reading.

```diff
@@ showGroup
-        await readActivity(false);
+        await readActivity(false, reuse);
@@ readActivity
-  const readActivity = async (append: boolean) => {
+  const readActivity = async (append: boolean, reuse = false) => {
@@
     const pageNumber = append ? pagination!.page + 1 : 1;
+    const path = `/api/groups/${groupId}/activity?page=${pageNumber}&limit=20`;
+    const fresh = !append && reuse ? freshRead(path) : null;
+    if (fresh && previous.status !== 'idle' && previous.pagination?.page === 1) return;
     if (!append) activityDetailRequest += 1;
@@
-      const page = await readCached(
-        `/api/groups/${groupId}/activity?page=${pageNumber}&limit=20`,
-        owner,
-        (value) => parseActivityPage(value, groupId, pageNumber),
-        () => current(owner) && view === viewRequest && read === activityRequest,
-      );
+      const parse = (value: unknown) => parseActivityPage(value, groupId, pageNumber);
+      const reading = fresh
+        ? null
+        : readCached(
+            path,
+            owner,
+            parse,
+            () => current(owner) && view === viewRequest && read === activityRequest,
+          );
+      reading?.catch(() => undefined);
+      if (reading && !append && !previous.events.length) {
+        const saved = await peek(path, owner, parse);
+        if (saved && current(owner) && view === viewRequest && read === activityRequest)
+          publish({ ...snapshot, activity: { ...snapshot.activity, events: saved.value.events } });
+      }
+      const page = fresh ? parse(fresh.value) : await reading!;
@@ refreshView
-    if (showingActivity() && snapshot.detail.status === 'ready') return refreshActivity();
+    if (showingActivity() && snapshot.detail.status === 'ready') return readActivity(false, reuse);
```
