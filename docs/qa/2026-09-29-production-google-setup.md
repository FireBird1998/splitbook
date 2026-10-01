# Production Google setup — 29 September 2026

## Completed

- Created the dedicated Google Cloud project `Splitbook` (`splitbook-5471`) under the owner's existing organization. Existing shared-project clients were preserved.
- Configured the Splitbook consent identity, owner support/developer contact and External / Testing audience. The owner completed the Google policy agreement.
- Created `Splitbook Production Web` after explicit approval, with origin `https://splitbook-ankit-das-projects.vercel.app` and callback `/api/auth/callback/google` on that origin.
- Saved the owner account as the sole test user after explicit approval.
- Installed the new matching `AUTH_GOOGLE_ID` and `AUTH_GOOGLE_SECRET` in Vercel's Production environment only. Credential values are omitted from this report.
- Requested a production rebuild of the previously live deployment, preserving source commit `2d6db3e2ee84c19d6fe4de8a8ceb744a6826c818`. New deployment: `dpl_9UpWTa7GdKHdGiyAZQ8MujxSJxLf`.
- Vercel confirmed the rebuild READY and the production alias assigned. Live login sends the new Google client ID, expected production callback and PKCE, requesting only `openid`, `email` and `profile`.
- Real Google sign-in with the owner succeeded and the authenticated dashboard rendered. A fresh browser tab retained the session. Sign-out returned to the public homepage; a subsequent direct dashboard request redirected to login.
- A second real Google sign-in succeeded after sign-out. Reloading the dashboard retained the authenticated owner session.

## Verification still pending

- Full production database/ledger acceptance and denied-account verification.
- Mobile Google integration and staging client/release setup.

## Limits

- The Vercel environment pull returned empty placeholders for application settings; it is not a usable backup of their values. An attempted broader decrypted backup was blocked by automatic approval review; no such backup ran. Subsequent changes were limited to the Google pair.
- This rebuild preserves the existing live source; it does not establish that production includes every newer merge on main.
- Local development settings, Atlas users/roles and existing OAuth clients were not changed. Real sign-in exercised normal production authentication writes; no ledger data was created or changed.
