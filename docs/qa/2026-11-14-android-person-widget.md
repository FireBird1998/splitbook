# Person widget device check (#1188)

Device: emulator-5572, Android 16 / API 36, arm64, 1080×2400 at 420 dpi.
The P1 development APK contains the fourth receiver. P2 changes are JavaScript
only, loaded from this worktree's Metro. Widgets were enabled only for the local
check, against the isolated fictional backend on 4572 / Mongo 27018. This is not
a release-APK check or a change to the default-off widgets switch.

The native configuration and widget drawings were compared with Widget2Person,
Widget2PersonUsual, Widget2SetupPerson, Widget2Picker, Widget2Currencies and
Widget2LargeText. Launcher measurements are 172×224, 360×224 and 360×344 dp;
the shorter board boxes are not launcher dimensions. Both themes and 100%,
130% and 200% text were checked. Attempting 1×1 clamped to 172×224 dp.

## Findings fixed

- The optional Group count wrapped and clipped in a compact header at 130%.
  Compact headers now omit it, as the compact board does; TalkBack keeps it.
  A view-function regression failed before the fix and passed afterwards.
- At 200%, adding a launcher row still admitted only one payment. The cap now
  follows the actual 120 dp launcher-row increment. The default admits one row;
  360×344 admits both full payments. A second view regression pins this.
- Drawing flattened wrapped title, description and subtitle lines into parents
  with inter-block gaps. This clipped the last message line at 130%. Lines now
  stay inside their measured blocks, with gaps between blocks. Before/after
  device captures verify the complete description.
- Full-width action labels were left aligned. Each line is now centred; device
  regressions cover the full-width and wrapped minimum-size actions.
- Cold Person setup inherited white status-bar text in light mode. It now sets
  contrasting status-bar text for both themes. Two setup component regressions
  cover the platform status-bar adapter, and fresh device captures confirm it.

The drawing regressions use the device seam specified by #1177; no automated
native-drawing seam or SVG-path assertions were added.

## Real reads and taps

The app signed in as fictional Alex and read all six Groups through the existing
controller. Person's Sam rows agreed with the saved Suggested payments:
Alex pays Sam ₹2,812 in Kochi to Alleppey and Sam pays Alex ₹1,480 in Goa Friends
Trip. A real row tap opened the first Group's Record payment sheet with payer,
recipient, INR and `2812` filled in. It was closed without recording. A second
tap during an Expense kept `Person widget unsaved QA` intact and was held with
source `widget`. Only that unsaved local QA Expense draft was deleted.

The two Suggested payments were unchanged after the later membership fixture
was restored. No Expense or Settlement was saved during this pass.

Namesake fixtures show Sam C / SC and Sam P / SP in setup, and Sam C in the
widget and its accessibility summary. Same-Group INR/EUR fixtures remain two
lines, without netting. Cold configuration also worked with the backend's adb
tunnel removed; it read the Widget copy without opening the main app.

## Evidence and restoration

External evidence is in `~/splitbook-hs-pack/out/p1188/` and `out/p1189/`;
`~/splitbook-hs-pack/report-p2.md` lists every product image and the board
differences. Widget cases are indexed by `device-manifest.jsonl`, setup cases
by `setup-manifest.jsonl`. Review composites put the supplied board beside the
actual launcher or configuration image. Board fixtures are labelled separately
from the real backend journeys.

On entry, the existing widget IDs were 45, 47 and 48 (recorded before install),
not the older IDs in P1's handoff. They remain. Only Person 51 was created and
removed; its setup row is gone. The app is signed out, its current Widget copy
is cleared, and font 1.0, light mode, IST, automatic time/zone, size and density
match the baseline. The original 4572 adb tunnel was retained; the added Metro
tunnel was removed. The local backend/database and Metro were stopped. The
exclusive device lock was released after restoration.
