# Connect the Hostinger domain to Splitbook on Vercel

## Assignment for the domain agent

Connect the owner's existing Hostinger domain to the existing Splitbook Vercel project and verify real Google sign-in on the final address. The owner has authorized this work and browser access. This task concerns the website domain only. Keep domain registration at Hostinger; preserve existing email DNS and unrelated services. No domain purchase, transfer, paid upgrade, Android implementation, or database migration is included.

The exact domain has not been identified in this conversation. Inspect the owner's signed-in Hostinger Domains page. If there is more than one plausible domain or the chosen domain serves another site, ask which domain or subdomain should host Splitbook before changing its routing.

## Known project and authentication state

- Repository: `FireBird1998/splitbook`; Next.js app directory: `apps/web`.
- Vercel project: `splitbook`, scope `ankit-das-projects`, project ID `prj_SMrj9nKC4uUEse67y9cmwDxq4lKu`.
- Existing production address: `https://splitbook-ankit-das-projects.vercel.app`.
- Dedicated Google Cloud project: `Splitbook`, ID `splitbook-5471`.
- Google Web OAuth client: `Splitbook Production Web`.
- The matching Google client ID and secret are installed in Vercel Production. Real owner sign-in, session persistence, sign-out, protected-page redirect and repeat sign-in passed on 29 September. Read `docs/qa/2026-09-29-production-google-setup.md` for evidence and limits. No secret belongs in this handoff or a chat message.
- The production auth rebuild preserved the previously deployed source; newer main changes must not be bundled into a domain-only deployment accidentally. Inspect the current deployment before deciding how to redeploy.

## Execution sequence

1. **Inspect and prepare rollback.** Read the repository instructions, Vercel domain configuration and the selected domain's authoritative DNS. Record the exact web records being replaced and their TTLs. Establish the intended canonical hostname (apex or `www`) with the owner if ambiguous. Preserve MX, TXT email authentication, and unrelated subdomain records. Completion: target hostname, current routing and rollback are explicit.
2. **Register the hostname with Vercel.** Add it to the existing Splitbook project. Use the current project-specific DNS values Vercel supplies; do not copy generic IP values from an old guide. Resolve ownership verification if required. Prefer editing the necessary A/CNAME/TXT records at Hostinger rather than moving nameservers. Completion: the hostname belongs to the intended project and the required records are known.
3. **Prepare Google authentication before canonical cutover.** In the dedicated Splitbook project, retain the working Vercel origin/callback and add the new HTTPS origin and `https://<canonical-host>/api/auth/callback/google`. Update authorized-domain branding only where required. Keep the existing Google client and secret. Completion: both old and new addresses are registered correctly.
4. **Apply DNS and verify HTTPS.** Change only the selected website records, resolving conflicting web records if necessary. Follow tool-required confirmation rules for consequential changes. Verify authoritative resolution, Vercel domain verification, certificate readiness and site loading. Completion: HTTPS serves Splitbook with no certificate warning or redirect loop.
5. **Switch application origin.** Set Production `NEXT_PUBLIC_APP_URL` to the canonical HTTPS origin after inspecting the current auth configuration for any additional explicit base/trusted-origin setting. Change only required origin settings. Rebuild the same known deployed source, coordinate concurrent deployments with the owner, and verify the resulting source revision. Preserve the old OAuth callback as a fallback. Completion: login requests carry the new callback and the hostname redirects behave as intended.
6. **Run real acceptance checks.** On the new hostname, test approved Google sign-in, refresh, logout, direct protected-page access after logout, and sign-in again. Check Group navigation and invitation URL generation without creating unwanted ledger data. Record the tested hostname, deployment revision, final web DNS changes, screenshots and remaining limitations. Completion: final URL and evidence are delivered; no claim of complete production database QA is made from login alone.

## Coordination with Android work

Another agent is implementing Android Google login against a separate staging ledger. This assignment owns only the production website hostname and its Google callback. Report the final production origin and any selected staging hostname to the owner; let the Android agent configure staging and App Links for its actual package/certificate. Preserve the existing app sessions and account allowlist. Avoid changing production credentials while the Android agent is testing shared auth code.

## Cost and scope

Adding an existing custom domain does not itself require a paid Vercel upgrade. Hostinger renewal continues. Vercel Hobby eligibility and usage limits still apply. If a provider asks for payment, broader access, or a plan upgrade, explain the concrete requirement before proceeding.

References: [Vercel domain setup](https://vercel.com/docs/domains/working-with-domains/add-a-domain), [Vercel Hobby](https://vercel.com/docs/plans/hobby).
