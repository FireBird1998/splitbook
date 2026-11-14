---
status: accepted
date: 2026-11-14
---

# Draw Android Header scenes from generated pictures

The Group screen and the settings preview draw a Header scene from pictures that
`tools/header-scenes` generates from the same traced art as the web's vectors:
one picture per layer body (far, main, front, night glow) without anything that
moves on its own, one for the ground shadow, one per cloud, and one per moving
part of an island (below), each trimmed to its content. There are 260 PNG files,
813 KB in all, under `apps/mobile/assets/header-scenes`, drawn at 3 pixels per
scene unit so no supported density scales one up; a picture longer than 2,048
pixels is scaled down to that, the texture limit of the oldest GPUs (two wide far
layers). A generated list per scene
places them in scene units. The settings choices show a small whole-island
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
uncover a blank strip.

Everything the web animates inside an island moves on Android too (#1240; the
owner's decision of 15 Nov 2026, replacing the first version's cut): waterfall
streaks, drops and mist, shimmer and ripples, koi, crab, gull, fox, walkers,
hiker, cyclist, birds, boat, turbines, smoke, snow, petals, swaying plants, and
at night the window flicker, lantern bob and halo pulse. The rules:

- **One source of timing.** The generator reads the web's own CSS (`scene.css`
  and each scene's rules) and bakes every `@keyframes` rule into straight stops,
  with its easing, steps, delay and direction drawn in. The list carries those
  stops; the app never restates a period or a path. What the generator cannot
  play stops the build with a message: a direction other than `reverse`, a
  finite repeat, `step-start`, `step-end` and steps that jump at the start,
  timing or repeat written as longhands or inside keyframes, a transform other
  than a px slide, a single scale or a turn in degrees, a positive delay, a
  selector that does not end on one class under `.vq` or `.vq.t-night`, and a
  night rule that replaces a day animation.
- **Parts.** Each animated element is cut out of its layer body into a picture of
  its own; equal neighbours share one. A part is a child of its layer, so it
  rises and tilts with its island.
- **Clocks.** The app runs one linear 0-to-1 loop per period on the native
  driver (13 to 26 per scene) and each part reads its slide, fade, scale or turn
  from its period's clock by interpolation. No part has a loop of its own.
- **Covers.** Where static art is drawn after a part and overlaps the part's
  reach, that art is drawn again, cut to the reach, on top of the part. The
  generator derives this from drawing order; nothing is placed by hand. The glow
  layer has no covers: its lights are see-through and would brighten if drawn
  twice.
- **Turbines.** Eco city's rotors turn inside a slanted group. Android has no
  skew, so the picture holds the rotor unslanted and a holder applies the slant
  as a fixed turn, stretch and turn (its singular values), which Android can
  draw exactly.
- **Stopping.** Motion off, Remove animations, off screen, a covered Group and
  background stop every clock. With Motion off or Remove animations a part rests
  where the web's still scene has it; one that is only seen while it moves (a
  drop, a snowflake, a ripple) is not drawn. A scene that is only paused (off
  screen, covered, in the background) keeps its parts in the pose its clocks
  restart from, so nothing jumps when it comes back into view.
- **Night.** The glow layer and night-only movement are mounted, and their
  clocks started, only when the scene shows them.

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

## In-scene movement, measured (2026-11-15)

Same emulator and build type, but on an unattended Mac (no user input for 45
minutes, a second emulator open). There the unchanged scene itself drew about
33 frames a second, far below the table above, at a host load of 2 to 3 as well
as at 7; the cause was not established. The two builds were therefore alternated
on Mountain village by day, the scene with the most parts (61 on its main
island), two runs each, and again in a second session with the same result:

| Build                  | Run       | Frames   | Janky  | p50       | p90         |
| ---------------------- | --------- | -------- | ------ | --------- | ----------- |
| Float and clouds only  | idle 10 s | 330, 321 | 26%    | 36, 32 ms | 117, 125 ms |
| With in-scene movement | idle 10 s | 417, 421 | 17%    | 32 ms     | 77, 69 ms   |
| Float and clouds only  | 16 swipes | 234, 247 | 25–27% | 36, 34 ms | 109, 125 ms |
| With in-scene movement | 16 swipes | 289, 241 | 22%    | 34, 36 ms | 69, 121 ms  |

During a third session the emulator ran at full speed for one pair of runs, on
Eco city by day (38 parts on its main island): without in-scene movement 604
frames idle with 0 janky and 616 while tilting with 1; with it 607 with 2 and
622 with 1, p50 20 to 22 ms. The other scenes in that session were slow for both
builds alike (Beach idle 433 against 443 frames, 20% janky each).

In-scene movement is no slower than the scene without it under the same load.
Mountain village, Sakura and Beach have no full-speed run yet: repeat the first
table's runs for them with someone at the Mac before quoting a frame rate.
Remove animations leaves no changed pixel between two captures, and the app in
the background draws no frame. The release APK grew from 30.46 MB to 30.81 MB.

If a scene ever cannot hold its frame rate, thin it in this order and say so:
snowflakes, petals and drops; then shimmer; then smoke. People, animals, the
waterfall, the boat and the turbines need the owner's decision.

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
interval. On Android 7–11 it uses fastest native sampling, and that power cost
has not been measured on a handset, so Tilt is gated to Android 12 (API 31) and
later: below it the sensor module is never loaded, the Tilt row is not shown and
scenes still float. Lift the gate only with a handset measurement. Verify the
merged release manifest and APK, rather than trusting the source config.
The app does not transmit or store sensor samples. Only the on/off choice is kept
in SecureStore (`splitbook.header-tilt`), outside account Saved copies and sign-out
clearing, like Motion and Appearance (ADR 0006). It defaults on.

A cancellable sensor lease loads the module only on Android 12 and later, for an
available, visible Group scene whose pictures have loaded, in the foreground,
with Motion and Tilt on and Remove animations off. The float and drift loops stop
on the same conditions, including the app going to the background.
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
