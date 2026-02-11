# Group Settings Page

## Overview

A dedicated settings page at `/groups/[id]/settings` for group admins to manage group configuration, members, and danger zone actions.

## Page Structure

### Header
- Back arrow → group detail page
- Title: "Group Settings"
- Group icon + name

### Sections

#### 1. General Information
- **Name** — text input (editable)
- **Description** — textarea (editable)
- **Category** — select dropdown (trip / home / couple / work / other)
- **Save** button

Uses existing `PATCH /api/groups/[id]` with `updateGroupSchema`.

#### 2. Currency Settings
- **Default Currency** — select dropdown
- **Alternate Currencies** — multi-select (max 2), with remove chips
- **Save** button

Uses existing `PATCH /api/groups/[id]`.

#### 3. Members
- List of all members with:
  - Avatar, name, email, role badge (Admin/Member)
  - Join date
  - For admins: action menu (promote to admin / demote to member / remove)
- **Invite** button at bottom → opens `InviteDialog`

Needs new API: `PATCH /api/groups/[id]/members/[userId]` for role change / removal.
Or keep it simple: use `PATCH /api/groups/[id]` with a member management action.

#### 4. Invite Link
- Show current invite link status (active/expired/none)
- **Generate New Link** button
- **Copy Link** button
- Expiry info

Uses existing `POST /api/groups/[id]/invite-link`.

#### 5. Danger Zone
- **Archive Group** — soft delete with confirmation dialog
- Red-bordered section for visual distinction

Uses existing `DELETE /api/groups/[id]`.

## Access Control

- Only **admins** can access this page
- Members who navigate here see a "You don't have permission" message
- The Settings icon in GroupDetailView header is visible to all but only links for admins

## Files to Create/Modify

### New Files
- `src/app/(main)/groups/[id]/settings/page.tsx` — server component
- `src/components/groups/GroupSettingsView.tsx` — client component with all sections

### Modified Files
- `src/lib/services/group.service.ts` — add `removeMember`, `updateMemberRole` methods
- `src/app/api/groups/[id]/route.ts` — no changes (PATCH already exists)
- `src/lib/validators/group.validator.ts` — no changes (updateGroupSchema already covers all fields)

### New API Route (optional, can use existing PATCH)
- `src/app/api/groups/[id]/members/[userId]/route.ts` — PATCH for role update, DELETE for removal

## Notes

- This is an admin-only page
- All fields use existing validators and API endpoints where possible
- Member removal should check that at least one admin remains
- Removing a member doesn't delete their expenses from the group

