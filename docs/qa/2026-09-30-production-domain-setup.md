# Production custom domain — 30 September 2026

## Scope and owner decisions

The owner requested the Hostinger-to-Vercel domain assignment and selected `https://splitbook.in` as canonical, with `www.splitbook.in` redirecting to it. They explicitly approved adding the new Google OAuth origin and callback. Registration and authoritative DNS remain at Hostinger. No paid service, domain transfer, database migration or Android change was performed.

## Routing and rollback

Hostinger initially served its parked-domain page. The complete DNS table contained only these records:

| Type  | Name | Previous value | Previous TTL | Final value                         | Final TTL |
| ----- | ---- | -------------- | ------------ | ----------------------------------- | --------- |
| A     | @    | 2.57.91.91     | 50           | 216.198.79.1                        | 300       |
| A     | @    | absent         | —            | 64.29.17.1                          | 300       |
| CNAME | www  | splitbook.in   | 300          | 1832a21bfee9a191.vercel-dns-017.com | 300       |

Both apex addresses and the CNAME came from `vercel domains verify`, scoped to the existing Splitbook project, on the execution date. Hostinger nameservers remain `artemis.dns-parking.com` and `hermes.dns-parking.com`. There were no MX, TXT or AAAA records in the initial table/queries. No unrelated domain was modified.

Vercel project `prj_SMrj9nKC4uUEse67y9cmwDxq4lKu`, scope `ankit-das-projects`, now owns both hostnames. `www` uses an HTTP 308 redirect to the apex. Both domains passed Vercel configuration/ownership verification; both authoritative nameservers returned the final records. HTTPS certificate-chain and hostname verification passed without bypasses. The apex certificate is issued by Google Trust Services and expires 28 December 2026; the www certificate is issued by Let's Encrypt and expires the same date.

To roll back DNS, remove the added `64.29.17.1` record, restore the apex to `2.57.91.91`, and restore `www` to `splitbook.in`. Hostinger now enforces a minimum TTL of 60 seconds, so the original apex TTL of 50 cannot be entered through its current UI; use 60 or 300 seconds. Keep existing nameservers.

## Authentication and deployment

The existing `Splitbook Production Web` OAuth client in Google project `splitbook-5471` retains its original Vercel origin/callback. Added and verified persisted values:

- `https://splitbook.in`
- `https://splitbook.in/api/auth/callback/google`

No credential rotation, consent scope, test-user, allowlist or session-policy change was made. Google accepted the client settings without requiring a branding update; the app remains in Testing status.

The deployed source derives Better Auth `baseURL`, `trustedOrigins` and invitation URLs from `NEXT_PUBLIC_APP_URL`. Only this Production variable was changed, to `https://splitbook.in`; its Production-only scope and existing sensitive type were preserved. Vercel returned null for the old sensitive value, so that value was not backed up from the environment API; the former origin is recorded in the previous verified production report.

Pre-change live deployment: `dpl_9UpWTa7GdKHdGiyAZQ8MujxSJxLf`, URL `https://splitbook-m7ljzp4sh-ankit-das-projects.vercel.app`, source `2d6db3e2ee84c19d6fe4de8a8ceb744a6826c818`. No active concurrent Production build was present before the rebuild request.

Requested rebuild of that exact deployment: `dpl_2Sg2FWmuvLKtJyBN7R8L8W6pRW7s`, URL `https://splitbook-hylnx2ama-ankit-das-projects.vercel.app`. The rebuild is READY, source identity remained `2d6db3e2ee84c19d6fe4de8a8ceb744a6826c818`, and both custom hostnames plus the existing Vercel aliases are assigned. Build phase took approximately 127 seconds. This did not deploy newer changes on main.

Application rollback: restore Production `NEXT_PUBLIC_APP_URL` to `https://splitbook-ankit-das-projects.vercel.app` and rebuild the previous known deployment, or restore its deployment aliases using Vercel rollback. Preserve the original Google callback for this fallback. Sessions on the previous hostname are not transferred across unrelated browser cookie domains; no session store was cleared.

## Acceptance

All requested domain acceptance checks passed on `https://splitbook.in`:

| Check                                | Result                                                                                                                                                          |
| ------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Apex HTTPS loading                   | PASS: valid certificate, HTTP 200, Splitbook rendered                                                                                                           |
| HTTP to HTTPS                        | PASS: HTTP 308 to HTTPS apex                                                                                                                                    |
| www canonical redirect               | PASS: HTTP 308 to apex, preserving path and query string                                                                                                        |
| Google callback generation           | PASS: `https://splitbook.in/api/auth/callback/google`, `email profile openid`, PKCE S256                                                                        |
| Real approved-owner Google sign-in   | PASS: authenticated owner dashboard on new hostname                                                                                                             |
| Authenticated refresh                | PASS: owner session persisted and dashboard rendered                                                                                                            |
| Sign-out                             | PASS: returned to public homepage                                                                                                                               |
| Direct dashboard access after logout | PASS: redirected to `/login?callbackUrl=%2Fdashboard`                                                                                                           |
| Repeat real Google sign-in           | PASS: selected the approved owner account at Google; returned to new-host dashboard                                                                             |
| Group navigation                     | PASS: new-host Groups page loaded; initially no groups existed                                                                                                  |
| Invitation URL generation            | PASS: owner explicitly authorized one empty General Group named `Domain verification`; generated `https://splitbook.in/join/[redacted]`, expiring in seven days |

The approved verification Group remains in production, ID `6abc5d43d990c2fa4408c85a`, with one owner member and zero expenses/settlements. No invitation was sent or shared. No user or session store was reset. This task exercised normal authentication writes plus the explicitly approved Group/invite creation.

A deployment-specific Vercel error-level log query for the preceding 15 minutes returned no logs. This is a bounded observation, not a monitoring or full production-health certification. No log drains or monitoring configuration was changed.

## Evidence and limitations

Evidence files are retained under `docs/qa/evidence/2026-09-30-domain/`:

- `hostinger-final-dns.png`: all three final DNS records.
- `google-callback-saved.png`: persisted old and new Google callback configuration; secret remains masked in the screenshot.
- `groups-navigation.png`: successful authenticated Groups navigation before Group creation.
- `protected-page-after-logout.png`: login screen reached from a protected route after logout.
- `authenticated-dashboard.png`: final authenticated dashboard.
- `deployment-final.json`: READY deployment, exact source revision and assigned aliases.
- `invitation-url-verified.txt`: rendered invitation result with invite token redacted.

The canonical production origin to use in handoffs is `https://splitbook.in`. No staging hostname was selected or configured. Android staging auth and App Links remain separate work.

Google remains in External / Testing status and the existing account allowlist is unchanged. No denied-account test, full production ledger/database QA, device OAuth test, or global propagation guarantee is claimed. No plan file, application source, production credential, Atlas configuration, or unrelated Hostinger service was changed. The old OAuth callback remains a rollback fallback; normal browser cookies do not transfer across unrelated domains.
