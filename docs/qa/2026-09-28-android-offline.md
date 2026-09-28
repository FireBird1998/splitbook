# Android offline financial views — ticket #59

Verified on 2026-09-28 using the Android development client, the public mobile controller, and owned fictional fixtures. This is not a staging APK or Google OAuth verification.

## Automated checks

- Workspace unit tests: 587 passed (shared 259, web 137, mobile 191).
- Workspace TypeScript and ESLint checks passed.
- Web integration tests: 130 passed on the existing local test Mongo at port 27018. The first invocation used unavailable default port 27017; rerunning with `TEST_MONGODB_URI` resolved that environment failure.
- `MOBILE_VERIFY_URL=http://127.0.0.1:4145 pnpm mobile verify:offline` passed after the review fixes. It creates and archives its own Group through authenticated HTTP, uses disk-backed account state, and verifies cached Home, Group, visited Month, running balances and Activity; cold offline restoration; an unvisited Month; retained draft; reconnect without writes; membership removal; and sign-out purge.
- Sixteen public-controller offline regressions cover account switching, expired identity/session, server errors, corrupt/wrong-owner/future cache envelopes, partial connectivity, membership-list removal, and the review cases below. Existing financial tests continue to cover immutable uncertain attempts and explicit retries.

## Android device checks

Task-owned `SplitBook55` emulator, serial `emulator-5556`; existing compatible debug binary `com.splitbook.app.dev`; current Metro bundle on port 8085. No native dependencies changed. The fictional backend used separately marked database `splitbook_mobile_59` on port 4145. A loopback proxy on port 4146 disconnected API traffic while keeping Metro reachable; this tests actual native fetch failure rather than UI-only airplane-mode labels.

1. Signed in as fictional Sam and loaded Home, Maple House, August expenses, running balances and Activity. Force-stopped and reopened with API disconnected. SecureStore restored the last verified account; SQLite restored cached views with an explicit stale notice and saved refresh timestamp.
2. August remained readable. July, which had not been visited online, showed “This view was not saved on this device. Connect to load it.” It did not display a fake empty summary.
3. Prepared `QA59 offline draft`, INR 12, Groceries Tag. Save visibly reported the connection failure. After force-stop/reopen, **Resume draft** recovered its values from SQLite.
4. Restored API connectivity and foregrounded the app. The draft remained intact. An independent authenticated HTTP read confirmed zero Expenses with that description; reconnect did not submit it.
5. Removed fictional Sam from the owned Household, then foregrounded the app. The editor retained the draft, showed revoked access and removed Save. Another offline cold restart showed unavailable Home/Group cache instead of resurrecting revoked content. Restored the fixture membership afterward.
6. Signed out while disconnected and confirmed the purge. An offline cold restart returned to the persona sign-in screen without account content.
7. Inspected dark appearance with font scale 1.3 and light appearance at scale 1.0. The stale notice, timestamp, draft values and sign-out confirmation remained readable; controls were reachable by scrolling. Expo's developer Tools overlay overlaps the app's Settings icon in this existing debug binary, so Settings was accessed through its unobstructed bounds.

Native screenshot evidence is saved in the task output directory as `qa59-offline-draft-dark-large.png` and `qa59-signout-light.png`. These checks exercise Android SQLite/SecureStore, separately from the disk-backed Node verifier. The API outage does not simulate loss of Metro or a standalone release binary.

## Standards review

No outstanding findings. The optional duplicate identity-persistence code was consolidated into `saveVerifiedIdentity`.

## Spec review

Two findings were reproduced and corrected: Home's retained cached Group list losing its stale provenance after child navigation; and a Group denial while opening an Expense leaving the Group card in memory. Regression tests passed and the independent reviewer confirmed both fixes. No outstanding Spec findings.

## Remaining release work

Real platform OAuth configuration (#35), native auth integration (#36), and signed staging APK/install verification (#60) remain separate. No real staging host, platform OAuth audience, signing certificate, or Google callback was verified by this ticket.
