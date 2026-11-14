---
status: accepted
date: 2026-11-14
---

# Draw Android Header scenes with react-native-svg

The Group screen draws the generated portable layers with `react-native-svg` 15.16.0,
Expo SDK 58's bundled version. This is the owner's dependency choice (#1200, #1206).
The Expo SDK 58 SVG reference and local `expo/bundledNativeModules.json` agree on
15.16.0. Expo's default Hermes runtime is retained; no WebView or XML parser is added.

The library's Android consumer ProGuard rules retain `com.horcrux.svg` classes.
A release APK must still be built and opened with a scene under R8 before this
change is accepted; a debug build alone does not verify shrinking.

Only a Scene header behind `EXPO_PUBLIC_HEADER_SCENES_ENABLED` evaluates the native
renderer; only the chosen art module is evaluated. Classic, Home and widgets keep
their existing rendering. Generated data is never copied or edited.

The vector tree is memoized. A native-driver floating transform moves the rendered
scene without React renders per frame. The existing reduce-motion watcher wins
over the device Motion preference. Detailed per-vector animation and tilt are
separate from this initial rendering adapter. Device frame measurements and the
release run are recorded in the QA handoff report.

## Android performance fallback

The main Mac's spare release emulator exceeded the scene-on scrolling budget
(UI p90 117–167 ms with the native float). Rasterizing the native SVG did not
bring it within budget. Header scenes therefore render still on Android under
#1200's explicit fallback; `headerSceneMotionAvailable` is false. The device
Motion preference is retained for a renderer that meets the budget. Remove
animations still takes precedence through the existing motion helper. The
measurements and comparison are in the A1 QA handoff report.
