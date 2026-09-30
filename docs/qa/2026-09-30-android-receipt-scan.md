# Android receipt scanning, first slice (#90)

This slice implements [#90](https://github.com/FireBird1998/splitbook/issues/90) from `c082b91`. It is a development/staging experiment: scan a receipt screenshot, review a suggested INR total, and optionally apply it to a new Expense draft's amount.

## Automated verification

- Mobile: 217 unit tests passed, including 17 selection-policy cases (`receipt-total.test.ts`) and 7 controller journeys (`receipt-scan-controller.test.ts`).
- The controller tests use a controllable fake scanner at the new dependency seam and cover:
  - select → recognize → review → apply
  - no suggestion, cancellation, recognition failure and interpretation failure
  - an amount edited after the scan started
  - dismissed and superseded scans
  - moving to another Group, and sign-out followed by sign-in to another account
  - non-INR Groups and the disabled experiment
- They also assert that no HTTP write occurs and that payers, split values, currency and Tag are unchanged after Apply.
- Mobile typecheck and lint passed.

## Native environment

- Emulator: `Medium_Phone_API_36.1` (Android 16, arm64), headless, as `emulator-5554`.
- App: a fresh `expo prebuild` and Gradle `assembleDebug` of `com.splitbook.app.dev`, served by Metro on 8081.
- Backend: the isolated fictional backend on 4138, database `splitbook_mobile_50` on local Mongo 27018.
- Recognition: `com.google.mlkit:text-recognition:16.0.1` (bundled Latin model). Picker: `expo-image-picker` 57.0.20.
- Only fictional personas and three synthetic screenshots, rendered locally at 1080×2400, were used. No real receipt was used.

| Input                                                                     | SHA-256                                                            |
| ------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| `synthetic-rupee-to-pay.png` (₹ amounts, “To Pay ₹289.86”)                | `34d9d87abd7d36e65a56a4ef4a133f1c8cead49b72a56aabc9d0166ff83d0b16` |
| `synthetic-rs-grand-total.png` (“Grand Total Rs. 1,249.50”)               | `53bd1215d6bbc437603940096b9a922d7a6bdab092c057b3c035f2d0f5d8e44f` |
| `synthetic-competing-totals.png` (“Bill total ₹350.00”, “To Pay ₹320.00”) | `637e55f7af68ebf892a7309bbe600d2c471fea563e6e226f6f608ed366b47822` |

## Native results

Sam opened **Maple House → Add expense**, entered a description, and chose **Scan receipt**.

- **`Rs.` receipt:**
  - The Android photo picker returned one image and ML Kit returned 10 lines. The label and its right-aligned amount came back as separate lines; row reconstruction joined them.
  - The review showed ₹1,249.50 from “grand total”, with the supporting row `Grand Total Rs. 1,249.50`.
  - **Apply** set the amount to `1249.5` and left the description and other fields unchanged.
- **`₹` receipts:** ML Kit's Latin model did not recognize the rupee glyph. It read `₹310.00` as `7310.00`, `-₹45.14` as `-745.14` and `₹289.86` as `¿289.86`, and dropped it from `₹25.00`. With no INR marker, both ₹ receipts abstained with an explicit message, and the draft amount did not change. Accepting those numbers would have produced amounts with a spurious leading `7`, off by roughly a factor of ten or more. This is the most important input for #91.
- **Cancelling the picker** returned to the idle state without changing the draft.
- **Cleanup:**
  - After five scans, the app's `cache/ImagePicker` directory was empty.
  - The three originals in `/sdcard/Pictures/SplitBookSynthetic` remained with their original sizes.
  - An authorized database read showed zero Expenses in Maple House, and none created during the session.
  - The fictional draft was discarded afterwards.

One defect was found and fixed during the native check. Hermes leaves `groups` unset on `matchAll` results, so named capture groups threw, and that escaped the scan and left it reading indefinitely. The policy now uses numbered groups, and interpretation failures always end the scan with a “couldn’t read” result. A regression test covers the second part.

## Not verified here

- A physical phone, performance, memory, app-size delta, airplane-mode or fresh-install recognition, dark mode and large text. These belong to #93 and #95.
- Staging builds. The staging configuration does not exist yet, so the experiment is enabled only in the development build.
- Parity with the Tesseract pipeline, which is not claimed.
