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

## Phone tilt and the sensor dependency (#1208)

Use `expo-sensors` 58.0.4, within SDK 58's bundled `~58.0.4`, through its
Accelerometer API. The SDK's Expo module bridge works with the existing Hermes
runtime; local acceptance also requires an R8 release run. No custom keep rules,
background service, permission prompt or new data collection is introduced.

The package manifest includes `ACTIVITY_RECOGNITION` for its unused pedometer.
Block it and `HIGH_SAMPLING_RATE_SENSORS` in app config: tilt only samples the
accelerometer every 50 ms (at most 20 Hz), far below Android's 200 Hz permission boundary.
Expo 58.0.4 uses normal native sampling without that permission on Android 12+
(about 5 Hz on the spare emulator), then throttles forwarding to the requested
interval. On Android 7–11 it uses fastest native sampling; verify handset power
cost before enabling availability there. Verify the merged release manifest and
APK, rather than trusting the source config.
The app does not transmit or store sensor samples. Only the on/off choice is kept
in SecureStore (`splitbook.header-tilt`), outside account Saved copies and sign-out
clearing, like Motion and Appearance (ADR 0006). It defaults on.

A cancellable sensor lease loads the module only for an available, visible Group
scene, in the foreground, with Motion and Tilt on and Remove animations off.
Leaving any condition removes the listener and resets the transforms; a late
module/availability result cannot register after disposal. No polling, sensor
permission request or background listener remains. When supported, gravity relative
to the first sample controls bounded, eased native-driver translations (up to
5 dp horizontally and 3 dp vertically) at different layer depths. No React state
or vector path changes occur per sample. Sampling and animated work still cost
battery while visible, so a low rate and explicit unsubscription matter.

Tilt shares `headerSceneMotionAvailable` with the A1 motion fallback. It stays
false: A1's release scene scrolling missed the frame budget, and adding layer
transforms does not establish that budget. The setting and sensor wiring are
retained behind this flag; normal Android builds never load or register a sensor.
The A2 report distinguishes the shipping still release from a temporary inspection
build with the flag enabled for virtual-sensor and R8 verification.

References: [Expo SDK 58 Sensors](https://docs.expo.dev/versions/v58.0.0/sdk/sensors/),
[Android sensor guidance](https://developer.android.com/develop/sensors-and-location/sensors/sensors_overview).
