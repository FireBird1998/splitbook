# Android widgets: force-stop platform check (#1009)

The single-tap acceptance criterion remains **FAIL** after an explicit force-stop on Android 16. Android replaces the widget with its own stopped-package mask before Splitbook receives a click. This is a platform limitation; the owner decides whether that acceptance criterion blocks enabling widgets. No app behavior was changed.

## Build and device

- App source: `ae1dd7f2422dd015d8d00231e8173cd22fc00964`, R8 release, arm64, package `com.splitbook.app.dev`.
- Flags: `EXPO_PUBLIC_APP_ENV=development`, `EXPO_PUBLIC_ANDROID_WIDGETS_ENABLED=true`, `EXPO_PUBLIC_PERSISTENT_DRAFTS_ENABLED=true`. API and auth origin point to the worker's own loopback demo backend.
- APK SHA-256: `2edf9f681c41ada35ed547ce0eeca25c0f38fc152685449be5749c64ea254aba`.
- Device: emulator-5572, Android 16 / API 36, build `BE2A.250530.026.F3`, font scale 1.0, light mode.
- Data: fictional demo personas and saved widget copies produced by real reads in a local debug build. The release retains #1013's demo-account configuration restriction; its screen says “Build setup needed.” No staging or production service was used.

## Device observations

For each kind: return to the launcher, force-stop the package, capture the mask, tap once, wait ten seconds, inspect the resumed activity and stopped flag, then tap again. Use the Group header to avoid a payment-line action.

| Widget      | First tap after force-stop                             | Second tap         | Verified MainActivity intent data                               | Screenshot prefix      |
| ----------- | ------------------------------------------------------ | ------------------ | --------------------------------------------------------------- | ---------------------- |
| Balances    | FAIL: launcher remains foreground; stopped flag clears | MainActivity opens | `splitbook-dev://widget/home`                                   | `ForceStop-Balances`   |
| Group       | FAIL: launcher remains foreground; stopped flag clears | MainActivity opens | `splitbook-dev://widget/group/a00000000000000000000020/group`   | `ForceStop-Group`      |
| Add expense | FAIL: launcher remains foreground; stopped flag clears | MainActivity opens | `splitbook-dev://widget/group/a00000000000000000000020/expense` | `ForceStop-Addexpense` |

Each prefix has `-masked-actual.png`, `-first-tap-actual.png` and `-second-tap-actual.png`. External evidence also includes `force-stop-results.json` (resumed activities, package state and full intent data) and `platform-evidence.json`. These prove activity launch and the requested route; signed-in destination rendering remains outside release coverage because of #1013.

## Root cause and decision

[Android's stopped-state documentation](https://developer.android.com/about/versions/15/behavior-changes-all#stopped-state) explains that Android 15 and later cancel all app PendingIntents and temporarily disable widgets after force-stop.

The [Android 16 implementation of `maskWidgetsViewsLocked`](https://android.googlesource.com/platform/frameworks/base/+/99b01a65cc4c104933788b3143285ab6bae65827/services/appwidget/java/com/android/server/appwidget/AppWidgetServiceImpl.java#953) replaces the app's RemoteViews with a system mask. Its stopped-package click sends an `APPWIDGET_UPDATE` broadcast, without the original destination. That explains the observed unstop/redraw without MainActivity opening. The app's own click handler is not called on that first tap.

Splitbook's generated widget provider already opens `OPEN_URI` natively through `context.startActivity`, before the JS click task. Changing its original PendingIntent from broadcast to activity cannot preserve it across force-stop or bypass Android's replacement view. Per the handoff, implementation stops here for an owner decision.

## Validation

Mobile: 4,098 tests passed. Shared: 2,075 passed. Workspace typecheck, lint and format passed; lint reports five existing web warnings. No ceilings changed. No red-first behavior commit applies because this branch adds only this platform-check record.
