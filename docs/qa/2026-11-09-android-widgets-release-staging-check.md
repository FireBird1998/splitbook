# Android widgets: signed-in release check on staging (#1013)

**Result: PASS.** With an R8 staging release, the three widgets show real saved data while signed in, and a tap opens the right screen, including from a dead app process. This covers the release-only checks that #992 couldn't run (B01).

## Why staging

A release build refuses the local demo configuration: development settings are rejected outside development JS builds. That refusal is intentional and stays.

So release-mode widget checks use a **staging APK with the widgets switch on**, signed in with a staging account. They do not use a release-like local profile with demo personas, which would mean weakening that refusal.

## Recipe

1. **Build:** run `pnpm mobile build:staging` from `main` with the usual staging settings plus `EXPO_PUBLIC_ANDROID_WIDGETS_ENABLED=true` (and `EXPO_PUBLIC_ANDROID_NOTIFICATIONS_ENABLED=true` to match the staging build).
2. **Install:** install over the existing staging app. It has the same signer, so the sign-in survives. If the device isn't signed in yet, the owner signs in on it; agents never enter credentials.
3. **Place widgets:** in the launcher, long-press → Widgets → Splitbook Staging. Place the widgets and go through their setup screens.
4. **Dead-process taps:** to tap from a dead process, go Home, wait about 15 s, then run `adb shell am kill <package>`. Confirm `pidof` is empty before tapping. Don't use force-stop; that is the separate Android limit accepted in #1009.
5. **No writes:** don't save anything. Close forms and sheets with ✕.

## Build and device

- App source: `84bbbc33a4b6cbe5e78503229ce7165cd2da31ed`, staging R8 release, arm64.
- Package: `com.splitbook.app.staging`, signer `dd96e7ab…` (the same as earlier staging builds).
- APK SHA-256: `c2b51a149c1798887dceea11b3f178ab5ca5303b8615324bbb16bac94fd71d9e`.
- Device: emulator-5554, Android 16 / API 36, font scale 1.0, light mode.
- Data: the owner's existing staging account and one staging Trip Group (two members, INR main, EUR and JPY settled up). Nothing was written to staging.

## Observations

| Check                            | Expected                                                        | Observed                                                                                                                           | Result | Screenshot               |
| -------------------------------- | --------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- | ------ | ------------------------ |
| Balances setup and first draw    | The setup screen opens; the widget shows the signed-in balances | The setup screen opened with Hide amounts. The widget showed "You owe ₹250.00", with "You're owed —", matching Home                | PASS   | `05-balances-home.png`   |
| Group setup                      | Group chooser lists the account's Groups                        | The chooser listed the one Group, "Trip · 2 members · 3 currencies", with Hide amounts                                             | PASS   | `12-group-retry.png`     |
| Group before any read            | "Nothing saved yet"                                             | "Nothing saved yet · Open Splitbook to load this Group."                                                                           | PASS   | `13-group-home.png`      |
| Group tap, app running           | Opens the Group                                                 | Opened the Group's Balances                                                                                                        | PASS   | `16-group-tap-opens.png` |
| Group after the read             | Group name, balance and own payment line                        | "In 3 currencies", with an "AD · You pay ‹member› ₹250.00" row and Add expense                                                     | PASS   | `17-group-filled.png`    |
| Payment row, dead process        | Record payment for that Debt                                    | Record payment for the ₹250.00 Debt in INR, prefilled. Closed without recording                                                    | PASS   | `18-cold-group-tap.png`  |
| Group header, dead process       | Opens the Group                                                 | Opened the Group's Balances                                                                                                        | PASS   | `22-cold-header.png`     |
| Add expense button, dead process | Add expense form in that Group                                  | "Add expense · QA device 2026-11-02 · JPY" form. Closed without saving                                                             | PASS   | `22-cold-addexp.png`     |
| Reconfigure                      | The pencil opens setup with the current choice                  | The Group setup opened with the Group selected, showing Save. Closed without saving                                                | PASS   | `23-restored-home.png`   |
| TalkBack summaries               | One summary per widget, with complete amounts                   | "Balances. You owe ₹250.00. Saved 1:50." and "Group. QA device 2026-11-02. In 3 currencies. You pay ‹member› ₹250.00. Saved 1:50." | PASS   | (accessibility tree)     |

**Note:** the first attempt to add the Group widget left an empty frame. The launcher logged that the setup screen returned no widget ID, and the setup activity never started. That attempt began with a tap made while the widget picker was still closing. A clean retry opened the setup screen straight away. It wasn't reproduced and isn't counted as a defect. Watch for it in the next manual pass.

Screenshots are under `output/1013-staging-widgets/` on the QA Mac. They aren't committed because they show a real staging account.

## Left on the device

The Balances and Group widgets stay on emulator-5554's home screen for the owner to look at. Remove them with a long-press and drag. No system setting was changed: font scale is 1.0 and contrast is the default.
