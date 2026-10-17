# Android Google login beta implementation plan

## Approved outcome

Deliver a polished signed Android APK for the owner and invited testers. Use a native Google account chooser, the existing Next.js/Better Auth backend architecture, approved Google email addresses, and a separate staging ledger. The owner confirmed this scope after the grilling interview. Public Play Store release, iOS release, automatic production-data migration and paid services are outside the first milestone.

## Implementation order

1. **Compatibility proof:** validate a current Android Credential Manager integration against installed Expo/React Native versions and the real Android build toolchain. Prefer a maintained free integration; commit the dependency only after compilation and a native smoke check. If native compatibility fails, present evidence before changing to browser OAuth.
2. **Runtime and session boundary:** separate environment/authentication capability from demo-persona availability. Staging must accept HTTPS configuration and restore real saved sessions. Extend the existing controller's ownership, cookie persistence, request invalidation and cleanup boundary.
3. **Google authentication:** request a native Google identity token with the configured server audience and exchange it through Better Auth. Keep secrets on the server, enforce allowed emails on every sign-in, validate intended token audience, preserve web OAuth, and scope trusted native origins to configured schemes. Translate cancellation, unavailable services, rejected accounts and network failures into useful UI states.
4. **Staging and signed build:** provision or verify separate staging deployment/database, configure the actual package and signing certificate in Google, configure Android App Links for the real staging host, and deliver a reproducible signed APK. Keep demo entry restricted to development.
5. **UX and recovery:** native account selection, meaningful progress, accessible light/dark login screen, restart persistence, expiry handling, invitation continuation, safe logout and account switching. Preserve offline-read labels, account-isolated drafts, and immutable lost-response retry identities.
6. **Release verification:** test real approved and denied accounts, cancellation, interrupted login, restart, expiry, offline/online recovery, invite continuation, sign-out and account switching. Run a full Group/Expense/balance/Settlement journey and applicable shared/web/mobile regressions. Verify on emulator and physical Android hardware; identify unperformed device/provider checks explicitly.

## Existing work and boundaries

- Reconcile existing issues #35, #36 and #60 rather than duplicating them. Native client registration must use the actual staging package/certificate, not blindly follow older production-only identifiers.
- Authentication was development-only at planning time: staging configuration was rejected and session restore depended on the demo flag. Treat these as implementation gaps, not only UI work.
- The controller already owns sensitive session/account cleanup. Avoid a second independent session store.
- Production web Google login is verified in `docs/qa/2026-09-29-production-google-setup.md`. Keep its working configuration and regression behavior.
- Production domain changes belong to the separate handoff in `2026-09-30-hostinger-vercel-domain-handoff.md`. Read the final hostname before configuring native App Links; staging does not inherit the production database.
- Existing user's local demo database, environment files, dirty checkout and attached plans are preserved. Implementation occurs in an isolated branch/worktree.

## Completion evidence

Record exact source revision, changed configuration without secrets, automated commands/results, native build result, real-device/provider outcomes, screenshots, and remaining release gates. A compiled APK or mocked token test alone is not proof of real Google sign-in. Do not close operational tickets until their actual acceptance criteria are evidenced.
