---
status: accepted
date: 2026-09-27
---

# Expo React Native client with online financial writes

SplitBook's mobile client will use React Native with Expo development builds, launching on Android first while keeping the shared app compatible with a later iOS release. This preserves the TypeScript domain reuse and shared backend established by ADRs 0001–0003; separate Kotlin and Swift implementations would duplicate the client and its financial rules. The first usable milestone is a connected private beta with real sign-in and shared data, with fictional demo personas restricted to development.

The first release permits viewing previously loaded data with an explicit offline label and preserving unsaved drafts. Saving an Expense or recording a Settlement requires a connection; offline financial writes and automatic synchronization are outside this initial decision. Cached figures do not promise a current balance, and an unsaved draft does not change the ledger.

Internal Android APKs will connect to a separate staging ledger for the first beta. Live-data cutover follows verified authentication and ledger rollout; a public Play Store release and a paid cloud build service are not selected by this decision.

An unfinished Expense is preserved as one draft per Group and signed-in account across app restarts. Local financial data is cleared on sign-out. A submission whose response was lost retains its attempted payload and retry identity, separately from editable draft state, so reconnecting and retrying cannot turn one action into duplicate records. A conflicting edit preserves the draft and requires review against the latest saved Expense before resubmission. These recovery choices deliberately avoid automatic offline financial synchronization and automatic money-field merging.
