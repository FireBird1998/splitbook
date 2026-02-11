# V2: Receipt Upload

## Problem

The `receiptUrl` field exists in the Expense schema, the `ExpenseCard` shows a receipt chip when present, but there's no upload API, no file storage, and no upload UI in the form.

## What Changes

### Storage Strategy

Use local disk storage under `public/uploads/receipts/`. Files served statically by Next.js.

Path format: `public/uploads/receipts/{groupId}/{expenseId}-{timestamp}.{ext}`
URL format: `/uploads/receipts/{groupId}/{expenseId}-{timestamp}.{ext}`

Future: swap to Cloudinary/S3 by changing the upload handler — the rest of the app just stores a URL string.

### New API: `POST /api/upload/receipt`

#### File: `src/app/api/upload/receipt/route.ts`

```
POST /api/upload/receipt
Content-Type: multipart/form-data

Body:
- file: File (image/jpeg, image/png, image/webp, application/pdf)
- groupId: string
- expenseId: string (optional — can upload before expense is saved)

Response:
{ data: { url: "/uploads/receipts/abc123/exp456-1707600000.jpg" } }
```

Implementation:
1. Authenticate user
2. Validate file type (jpeg, png, webp, pdf) and size (max 5MB)
3. Validate user is a member of the group
4. Save file to `public/uploads/receipts/{groupId}/`
5. Return the public URL

#### File validation
- Allowed types: `image/jpeg`, `image/png`, `image/webp`, `application/pdf`
- Max size: 5MB
- Sanitize filename (strip special chars)

### File: `src/components/expenses/ExpenseFormDialog.tsx`

#### Add receipt upload field

After the Notes field:

```
── Receipt ──
[📎 Attach receipt]          ← file input (hidden), triggered by button

After upload:
[🖼️ receipt-photo.jpg  ✕]   ← shows filename, remove button
```

#### State

```typescript
const [receiptFile, setReceiptFile] = useState<File | null>(null);
const [receiptPreview, setReceiptPreview] = useState<string>("");   // data URL for preview
const [existingReceipt, setExistingReceipt] = useState<string>(""); // when editing
```

#### Upload flow in `handleSubmit`

```typescript
let receiptUrl = existingReceipt || undefined;

if (receiptFile) {
  const formData = new FormData();
  formData.append("file", receiptFile);
  formData.append("groupId", groupId);

  const uploadRes = await fetch("/api/upload/receipt", {
    method: "POST",
    body: formData,
  });
  const uploadData = await uploadRes.json();
  receiptUrl = uploadData.data.url;
}

// Include receiptUrl in the expense payload
body: JSON.stringify({ ...payload, receiptUrl })
```

#### Preview (images only)

When a file is selected:
- If image: show a small thumbnail preview
- If PDF: show a PDF icon with filename
- Show file size

### File: `src/components/expenses/ExpenseDetailDialog.tsx`

In the Receipt section:
- If `receiptUrl` is an image: show thumbnail, click to open full-size in new tab
- If `receiptUrl` is a PDF: show download link
- If no receipt: show "No receipt attached"

### File: `src/lib/validators/expense.validator.ts`

Add `receiptUrl` to both schemas:

```typescript
receiptUrl: z.string().url().nullable().optional(),
```

### Gitignore

Add to `.gitignore`:
```
public/uploads/
```

## Security Notes

- Only group members can upload to a group's folder
- File type validation on server side (don't trust Content-Type header — check magic bytes)
- Filename sanitization to prevent path traversal
- Size limit enforced server-side

## Files Modified

- **New** `src/app/api/upload/receipt/route.ts` — upload endpoint
- `src/components/expenses/ExpenseFormDialog.tsx` — add file picker + preview
- `src/components/expenses/ExpenseDetailDialog.tsx` — show receipt
- `src/lib/validators/expense.validator.ts` — add `receiptUrl` field
- `.gitignore` — exclude uploads dir

