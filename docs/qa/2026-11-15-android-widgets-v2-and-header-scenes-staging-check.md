# Android widgets, second round, and Header scenes: staging device check

15 November 2026. Covers #1190 (widgets, second round, spec #1177) and #1209 (Header scenes, spec #1200).

## What was tested

- **Build:** a signed staging release APK (Hermes, R8, arm64) built from `main` at `01660d08` with `pnpm mobile build:staging`. Package `com.splitbook.app.staging`, the usual staging signing key. Switches on for this build only: `EXPO_PUBLIC_ANDROID_WIDGETS_ENABLED`, `EXPO_PUBLIC_ANDROID_NOTIFICATIONS_ENABLED`, `EXPO_PUBLIC_PERSISTENT_DRAFTS_ENABLED`, `EXPO_PUBLIC_HEADER_SCENES_ENABLED`.
- **Server:** `https://staging.splitbook.in`, deployed from the same commit, with `NEXT_PUBLIC_HEADER_SCENES_ENABLED=true` for that deployment only.
- **Device:** Android 16 (API 36) emulator, 1080×2400 at 420 dpi, with the previous staging build (`61356337`) installed, signed in, and three widgets already placed (Overview at its small size, Group, Quick actions).
- **Method:** the new APK was installed over the old one (`adb install -r`), so this is also the upgrade check for the new `widget_group_evictions` table on an existing widget database. The device was driven with `adb`; every screenshot was opened and read.

## Results

### Upgrade

| Check                                                  | Result |
| ------------------------------------------------------ | ------ |
| App opens signed in after the upgrade                  | Pass   |
| Home shows live balances and the Group                 | Pass   |
| The three widgets placed by the old build redraw       | Pass   |
| No crash or SQLite error in the device log all session | Pass   |

### Header scenes (#1209)

| Check                                                                                          | Result |
| ---------------------------------------------------------------------------------------------- | ------ |
| Group options offers "Header scene"                                                            | Pass   |
| Settings page: Scene or Classic, four scenes, Auto and four times of day, Motion, Tilt, Save   | Pass   |
| Each scene draws in the preview: Beach, Sakura, Eco city, Mountain village                     | Pass   |
| Each time of day draws: Morning, Day, Sunset, Night; Auto followed the clock (Night at 02:00)  | Pass   |
| Save applies to the Group screen; the card under the scene is dark at Night                    | Pass   |
| The scene moves on the Group screen (two captures three seconds apart differ across the scene) | Pass   |
| Choosing Classic and saving restores the boarding-pass header                                  | Pass   |

### Widgets (#1190)

| Check                                                                                                                 | Result |
| --------------------------------------------------------------------------------------------------------------------- | ------ |
| The launcher's widget picker lists Overview, Group, Person and Quick actions, each with its preview and description   | Pass   |
| Person: add from the picker, setup lists the people in the member's Groups, the widget shows the line for that person | Pass   |
| Person: resized 4×2 → 4×4 → 2×4 with the launcher's handles; it redraws each time and the narrow size reflows         | Pass   |
| Person: Reconfigure opens setup with the saved person selected                                                        | Pass   |
| Person: Hide amounts shows "One person", a count and "Amounts and names hidden"; the spoken summary has no name       | Pass   |
| Spoken summary with amounts shown names the person, the amount, the Group and the saved time                          | Pass   |
| Tap a payment row on the Group widget: Record payment opens, filled in for that payment                               | Pass   |
| Taps made while that payment form is open are held; after closing it the app offers "Ready to open"                   | Pass   |
| "Open" on that notice goes to the held destination                                                                    | Pass   |
| Group widget's Add expense opens the Add expense form for that Group                                                  | Pass   |
| Quick actions (Ask each time) opens Choose a Group                                                                    | Pass   |
| Dark mode, 130% text and 200% text: all placed widgets redraw with no clipped text                                    | Pass   |

A widget tap on this release build opens its destination. The earlier note that a widget tap opened Home was specific to the debug client.

## Not covered on this device, and where it was covered

The emulator holds a real staging sign-in, so nothing that changes the clock, signs out or clears data was done on it.

- **Date change during a Trip, sign-out with widgets on screen, stale figures, the switch off, archived and refused Groups:** exercised on development builds during the build rounds, with their own screenshots, and pinned by controller tests. See `docs/qa/2026-11-14-android-person-widget.md` and the pull requests for #1178 to #1189 and #1231.
- **Every size of every widget type:** the native previews at real dp sizes in those rounds, checked against the boards by the Designer. Here only Person was dragged through sizes on a real launcher.
- **Tilt:** an emulator has no motion to tilt with. The motion work measured Tilt on a release build and gates it to Android 12 and later.
- **Web scenes on staging:** not checked in a browser in this pass (no signed-in browser session was used). The web scenes were checked in their own pull requests.
- **Notifications (#1233):** no notification was sent in this pass; the fix is pinned by controller tests.

## Observation

While a scene is moving, `uiautomator dump` never sees the screen go idle and returns nothing new, so UI automation has to wait on a still screen or use screenshots. It does not affect the app or TalkBack. Turning Motion off stops it.

## Device left as found

Text size 1.0, light mode, automatic time and time zone, the same three widgets with the same ids, the Group's header back on Classic, and the test Person widget removed.
