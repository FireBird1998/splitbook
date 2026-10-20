# TanStack Form and Store ownership on Android

Research for [Research: TanStack Form and Store ownership on Android](https://github.com/FireBird1998/splitbook/issues/703), part of [Wayfinder: TanStack adoption alongside Next.js, with Android first](https://github.com/FireBird1998/splitbook/issues/702). Checked 2026-10-21. Repository baseline: `ef4f1b9cd3e1db7cd0807c1281983c2947dc5b95`. This answers the research question; it does not select adoption or amend an ADR. No candidate packages were installed and no native build or runtime was exercised.

## Answer

Published Form v1 can plausibly replace field metadata and validation scheduling. Store can replace the controller's notification container. Neither removes money validation, durable Draft recovery, immutable save attempts, or controller commands. The maintenance benefit is therefore conditional: a prototype must delete existing ownership rather than synchronize two writable copies. React Native has explicit Form documentation, but compatibility with this exact Expo/React Native/Hermes build remains unproven. Store's React adapter declares a React DOM peer, requiring a package-resolution check even though its selector source has no React DOM import.

The most informative bounded experiment would put one Group-creation form behind the existing controller interface, using a controller-owned FormApi, and separately measure whether replacing the snapshot container with Store removes enough code to justify another abstraction. These are prototype questions, not adoption decisions.

## Published releases and channels

The following are npm registry dist-tags and version manifests, fetched directly on the checked date. A `latest` tag means the normal published channel; it does not turn Store's pre-1.0 API into a compatibility promise.

| Package                 | Normal published channel       | Prerelease tags                                   | Relevant dependencies / peers                                                                        |
| ----------------------- | ------------------------------ | ------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| `@tanstack/form-core`   | `1.33.5`, published 2026-08-11 | `alpha: 2.0.0-alpha.2`, 2026-08-21; no beta tag   | Store `^0.11.0`, pacer-lite `^0.1.1`, devtools-event-client `^0.4.1`                                 |
| `@tanstack/react-form`  | `1.33.5`, 2026-08-11           | `alpha: 2.0.0-alpha.2`, 2026-08-21; no beta tag   | form-core exactly `1.33.5`, react-store `^0.11.0`; React peer includes 17/18/19                      |
| `@tanstack/store`       | `0.11.2`, 2026-09-29           | `beta: 0.0.1-beta.174`, 2023-08-30; no alpha tag  | No runtime dependencies in this manifest                                                             |
| `@tanstack/react-store` | `0.11.2`, 2026-09-29           | `alpha: 1.0.0-alpha.0`, 2026-10-10; beta as above | store exactly `0.11.2`, external-store `^1.6.0`; React **and React DOM** peers include 16.8/17/18/19 |

Sources: [form-core registry](https://registry.npmjs.org/@tanstack/form-core), [react-form registry](https://registry.npmjs.org/@tanstack/react-form), [store registry](https://registry.npmjs.org/@tanstack/store), [react-store registry](https://registry.npmjs.org/@tanstack/react-store). Historical beta tags are not newer candidates than `latest`.

The alpha Form packages have a different export layout and dependencies; alpha form-core uses Store `^0.11.1` and pacer-lite `^0.2.2`, without the stable manifest's devtools-event-client dependency. React Store alpha removes its direct external-store dependency but still declares React DOM. These differences are not a reason to mix channels. Any future experiment should pin exact versions and inspect the resulting lockfile. This note evaluates stable Form 1.33.5 and Store 0.11.2, not `/alpha` documentation.

## Native evidence and its limits

The official [Form React Native guide](https://tanstack.com/form/latest/docs/framework/react/guides/react-native) describes native use and wires TextInput values and `onChangeText` to fields. That is stronger evidence than a browser example, but supplies no certification matrix for Expo 57, React Native 0.86.3 or Hermes. Those are the repository's [current package versions](https://github.com/FireBird1998/splitbook/blob/ef4f1b9cd3e1db7cd0807c1281983c2947dc5b95/apps/mobile/package.json); React is 19.2.3 and TypeScript is approximately 5.9.3.

Published archives were read in memory, without installing or executing them: [react-form 1.33.5](https://registry.npmjs.org/@tanstack/react-form/-/react-form-1.33.5.tgz), [form-core 1.33.5](https://registry.npmjs.org/@tanstack/form-core/-/form-core-1.33.5.tgz), [react-store 0.11.2](https://registry.npmjs.org/@tanstack/react-store/-/react-store-0.11.2.tgz), [store 0.11.2](https://registry.npmjs.org/@tanstack/store/-/store-0.11.2.tgz). Their source shows:

- React Store's `useSelector` uses React callbacks and `use-sync-external-store/shim/with-selector`; its default comparison is `===`, with an explicit comparison option. Sources expose `get()` and `subscribe()` returning an object with `unsubscribe`. Splitbook currently returns the unsubscribe function directly, so retaining its interface needs an adapter.
- Store supports framework-independent construction, functional `setState`, and subscriptions. This can sit under controller commands without exporting mutable stores to screens.
- React Form creates a FormApi instance in its hook, and subscribes through React Store. Its isomorphic layout-effect helper checks `typeof window`; the stable core also constructs a devtools EventClient. These observations identify Metro/Hermes and development/production checks; they do not establish that the complete transitive import graph is browser-free.

No official Expo/Hermes version-specific guarantee was established by these sources. The React DOM peer should be tested with the actual pnpm workspace and Metro resolution; it is not proof the runtime needs a DOM, nor permission to add React DOM to Android without investigation. Native ref/focus, keyboard avoidance, accessibility announcements and component lifecycle remain app responsibilities. The official [focus guide](https://tanstack.com/form/latest/docs/framework/react/guides/focus-management) uses browser-oriented examples; native behavior must be verified separately.

## Current ownership, compared with ADR 0006

[ADR 0006](../adr/0006-android-client-architecture.md) deliberately retains controller-owned forms/client state and rejects a second store. Its Evidence section describes an older commit; it is not today's inventory. At this baseline Android already installs query-core 5.104.1 and uses headless Query modules for display reads. Query adoption is not part of this experiment.

[The controller](https://github.com/FireBird1998/splitbook/blob/ef4f1b9cd3e1db7cd0807c1281983c2947dc5b95/apps/mobile/src/data/mobile-controller.ts) owns commands, route, snapshot publication, listeners, account generation and asynchronous recovery. `use-mobile-snapshot.ts` wraps `useSyncExternalStoreWithSelector`; it already offers selection and custom equality. Store therefore does not introduce selective subscriptions that the app currently lacks.

`field-feedback.ts` implements generic submitted/touched/errors/focus metadata, touch/rejection helpers, error visibility and correction summaries. It also contains product-specific numeric-text, exact-money and calendar-date helpers. `expense-draft.ts` repeats Expense-specific metadata and adds member/Tag/currency-aware validation, allocation preview, payload construction and recovery decoding. Controller functions revalidate, touch and reject forms. `flow-transitions.ts` declares test-enforced transitions; it is not a form-state engine.

`review-form.ts` maps incomplete shared Draft values into picker fields and maps changes back without inventing omitted facts. This mapping is domain behavior, not redundant metadata. Native `expense-form.tsx`, `expense-editor.tsx`, `group-workflows.tsx` and `record-payment-sheet.tsx` supply the UI and focus mechanics. These findings are source inventory, not claims that entire modules can disappear.

## What could disappear, and what must remain

| Candidate replacement         | Concrete removal target                                                                                                                                   | Retained contract / adapter                                                                                                                   |
| ----------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| Form metadata for one form    | That form's touched/submitted/error container and controller touch/revalidation bookkeeping; Group creation calls generic `touchField` and `rejectFields` | Exact messages, error order, submit-time first-error focus request, native blur/change wiring; generic helpers stay until all callers migrate |
| Form metadata across forms    | Duplicate `ExpenseValidation` / `emptyExpenseValidation`, `visibleExpenseErrors`, and generic metadata helpers after all consumers move                   | `validateExpenseDraft`, money/calendar/Tag/member checks, correction summaries and accessibility behavior                                     |
| Store beneath snapshot        | Listener Set/add/remove/notify implementation; potentially its selector wrapper                                                                           | Controller `getSnapshot`/`subscribe` facade, stable snapshot identity, equality semantics, route ownership, cancellation and account cleanup  |
| Direct selectors over FormApi | Repeated projection glue only if fields subscribe to the authoritative controller-held form                                                               | No editable snapshot mirror; controller snapshot must project the same values for existing callers/tests                                      |

All deletion targets are hypotheses, not measured savings. `review-form.ts`, persisted schemas, recovery parsers, allocation/payload builders and `flow-transitions.ts` have no demonstrated wholesale replacement. New adapters count against removed code. A Store wrapper alone would replace a very small container while leaving the difficult controller logic intact.

The [validation guide](https://tanstack.com/form/latest/docs/framework/react/guides/validation) allows function and Standard Schema validators, field/form validation, and scheduling by change/blur/submit. Zod can integrate directly through Standard Schema. It explicitly warns that validation does not yield transformed output. Existing money parsing and payload construction must therefore remain explicit: entered decimal strings, incomplete Draft values and final ledger payloads are distinct representations. Replacing product messages with default Zod issue strings would change behavior.

The [reactivity guide](https://tanstack.com/form/latest/docs/framework/react/guides/reactivity) requires subscriptions for reactive reads. Reading `.state` alone is not a React subscription. Selector outputs and equality must retain the existing render ceilings.

## Ownership alternatives

1. **Controller-owned FormApi:** commands update one headless form; snapshot projects its values/metadata; screens keep the public interface. This best preserves the current seam but requires subscription/lifetime cleanup and projection adapters. Avoid projecting back into the FormApi on every publication.
2. **Screen-owned Form:** move authoritative editable input to React Form and supply values to commands. This changes controller ownership and the tests that drive it; Draft restoration, navigation and asynchronous persistence need an explicit handoff. Keeping the old editable Draft in parallel would create two owners.
3. **Store under controller:** replace the snapshot container only, retaining controller-only writes and Query as server-read owner. Export read-only access. It does not justify a second independent screen store.
4. **Retain current ownership:** a valid result if adapters erase the expected maintenance reduction. Form may already bring Store transitively; that is not a reason to migrate unrelated client state.

Any selected alternative reopens ADR 0006 explicitly. [ADR 0004](../adr/0004-expo-mobile-client.md) still requires restart recovery and immutable retry identity; [ADR 0008](../adr/0008-persistent-assistant-expense-drafts.md) distinguishes server Draft review from device recovery. Forms must not become financial mutations, auto-save queues or reconnect replay engines. Shared domain code remains framework-free.

## Small prototype and proof gates

Question: can a controller-owned FormApi replace Group creation's field metadata while preserving `updateCreation`, blur, validation, snapshot and explicit create behavior, with net production-code reduction after adapters? Run a separate Store-container comparison rather than bundling both ownership changes into the first result.

Before accepting a prototype:

- Pin stable versions; demonstrate pnpm/Metro development and production bundling, React DOM peer handling, TypeScript compatibility and Hermes startup on an approved device. Measure bundle delta; do not infer it from npm archive size.
- Preserve validation strings/timing, rejected numeric text, first invalid field focus, repeated rejected submissions, keyboard behavior, enlarged text and screen-reader announcements.
- Drive commands without mounting screens. Verify navigation away/back, restart, same-account reauthentication, late async responses, sign-out/account change and subscription disposal. Show one authoritative value at every point.
- Reuse `form-corrections-controller.test.ts`, `field-feedback.test.ts`, `expense-controller.test.ts`, `settlement-controller.test.ts`, `review-form.test.ts`, form UI tests and flow monitoring. Add only cases that expose adapter-specific ownership/lifecycle failures.
- Preserve attempt storage before send, unchanged retry key/body/revision, explicit online submission, no reconnect replay and separate editable Draft/attempt state. No TanStack Query mutations or stock persisters.
- Compare deleted/added production code and existing render/request ceilings. Roll back if ownership duplicates, recovery weakens, native compatibility fails, ceilings rise without approval, or adapter code cancels the benefit.

Rollback should restore the original form/container behind the unchanged controller interface. Keep disk schemas and immutable attempt formats unchanged in the experiment so rollback needs no data migration. No runtime or code-reduction gate was executed by this research.
