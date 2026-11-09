# Widget font changes after process death (#1012)

The fix uses an event-driven Android content job to redraw the saved widget copy after a font-scale change, including when the app process has died. No periodic refresh, polling, network read, or foreground activity is added.

## Findings

- `react-native-android-widget` 0.26.0 creates TextViews using SP by default, but draws the whole widget to PNGs and hands the launcher ImageView URIs. Those bitmaps contain the text size chosen during rendering. Giving the existing launcher view another SP value cannot resize those pixels or apply #991's line-dropping rules; that would require changing the renderer.
- [Configuration broadcasts](https://developer.android.com/reference/android/content/Intent#ACTION_CONFIGURATION_CHANGED) reach dynamically registered receivers, not manifest receivers. The patched React module's component callback also needs its React context alive. The launcher can restart the image provider after a font change without initializing that context; the cached bitmaps remain stale.
- [Locale broadcasts](https://developer.android.com/reference/android/content/Intent#ACTION_LOCALE_CHANGED) concern an actual locale change. They do not provide a font-scale notification. AppWidget update/options callbacks cover widget lifecycle and host options; a font change cannot rely on a launcher delivering one. The Android 16 negative control reproduced this absence of a redraw.
- [Content URI jobs](<https://developer.android.com/reference/android/app/job/JobInfo.Builder#addTriggerContentUri(android.app.job.JobInfo.TriggerContentUri)>) are available from API 24, the app's minimum SDK. The system observes `Settings.System.getUriFor(Settings.System.FONT_SCALE)` independently of the app process. This supplies the missing wakeup without a manifest configuration receiver.

## Implementation

The Expo plugin generates `.widget.FontScaleJob`, protected by `BIND_JOB_SERVICE` and enabled only in widgets-on builds. The three widget providers share a lifecycle hook that keeps one font watch while widgets are placed and cancels it when none remain. A content job is one-shot, so it re-arms before requesting the existing headless saved-copy renderer for each placed kind.

The existing live-process callback, bitmap renderer, TalkBack target structure and framework-free large-text layouts remain unchanged. Widget provider `updatePeriodMillis` remains zero. JobScheduler controls delivery under background power and quota policies; this is not a periodic timer or an exact alarm. Explicit force-stop remains Android's separate stopped-package case (#1009).

## Device check

Device: emulator-5572, Android 16 / API 36, arm64. Widgets-on R8 release, development package, configured only for a loopback backend. The debug build prepared the fictional demo saved copies. The release font checks ran with Metro and the real backend stopped. An HTTP trap at the configured API origin recorded zero requests.

Each process death was a normal kill after backgrounding, with an empty PID check before the font change and the package's stopped flag still false. No job was force-run.

| Check                                                                      | Actual                                                                                                                                                       | Result |
| -------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------ |
| Negative control: cancel only the content watch, kill, change 100% to 200% | All six light/dark widget bitmaps retain their old hashes after eight seconds. Only the image provider restarts.                                             | PASS   |
| Arm the watch, kill again, change 100% to 200%                             | Group, Balances and Add expense automatically receive new light/dark bitmaps in 1.25 seconds. The launcher remains foreground.                               | PASS   |
| Keep #991 layouts and TalkBack structure                                   | The Group drops payment lines at 200%; all three use the existing large-text drawing path. The renderer and single-target accessibility patch are unchanged. | PASS   |
| Data-only redraw                                                           | Saved copy, session, setup and verification times remain identical; HTTP trap stays empty.                                                                   | PASS   |
| Kill again, change 200% back to 100%                                       | The re-armed watch redraws all three in 1.24 seconds, reproducing the original bitmap hashes.                                                                | PASS   |

External evidence includes `control-results.json`, `positive-results.json`, `restore-results.json`, `font-process-events.log`, the font-job records and `evidence.json`. Before/after captures are named `Font-Group-before-100-actual.png` / `Font-Group-after-200-actual.png`, with corresponding `Balances` and `Addexpense` pairs. Screenshots and logs are not committed.

API 24 availability is checked against the platform API contract; device behavior was tested on Android 16. This record does not claim an API 24 device run.
