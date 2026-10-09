## Problem

Tapping New Expense from a Group that just loaded shows “Opening your draft…” while the app repeats the Group request. Network latency blocks an otherwise local form. TanStack Query already owns the verified Group data.

## Specification

Reuse the Group response for a new Expense only when it was verified online within the existing 30-second display freshness window, the app is online, and no Group read is in flight. Use the existing verifiedGroup policy, including its account/environment query key and original response verification time. Do not introduce another cache.

Load local draft storage before choosing a blank form, recovered draft or unconfirmed-save recovery. For a warm new form without a known kept draft, keep the Group visible until the local recovery check finishes. Route or account changes during that check cancel the open. Known kept-draft navigation remains unchanged. The improvement removes the unnecessary network wait. Cold, expired, offline, restored-copy and currently-refreshing contexts keep the existing Group-read path. Saved Expense records retain their current fresh access check.

Existing foreground/reconnect refresh remains in charge of background reads. Opening a recently verified form does not add a second refresh request. Save must still perform its explicit online Group check before any financial write; an access denial must still evict Group content and prevent a write. Retry keys and revisions stay unchanged.

## Acceptance criteria

- [ ] A new Expense opened over a recently verified Group makes no additional Group request and reaches the correct editable form.
- [ ] Missing or older-than-30-second context waits for a fresh read; no stale shortcut.
- [ ] An in-flight refresh is joined rather than bypassed.
- [ ] Drafts and unconfirmed saves remain recoverable and take precedence over a blank form.
- [ ] After access is revoked, Save checks online and sends no Expense write.
- [ ] Viewing an existing Expense still performs its fresh Group check.
- [ ] Restored/offline content is never treated as freshly verified, and data cannot cross accounts.

## Implementation and validation

Change only the new-Expense Group selection in the controller to reuse the existing verifiedGroup helper. Preserve navigation, storage and query ownership. Add public-controller tests for request counts, expiry/in-flight reads, draft recovery and Save-time refusal. Run the mobile unit suite, TypeScript, lint and formatting. Device verification: load a Group online, tap New Expense immediately, verify the network-dependent loading gap is gone; retry with expired context and confirm access denial still blocks saving.
