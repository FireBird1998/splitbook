# Hotkeys prototype: compatibility is possible, maintenance benefit fails

Throwaway prototype for [Prototype: prove TanStack Hotkeys simplifies existing web shortcuts](https://github.com/FireBird1998/splitbook/issues/715), based on `45485342f4e2b70f9497b13e14573bf3bfd6c0e2`. This branch is evidence, not a migration proposed for merging. Keep the existing web shortcut engine: the measured adapter increases owned production code while retaining the application's difficult responsibilities. The owner's significant-gain condition is not met.

## Run the proof

After the workspace's normal dependency setup:

```sh
pnpm web test:hotkeys-prototype
pnpm web measure:hotkeys-prototype
```

The first command runs existing shortcut, hint and search tests plus the actual React-library integration fixture. The second compares the baseline's four owned shortcut modules against this branch. The normal web dev command also runs the candidate in the existing UI; there is no separate simulation or additional product route.

## What was actually replaced

The prototype pins `@tanstack/react-hotkeys` **0.16.0**, whose published dependency is `@tanstack/hotkeys` **0.17.0**. The lockfile additionally resolves React Store and Store **0.11.2**; these are transitive Hotkeys requirements, not a decision to migrate application state to Store. [Published package metadata](https://registry.npmjs.org/@tanstack/react-hotkeys/0.16.0).

One real `useHotkeys` call replaces the provider's manual window listener and page chord selection. The semantic Expense table keeps its existing React `onKeyDown`, native Enter and focus/scroll implementation; its matching now reaches the public `matchesKeyboardEvent` API through the existing `shortcutFor` seam. There is one active page dispatcher, no dual-run legacy engine, no custom shortcut UI, no library scopes and no Devtools.

The member preference, newest-real-handler/fallback priority, ten-second navigation handoff, labels/ARIA hints, input/IME/overlay policy and table focus/scroll responsibilities remain owned by Splitbook. They were not counted as deletions. No persisted schema or key, route, backend API, financial save command or native application code changed.

## Why the adapter grows

Published source confirms the manager does not reject already-prevented events and consumes browser defaults before invoking callbacks. The prototype sets `preventDefault: false`, `stopPropagation: false`, `ignoreInputs: false`, `capture: false`, `eventType: 'keydown'` and `requireReset: false`. Application callbacks reject an already-prevented event and apply policy before consuming it, and only consume when a real handler exists. [Manager implementation](https://unpkg.com/@tanstack/hotkeys@0.17.0/dist/hotkey-manager.js).

Explicit Control+K and Meta+K bindings preserve acceptance on either platform; `Mod+K` alone would narrow behavior. Explicit shifted letter bindings preserve Shift+N/J/K/E. The library accepts physical-position fallback for some logical shortcuts, so each callback also verifies actual `event.key` identity. Explicit application modifier checks retain the strict Ctrl/Alt/Meta rules even when library AltGr normalization differs. N/slash/E still reject `event.repeat`, while J/K and search retain repetition; `requireReset` does not reproduce the first-observed-repeat rule. [Published matcher](https://unpkg.com/@tanstack/hotkeys@0.17.0/dist/_match.js), [React hook](https://unpkg.com/@tanstack/react-hotkeys@0.16.0/dist/useHotkeys.js).

These are compatibility adapters around two library entry points, not removal of the hard product policy. The handwritten descriptor `matches` functions and letter factory disappear, but binding lists, literal identities, library calls and defensive callback policy replace them. The React Compiler also required stable registry/handoff refs in the existing registration callback's dependencies after passing callbacks through the library hook; focused lint passes with that adjustment.

## Owned production code

Counts include every compatibility helper added by the prototype. `shortcuts.ts` and `ShortcutsProvider.tsx` are the only changed production modules; preference and table-focus modules are included unchanged to make the retained boundary visible. Existing unmodified hint/search callers have zero delta. Tests, measurement tooling, dependency code and documentation are excluded from production-source totals and reported separately by purpose; dependency cost belongs in the build comparison below.

| Module                  | Physical lines before → after | Nonblank/noncomment before → after |
| ----------------------- | ----------------------------- | ---------------------------------- |
| `shortcuts.ts`          | 282 → 304                     | 196 → 214                          |
| `ShortcutsProvider.tsx` | 174 → 198                     | 131 → 152                          |
| `shortcut-setting.ts`   | 80 → 80                       | 57 → 57                            |
| `expense-table-keys.ts` | 58 → 58                       | 42 → 42                            |
| **Total**               | **594 → 640 (+46)**           | **426 → 465 (+39)**                |

Reproduce with `pnpm web measure:hotkeys-prototype`. Its rule is intentionally simple and auditable: remove block comments, discard blank lines and lines whose first non-space characters are `//`, then count remaining lines. Physical counts include comments and blanks. It is a lexical count, not an AST measure; no claim of changed runtime complexity is inferred from a line count alone. The final formatted source is measured against the exact baseline above.

## Verification and limits

The focused proof command passes **66 tests in four files**: 54 existing shortcut/hint/search tests and 12 added integration cases. Web type checking and focused ESLint pass. The added fixture mounts the real provider and real published `useHotkeys` via React's test renderer, then dispatches real Node `EventTarget` events. It does not mock the library. Minimal element/document stubs support policy checks; this is not proof of browser event ordering, native focus/scroll, server-to-client hydration, storage events, or navigation.

The twelve integration cases prove:

- Already-prevented page events do not invoke the action; blocked/unhandled events retain defaults and propagation.
- Shift+/ dispatches once, shifted letters work, and unrelated characters/Dead keys at the same physical position do not trigger.
- Both Control+K and Meta+K work with strict modifiers, and held search retains repeat behavior.
- Composition, editable ARIA widgets, overlays and ordinary fields suppress their existing actions; search's own field keeps its exception.
- A first observed repeated N does not add an Expense.
- Latest real registration wins; removal restores the prior real handler.
- Handoff fires once before expiry, ignores fallback registration and does not fire at the expiry boundary.
- Member preference disables single keys while search stays available, then enabling it activates N.
- Strict Mode mount/unmount/remount leaves no duplicate or leaked registrations.

Existing tests additionally cover semantic metadata/hints, unknown preference on the server, allowed non-text inputs, settings failure behavior and row stepping. The added priority test does not exercise fallback restoration after the last real handler disappears; browser/remaining tests must not be credited for a case they do not execute. The browser runs below cover real Group navigation, portal/menu/dialog behavior and Expense focus/scroll.

### Build and browser evidence

Both the baseline and the final candidate built successfully with the same demo-auth configuration, Next.js webpack production build, persistent-Draft flags and isolated replica-set backend. The measurement collects the unique client-manifest JavaScript chunks for each named route plus the build's `rootMainFiles`, gzipping each file at level 9 and summing their compressed lengths:

| Measured JavaScript set              | Baseline gzip bytes | Candidate gzip bytes | Delta   |
| ------------------------------------ | ------------------- | -------------------- | ------- |
| Groups route chunk union             | 394,212             | 405,163              | +10,951 |
| Expenses route chunk union           | 454,379             | 465,339              | +10,960 |
| All emitted static/chunks JavaScript | 897,444             | 907,043              | +9,599  |

The build emits two additional JavaScript files. Each row is its own union: do not add the route rows together. These are sums of individually compressed emitted files, **not** measured network transfer bytes or an initial-load metric. Chunk splitting and cross-route sharing explain why the route delta differs from the entire static-JavaScript delta. Reproduction requires the same baseline, source, lockfile, Node/Next toolchain and environment; build each tree with `pnpm web build`, collect unique `.js` entries from the route client-reference manifest plus `.next/build-manifest.json`'s `rootMainFiles`, then apply `gzipSync(bytes, { level: 9 })` per unique file and sum lengths. The all-chunks row instead walks every `.js` under `.next/static/chunks`.

The captured helper is `apps/web/scripts/hotkeys-prototype-bundle.mjs`: run `pnpm web measure:hotkeys-bundle` after the production build. It defaults to its own workspace and accepts an optional workspace-root argument, so the same helper can inspect the built baseline without modifying that tree. It decodes manifest chunk paths with `decodeURIComponent` before reading files.

The existing `shortcuts.spec.ts` and `search.spec.ts` browser journeys passed on both production builds, with fresh fictional demo seeds: **34 passed, 10 intentionally skipped on each build**, across desktop/mobile light/dark projects. Intentional skips reflect desktop-table versus phone-layout coverage. These runs prove the exercised table focus/scroll/native Enter, N/slash navigation handoff, typing guards, member settings/hints and search dialog/navigation paths. They do not prove every missing edge case identified above, such as last-real-handler fallback restoration, delayed failed mounts, cross-tab storage races or every keyboard layout. Production compilation and tested browser parity succeed; the significant maintenance-gain gate still fails.

## Verdict and rollback

**Do not migrate this adapter to main.** The adapter adds 39 owned nonblank/noncomment production lines, four resolved library packages, and a second API boundary for matching while retaining the difficult registration and navigation policies. No current feature demand justifies the library's broader scope. A package adoption that preserves behavior but adds maintenance does not satisfy the owner's condition.

Keep this throwaway branch as primary evidence. Rollback is simply to leave main on the existing implementation; if evaluating the branch locally, restore the two production modules and remove the candidate dependency and prototype-only commands/fixture/tooling. All existing public hook calls, storage and navigation contracts are unchanged. Revisit only if an actual product requirement removes substantial application responsibilities or a later library API directly supports the missing policy boundaries; do not expand product scope to make the adoption look useful.
