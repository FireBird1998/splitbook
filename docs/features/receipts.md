# Feature: Receipt Attachment

> **Status: not implemented.** This document is a design sketch, not a
> description of working behaviour. Nothing below exists in the codebase:
>
> - No upload route (`.../receipt` is not a route), no storage integration, no
>   upload component.
> - `Expense.receiptUrl` exists on the Mongoose model and `ExpenseCard` renders a
>   receipt chip when it is set — but the field is **absent from both
>   `createExpenseSchema` and `updateExpenseSchema`**, and Zod strips unrecognized
>   keys, so **no API request can ever populate it**. The chip is unreachable.
> - `docs/v2/receipt-upload.md` describes a different endpoint again
>   (`POST /api/upload/receipt`); neither exists.
>
> Implementing this needs, at minimum: a storage provider, an upload route, and
> `receiptUrl` added to the expense validators.

## Overview (proposed)

Users can attach a receipt image to any expense for record-keeping and transparency. One image per expense.

---

## User Stories

1. **As a user**, I can upload a receipt photo when creating an expense.
2. **As a user**, I can add/replace a receipt on an existing expense.
3. **As a user**, I can view a receipt image by clicking on it (full-size in modal).
4. **As a user**, I can remove a receipt from an expense.

---

## Upload Flow

```
1. In expense form, user clicks "📎 Attach receipt"
2. File picker opens → user selects image
3. Preview shows in the form
4. On form submit, image is uploaded along with expense data
5. Image stored in /public/uploads/ (local) or Cloudinary (production)
6. Receipt URL saved on expense document
```

---

## Receipt Upload UI

### In Expense Form (before upload)

```
┌──────────────────────────────────┐
│ 📎 Attach receipt                │
│ Drag & drop or click to upload   │
│ Max 5MB · JPG, PNG, WebP         │
└──────────────────────────────────┘
```

### In Expense Form (after upload)

```
┌──────────────────────────────────┐
│ ┌────────────┐                   │
│ │  📷        │   receipt.jpg     │
│ │  Preview   │   1.2 MB          │
│ │  Image     │   [✕ Remove]     │
│ └────────────┘                   │
└──────────────────────────────────┘
```

### In Expense Card (viewing)

```
┌──────────────────────────────────────────┐
│ 🍕 Dinner at restaurant          €120.00│
│ John paid · Split 3 ways                 │
│ [dinner] [birthday]     📎 [View Receipt]│
└──────────────────────────────────────────┘
```

Clicking "View Receipt" opens a full-screen modal with the image.

---

## Technical Implementation

### Storage Strategy

**Development**: Store in `public/uploads/receipts/` with unique filenames.

**Production**: Use Cloudinary (or similar) for:

- CDN delivery
- Image optimization
- Automatic format conversion
- Thumbnail generation

### Upload API

```
POST /api/groups/[id]/expenses/[expenseId]/receipt
Content-Type: multipart/form-data

Body: { file: <image file> }

Response: { data: { receiptUrl: "https://..." } }
```

### File Handling

```typescript
// In API route
export async function POST(req: Request) {
  const formData = await req.formData();
  const file = formData.get('file') as File;

  // Validate
  if (!file) return error('No file provided');
  if (file.size > 5 * 1024 * 1024) return error('File too large (max 5MB)');
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
    return error('Invalid file type');
  }

  // Save file (local or Cloudinary)
  const url = await uploadFile(file);

  // Update expense
  await Expense.findByIdAndUpdate(expenseId, { receiptUrl: url });

  return success({ receiptUrl: url });
}
```

---

## Validation

- Max file size: 5MB
- Allowed types: JPEG, PNG, WebP
- One receipt per expense (upload replaces previous)
- Only expense creator or group admin can upload/remove receipt

---

## Edge Cases

- Upload fails mid-way: Show error, keep expense without receipt
- Very large image: Compress on upload (Cloudinary handles this)
- Slow connection: Show upload progress bar
- Receipt on deleted expense: Receipt file is preserved (not cleaned up immediately)
- Mobile: Camera option in file picker (native on most phones)
