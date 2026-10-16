# Custom Tag management on Android and shared web safety

Status: confirmed by the owner on 13 October 2026: “yes looks good, confirm the design.” The consolidated scope and public test seams are approved for local implementation. Eleven decisions were settled through grill-with-docs on 12–13 October 2026. This document supersedes the preliminary local Android-only spec.md; it does not authorize GitHub publication, merging or deployment.

## Intended experience

An admin opens a Group’s options and chooses Manage Tags. They can create a named Tag, rename one, archive it or restore an Archived Tag. Active and archived Tags are clearly distinguished; deleted identities are not offered for selection. Android’s Expense picker remains a selection/search control, with no Tag creation or management entry. Custom colors, icons and an Android Delete action are outside this version.

Management remains admin-only, and every Group member may select an active Tag for an Expense. Tag changes require a connection. Existing offline Expense editing stays available; reconnecting never automatically submits Tag changes.

Names follow the existing rule: trim surrounding whitespace, require 1–50 characters, and reserve names ignoring case among this Group’s non-deleted Tags, including archived Tags. Creating “villa” when “Villa” is archived offers an explicit Restore of that existing identity. An active duplicate is explained; it is never silently selected or treated as proof an interrupted request succeeded.

Closing changed, unsubmitted name text asks whether to keep editing or discard that text. Ordinary unsubmitted names are not retained across app restart. A submitted action whose result is unconfirmed is separate: closing the manager does not discard its recovery information.

## Domain and history

A Tag’s identity survives rename, archive and restore. Saved Expenses, filters, recurring templates and retained Drafts remain associated with that identity; monetary values do not change. Read responses show the current Tag name while historical fallback text remains intact.

Archiving requires explanation and explicit confirmation. Saved Expenses keep the Tag and can retain it during an otherwise valid edit. New assignments require an active Tag. Unfinished Expense Drafts using an archived Tag keep their entries and require another active Tag before becoming an Expense; nothing is silently substituted. Existing recurring generation stops when its Tag is archived, under the current rules. This feature does not reopen the parked recurring-template/member-leave rule.

The backend must prevent removal of the last active Tag, through archive or existing web deletion. Create or restore another first. Concurrent admins cannot each retire a different Tag and leave none active. Historical Groups already lacking an active Tag stay readable and allow an admin to create or restore one; no automatic backfill invents a Tag or modifies their history. Existing web deletion remains restricted to unused Tags, including recurring-template references.

## Shared safety contract

Web and Android use one backend contract for current permissions, stale edits, last-active-Tag protection and recovery. Web’s existing Tag controls adopt these protections too. An older web form must receive a correctable rejection rather than bypassing the guards. Read compatibility and existing Tag identities must be retained.

Rename, archive, restore and existing web deletion must check the Tag state/version the member reviewed. A stale change stops without overwriting another admin’s work; preserve the entered name, show the current saved state and require explicit review/reapply.

Every submitted action has a durable, account/Group-scoped request identity and the exact submitted intent. Keep that intent before sending; if it cannot be retained, do not send a change that cannot be recovered. The backend records whether that particular action was applied atomically with its effect. A name match or matching current archive state is not a receipt.

After a lost reply, closing/reopening or app restart offers explicit recovery. A read-only Check reports whether the action was applied and does not execute it. Explicit Retry uses the original request, never a fresh key or edited payload. It cannot apply twice or overwrite a later change. If a create was applied and then renamed, recovery identifies the same Tag; if a rename/archive/restore/delete was applied and then superseded, explain the confirmed earlier action and show the current state separately. Do not claim that the current Tag state equals the submitted one.

Current authorization always applies. Losing only admin permission disables management while retaining Group data the member may still read. Actual membership loss clears inaccessible data. Local recovery must be isolated by account and environment, with the existing sign-out/account-cleanup rules; action receipts cannot grant new permissions. Recovery records follow Group/account cleanup rules rather than leaving orphan storage.

A write that may have reached the server invalidates affected old reads and saved copies. Late responses from a closed or superseded manager, removed Group or changed account must not overwrite a new view or leak data. Existing financial save/recovery commands and Expense entries stay intact.

## Acceptance and tests

Use the existing public controller, rendered Android/web clients and authenticated HTTP seams against isolated real MongoDB with fictional data. Verify these complete journeys:

1. An admin creates “Villa”, reads it in both clients and selects its stable identity for an Expense. A regular member cannot mutate Tags, and a role-only denial keeps the accessible Group visible.
2. An archived “Villa” reserves its name; attempted case-variant creation offers Restore. Restoring reuses the identity and its history. Duplicate-name races cannot create two non-deleted Tags with the same normalized name.
3. Admin A opens an edit; admin B changes it through the other client. A’s stale change fails, preserves input and can be explicitly reviewed/reapplied. An older client cannot bypass the required precondition.
4. Drop a reply after each action is applied, close/restart, then Check and explicitly Retry. Confirm one effect for the same action. Include another admin changing the Tag between application and recovery, and an unapplied action becoming stale before retry.
5. Archive preserves Expense amounts, filters and Tag identity; saved Expenses can retain their archived Tag. Retained Drafts keep input and require an active selection before saving. Verify existing recurring behavior with the recurring switch enabled only in the isolated test fixture.
6. Attempt archive/delete of the last active Tag, including two concurrent admins retiring the last two Tags. At least one remains. A historical zero-active Group remains readable and can be repaired explicitly.
7. Close a dirty unsubmitted name form, go offline, lose admin/membership permission and change accounts during pending reads/writes. Check confirmation copy, retained recovery, isolation and the absence of automatic submissions.

Run relevant repository lint, typecheck, regression and build gates, with independent Standards and Spec review. Inspect a frozen Android build on the emulator in light/dark, narrow layout and large text; verify named controls, keyboard behavior, Back navigation, error/conflict/recovery states and the Expense picker regression. Physical phone acceptance and spoken accessibility checks remain separate from emulator claims.

## Implementation order and authority

1. Shared backend contract and compatibility: permissions, versions, exact action receipts, last-active invariant, scoped cleanup and public HTTP verification.
2. Web controls adopt the contract, conflict/recovery behavior and confirmation copy.
3. Android Group-options manager and account-local recovery integrate with existing queries and saved-copy rules.
4. Combined cross-client regression, frozen emulator verification and independent reviews.

Keep implementation isolated from unrelated work. The owner confirmed this consolidated design and test seams on 13 October 2026, allowing local implementation to resume. Specific GitHub publication/merge and staging rollout approvals still follow RESUME-PROMPT.md. No staging/prod changes, historical database cleanup or user-phone actions are included in design confirmation.
