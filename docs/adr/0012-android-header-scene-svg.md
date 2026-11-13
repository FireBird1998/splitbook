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
