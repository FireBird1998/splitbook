# Tag Management

## Overview

Tags are group-scoped labels that must be assigned to every expense (exactly 1 tag per expense). Group admins can create, archive, unarchive, and delete tags from the group settings page.

## Rules

| Rule         | Detail                                                                                |
| ------------ | ------------------------------------------------------------------------------------- |
| Mandatory    | Every expense must have exactly 1 tag                                                 |
| Single tag   | Only 1 tag allowed per expense (not an array)                                         |
| Group-scoped | Tags are embedded in the Group document                                               |
| Archive      | Archived tags are hidden from the expense form but remain on existing expenses        |
| Unarchive    | Archived tags can be restored                                                         |
| Delete       | A tag can only be deleted if **no expense** uses it; otherwise the delete is rejected |

## Data Model Changes

### Group Model

Add `tags` subdocument array to `GroupSchema`:

```typescript
interface IGroupTagDocument {
  _id: mongoose.Types.ObjectId;
  name: string;
  isArchived: boolean;
  createdAt: Date;
}

// In GroupSchema:
tags: [
  {
    name: { type: String, required: true, trim: true, maxlength: 50 },
    isArchived: { type: Boolean, default: false },
    createdAt: { type: Date, default: Date.now },
  },
];
```

### Expense Model

Change from array to single required field:

```typescript
// Before:
tags: string[];  →  tags: { type: [String], default: [] }

// After:
tag: string;     →  tag: { type: String, required: true, trim: true }
```

Update index: `{ group: 1, tags: 1 }` → `{ group: 1, tag: 1 }`

### Types (`src/types/index.ts`)

```typescript
interface IGroupTag {
  _id: string;
  name: string;
  isArchived: boolean;
  createdAt: Date;
}

// IGroup adds: tags: IGroupTag[]
// IExpense changes: tags: string[]  →  tag: string
// ExpenseFilters changes: tags?: string[]  →  tag?: string
```

## API Endpoints

### Tag CRUD

| Method | Path                            | Description                        | Auth  |
| ------ | ------------------------------- | ---------------------------------- | ----- |
| POST   | `/api/groups/[id]/tags`         | Create new tag                     | Admin |
| PATCH  | `/api/groups/[id]/tags/[tagId]` | Archive/unarchive (or rename)      | Admin |
| DELETE | `/api/groups/[id]/tags/[tagId]` | Delete tag (if no expenses use it) | Admin |

Tags are returned as part of the group object (`GET /api/groups/[id]`), so no separate GET endpoint is needed.

#### POST body

```json
{ "name": "groceries" }
```

#### PATCH body

```json
{ "isArchived": true }
// or
{ "name": "new-name", "isArchived": false }
```

#### DELETE response

- `200` if deleted
- `400` if tag has associated expenses (returns `{ error: "Tag is in use by X expenses" }`)

### Expense Endpoints

Filter parameter changes:

- `tags=foo,bar` (array) → `tag=foo` (single value)

## UI Changes

### Group Settings Page

New "Tags" section between "Currency Settings" and "Members":

- List of all tags (name, status chip: active / archived)
- "Add tag" text field + button
- Each tag row has: tag name, status, action menu (archive/unarchive, delete)
- Delete shows confirmation; blocked with error message if expenses exist

### Expense Form Dialog

Replace the `Autocomplete` (multiple, freeSolo) tags field with:

- `TextField select` (single select, required)
- Options = group's non-archived tags
- Label: "Tag \*"
- Validation: must select exactly 1 tag before submitting

### Expense Card

- Show single tag chip instead of array of chips

### Expense List Filters

- Tag filter: single-select dropdown (or chip list) instead of multi-tag filter

### Predefined Items

Change `defaultTags: string[]` → `defaultTag: string` and update the predefined items data.
