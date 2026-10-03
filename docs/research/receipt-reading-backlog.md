# Receipt reading (backlog)

**Status, 2026-10-03:** backlogged by the owner. Reading receipts needs research before it is planned. The direction is kept, but nothing is scheduled.

## What exists

- **Android:** a parked draft, PR #96. It uses on-device ML Kit text recognition, reads INR totals only, and replaces only the draft's amount. The Android OCR issues are #90–#95; the receipt scan in the compact form is #130 (parked).
- **Web:** nothing. A concept screen ("Receipts", read on the user's computer) is on the [design canvas](https://claude.ai/artifact/R73Hkvu43SAkDqWDoKLMN9), marked as backlog. The photo would never be uploaded; only the Expense the user saves is sent.
- **Old specs, never built:** [features/receipts.md](../features/receipts.md) and [v2/receipt-upload.md](../v2/receipt-upload.md) describe uploading receipt images. Receipt upload is out of scope in v4.
- **Connected assistants:** receipts are not exposed to assistants.

## Open research

- **Which text reader.**
  - Web: Tesseract.js (WASM) or PaddleOCR through ONNX Runtime Web.
  - Android: ML Kit, or the same model as the web.
  - Weigh accuracy, download size and speed on mid-range phones and laptops.
- **Accuracy on Indian receipts.** Build the reproducible baseline in #94 first: printed bills, screenshots, GST lines, rounding lines and totals.
- **Shared parsing.** Finding the total, date, merchant and line items is pure logic. It should live in `@splitbook/shared` (ADR 0002), so Android and web read receipts the same way and only the text reader differs.
- **Scale.** Reading on the device costs no server compute, but the model has to reach every device: download size, caching and updates.
- **Trust.** Suggestions are never applied without the member's check ("Suggested · See why · Apply"). Decide whether lines read with low confidence block saving.
