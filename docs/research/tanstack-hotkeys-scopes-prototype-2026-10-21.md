# Second Hotkeys prototype: scopes remove machinery, but migration remains on hold

Question: can TanStack scopes replace Splitbook's custom priority registry and overlay scan with a worthwhile reduction in maintenance? **This experiment does remove both, but it does not meet the migration condition.** Two handler-priority contracts regress, the MUI lifecycle adapter adds a new integration responsibility, and the full adapter still grows. Keep the current implementation. This is evidence on `codex/715-hotkeys-scopes`, not a proposed production migration. Nothing is merged or deployed.

The baseline is main commit `b2daa50c3e9a80e8e01870e7c6bf9cd9af1769b8`, including #718. The first experiment is preserved at `1e7db5db0c9eaa9887775d79ef4b20002c344c53`. Both experiments concern web shortcuts; Next.js, Android Query and financial writes are unchanged.

## What scopes replace

The candidate uses the real public manager from `@tanstack/react-hotkeys` 0.16.0, backed by `@tanstack/hotkeys` 0.17.0. The lockfile also resolves Store and React Store 0.11.2. The custom registration map, reverse handler lookup and DOM overlay query are gone. Each real page registration gets an active scope; the shell fallback uses `global`. Exclusive overlay providers suspend background scopes while explicitly allowing global Search. Unmount releases registrations and scopes.

MUI requires integration: a themed Modal root wraps its contents in a scope, preserves its styled root and forwarded ref, and follows the public `MuiModal-hidden` class so exiting portals remain blocking and kept-mounted closed roots stop blocking. An initial owner-state slot-prop adapter failed the real Menu test because Menu/Popover supplies its own slot props; the final adapter avoids that override. Autocomplete gets a Popper boundary and the custom inline TagManager alertdialog gets an explicit boundary.

This removes DOM discovery, but future custom overlays now need an explicit boundary. MUI focus trapping, Escape, restoration and portals remain MUI's responsibility. The member preference, keyboard policy, ten-second navigation handoff, accessible hints, and Expense-table focus/scroll remain Splitbook's responsibility. Literal-key and modifier checks, IME/editable-field guards, repeat rules and deferred prevention are still needed around the library matcher. There is no dual-running legacy dispatcher.

## Two reproduced blockers

These tests pass when the baseline provider is substituted into the same integration fixture, and fail against the candidate with ordinary assertions:

- `the latest fallback wins and removing it restores the earlier fallback`
- `the latest global search handler wins and its predecessor resumes after unmount`

Both fail at the first latest-handler assertion: registrations in a shared scope run in insertion order, and the application's already-prevented guard leaves the earlier handler as winner. Unique page scopes preserve latest-real precedence and restore a late-mounted fallback when the last real handler unregisters. They do not fix multiple handlers in the shared fallback/Search scopes.

The candidate captures these as two **expected failures**, clearly marked as migration blockers. They must not be interpreted as compatibility passes. Run them as ordinary red tests with:

```sh
HOTKEYS_PROTOTYPE_STRICT=1 pnpm web test:hotkeys-prototype
```

A replacement registration would remove the earlier registration needed for restoration. More elaborate scope hierarchy, dynamic allow-lists or custom dispatch might address the mismatch, but were not validated here and would need to earn their maintenance cost. This is a finding about this tested design, not a claim that the library cannot implement the behavior.

## Source and bundle cost

`pnpm web measure:hotkeys-prototype` compares every affected production module plus the unchanged setting module against the baseline. It excludes tests, docs, tooling and dependency source. The lexical measure removes block comments, blank lines and full-line comments; it is not a complexity or speed benchmark.

| Measure                                   | Baseline | Candidate |   Delta |
| ----------------------------------------- | -------: | --------: | ------: |
| Physical production lines                 |    1,335 |     1,412 |     +77 |
| Nonblank/noncomment production lines      |    1,145 |     1,212 |     +67 |
| Groups route chunk union, gzip bytes      |  394,213 |   407,002 | +12,789 |
| Expenses route chunk union, gzip bytes    |  454,124 |   466,907 | +12,783 |
| All emitted static JavaScript, gzip bytes |  896,063 |   907,364 | +11,301 |

The two production builds use the same Node 22.22.2/pnpm 10.23.0 toolchain, demo authentication, persistent Draft flags and fictional replica-set backend. The candidate emits two additional JavaScript chunks. `pnpm web measure:hotkeys-bundle` sums each unique emitted file compressed separately at gzip level 9, using each route's client manifest plus root-main files. These are emitted chunk unions, not measured initial network transfers; do not add the route rows together. No runtime speed improvement was measured or claimed.

## Verification

The new `nested overlay scopes suspend page keys until the last overlay closes, while search stays available` test was red with a no-op boundary and passes with real exclusive scopes. The fixture uses the real library, React renderer and EventTarget events; minimal element stubs do not prove native browser behavior.

The focused suite has 69 successful behavioral cases and the two expected failures above, across four files. It covers latest-real and last-real fallback restoration, nested scope release, logical versus physical keys, shifted keys, Control/Meta, IME and editable widgets, already-prevented events, defaults/propagation, repeat behavior, handoff expiry/once-only dispatch, refused storage, account preference changes, and Strict Mode cleanup.

The browser comparison uses `shortcuts.spec.ts`, `search.spec.ts` and `hotkeys-scopes-prototype.spec.ts` against production builds with fresh fictional data. The baseline's existing journeys pass (34, with 10 intentional phone/desktop skips); all 12 added cases pass across desktop/phone and light/dark. The final candidate passes all 46 browser cases, with the same 10 intentional skips. The new cases cover nested Menu/Search/Drawer closure and resumed page shortcuts, another tab changing the member preference, and a failed Expenses read retaining local slash focus. The overlay test waits for MUI exit completion before asking the background handler to resume; its initial role-hidden-only wait was premature on the baseline as well.

The fixture's baseline priority proof substitutes only the baseline provider into the candidate test environment; it is not a full baseline dependency install. Browser evidence is from the separately built baseline. Neither proof establishes every keyboard layout, every custom overlay/Autocomplete interaction, or navigation where the destination handler never mounts. No claim that all edge cases are handled is justified.

## Decision

The meaningful gain is removal of two pieces of custom dispatch machinery. It is outweighed in this prototype by demonstrated priority regressions, new MUI coupling, remaining application policy, and increased source/dependency cost. Do not migrate this branch. Revisit when a concrete shortcut feature or a simpler validated scope mapping offsets those costs. Rollback is to keep using main; no production rollback is needed.
