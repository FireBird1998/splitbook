# Spending by day: device check (16 to 17 November 2026)

Ticket #1277 of spec #1271. Checked on main `9d0e3142`, which holds every build ticket for the spec: #1272 (shared rules), #1273 (the server read), #1274 (the Settings switch and the saved monthly read), #1275 (the Home card) and #1276 (the Spending screen).

Result: **ten of eleven checks pass; one defect.** On a phone in a time zone behind UTC, the card and the Spending screen name the previous Month over the right Month's figures. It is filed as #1283, with two small accessibility points from the same check. The feature is off by default and is not in production.

## How it was run

- **Backend:** `pnpm swarm up` from a clean worktree of main, on its own MongoDB replica set, with the fictional personas (Alex Rivera, Sam Chen, Priya Shah) and Groups. Nothing touched staging or production.
- **Android:** emulator `emulator-5556` (1080×2400, 420 dpi), a development build of the app from the same commit loading its code from Metro. Each step was read back from the screen's accessibility tree, which is also what TalkBack reads, and captured to `output/1277-android/`.
- **Figures:** every amount on screen was compared with the reply of `GET /api/user/spending/days` for the same persona, Month and zone.
- **A second member:** Priya acted through HTTP against the same backend.
- **Not checked:** "off after an update" from a clean state (the app found on the emulator already had the switch set by an earlier build), and TalkBack by ear (labels were read from the accessibility tree).

## Results

1. **PASS**: fresh install (`pm clear`). Switch off (Switch, checked=false), "Off. Home shows your balances and Groups…", no card, no `/api/user/spending/days` in the backend log (02, 03). The found app's data already had `spending-by-day` set by an earlier session, so "off after an update" could not be checked from a clean state (01).
2. **PASS**: card "SPENDING · NOVEMBER", "Updated 11:40 PM", ₹31,781.34, "Your share · 10 days with spending", mini grid, "See each day" (06). Backend: totalMinor 3178134, dayCount 10. Days 2/5/6 = 18,393 / 486.67 / 6,000 match.
3. **PASS**: EUR Group via HTTP. Card shows ₹31,781.34 / 10 days and €75.25 / 2 days on separate lines, never added (13). This matches board 2.
4. **PASS** with one defect (D2). Opens on today. Grid is Sunday-first and correct for Nov 2026, Dec 2025, Oct and Sep 2026. Five tints follow the ₹500 / ₹1,000 / ₹2,500 steps. Day 2 lists 2 rows: "₹18,000.00 of ₹54,000.00" and "₹393.00 of ₹1,179.00" (08). Tapping an Expense opens it in Banyan Court, and Back returns to Spending (09, 10). Paging goes back to Dec 2025, where Previous is disabled, and forward stops at Nov 2026 (12). Empty month: "Nothing shared in December". INR and EUR tabs work (15, 16). Sep ₹44,295.02 and Apr ₹953.34 match the backend.
5. **PASS**: in-app ₹900 Maple House Expense, then Home with no manual refresh: ₹32,081.34, 11 days (14). Priya's HTTP Expense, then pull to refresh: ₹32,281.34; backend 3228134, today 50000 (15).
6. **PASS** with an observation.
   - (a) Loading through an 8 s delay proxy: skeleton, card height kept (Groups header at the same y), no zero (27). The Spending screen shows the grid frame and skeleton totals (29).
   - (b) Sam with his Groups archived in my database: "₹0.00", "Your share · nothing yet in November" (38).
   - (c) Cells read 14L, 90L and "<1" for ₹0.50. The screen total ₹10,432,281.84 and the rows are in full (20).
   - Observation: the Home figure never switched to the L form, even at ₹100,432,281.84 at 100% and 200%. It stays in full with a slightly smaller glyph and is not cut (25, 26). Fit-first allows this, but the board's "₹14.2L" state was not reproduced on a 1080 px screen.
7. **PASS**: 100/130/200% × light/dark (21–24). Nothing clipped. Seven columns kept. The card grid moves under the figure at 130% and 200%. Cells shorten sooner (18K, 1.3K).
8. **PASS** with one defect (D3).
   - Card: one Button, no clickable children. Label: "Spending, November. Your share ₹31,781.34. 10 days with spending. See each day".
   - Cells: "2 November, ₹18,393.00", "16 November, ₹500.00, today".
   - Rows: "…your share ₹18,000.00 of ₹54,000.00".
   - Tabs: role tab (source), selected state (dump).
   - Paging: Next is DISABLED at the current month.
9. **PASS**.
   - (a) Offline restart: card "Saved 11:57 PM", and the label ends ". Saved 11:57 PM". Nov and Oct show "Saved" (30, 31).
   - (b) Sep: "This month isn't on this phone yet. Connect to load it." + Try again (32). On reconnect the month loaded by itself. Try again worked when tested alone (reverse removed, then restored).
   - (c) Switch off/on offline: "Your spending isn't on this phone yet. Connect to load it." + Try again, no ₹0.00 (35).
10. **PASS**.
    - After sign-out, `saved_queries` has 0 spending rows (1 before), with no cached reply in files or prefs. Only the encrypted `spending-by-day` switch key remains.
    - Signing in as Sam showed no flash of Alex's figures over 14 burst frames (37a–c). The switch stayed on.
    - Alex left QA Euro Trip via HTTP; after a refresh the EUR line was gone (18).
11. **FAIL** (D1).
    - Kiritimati: November, today = 17, ₹31,531.34 matches the backend (41, 42).
    - Pago Pago: today ring 16 and figures correct, request `month=2026-11`, but the month is named "October" (39, 40).
12. See defects and polish.

## Defects

**D1 (real): wrong month name in zones behind UTC.**

- Steps: device zone Pacific/Pago_Pago (UTC−11), switch on, pull to refresh on Home, open Spending.
- Expected: "Spending · November" and "November 2026".
- Observed:
  - The card reads "Spending, October".
  - The screen title reads "October 2026" over the November grid with November figures.
  - Empty-day TalkBack labels read "1 October, nothing", while days with spending read "2 November, ₹18,393.00".
  - Paging back shows "September 2026" over October.
- Every zone behind UTC is likely affected, so all of the Americas.
- Likely source: `monthName` (`apps/mobile/src/ui/spending-words.ts`) and `monthTitle` / `dateOf` and the empty-cell label (`apps/mobile/src/ui/spending-screen.tsx`), which build local dates from strings.
- Captures: 39-tz-pago-pago-home-card-says-october, 40-tz-pago-pago-spending.

**D2 (minor, a11y): Expense opened from Spending has a "Back to Group" header button.**

- The button and hardware Back both return to Spending, so TalkBack names the wrong destination (11).

**D3 (minor, a11y): the loading card has no accessible label.**

- Only "SPENDING · NOVEMBER" is exposed; there is no busy or loading text (27).

## Polish

- The Settings switch thumb is top-aligned in its row; the board centres it (03, 04).
- The Days legend note omits "Tint steps at ₹500, ₹1,000 and ₹2,500" from board days-2 (07).
- The Home figure shrinks its glyphs rather than shortening (6c observation).

## After the check

The emulator was returned as found: the app that was installed before the check was reinstalled (same file), text size, dark mode, animation settings, screen size and time zone were put back, and the emulator was stopped. One difference remains: the fresh-install check cleared that app's data, so its encrypted phone settings are gone; it was signed out before and after. The backend, its database and the build processes were removed.
