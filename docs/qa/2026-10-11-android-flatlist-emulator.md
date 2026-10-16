# Android FlatList emulator verification (#179)

Verification record for [#179](https://github.com/FireBird1998/splitbook/issues/179) and the existing list/return contract [#215](https://github.com/FireBird1998/splitbook/issues/215). The owner authorized preparing and comparing this implementation on a 4 GB emulator because a low-end physical phone is unavailable. Application source, automated gate and native correctness are verified at `ce8d92281267815d782d1216bb1147dcaf1c8e41`. The emulator timing results below include the misses and do not complete the physical-phone requirements in [#194](https://github.com/FireBird1998/splitbook/issues/194) or [#226](https://github.com/FireBird1998/splitbook/issues/226). No GitHub mutation, staging deployment or merge is authorized by this record.

## Implementation

Expenses and Activity now use one flattened React Native `FlatList` per ledger. Day headings and record rows have stable keys; summary, notices, loading/error states, pager and card appearance remain in the same scroll container. Balances retains its `ScrollView`. No nested virtualized list or new list library is introduced.

The list mounts eight initial cells, uses five viewports, and batches up to eight cells every 32 ms. Clipped-subview removal is disabled to preserve Android focus and large-text rows. FlatList receives every native scroll position with `scrollEventThrottle={16}`; Balances and the other existing ScrollViews retain 100 ms. In the installed React Native 0.86.3 Android implementation, a throttle of at least 17 ms can discard the sole scroll event from a closely spaced nonanimated seek. Native trace and a public callback regression confirmed that failure before the override.

Return and five-page slide positions are aligned against actual native viewport measurements. Average/index coordinates provide navigation intent only and cannot complete a return. Native content/layout progress advances an unmounted seek without polling. Native clamps establish the deduplication baseline after feedback, while duplicate commands before feedback are suppressed. Drag, Month unmount and superseding requests cancel obsolete work. Completed returns relinquish correction after native focus movement, in either order with a late layout, and stale asynchronous measurement replies cannot revive them. Each asynchronous alignment read captures the existing sample/revision/y/viewport/header basis. Obsolete same-owner coordinates cannot complete or replay against newer native geometry; one coalesced fresh read continues only while its owner is active. A late real geometry change before member navigation still preserves the restored row.

The controller retains command and snapshot ownership, and TanStack Query retains display-read ownership. Explicit loading, refresh, Load older/newer and financial writes keep their existing behavior. There are no optimistic ledger writes, automatic pagination or additional automatic financial retries. Existing render/request ceilings are unchanged.

## Source and diagnostic build identity

| Item                         | Identity                                                                                                        |
| ---------------------------- | --------------------------------------------------------------------------------------------------------------- |
| Baseline source              | `9788b240a772fb7e9c7cbfe45250226efd47198d`                                                                      |
| Tested application source    | `ce8d92281267815d782d1216bb1147dcaf1c8e41`                                                                      |
| Baseline APK SHA-256         | `348fce1f4d75992de01962fc16662481031b4e44f7ebf4517fd796845bd5611c`                                              |
| Candidate APK SHA-256        | `fe2236578cd643da3cae6318cd965ef32329867f05c3dc6aa5cb156766591bdb`                                              |
| Native / JavaScript mode     | Native Release / bundled production JavaScript, diagnostic builds                                               |
| Application ID               | `com.splitbook.app.dev`                                                                                         |
| Tracked archive verification | All tracked files hashed against their source Git blobs before and after build; one documented harness override |
| Runtime logging              | Final candidate has no diagnostic trace instrumentation                                                         |

Both frozen archives have the same harness-only override in `apps/mobile/src/runtime.ts`: the development-configuration guard's `__DEV__` argument is replaced by `true` so production JavaScript can use the fictional local demo backend. The tracked guard is unchanged. The runtime file's original SHA-256 is `f7e7403fbc63429ef48fd0735019112cae24eace36407379cad354333b1aea5c`; its identical diagnostic SHA-256 is `136767253f83e90be012bda4d0927552bc3bebf3f5432d1451b8d6c80383253e` in both builds.

The diagnostics use `EXPO_PUBLIC_APP_ENV=development`, loopback API/auth/invitation origins on port 4185, `EXPO_NO_DOTENV=1`, and an arm64-v8a native Release build. Personal Google credentials and staging signing inputs are not supplied. These APKs are development-package diagnostics, never an unchanged signed staging release or a distribution artifact. Intermediate trace-only builds helped diagnose failures; their logs and builds are excluded from final performance/distribution evidence.

## Environment and workload

- Emulator: `emulator-5554`, `Medium_Phone_API_36.1`, Android API 36.
- RAM: `MemTotal` 4,010,748 kB, approximately 4 GB; four virtual CPU cores. This is an emulator configuration, not a physical low-end-phone model.
- Display: 1080 × 2400 px, density 420; recorded initial font scale 1.0 and night mode off.
- Backend: isolated local fictional MongoDB/app environment, with 20 Groups and 120 varied Expenses dated within September. The corresponding 120 expense-added Activities were created on October 11; Activity is not a September-dated timeline. The comparison loads 100 records, then an explicit sixth page exercises the five-page sliding window.
- Baseline and candidate use the same fixture, scroll protocol and native build mode. Native normal/200% return checks and 130%/200% Dark and 200% Light layout checks passed. Device settings and the original dev APK were restored afterwards.
- Performance samples must retain whole-run native `gfxinfo`, PSS/memory and host-load evidence. A raw framestats ring buffer holds only the last 120 frames and is a secondary diagnostic, not the whole-run result.

## Automated verification

| Check                           | Verified result at tested source                                                                                                                                              |
| ------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Full workspace gate             | 16/16 steps passed                                                                                                                                                            |
| Workspace unit tests            | 4,617 passed: shared 1,484; swarm 122; mobile 2,130; web 881                                                                                                                  |
| Authenticated HTTP verifiers    | All nine passed: API, Groups, Settings, financial, Expenses, Expense edit, Settlements, Activity and offline                                                                  |
| Typecheck, lint, formatting     | Passed in the full gate                                                                                                                                                       |
| Render/request ceilings         | No ceiling rose; no journey removed or renamed                                                                                                                                |
| Focused rendered-App/list suite | 160 passed in five files, including 37 native-ref cases and all 16 existing render/request ceiling cases                                                                      |
| Real MongoDB integration        | 433 passed in 39 files on frozen `83613fd2`; reused after proving `apps/web`, `packages/shared`, root `package.json` and `pnpm-lock.yaml` unchanged through the tested source |
| Independent cumulative reviews  | Standards: zero findings; Spec: zero findings                                                                                                                                 |

Tests use the public controller, rendered App/list callbacks, pure scroll targets and native-ref scroll/measurement seam. The React Native stand-in is not real virtualization and cannot establish native performance. Red/green and mutation evidence covers premature guessed completion, coordinate coherence, delayed page arrival, consecutive slides, numeric fallback retirement, bounded index progression, native viewport clamps, dropped native scroll feedback and completed-owner retirement in both callback orders. Assertions, expected positions and ceiling budgets were preserved.

## Native journeys

Native return/slide success requires the retained row to stay within 5 px of its original position, with another 3-second settled capture to reject late movement. Mere visibility is insufficient. The final uninstrumented full sequence passes; the old Activity sixth-page failure and trace/probe evidence remain preserved.

| Journey on final uninstrumented candidate                           | Result                                                                                                                                                                                   |
| ------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Expense 071, page-three record → Back, normal text                  | −1 px; late jump 0 px                                                                                                                                                                    |
| Activity Expense 071, page-three record → Back, normal text         | −1 px; late jump 0 px                                                                                                                                                                    |
| Expense 071 record → Back, 200% text                                | 0 px; late jump 0 px                                                                                                                                                                     |
| Activity Expense 071 record → Back, 200% text                       | 0 px; late jump 0 px; original partly visible row retained                                                                                                                               |
| Expense sixth-page window slide                                     | 0 px; late jump 0 px                                                                                                                                                                     |
| Activity sixth-page window slide                                    | −1 px; late jump 0 px                                                                                                                                                                    |
| Expense / Activity Load newer                                       | Both 0 px; both late jump 0 px                                                                                                                                                           |
| 130% Dark; 200% Light/Dark summary and Dark Activity                | Personally reviewed; all three ₹19,191.40 summary amounts and 120 Expenses readable; existing long-description ellipsis retained                                                         |
| UIAutomator accessibility semantics                                 | Record labels include full text/money; actual TalkBack speech is not tested                                                                                                              |
| Month/drag cancellation, refresh and retained Activity detail cover | Public controller/rendered tests only; no separate final native journey claim                                                                                                            |
| Current candidate PID error scan after measurements                 | See final scoped scan below; not a claim about every earlier PID                                                                                                                         |
| Device/runtime restoration                                          | Original dev APK reinstalled with matching certificate and data preserved; font 1.0/night off/IME/animation/display restored; only owned reverse removed; existing 4138 reverse retained |
| Backend cleanup                                                     | Only the two marked task databases removed and their servers stopped; all other database names and existing Mongo 27018 container/bindings verified unchanged                            |

## Final matched performance comparison

Baseline `9788b240a772fb7e9c7cbfe45250226efd47198d`; candidate application source `ce8d92281267815d782d1216bb1147dcaf1c8e41`. Three runs per ledger/protocol (24 whole-run measurements). Both cold application sessions followed Expenses then Activity on the same fictional database, font scale 1.0, saved Light appearance and system night mode off. Heavy builds/tests ended before measurement. All measured-end UI guards passed. No instrumentation, UI dump or recording ran during measured gestures.

The figures below use the whole-run Android gfxinfo counters and percentile histograms. The last-120-frame ring is retained only as a secondary diagnostic. PSS is process proportional memory, not JavaScript heap. The dumpsys Views counter counts View objects, including retained/detached instances and the rest of the app; it is not an exact mounted-row count. [Android 16 ActivityThread source](https://github.com/aosp-mirror/platform_frameworks_base/blob/android16-release/core/java/android/app/ActivityThread.java#L1598-L1665).

The issue proposes jank ≤5% and p90 ≤18.2 ms; these are proposed thresholds, not an owner-confirmed physical-phone budget. An emulator with 4 GB configured RAM does not model a low-end physical CPU/GPU, thermal behavior or real TalkBack.

| Build           | Ledger / gesture | Median jank (range) | p50 / p90 / p99 ms | p90 range ms | Jank / p90 threshold |
| --------------- | ---------------- | ------------------- | ------------------ | ------------ | -------------------- |
| baseline-final  | expenses / slow  | 9.54% (7.56–9.76)   | 25 / 36 / 53       | 36–36        | miss / miss          |
| baseline-final  | expenses / fling | 1.27% (1.26–1.89)   | 17 / 20 / 28       | 20–20        | pass / miss          |
| baseline-final  | activity / slow  | 8.36% (8.21–10.21)  | 25 / 36 / 53       | 34–36        | miss / miss          |
| baseline-final  | activity / fling | 2.29% (1.30–2.31)   | 17 / 20 / 31       | 18–23        | pass / miss          |
| candidate-final | expenses / slow  | 10.54% (7.26–11.99) | 26 / 38 / 57       | 36–40        | miss / miss          |
| candidate-final | expenses / fling | 1.86% (1.27–1.90)   | 17 / 19 / 23       | 19–22        | pass / miss          |
| candidate-final | activity / slow  | 10.81% (9.31–12.43) | 26 / 38 / 53       | 36–38        | miss / miss          |
| candidate-final | activity / fling | 1.57% (0.78–2.38)   | 17 / 20 / 22       | 19–20        | pass / miss          |

## Memory and View objects after gesture runs

| Build           | Ledger / gesture | Median PSS MiB (range) | Median native View objects (range) | Host one-minute load range |
| --------------- | ---------------- | ---------------------- | ---------------------------------- | -------------------------- |
| baseline-final  | expenses / slow  | 139.5 (128.0–147.6)    | 682 (682–685)                      | 3.16–7.64                  |
| baseline-final  | expenses / fling | 170.1 (162.5–177.8)    | 688 (688–688)                      | 5.43–6.82                  |
| baseline-final  | activity / slow  | 157.8 (156.6–162.0)    | 544 (542–545)                      | 4.11–5.36                  |
| baseline-final  | activity / fling | 164.3 (160.5–165.1)    | 544 (542–548)                      | 4.37–5.29                  |
| candidate-final | expenses / slow  | 154.1 (152.5–169.7)    | 372 (372–372)                      | 3.23–3.89                  |
| candidate-final | expenses / fling | 173.2 (163.1–178.4)    | 372 (372–372)                      | 4.08–5.02                  |
| candidate-final | activity / slow  | 163.6 (155.3–163.7)    | 331 (331–333)                      | 3.13–3.68                  |
| candidate-final | activity / fling | 156.9 (154.1–162.2)    | 336 (331–337)                      | 3.03–3.75                  |

## Single post-fifth-page memory snapshots

These are one post-load snapshot for each build/ledger, with 100 loaded records. They are not three page-load timing runs. Native and Dalvik heap size/allocated/free come from dumpsys meminfo; Android heap categories are not a separate Hermes JS-heap measurement.

| Build           | Ledger   | PSS MiB | Native heap size / allocated / free KiB | Dalvik heap size / allocated / free KiB | Native View objects |
| --------------- | -------- | ------- | --------------------------------------- | --------------------------------------- | ------------------- |
| baseline-final  | expenses | 114.1   | 60792 / 53431 / 3328                    | 17601 / 8801 / 8800                     | 686                 |
| baseline-final  | activity | 156.8   | 113272 / 56681 / 52539                  | 16920 / 8460 / 8460                     | 547                 |
| candidate-final | expenses | 130.6   | 71808 / 61687 / 6015                    | 16544 / 8272 / 8272                     | 620                 |
| candidate-final | activity | 153.1   | 126848 / 55206 / 67554                  | 15488 / 7744 / 7744                     | 473                 |

## All raw runs

| Build           | Ledger / gesture | Run | Jank % | p50 / p90 / p99 ms | PSS KiB | Native View objects | Host load |
| --------------- | ---------------- | --- | ------ | ------------------ | ------- | ------------------- | --------- |
| baseline-final  | expenses / slow  | 1   | 7.56   | 21 / 36 / 48       | 131091  | 682                 | 3.16      |
| baseline-final  | expenses / slow  | 2   | 9.54   | 27 / 36 / 53       | 142812  | 685                 | 3.79      |
| baseline-final  | expenses / slow  | 3   | 9.76   | 25 / 36 / 53       | 151134  | 682                 | 7.64      |
| baseline-final  | expenses / fling | 1   | 1.89   | 17 / 20 / 26       | 166438  | 688                 | 6.82      |
| baseline-final  | expenses / fling | 2   | 1.26   | 17 / 20 / 28       | 174178  | 688                 | 6.01      |
| baseline-final  | expenses / fling | 3   | 1.27   | 17 / 20 / 34       | 182058  | 688                 | 5.43      |
| baseline-final  | activity / slow  | 1   | 8.36   | 21 / 34 / 97       | 161606  | 545                 | 4.11      |
| baseline-final  | activity / slow  | 2   | 8.21   | 25 / 36 / 53       | 160406  | 544                 | 4.68      |
| baseline-final  | activity / slow  | 3   | 10.21  | 25 / 36 / 53       | 165870  | 542                 | 5.36      |
| baseline-final  | activity / fling | 1   | 1.30   | 17 / 18 / 32       | 168221  | 542                 | 5.29      |
| baseline-final  | activity / fling | 2   | 2.29   | 17 / 20 / 24       | 169093  | 544                 | 4.79      |
| baseline-final  | activity / fling | 3   | 2.31   | 20 / 23 / 31       | 164389  | 548                 | 4.37      |
| candidate-final | expenses / slow  | 1   | 11.99  | 26 / 40 / 61       | 156115  | 372                 | 3.23      |
| candidate-final | expenses / slow  | 2   | 7.26   | 22 / 36 / 57       | 173792  | 372                 | 3.44      |
| candidate-final | expenses / slow  | 3   | 10.54  | 27 / 38 / 53       | 157844  | 372                 | 3.89      |
| candidate-final | expenses / fling | 1   | 1.86   | 17 / 19 / 23       | 167035  | 372                 | 4.08      |
| candidate-final | expenses / fling | 2   | 1.27   | 17 / 19 / 21       | 177403  | 372                 | 5.02      |
| candidate-final | expenses / fling | 3   | 1.90   | 19 / 22 / 26       | 182723  | 372                 | 4.56      |
| candidate-final | activity / slow  | 1   | 12.43  | 26 / 38 / 53       | 167543  | 331                 | 3.48      |
| candidate-final | activity / slow  | 2   | 10.81  | 26 / 38 / 53       | 167655  | 333                 | 3.13      |
| candidate-final | activity / slow  | 3   | 9.31   | 25 / 36 / 48       | 159019  | 331                 | 3.68      |
| candidate-final | activity / fling | 1   | 0.78   | 17 / 20 / 22       | 166119  | 336                 | 3.75      |
| candidate-final | activity / fling | 2   | 1.57   | 17 / 19 / 22       | 160655  | 337                 | 3.49      |
| candidate-final | activity / fling | 3   | 2.38   | 17 / 20 / 22       | 157815  | 331                 | 3.03      |

## Verdict and limits

The comparison retains every final sample and the older failed/intermediate source evidence. Host load and run spread qualify timing differences; these measurements cannot establish a causal physical-phone speedup. The FlatList implementation bounds row mounting by its viewport window. Measured View object counts after scrolling fell 45.5–45.9% for Expenses and 38.2–39.2% for Activity. Slow-scroll median jank rose 9.54→10.54% and 8.36→10.81%, and p90 rose 36→38 ms in both. Fling p99 improved 28→23 ms and 31→22 ms; fling p90 was 20→19 ms and 20→20 ms. All candidate p90 medians miss 18.2 ms, while both fast-fling jank medians meet 5%. PSS is mixed: Expense slow/fling medians rise about 14.7/3.1 MiB; Activity slow rises about 5.8 MiB and fling falls about 7.4 MiB. These data do not establish an overall frame-time or memory improvement. Keep the candidate unmerged pending performance review/phone feedback. No FlashList dependency or version change is made. Any proposed-threshold miss is brought to the owner before considering that separate change.

This is the list-only emulator comparison. Full physical #194/#226 work remains: phone hardware/signing identity, typing Perfetto/React Profiler, repeated fifth-page-load timings and no-op Home refresh. Human TalkBack, Google account and signed staging phone QA remain separate.

Raw JSON/gfxinfo/memory files and session identities are retained in `.claude/orchestrator/drafts/QA/2026-10-11-flatlist-179/`, using baseline-final/candidate-final filenames. `FINAL-COMPARISON-PROTOCOL.md` records why the matched rerun was needed. Existing intermediate data is preserved, rather than replaced by the final result.

## Video and blank-row inspection

Application source `ce8d92281267815d782d1216bb1147dcaf1c8e41`, final uninstrumented native Release/production-Hermes diagnostic with the same fictional-backend guard override as the baseline.

Every genuine decoded candidate frame was personally inspected in six contact sheets, followed by the larger worst/spaced sheets: Expenses **159/159** and Activity **149/149**. Both begin on the intended ledger. **Zero visible blank-ledger frames** were observed. Header/card/row content remains present throughout each recorded fling; natural space after the pager is not classified as a missing row. Original 1080×2400 MP4s, hashes, frame metadata and all-frame manifests are retained. A supplementary pixel scan flagged no candidate frame; it is not the visual oracle.

Recordings ran separately after the numerical frame/memory measurements, using the same six 130 ms flings. Screen-recording frame rate is not app FPS, contact sheets cannot reveal subframe behavior, and one bounded capture per list does not prove no blanking on all phones or gestures. The unchanged baseline recording review remains VIDEO-BASELINE.md: 159 Expense frames and 152 Activity-ledger frames, with its initial Balances transition excluded. Those baseline recordings were captured in an earlier session, separate from the final matched numerical runs; no numerical causal inference is drawn from the videos.

Old e92 and earlier candidate video/raw evidence is preserved in the intermediate folders. The final results do not erase previously failing source/native cases. Physical low-end performance, actual TalkBack and signed staging phone QA remain outstanding.

## Evidence and remaining limits

Local evidence is retained in `.claude/orchestrator/drafts/QA/2026-10-11-flatlist-179/`: frozen source/build manifests, APK identity, final gate logs/counts, backend source identity, native XML/PNG/position verdicts, original failure/trace evidence, builder red/green/mutant logs and performance/video captures. These scratch artifacts are not substituted for a staging rollout or real-account verification.

- The owner authorized the emulator comparison because no phone with 4 GB RAM or less was available. #194/#226 remain open for the required physical measurements.
- Human TalkBack speech/focus behavior, physical-phone accessibility and real Google login are not established by callback regressions or UIAutomator.
- The final diagnostic uses a fictional backend and a documented development-configuration override. An unchanged signed staging APK still needs its own phone QA.
- Emulator scheduling and host load can affect frame-time comparisons. The result must describe the observed data and its uncertainty rather than promise identical performance on phones.
- The recorded emulator results qualify publication/merge decisions; specific owner approval is still required for GitHub publication and staging deployment. No historical or real-ledger deletion, staging deployment or GitHub mutation is part of this QA record.

## Scoped final error scan

Current final candidate PID after the matched scrolling/video workload: `11917`; app-PID error lines: 1 (one nonfatal Android ashmem startup deprecation also present in baseline PID 8848; application runtime errors: 0). Log evidence is restricted to this fictional diagnostic app and is not a whole-device or every-session verdict.
