# Member roles and removal: device check (16 November 2026)

Ticket #1255 of spec #1249. Checked on main `a3c2ad80a`, which holds every change for the spec: #1250 and #1251 (server and web), #1252, #1253 and #1254 (Android), and the review follow-ups #1261 (a role change keeps the last admin under concurrency) and #1262 (four Android race edges).

Result: **pass.** No defect was found in this check. One flaky browser test seen in CI during the build is filed as #1260 and is not part of this feature.

## How it was run

- **Backend:** `pnpm swarm up` from a clean worktree of main, on its own MongoDB replica set, with the fictional personas (Alex Rivera, Sam Chen, Priya Shah) and Groups. Nothing touched staging or production.
- **Web:** the built-in browser against that backend, signed in as Alex, at desktop width and at 390 px. What the page showed was read from the page itself (text, roles, dialogs), not judged from pictures.
- **Android:** emulator `emulator-5556` (Android 16, 1080×2400, 420 dpi), a development build of the app from the same commit loading its code from Metro, signed in as Alex. Each step was read back from the screen's accessibility tree, which is also what TalkBack reads, and captured to `output/1255-android/`.
- **The other member's view:** a second session signed in as Priya against the same backend.

This is a development build, not the release build. The release-like builds were exercised by the implementers during each ticket (captures in `output/1252-android/`, `output/1253-android/`, `output/1254-android/`, `output/1262-android/`), and the production APK's start is checked at release.

## Web

| Check                                                                                                                                             | Result |
| ------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| A member's menu says Make admin and Remove from Group                                                                                             | Pass   |
| Make admin applies at once; Snackbar "Sam Chen is now an admin", no Undo                                                                          | Pass   |
| The only admin's own row has no menu; with a second admin it offers only Step down to member                                                      | Pass   |
| Remove from Group opens "Remove Priya Shah from Maple House?" with both sentences, Cancel and Remove from Group; Cancel sends nothing             | Pass   |
| Step down opens "Step down to member?" and names who stays ("Sam Chen stays an admin."); Cancel sends nothing                                     | Pass   |
| Removing a member who owes is refused in the notice: "Sam Chen owes ₹1,480.00 in this Group. Settle up before removing them." with Go to Balances | Pass   |
| A member who is not an admin gets no member actions                                                                                               | Pass   |
| At 390 px the Remove dialog and both its buttons fit, with no sideways scroll                                                                     | Pass   |

## Android

| Check                                                                                                                                                                                 | Result |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| Admin's list: three dots on each row that can be acted on, "Tap a member to change their role or remove them."                                                                        | Pass   |
| Rows read as "Sam Chen, Admin, options"; a member's own or plain row has no "options"                                                                                                 | Pass   |
| Member options for a member: Make admin, Remove from Group (red, "You’ll be asked to confirm")                                                                                        | Pass   |
| Make admin: the row updates and the Snackbar says "Priya Shah is now an admin"                                                                                                        | Pass   |
| Make member: "Priya Shah is now a member"                                                                                                                                             | Pass   |
| Remove: confirm "Remove Priya Shah from Maple House?" with the explanation; after confirming the row and the count go and the Snackbar says "Priya Shah was removed from Maple House" | Pass   |
| Your own row offers only Step down to member while another admin exists                                                                                                               | Pass   |
| Step down: confirm names who stays; afterwards the member's view, no dots, "Only admins can change roles or remove members.", Snackbar "You’re now a member of Maple House"           | Pass   |
| The last admin's Leave Group: after confirming, "Make someone else an admin before you leave." with Choose an admin, which returns to the list; no mention of the web                 | Pass   |
| Removing a member who owes: the server's sentence on the sheet with Go to Balances and no Remove; the button lands on Balances showing the debt                                       | Pass   |
| Backend unreachable during a role change: "Couldn’t make Sam Chen an admin. Try again.", the offline notice, and the server unchanged (checked from the other account)                | Pass   |
| Once the app knows it is offline: both options disabled with "Changing roles or removing members needs a connection."                                                                 | Pass   |
| Back online after Try again: the offline notice goes and the options work                                                                                                             | Pass   |
| Dark mode: list and Member options                                                                                                                                                    | Pass   |
| 130% text: list, options and the Remove confirm fit; every action reachable                                                                                                           | Pass   |
| 200% text (not drawn on the boards): titles and sentences wrap, nothing is clipped, every action reachable                                                                            | Pass   |

## The other member's view

After Alex removed Priya from Maple House, Priya's session no longer lists the Group and a direct request for it is refused (403). Her other Groups are unchanged. A role change attempted while the backend was unreachable changed nothing on the server.

## Cited from the implementers' captures, not repeated here

These states need a proxy that answers in place of the server or drops a reply, and were captured on release-like builds during the tickets:

- the recurring-Expense refusal with Open on the web, the Group-changed refusal, and the last-admin refusal on removal (`output/1253-android/`);
- the last-admin race on stepping down (`output/1254-android/`);
- the row while a change is being made, and the failure Banner in dark and at 130% (`output/1252-android/`);
- "Another role change is still being made." on a second Group (`output/1262-android/`);
- the web's menus, dialogs and Snackbars in light and dark at both widths (`output/1250-web/`, `output/1251-web/`).

## Not covered

- TalkBack was not run with the screen reader on; the labels it reads were checked from the accessibility tree.
- A real phone. Everything here is an emulator.
- The release build with the production signing key; that is checked when a production APK is built.

## Left as found

The emulator's own development app was saved before the check and reinstalled after it (same checksum), its font scale, night mode and animation settings match what was recorded first, its port forwards are removed, and it is stopped with its lock released. The backend is stopped, its database dropped and its MongoDB container removed.
