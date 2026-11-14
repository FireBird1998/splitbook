---
status: accepted
date: 2026-11-14
---

# Draw Android Header scenes from generated pictures

The Group screen and the settings preview draw a Header scene from pictures that
`tools/header-scenes` generates from the same traced art as the web's vectors:
one picture per layer body (far, main, front, night glow), one for the ground
shadow and one per cloud, each trimmed to its content. There are 46 PNG files,
630 KB in all, under `apps/mobile/assets/header-scenes`, drawn at 3 pixels per
scene unit so no supported density scales one up. A generated list per scene
places them in scene units. The settings choices show each scene's main island
picture. No native drawing library is needed; `react-native-svg` is removed.

Freshness is a SHA-256 of the drawing input recorded in each list, never a
comparison of PNG bytes, which differ between macOS arm64 and Linux x64.

Only a Scene header behind `EXPO_PUBLIC_HEADER_SCENES_ENABLED` loads a scene's
list, and only the chosen scene's. Classic, Home and widgets keep their existing
rendering. Generated files are never edited by hand.

## Motion

Every moving part is a native-driver transform on a picture; nothing is redrawn
and no React render happens per frame. Layer bodies rise 3 scene units on the
web's 7, 9 and 11 second periods, clouds drift and re-enter from the left, the
shadow tightens as the main island rises, and tilt shifts the layers (below).
The sky does not move and no picture is cut by its own edge, so no offset can
uncover a blank strip. Movement inside an island (water, people, boat, turbines,
smoke, lanterns) is not drawn on Android.

The existing reduce-motion watcher wins over the phone's Motion choice. React
Native reports reduce motion on Android only when the transition animation scale
is 0, which the system's Remove animations setting does; the animator scale
alone does not.

`headerSceneMotionAvailable` is true. Set it false to ship still scenes: the
phone's Motion and Tilt card is then not shown and no sensor is loaded.

## Why pictures replaced vectors (2026-11-14)

The first renderer mapped the portable vector tree to `react-native-svg`
(15.16.0), 720 to 1,490 native nodes per scene, and motion was switched off
after release scrolling measured far over budget. That measurement was taken
while the Mac was busy: the Classic header, with no scene, was as slow. Measured
again on a quiet host (spare emulator, release, Hermes + R8, arm64, Android's
own `gfxinfo` summary):

| Build    | Run              | Frames | Janky | p50      | p95   |
| -------- | ---------------- | ------ | ----- | -------- | ----- |
| Pictures | float, idle 10 s | 602    | 0     | 18–19 ms | 20 ms |
| Pictures | float, 16 swipes | 418    | 0     | 19 ms    | 20 ms |
| Pictures | tilt swinging    | 602    | 0     | 19 ms    | 20 ms |
| Pictures | still, 16 swipes | 413    | 3     | 16 ms    | 17 ms |
| Vectors  | float, idle 10 s | 599    | 3     | 16 ms    | 17 ms |
| Vectors  | float, 16 swipes | 419    | 0     | 16 ms    | 17 ms |

Both hold 60 frames a second; the 16 against 19 ms difference also appears
between two runs of the same build and is vsync phase, not cost. Pictures were
kept because opening a Group no longer has a 55–105 ms UI-thread frame (9–19 ms
with pictures), a scene is about 12 images instead of 720 to 1,490 vector nodes,
clouds, shadow and islands can move separately, and the release APK is slightly
smaller (32.19 MB against 32.24 MB) with one native library fewer. Removing
`react-native-svg` changes the native build: a new APK is required.

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
to the resting pose controls bounded, eased native-driver translations (up to
5 dp horizontally and 3 dp vertically) at different layer depths: layers behind
the main island move against the front one. No React state changes per sample. Sampling and animated work still cost
battery while visible, so a low rate and explicit unsubscription matter.

Tilt shares `headerSceneMotionAvailable` with motion. Hand tremor (a change under 2%
of full tilt) starts no animation, and the resting pose follows the phone slowly, so
a scene held at an angle settles back.

References: [Expo SDK 58 Sensors](https://docs.expo.dev/versions/v58.0.0/sdk/sensors/),
[Android sensor guidance](https://developer.android.com/develop/sensors-and-location/sensors/sensors_overview).
